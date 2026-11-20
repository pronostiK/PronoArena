// Vérifie que le moteur (mélange Elo, ctx.eloMix) donne le même gain que run-elo2.mjs (promus compris)
import fs from "node:fs";
import { buildModel, calculate_match_prediction } from "../../src/model.js";
const hist = JSON.parse(fs.readFileSync(process.argv[2] || "../pronostik/pronostik/data/history.json", "utf8")).filter((m) => (m.division || "L1") === "L1");
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const acc = {};
const TOP = new Set(["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED"]);
for (const lg of [...TOP, "ELC", "FL2"]) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m) => ({ homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date }));
  for (const date of [...new Set(L.filter((m) => m.date >= "2024-08-01").map((m) => m.date))]) {
    const S = seasonOf(date), past = fin.filter((f) => f.date < date && f.season >= S - 1);
    const prev = new Set(); for (const f of past) if (f.season === S - 1) { prev.add(f.homeId); prev.add(f.awayId); }
    if (past.length < 20 || !prev.size) continue;
    const cur = new Set(); for (const m of L) if (seasonOf(m.date) === S) { cur.add(m.home); cur.add(m.away); } // comme le robot : équipes de la saison (joués + à venir)
    const newcomers = new Set([...cur].filter((t) => !prev.has(t)));
    const m1 = buildModel(past, { newcomers: TOP.has(lg) && newcomers.size <= 4 ? newcomers : null });
    for (const m of L.filter((x) => x.date === date)) {
      if (![m.avgH, m.avgD, m.avgA].every((x) => x > 1)) continue;
      const P = (model, mix) => { const p = calculate_match_prediction({ teamDomId: m.home, teamExtId: m.away, date }, { model, leagueId: lg, season: S, eloMix: mix }).poisson; return [p.proba1, p.probaN, p.proba2]; };
      const a = (acc[S] ||= { n: 0, d: 0 }); a.n++; a.d += brier(P(m1, true), res(m)) - brier(P(m1, false), res(m));
    }
  }
}
for (const [S, a] of Object.entries(acc)) console.log(`Saison ${S} : ${a.n} matchs, écart de Brier avec Elo − sans Elo ${(a.d / a.n).toFixed(4)}`);
