// ============================================================
// DUEL PRONO — Robot autonome (déclenché toutes les 10 minutes)
// À chaque passage : met à jour les sources les plus "en retard",
// puis recalcule les pronostics des compétitions concernées.
// ============================================================
import { currentSeason, robotSources, leaguesUsing } from "./config.js";
import { kvGet, kvPutIfChanged, refreshSource, resetEspnBudget, espnBudgetLeft, ESPN_RECENT_DAYS, ESPN_EXTRA_DAYS, refreshSportapi, resetSpBudget, spBudgetLeft } from "./sources.js";
import { buildLeague, predsKey, archiveKey, mergeArchive, INDEX_KEY, buildUpcoming, allKey } from "./build.js";
import { lastEvents, refreshOneCompo } from "./compos.js";
import { gradePicks, cleanArena } from "./arena.js";
import { refreshSeed } from "./nations.js";
import { LEAGUES } from "./config.js";

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const MAX_PER_RUN = 3;

// Délai souhaité entre deux mises à jour d'une source
function targetDelay(meta, kind, now) {
  if (meta?.error) return kind === "history" ? 7 * DAY : 30 * MIN;
  if (!meta || meta.complete === false) return 0;            // saison en cours de remplissage
  if (kind === "history") return 30 * DAY;                    // saison terminée : quasi figée
  if (meta.live || (meta.nextTs && meta.nextTs < now + 30 * MIN && meta.nextTs > now - 3 * HOUR)) return 15 * MIN; // match en cours / imminent
  if (meta.nextTs && meta.nextTs < now + DAY) return HOUR;    // match dans les 24 h
  return 3 * HOUR;
}

export function pickDue(sources, index, now) {
  return sources
    .map((s) => {
      const k = `${s.src}@${s.season}`, meta = index[k];
      const overdue = (now - (meta?.updatedAt || 0)) - targetDelay(meta, s.kind, now);
      // priorité : match en cours ou imminent > saison en cours > historique
      const urgent = s.kind === "live" && targetDelay(meta, s.kind, now) === 15 * MIN;
      // Premier chargement : les compétitions affichées passent avant les sources de secours
      const first = s.main && !meta?.error && (!meta || meta.complete === false);
      // SportAPI : le chargement de l'historique (saison précédente) passe avant tout, même avant les matchs en direct,
      // sinon il reste bloqué les soirs de matchs et la compétition n'est jamais publiée. Coût : 15 appels par passage, pendant ~4 h.
      const fill = s.src.startsWith("sp:") && !meta?.error && (!meta || meta.complete === false);
      // Les sources ESPN / football-data en direct sont revues à chaque passage ; SportAPI (quota d'appels par jour) toutes les 15 min seulement
      const dueNow = overdue >= 0 || (urgent && !s.src.startsWith("sp:"));
      return { ...s, k, urgent, dueNow, overdue: overdue + (s.kind === "live" ? 1 : 0) + (urgent ? 1e13 : 0) + (first && overdue >= 0 ? 1e12 : 0) + (fill ? 1e14 : 0) };
    })
    .filter((s) => s.dueNow)
    .sort((a, b) => b.overdue - a.overdue);
}

export async function saveLeague(env, leagueId, season, now, index = null) {
  const result = await buildLeague(env, leagueId, season, now, index);
  if (!result) return false;
  if (index) {
    index[`count:${leagueId}`] = result.count; // pour /leagues, sans relire les pronostics
    if (result.modele?.selections) index[`selections:${leagueId}`] = result.modele.selections; // pour /status
    index[`teams:${leagueId}`] = [...new Set(result.predictions.flatMap((p) => [p.teams.domicile.id, p.teams.exterieur.id]))]; // pour les compositions
  }
  const key = predsKey(leagueId, season);
  const old = await env.PRONO_CACHE.get(key);
  const strip = (o) => JSON.stringify({ p: o.predictions, c: o.classement, m: o.modele?.matchsAnalyses, s: o.modele?.source });
  if (old && strip(JSON.parse(old)) === strip(result)) return false;
  await env.PRONO_CACHE.put(key, JSON.stringify(result));
  // Archive pour le Verdict : chaque pronostic est figé au coup d'envoi
  const aKey = archiveKey(leagueId, season);
  const prevArchive = JSON.parse((await env.PRONO_CACHE.get(aKey)) || "{}");
  const next = mergeArchive(prevArchive, result, now);
  if (JSON.stringify(next) !== JSON.stringify(prevArchive)) await env.PRONO_CACHE.put(aKey, JSON.stringify(next));
  return true;
}

