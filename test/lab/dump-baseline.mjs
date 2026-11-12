// Sauvegarde, pour chaque match du test, la prévision du moteur ACTUEL (référence des comparaisons).
// Usage : node test/lab/dump-baseline.mjs <history.json> <sortie.json>
import fs from "node:fs";
import { buildModel, calculate_match_prediction } from "../../src/model.js";
const [HIST, OUT] = process.argv.slice(2);
const hist = JSON.parse(fs.readFileSync(HIST, "utf8")).filter((m) => (m.division || "L1") === "L1");
const LGS = ["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED", "ELC", "FL2"]; // mêmes championnats que le test de référence
const TEST_FROM = "2024-08-01";
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const rows = [];
for (const lg of LGS) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  if (!L.length) continue;
  const fin = L.map((m, i) => ({ id: `${lg}${i}`, homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date }));
  const byDate = new Map();
  for (let i = 0; i < L.length; i++) if (L[i].date >= TEST_FROM) (byDate.get(L[i].date) || byDate.set(L[i].date, []).get(L[i].date)).push(i);
  for (const [date, idx] of byDate) {
    const S = seasonOf(date);
    const past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const model = buildModel(past);
    for (const i of idx) {
      const m = L[i];
      const p = calculate_match_prediction({ matchId: i, teamDomId: m.home, teamExtId: m.away, date }, { model, leagueId: lg, season: S }).poisson;
      const o = [m.avgH, m.avgD, m.avgA];
      const bk = o.every((x) => x > 1) ? o.map((x) => 1 / x) : null;
      rows.push({ lg, date, home: m.home, away: m.away, hg: m.hg, ag: m.ag, k: res(m), dp: [p.proba1, p.probaN, p.proba2], bk: bk ? bk.map((x) => x / bk.reduce((a, b) => a + b, 0)) : null, elo: [model.elo[m.home] ?? 1500, model.elo[m.away] ?? 1500] });
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify(rows));
console.log(rows.length, "matchs");
