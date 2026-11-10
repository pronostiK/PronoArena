// ============================================================
// PRONO ARENA — Robot autonome (déclenché toutes les 10 minutes)
// À chaque passage : met à jour les sources les plus "en retard",
// puis recalcule les pronostics des compétitions concernées.
// ============================================================
import { currentSeason, robotSources, leaguesUsing } from "./config.js";
import { kvGet, refreshSource } from "./sources.js";
import { buildLeague, predsKey, archiveKey, mergeArchive, INDEX_KEY } from "./build.js";
import { lastEvents, refreshOneCompo } from "./compos.js";

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
      return { ...s, k, urgent, overdue: overdue + (s.kind === "live" ? 1 : 0) + (urgent ? 1e13 : 0) };
    })
    .filter((s) => s.overdue >= 0)
    .sort((a, b) => b.overdue - a.overdue);
}

export async function saveLeague(env, leagueId, season, now, index = null) {
  const result = await buildLeague(env, leagueId, season, now, index);
  if (!result) return false;
  if (index) {
    index[`count:${leagueId}`] = result.count; // pour /leagues, sans relire les pronostics
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
  // Compositions : une équipe par passage (prend une des 3 places du passage s'il y a du travail)
  let compoDone = false;
  // Pas de composition tant que des données manquent (remplissage) ou qu'un match se joue
  const pending = pickDue(robotSources(season), index, now);
  const busy = pending.some((x) => x.urgent || !index[x.k] || index[x.k].complete === false);
  if (!busy) try { const r = await refreshOneCompo(env, index, season, now); if (r) { report.push(r); compoDone = true; } }
  catch (e) { report.push(`compositions : ERREUR ${e.message}`); compoDone = true; }
  const due = pickDue(robotSources(season), index, now).slice(0, MAX_PER_RUN - (compoDone ? 1 : 0));
  const toRebuild = new Set();

  for (const s of due) {
    try {
      const { changed, data } = await refreshSource(env, s.src, s.season, now);
      const next = (data.upcoming || []).map((u) => u[3]).filter((t) => t > now - 3 * 3600000).sort((a, b) => a - b)[0] || null;
      const live = (data.upcoming || []).some((u) => /IN_PLAY|PAUSED|LIVE|IN_PROGRESS|HALFTIME|FIRST_HALF|SECOND_HALF/.test(u[4]));
      index[s.k] = { updatedAt: now, lastOk: now, complete: data.complete, nextTs: next, live, finished: data.finished.length, upcoming: data.upcoming.length, changed };
      // Sources ESPN : dernier match de chaque équipe et noms (pour les compositions)
      if (s.kind === "live" && s.src.startsWith("espn:")) {
        index[`last:${s.k}`] = lastEvents(data);
        index[`names:${s.src.slice(5)}`] = Object.fromEntries(Object.entries(data.teams).map(([id, t]) => [id, t[0]]));
      }
      // Saison en cours OU saison précédente : les pronostics qui en dépendent sont recalculés
      for (const id of leaguesUsing(s.src)) {
        if (changed || (s.kind === "live" && !(await env.PRONO_CACHE.get(predsKey(id, season))))) toRebuild.add(id);
      }
      report.push(`${s.k}: ok (${data.finished.length} terminés, ${data.upcoming.length} à venir${changed ? ", mis à jour" : ""})`);
    } catch (e) {
      index[s.k] = { ...(index[s.k] || {}), updatedAt: now, error: String(e.message || e) };
      // Source en panne : on revérifie les compétitions concernées (bascule sur le secours si besoin)
      if (s.kind === "live") for (const id of leaguesUsing(s.src)) toRebuild.add(id);
      report.push(`${s.k}: ERREUR ${e.message}`);
    }
  }

  for (const id of toRebuild) {
    try { if (await saveLeague(env, id, season, now, index)) report.push(`pronostics ${id}: recalculés`); }
    catch (e) { report.push(`pronostics ${id}: ERREUR ${e.message}`); }
  }

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
  return { saison: season, progression: `${ok}/${total} sources à jour`, dernierPassage: index._lastRun ? { date: new Date(index._lastRun.at).toISOString(), rapport: index._lastRun.report } : null, sources };
}
