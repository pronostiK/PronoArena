// Réglage du modèle des clubs : on règle sur 2024-25 uniquement, puis on vérifie une seule fois sur 2025-26 et après.
// Usage : node test/tune.mjs <history.json>
import fs from "node:fs";
import { MODEL } from "../src/config.js";
import { buildModel, calculate_match_prediction } from "../src/model.js";
const hist = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).filter((m) => (m.division || "L1") === "L1");
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const LGS = [...new Set(hist.map((m) => m.lg))];
const data = LGS.map((lg) => { const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  return L.map((m, i) => ({ id: i, homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date, bk: [m.avgH, m.avgD, m.avgA] })); });
function run(from, to) {
  let s = 0, n = 0, sb = 0;
  for (const fin of data) {
    const dates = [...new Set(fin.filter((f) => f.date >= from && f.date < to).map((f) => f.date))];
    for (const date of dates) {
      const S = seasonOf(date), past = fin.filter((f) => f.date < date && f.season >= S - 1);
      if (past.length < 20) continue;
      const model = buildModel(past);
      for (const m of fin.filter((f) => f.date === date)) {
        if (!m.bk.every((x) => x > 1)) continue;
        const p = calculate_match_prediction({ matchId: m.id, teamDomId: m.homeId, teamExtId: m.awayId, date }, { model, leagueId: "x", season: S }).poisson;
        s += brier([p.proba1, p.probaN, p.proba2], res(m)); n++;
        const b = m.bk.map((x) => 1 / x), t = b[0] + b[1] + b[2]; sb += brier(b.map((x) => x / t), res(m));
      }
    }
  }
  return { brier: s / n, bk: sb / n, n };
}
const TRAIN = ["2024-08-01", "2025-07-01"], TEST = ["2025-07-01", "2099-01-01"];
const keys = { windowMatches: [20, 30, 40, 60, 80], recentMatches: [0, 3, 5, 8], recentWeight: [1, 1.5, 2, 3], priorMatches: [1, 3, 6, 10, 15], specificWeight: [0, 0.15, 0.3, 0.5], rho: [-0.15, -0.1, -0.08, -0.04, 0] };
const start = { ...MODEL };
let best = run(...TRAIN).brier;
console.log(`départ (réglages actuels) : ${best.toFixed(4)}`);
for (let pass = 0; pass < 2; pass++) for (const [k, vals] of Object.entries(keys)) {
  let bv = MODEL[k];
  for (const v of vals) { if (v === bv) continue; MODEL[k] = v; const b = run(...TRAIN).brier; if (b < best - 1e-5) { best = b; bv = v; } }
  MODEL[k] = bv; console.log(`  ${k} = ${bv}  → ${best.toFixed(4)}`);
}
const tuned = Object.fromEntries(Object.keys(keys).map((k) => [k, MODEL[k]]));
const tTuned = run(...TEST); Object.assign(MODEL, start); const tOld = run(...TEST);
console.log(`\nVérification unique sur ${tOld.n} matchs jamais vus (2025-26 et après) :`);
console.log(`  réglages actuels : ${tOld.brier.toFixed(4)}   nouveaux réglages : ${tTuned.brier.toFixed(4)}   bookmakers : ${tOld.bk.toFixed(4)}`);
console.log("  nouveaux réglages :", JSON.stringify(tuned));
