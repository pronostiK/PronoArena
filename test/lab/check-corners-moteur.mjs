// Vérifie le chemin de production des corners (corners.js : blendCorners) sur l'historique réel, Portugal exclu.
import fs from "node:fs";
import { computeTeamRatings, computeElo, buildModel, calculate_match_prediction } from "../../src/model.js";
import { LEAGUES, MODEL } from "../../src/config.js";
import { blendCorners } from "../../src/corners.js";
const hist = JSON.parse(fs.readFileSync(process.argv[2] || "../pronostik/pronostik/data/history.json", "utf8")).filter((m) => (m.division || "L1") === "L1");
const PROMUS = new Set(Object.values(LEAGUES).filter((l) => l.promus).map((l) => l.src.replace("fd:", "")));
const CORN = new Set(["FL1", "PL", "PD", "SA", "BL1", "DED", "ELC", "FL2"]);
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const acc = {};
for (const lg of ["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED", "ELC", "FL2"]) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m, i) => ({ id: lg + i, homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date }));
  const cmap = { m: Object.fromEntries(L.map((m, i) => [lg + i, m.hc != null && m.ac != null ? [m.hc, m.ac] : null]).filter((x) => x[1])) };
  for (const date of [...new Set(L.filter((m) => m.date >= "2024-08-01").map((m) => m.date))]) {
    const S = seasonOf(date), past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const prevT = new Set(); for (const f of past) if (f.season === S - 1) { prevT.add(f.homeId); prevT.add(f.awayId); }
    const curT = new Set(); for (const f of fin) if (f.season === S) { curT.add(f.homeId); curT.add(f.awayId); }
    const nc = new Set([...curT].filter((t) => !prevT.has(t)));
    const opts = { newcomers: PROMUS.has(lg) && prevT.size && nc.size && nc.size <= MODEL.promotedMaxTeams ? nc : null };
    const m0 = buildModel(past, opts);
    const m1 = CORN.has(lg) ? { ...computeTeamRatings(blendCorners(past, [cmap]).finished, opts), elo: computeElo(past) } : m0;
    for (const m of L.filter((x) => x.date === date && [x.avgH, x.avgD, x.avgA].every((o) => o > 1))) {
      const P = (model) => { const p = calculate_match_prediction({ teamDomId: m.home, teamExtId: m.away, date }, { model, leagueId: lg, season: S, eloMix: true }).poisson; return [p.proba1, p.probaN, p.proba2]; };
      const a = (acc[S] ||= { n: 0, d: 0 }); a.n++; a.d += brier(P(m1), res(m)) - brier(P(m0), res(m));
    }
  }
}
for (const [S, a] of Object.entries(acc)) console.log(`Saison ${S} : ${a.n} matchs, écart de Brier avec corners − sans ${(a.d / a.n).toFixed(4)}`);
