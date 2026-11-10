// ============================================================
// PRONO ARENA — Robot autonome (déclenché toutes les 10 minutes)
// À chaque passage : met à jour les sources les plus "en retard",
// puis recalcule les pronostics des compétitions concernées.
// ============================================================
import { currentSeason, robotSources, leaguesUsing } from "./config.js";
import { kvGet, refreshSource } from "./sources.js";
import { buildLeague, predsKey } from "./build.js";

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const INDEX_KEY = "robot:index";
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
      // priorité : saison en cours avant historique
      return { ...s, k, overdue: overdue + (s.kind === "live" ? 1 : 0) };
    })
    .filter((s) => s.overdue >= 0)
    .sort((a, b) => b.overdue - a.overdue);
}

export async function saveLeague(env, leagueId, season, now) {
  const result = await buildLeague(env, leagueId, season, now);
  if (!result) return false;
  const key = predsKey(leagueId, season);
  const old = await env.PRONO_CACHE.get(key);
  const strip = (o) => JSON.stringify({ p: o.predictions, c: o.classement, m: o.modele?.matchsAnalyses });
  if (old && strip(JSON.parse(old)) === strip(result)) return false;
  await env.PRONO_CACHE.put(key, JSON.stringify(result));
  return true;
}

export async function runRobot(env, now = Date.now()) {
  const season = currentSeason(new Date(now));
  const index = (await kvGet(env, INDEX_KEY)) || {};
  const due = pickDue(robotSources(season), index, now).slice(0, MAX_PER_RUN);
  const report = [];
  const toRebuild = new Set();

  for (const s of due) {
    try {
      const { changed, data } = await refreshSource(env, s.src, s.season, now);
      const next = (data.upcoming || []).map((u) => u[3]).filter((t) => t > now - 3 * 3600000).sort((a, b) => a - b)[0] || null;
      const live = (data.upcoming || []).some((u) => /IN_PLAY|PAUSED|LIVE|IN_PROGRESS|HALFTIME|FIRST_HALF|SECOND_HALF/.test(u[4]));
      index[s.k] = { updatedAt: now, complete: data.complete, nextTs: next, live, finished: data.finished.length, upcoming: data.upcoming.length, changed };
      // Saison en cours OU saison précédente : les pronostics qui en dépendent sont recalculés
      for (const id of leaguesUsing(s.src)) {
        if (changed || (s.kind === "live" && !(await env.PRONO_CACHE.get(predsKey(id, season))))) toRebuild.add(id);
      }
      report.push(`${s.k}: ok (${data.finished.length} terminés, ${data.upcoming.length} à venir${changed ? ", mis à jour" : ""})`);
    } catch (e) {
      index[s.k] = { ...(index[s.k] || {}), updatedAt: now, error: String(e.message || e) };
      report.push(`${s.k}: ERREUR ${e.message}`);
    }
  }

  for (const id of toRebuild) {
    try { if (await saveLeague(env, id, season, now)) report.push(`pronostics ${id}: recalculés`); }
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
