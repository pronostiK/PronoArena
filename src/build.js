// ============================================================
// PRONO ARENA — Construction des pronostics d'une compétition
// à partir des données préparées par le robot
// ============================================================
import { LEAGUES, LEAGUE_COEF, MODEL, VERSION } from "./config.js";
import { kvGet, srcKey, toFinished, toUpcoming } from "./sources.js";
import { buildModel, computeTeamRatings, teamStats, leagueTable, calculate_match_prediction } from "./model.js";

const r3 = (x) => Math.round(x * 1000) / 1000;
export const predsKey = (leagueId, season) => `preds:${leagueId}@${season}`;

export async function buildLeague(env, leagueId, season, now = Date.now()) {
  const lg = LEAGUES[leagueId];
  if (!lg) return null;
  const provider = lg.src.split(":")[0];

  const cur = await kvGet(env, srcKey(lg.src, season));
  if (!cur) return null;
  const prev = lg.cup ? null : await kvGet(env, srcKey(lg.src, season - 1));

  const finishedCur = toFinished(cur);
  const finishedAll = prev ? [...toFinished(prev), ...finishedCur] : finishedCur;
  const model = buildModel(finishedAll, now);

  // Coupes : forces en championnat de chaque équipe
  let domestic = null;
  const formePool = [...finishedCur];
  const domesticStatus = [];
  if (lg.domestic) {
    domestic = new Map();
    const srcs = await Promise.all(lg.domestic.map((d) => kvGet(env, srcKey(d, season))));
    lg.domestic.forEach((d, i) => {
      const s = srcs[i];
      domesticStatus.push({ source: d, disponible: !!s, matchs: s?.finished?.length || 0 });
      if (!s) return;
      const f = toFinished(s);
      formePool.push(...f);
      const rt = computeTeamRatings(f, now);
      for (const [id, rating] of Object.entries(rt.ratings)) {
        if (!domestic.has(id)) domestic.set(id, { rating, coef: LEAGUE_COEF[d] ?? MODEL.unknownLeagueCoef, played: rating.played, league: d });
      }
    });
  }

  const table = leagueTable(finishedCur);
  const rank = new Map(table.map((r) => [r.id, r]));
  const names = { ...(prev?.teams || {}), ...cur.teams };

  const upcoming = toUpcoming(cur, provider).sort((a, b) => a.ts - b.ts).slice(0, 10);
  const predictions = upcoming.map((m) => {
    const p = calculate_match_prediction(m, { model, leagueId, season, domestic });
    for (const side of ["domicile", "exterieur"]) {
      const team = p.teams[side];
      const st = teamStats(team.id, formePool);
      if (st) for (const f of st.formeDetail) f.adversaire = names[f.adversaire]?.[0] || f.adversaire;
      const row = rank.get(team.id);
      team.stats = st;
      team.classement = row ? { rang: row.rang, points: row.pts, joues: row.j, diff: row.diff } : null;
    }
    return p;
  });

  return {
    success: true,
    leagueId,
    season,
    count: predictions.length,
    modele: {
      version: VERSION,
      matchsAnalyses: model.matchesAnalysed,
      moyenneButsDom: r3(model.avgHome),
      moyenneButsExt: r3(model.avgAway),
      donneesMisesAJour: new Date(cur.updatedAt).toISOString(),
      ...(domesticStatus.length ? { championnatsUtilises: domesticStatus } : {}),
    },
    classement: table.map((r) => ({ rang: r.rang, id: r.id, nom: names[r.id]?.[0] || r.id, logo: names[r.id]?.[1] || null, joues: r.j, v: r.v, n: r.n, d: r.d, bp: r.bp, bc: r.bc, diff: r.diff, points: r.pts })),
    predictions,
  };
}

// ---------- Face-à-face ----------
function orient(list, teamDomId, teamExtId, names) {
  return list
    .filter((f) => (f.homeId === teamDomId && f.awayId === teamExtId) || (f.homeId === teamExtId && f.awayId === teamDomId))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 5)
    .map((f) => {
      const domAtHome = f.homeId === teamDomId;
      const sd = domAtHome ? f.hg : f.ag, se = domAtHome ? f.ag : f.hg;
      return {
        date: new Date(f.ts).toISOString().slice(0, 10),
        scoreDom: sd, scoreExt: se,
        vainqueur: sd > se ? "domicile" : sd < se ? "exterieur" : "nul",
        lieu: domAtHome ? "domicile" : "exterieur",
        equipeDomicile: names?.[f.homeId]?.[0] || null,
        equipeExterieur: names?.[f.awayId]?.[0] || null,
      };
    });
}

export async function getH2H(env, { matchId, source, teamDomId, teamExtId, leagueId }, season) {
  const cacheKey = `h2h:${matchId}`;
  const cached = await kvGet(env, cacheKey);
  if (cached) return cached;

  let h2h = [];
  if (source === "football-data") {
    const res = await fetch(`https://api.football-data.org/v4/matches/${matchId}/head2head?limit=10`, { headers: { "X-Auth-Token": env.FOOTBALL_DATA_KEY } });
    if (res.ok) {
      const data = await res.json();
      const list = (data.matches || [])
        .filter((m) => m.status === "FINISHED" && m.score?.fullTime?.home != null)
        .map((m) => ({ homeId: String(m.homeTeam.id), awayId: String(m.awayTeam.id), hg: m.score.fullTime.home, ag: m.score.fullTime.away, ts: Date.parse(m.utcDate) }));
      const names = {};
      for (const m of data.matches || []) { names[m.homeTeam.id] = [m.homeTeam.name]; names[m.awayTeam.id] = [m.awayTeam.name]; }
      h2h = orient(list, String(teamDomId), String(teamExtId), names);
    }
  } else {
    // ESPN : on cherche dans toutes les données ESPN déjà collectées par le robot
    const keys = new Set();
    for (const lg of Object.values(LEAGUES)) {
      if (!lg.src.startsWith("espn:")) continue;
      keys.add(srcKey(lg.src, season)); keys.add(srcKey(lg.src, season - 1));
      for (const d of lg.domestic || []) keys.add(srcKey(d, season));
    }
    const srcs = (await Promise.all([...keys].map((k) => kvGet(env, k)))).filter(Boolean);
    const all = [], names = {};
    for (const s of srcs) { all.push(...toFinished(s)); Object.assign(names, s.teams); }
    h2h = orient(all, String(teamDomId), String(teamExtId), names);
  }

  const result = { h2h };
  if (env.PRONO_CACHE) await env.PRONO_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: h2h.length ? 86400 : 21600 });
  return result;
}
