// Test 1 : décroissance dans le temps. Même matchs, même règle « le modèle ne voit que le passé » que le test de référence.
// Usage : node test/lab/run-decay.mjs <history.json> <sortie.json>
import fs from "node:fs";
import { calculate_match_prediction } from "../../src/model.js";
import { ratingsDecay, ratingsCurrent } from "./model-variants.mjs";
const [HIST, OUT] = process.argv.slice(2);
const hist = JSON.parse(fs.readFileSync(HIST, "utf8")).filter((m) => (m.division || "L1") === "L1");
const LGS = ["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED", "ELC", "FL2"];
const TEST_FROM = "2024-08-01";
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
// Configurations : témoin (moteur actuel) + demi-vies × lissage
const CONFIGS = [{ name: "actuel" }];
for (const H of [45, 90, 135, 180, 270, 365]) for (const K of [3, 6, 10]) CONFIGS.push({ name: `H${H}_K${K}`, H, K });
const rows = [];
for (const lg of LGS) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m, i) => ({ id: `${lg}${i}`, homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date }));
  const byDate = new Map();
  for (let i = 0; i < L.length; i++) if (L[i].date >= TEST_FROM) (byDate.get(L[i].date) || byDate.set(L[i].date, []).get(L[i].date)).push(i);
  for (const [date, idx] of byDate) {
    const S = seasonOf(date), ts = Date.parse(date + "T12:00:00Z");
    const past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const models = CONFIGS.map((c) => (c.H ? ratingsDecay(past, ts, c) : ratingsCurrent(past)));
    for (const i of idx) {
      const m = L[i];
      const o = [m.avgH, m.avgD, m.avgA];
      if (!o.every((x) => x > 1)) continue; // mêmes matchs que le test de référence : avec cotes
      const bk = o.map((x) => 1 / x), t = bk.reduce((a, b) => a + b, 0);
      const row = { lg, date, k: res(m), bk: bk.map((x) => x / t), p: {} };
      CONFIGS.forEach((c, j) => { const p = calculate_match_prediction({ matchId: i, teamDomId: m.home, teamExtId: m.away, date }, { model: models[j], leagueId: lg, season: S }).poisson; row.p[c.name] = [p.proba1, p.probaN, p.proba2]; });
      rows.push(row);
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify({ configs: CONFIGS, rows }));
console.log(rows.length, "matchs,", CONFIGS.length, "configurations");