export async function runRobot(env, now = Date.now()) {
  const season = currentSeason(new Date(now));
  const index = (await kvGet(env, INDEX_KEY)) || {};
  const report = [];
  resetEspnBudget();
  resetSpBudget();
  // ESPN refuse parfois les appels (403 / 429) : on arrête tout de suite et on attend avant de réessayer,
  // de plus en plus longtemps (30 min, 1 h, 2 h, 4 h), au lieu d'insister et d'aggraver le blocage.
  let espnPaused = (index._espnPause?.until || 0) > now;
  if (espnPaused) report.push(`ESPN en pause jusqu'à ${new Date(index._espnPause.until).toISOString()} (${index._espnPause.raison})`);
  const pauseEspn = (raison) => {
    const n = (index._espnPause?.n || 0) + 1;
    index._espnPause = { n, until: now + Math.min(30 * MIN * 2 ** (n - 1), 4 * HOUR), raison };
    espnPaused = true;
  };
  const refused = (e) => /\[(403|429)\]/.test(String(e?.message || e));
  // Compositions : une équipe par passage (prend une des 3 places du passage s'il y a du travail)
  let compoDone = false;
  // Pas de composition tant que des données manquent (remplissage) ou qu'un match se joue
  const pending = pickDue(robotSources(season), index, now);
  // (un match SportAPI en cours ne bloque pas les compositions : ses appels sont comptés à part et peu nombreux)
  const busy = pending.some((x) => (x.urgent && !x.src.startsWith("sp:")) || !index[x.k] || index[x.k].complete === false);
  if (!busy && !espnPaused) try { const r = await refreshOneCompo(env, index, season, now); if (r) { report.push(r); compoDone = true; } }
  catch (e) { report.push(`compositions : ERREUR ${e.message}`); compoDone = true; if (refused(e)) pauseEspn("compositions refusées"); }
  // Matchs en cours : jusqu'à 6 compétitions par passage (mises à jour éclair, légères)
  // SportAPI : un seul appel alimente toutes ses compétitions d'une saison, donc une seule place par saison
  const spSeen = new Set();
  const all = pickDue(robotSources(season), index, now).filter((x) => !x.src.startsWith("sp:") || (!spSeen.has(x.season) && spSeen.add(x.season)));
  const nUrgent = all.filter((x) => x.urgent).length;
  const due = all.slice(0, Math.max(MAX_PER_RUN - (compoDone ? 1 : 0), Math.min(6, nUrgent)));
  const toRebuild = new Set();

  const ready = (id) => {
    const lg = LEAGUES[id];
    if (!lg.src.startsWith("sp:")) return true;
    return [`${lg.src}@${season}`, ...(lg.cup ? [] : [`${lg.src}@${season - 1}`])].every((k) => index[k]?.complete && !index[k]?.error);
  };
  // Après une mise à jour réussie d'une source : état dans l'index et compétitions à recalculer
  const afterOk = async (s, data, changed) => {
    const next = (data.upcoming || []).map((u) => u[3]).filter((t) => t > now - 3 * 3600000).sort((a, b) => a - b)[0] || null;
    const live = (data.upcoming || []).some((u) => /IN_PLAY|PAUSED|LIVE|IN_PROGRESS|HALFTIME|FIRST_HALF|SECOND_HALF/.test(u[4]));
    index[s.k] = { updatedAt: now, lastOk: now, complete: data.complete, nextTs: next, live, finished: data.finished.length, upcoming: data.upcoming.length, changed };
    // Sources ESPN : dernier match de chaque équipe et noms (pour les compositions)
    if (s.kind === "live" && s.src.startsWith("espn:")) {
      index[`last:${s.k}`] = lastEvents(data);
      index[`names:${s.src.slice(5)}`] = Object.fromEntries(Object.entries(data.teams).map(([id, t]) => [id, t[0]]));
    }
    // Saison en cours OU saison précédente : les pronostics qui en dépendent sont recalculés
    // (pendant le remplissage, on attend que les données soient complètes : économise les écritures)
    for (const id of leaguesUsing(s.src)) {
      if (!ready(id)) continue; // SportAPI : « tout ou rien », on ne publie une compétition que lorsque ses saisons sont entièrement chargées
      const missing = s.kind === "live" && !(await env.PRONO_CACHE.get(predsKey(id, season)));
      if ((changed && data.complete !== false) || missing) toRebuild.add(id);
    }
    report.push(`${s.k}: ok (${data.finished.length} terminés, ${data.upcoming.length} à venir${changed ? ", mis à jour" : ""})`);
  };
  const afterError = (s, e) => {
    index[s.k] = { ...(index[s.k] || {}), updatedAt: now, error: String(e.message || e) };
    // Source en panne : on revérifie les compétitions concernées (bascule sur le secours si besoin)
    if (s.kind === "live") for (const id of leaguesUsing(s.src)) toRebuild.add(id);
    report.push(`${s.k}: ERREUR ${e.message}`);
  };

  for (const s of due) {
    if (s.src.startsWith("sp:")) {
      // SportAPI : toutes les sources "sp:" de cette saison sont mises à jour ensemble
      const group = robotSources(season).filter((x) => x.src.startsWith("sp:") && x.season === s.season);
      if (spBudgetLeft() <= 0) { report.push(`${s.k}: reporté (budget du passage)`); continue; }
      try {
        const res = await refreshSportapi(env, group.map((x) => x.src), s.season, now, spBudgetLeft());
        for (const g of group) await afterOk(g.kind ? { ...g, k: `${g.src}@${g.season}` } : g, res[g.src].data, res[g.src].changed);
      } catch (e) { for (const g of group) afterError({ ...g, k: `${g.src}@${g.season}` }, e); }
      continue;
    }
    // ESPN : un appel par jour ; on garde la mise à jour dans le budget du passage
    let extra = ESPN_EXTRA_DAYS;
    if (s.src.startsWith("espn:") && espnPaused) continue; // on ne touche pas à ESPN pendant la pause
    if (s.src.startsWith("espn:")) {
      const left = espnBudgetLeft() - (s.kind === "live" ? ESPN_RECENT_DAYS : 0);
      if (left < (s.kind === "live" ? 0 : 1)) { report.push(`${s.k}: reporté (budget du passage)`); continue; }
      const filling = !index[s.k] || index[s.k].complete === false;
      extra = filling ? left : Math.min(ESPN_EXTRA_DAYS, left); // remplissage : tout le budget du passage
    }
    try {
      const { changed, data } = await refreshSource(env, s.src, s.season, now, extra);
      await afterOk(s, data, changed);
      if (s.src.startsWith("espn:")) delete index._espnPause; // ESPN répond de nouveau
    } catch (e) {
      afterError(s, e);
      if (s.src.startsWith("espn:") && refused(e)) pauseEspn(String(e.message));
    }
  }

  // Changement de méthode pour les sélections : leurs pronostics sont recalculés une fois, sans attendre de nouvelles données
  // Nouveaux réglages du modèle (12/11/2026) puis rang dans le groupe pour les sélections (12/11/2026, rév. 3) : toutes les compétitions sont recalculées une fois
  if (index._modelRev !== 3) { index._modelRev = 3; for (const [id, lg] of Object.entries(LEAGUES)) if (lg.robot !== false) toRebuild.add(Number(id)); }
  if (index._natRev !== 2) { index._natRev = 2; for (const [id, lg] of Object.entries(LEAGUES)) if (lg.national && lg.robot !== false) toRebuild.add(Number(id)); }
  // Sélections : notes Elo rafraîchies une fois par semaine (tous les matchs internationaux)
  if (now - (index._nationsAt || 0) > 7 * DAY) {
    index._nationsAt = now;
    try { if (await refreshSeed(env)) { report.push("sélections : notes Elo mises à jour"); for (const [id, lg] of Object.entries(LEAGUES)) if (lg.national && lg.robot !== false) toRebuild.add(Number(id)); } }
    catch (e) { report.push(`sélections : ERREUR ${e.message}`); }
  }

  for (const id of toRebuild) {
    try { if (await saveLeague(env, id, season, now, index)) report.push(`pronostics ${id}: recalculés`); }
    catch (e) { report.push(`pronostics ${id}: ERREUR ${e.message}`); }
  }

  // Page d'accueil : tous les matchs à venir + date du prochain match de chaque compétition
  try {
    const up = await buildUpcoming(env, season, now, index._free);
    if (up.gratuits.ids.length) index._free = up.gratuits; // les 2 matchs offerts du jour, figés jusqu'à minuit
    for (const k of Object.keys(index)) if (k.startsWith("next:")) delete index[k];
    for (const [id, ts] of Object.entries(up.prochains)) index[`next:${id}`] = ts;
    await kvPutIfChanged(env, allKey(season), up);
  } catch (e) { report.push(`accueil : ERREUR ${e.message}`); }

  // Arène : les pronostics des joueurs sont notés dès que le score final est connu
  try {
    const n = await gradePicks(env, now);
    if (n) report.push(`arène : ${n} match(s) noté(s)`);
    if (env.DB && now - (index._arenaClean || 0) > DAY) { await cleanArena(env, now); index._arenaClean = now; }
  } catch (e) { report.push(`arène : ERREUR ${e.message}`); }

  index._lastRun = { at: now, report };
  await env.PRONO_CACHE.put(INDEX_KEY, JSON.stringify(index));
  return report;
}

