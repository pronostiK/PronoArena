// ============================================================
// PRONO ARENA — Point d'entrée du Worker (V7)
//   /league-predictions?leagueId=61[&season=2026]  pronostics + stats + classement
//   /match-details?matchId=..&source=..&teamDomId=..&teamExtId=..[&leagueId=..]
//   /status                                         état du robot (transparence)
// ============================================================
import { LEAGUES, currentSeason, VERSION } from "./config.js";
import { kvGet, refreshSource, srcKey } from "./sources.js";
import { predsKey, getH2H } from "./build.js";
import { runRobot, robotStatus, saveLeague } from "./robot.js";

const CORS = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" };
const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { ...CORS, ...extra } });

async function getPredictions(env, leagueId, season) {
  const cached = env.PRONO_CACHE ? await env.PRONO_CACHE.get(predsKey(leagueId, season)) : null;
  if (cached) return cached;
  // Pas encore préparé par le robot : calcul immédiat (une seule fois, ensuite c'est le robot qui entretient)
  const lg = LEAGUES[leagueId];
  if (!(await kvGet(env, srcKey(lg.src, season)))) await refreshSource(env, lg.src, season);
  await saveLeague(env, leagueId, season, Date.now());
  return env.PRONO_CACHE.get(predsKey(leagueId, season));
}

async function findPrediction(env, matchId, leagueId, season) {
  const ids = leagueId ? [leagueId] : Object.keys(LEAGUES).map(Number);
  for (const id of ids) {
    const raw = await env.PRONO_CACHE.get(predsKey(id, season));
    if (!raw) continue;
    const p = JSON.parse(raw).predictions.find((x) => String(x.matchId) === String(matchId));
    if (p) return p;
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const q = (k) => url.searchParams.get(k);

    try {
      if (path === "/league-predictions") {
        const leagueId = parseInt(q("leagueId"));
        if (!leagueId) throw new Error("LeagueId manquant.");
        if (!LEAGUES[leagueId]) return json({ success: true, leagueId, predictions: [], count: 0 });
        const season = parseInt(q("season")) || currentSeason();
        const body = await getPredictions(env, leagueId, season);
        if (!body) return json({ success: true, leagueId, season, count: 0, predictions: [] });
        return new Response(body, { headers: { ...CORS, "Cache-Control": "public, max-age=120" } });
      }

      if (path === "/match-details") {
        const matchId = q("matchId"), source = q("source");
        if (!matchId || !source) throw new Error("Paramètres manquants");
        const season = parseInt(q("season")) || currentSeason();
        const leagueId = parseInt(q("leagueId")) || null;
        const [pred, h] = await Promise.all([
          findPrediction(env, matchId, leagueId, season),
          getH2H(env, { matchId, source, teamDomId: q("teamDomId"), teamExtId: q("teamExtId"), leagueId }, season),
        ]);
        const stats = pred
          ? { domicile: { ...(pred.teams.domicile.stats || {}), classement: pred.teams.domicile.classement }, exterieur: { ...(pred.teams.exterieur.stats || {}), classement: pred.teams.exterieur.classement } }
          : { domicile: {}, exterieur: {} };
        return json({ success: true, stats, h2h: h.h2h });
      }

      if (path === "/status") return json({ success: true, version: VERSION, ...(await robotStatus(env)) });

      return json({ success: false, error: "Route inconnue" }, 404);
    } catch (err) {
      return json({ success: false, error: err.message }, 400);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRobot(env));
  },
};
