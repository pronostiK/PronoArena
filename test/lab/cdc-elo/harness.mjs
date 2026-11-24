import { computeTeamRatings, calculate_match_prediction, computeElo } from "./src/model.js";
import { MODEL, LEAGUE_COEF } from "./src/config.js";
import { domesticMatches, clMatches, norm } from "./load.mjs";
export const ALIAS = { "Sporting CP": "Sp Lisbon", "Borussia Dortmund": "Dortmund", "Manchester City": "Man City", Internazionale: "Inter", "Paris Saint-Germain": "Paris SG", "Bayer Leverkusen": "Leverkusen", "Feyenoord Rotterdam": "Feyenoord", "Atlético Madrid": "Ath Madrid", "Athletic Club": "Ath Bilbao", "Union St.-Gilloise": "St. Gilloise", "Tottenham Hotspur": "Tottenham", Olympiacos: "Olympiakos", "Ajax Amsterdam": "Ajax", "Eintracht Frankfurt": "Ein Frankfurt", "Newcastle United": "Newcastle", "Manchester United": "Man United", "LASK Linz": "LASK", "Real Betis": "Betis", "AEK Athens": "AEK", "RB Salzburg": "Salzburg", "SK Sturm Graz": "Sturm Graz", PSV: "PSV Eindhoven" };
const key = (n) => norm(ALIAS[n] || n);
const COEF = { eng: LEAGUE_COEF["fd:PL"], esp: LEAGUE_COEF["fd:PD"], ita: LEAGUE_COEF["fd:SA"], ger: LEAGUE_COEF["fd:BL1"], fra: LEAGUE_COEF["fd:FL1"], por: LEAGUE_COEF["fd:PPL"], ned: LEAGUE_COEF["fd:DED"], bel: LEAGUE_COEF["espn:bel.1"], tur: LEAGUE_COEF["espn:tur.1"], sco: LEAGUE_COEF["espn:sco.1"], nor: LEAGUE_COEF["espn:nor.1"], aut: LEAGUE_COEF["espn:aut.1"], gre: LEAGUE_COEF["espn:gre.1"] };
export const DOM = domesticMatches().map((m, i) => ({ id: i, homeId: key(m.home), awayId: key(m.away), hg: m.hg, ag: m.ag, ts: m.ts, season: m.season, lg: m.lg }));
export const CL = clMatches().map((m) => ({ ...m, hId: key(m.h), aId: key(m.a), season: new Date(m.ts).getUTCMonth() >= 6 ? new Date(m.ts).getUTCFullYear() : new Date(m.ts).getUTCFullYear() - 1 })).sort((a, b) => a.ts - b.ts);
const LGS = [...new Set(DOM.map((m) => m.lg))];
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);

// opts : domSeasons (1 = saison en cours seulement comme en production, 2 = + la précédente), coef (fonction lg -> nombre), prior (cupDomesticPrior)
export function run(opts = {}, from = 0, to = 1e15, onPred = null) {
  const o = { domSeasons: 1, coef: (lg) => COEF[lg], prior: MODEL.cupDomesticPrior, post: null, ...opts };
  const save = { cupDomesticPrior: MODEL.cupDomesticPrior }; MODEL.cupDomesticPrior = o.prior;
  const rows = [];
  for (const m of CL) {
    if (m.ts < from || m.ts >= to) continue;
    const S = m.season;
    const cur = CL.filter((x) => x.season === S && x.ts < m.ts).map((x, i) => ({ id: i, homeId: x.hId, awayId: x.aId, hg: x.hg, ag: x.ag, ts: x.ts, season: S }));
    const model = { ...computeTeamRatings(cur), elo: {} };
    const domestic = new Map();
    for (const lg of LGS) {
      const f = DOM.filter((d) => d.lg === lg && d.ts < m.ts && d.season >= S - (o.domSeasons - 1) && d.season <= S);
      if (!f.length) continue;
      const rt = computeTeamRatings(f);
      for (const [id, rating] of Object.entries(rt.ratings)) if (!domestic.has(id)) domestic.set(id, { rating, coef: o.coef(lg), played: rating.played, league: lg });
    }
    const p = calculate_match_prediction({ matchId: m.id, teamDomId: m.hId, teamExtId: m.aId, domName: m.h, extName: m.a, date: new Date(m.ts).toISOString() }, { model, leagueId: 2, season: S, domestic });
    let pr = [p.poisson.proba1, p.poisson.probaN, p.poisson.proba2];
    if (o.post) pr = o.post(pr);
    const k = res(m);
    const hasDom = domestic.has(m.hId) && domestic.has(m.aId);
    rows.push({ ts: m.ts, season: S, h: m.h, a: m.a, pr, k, hasDom, brier: pr.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0), ll: -Math.log(Math.max(1e-6, pr[k])) });
    if (onPred) onPred(m, pr);
  }
  MODEL.cupDomesticPrior = save.cupDomesticPrior;
  return rows;
}
export const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / (a.length || 1);
export function summary(rows, label) {
  const per = (f) => { const r = rows.filter(f); return `${r.length}m B=${mean(r, (x) => x.brier).toFixed(4)} LL=${mean(r, (x) => x.ll).toFixed(4)}`; };
  const S = (y) => (x) => x.season === y;
  console.log(label.padEnd(34), "24-25:", per(S(2024)), "| 25-26:", per(S(2025)), "| 26-27:", per(S(2026)));
}
export const T0 = Date.parse("2024-09-01"), T1 = Date.parse("2025-07-01"), T2 = Date.parse("2026-07-01");