export async function robotStatus(env, now = Date.now()) {
  const season = currentSeason(new Date(now));
  const index = (await kvGet(env, INDEX_KEY)) || {};
  const sources = robotSources(season).map((s) => {
    const k = `${s.src}@${s.season}`, m = index[k];
    return {
      source: k,
      type: s.kind === "history" ? "saison précédente" : "saison en cours",
      etat: !m ? "en attente" : m.error ? `erreur : ${m.error}` : m.complete === false ? "remplissage en cours" : "à jour",
      derniereMiseAJour: m?.updatedAt ? new Date(m.updatedAt).toISOString() : null,
      matchsTermines: m?.finished ?? null,
      matchsAVenir: m?.upcoming ?? null,
    };
  });
  const total = sources.length, ok = sources.filter((s) => s.etat === "à jour").length;
  const pause = (index._espnPause?.until || 0) > now ? { jusqua: new Date(index._espnPause.until).toISOString(), raison: index._espnPause.raison, refusConsecutifs: index._espnPause.n } : null;
  const selections = Object.fromEntries(Object.entries(index).filter(([k]) => k.startsWith("selections:")).map(([k, v]) => [LEAGUES[k.slice(11)]?.name || k, v]));
  return { saison: season, selections, matchsOfferts: index._free || null, progression: `${ok}/${total} sources à jour`, espn: pause ? { etat: "en pause", ...pause } : { etat: "ok" }, dernierPassage: index._lastRun ? { date: new Date(index._lastRun.at).toISOString(), rapport: index._lastRun.report } : null, sources };
}
