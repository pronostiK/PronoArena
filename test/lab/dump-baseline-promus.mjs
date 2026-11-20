// Export des probabilités du moteur AVEC correction des promus (+ Elo des clubs, cotes) pour les tests suivants (run-elo2.py)
// Usage : node test/lab/dump-baseline-promus.mjs <history.json> <sortie.json>
import fs from "node:fs";
import { buildModel, calculate_match_prediction } from "../../src/model.js";
import { LEAGUES, MODEL } from "../../src/config.js";
const [H = "../pronostik/pronostik/data/history.json", OUT = "baseline-promus.json"] = process.argv.slice(2);
const hist = JSON.parse(fs.readFileSync(H, "utf8")).filter((m) => (m.division || "L1") === "L1");
const TOP = new Set(Object.values(LEAGUES).filter((l) => l.promus).map((l) => l.src.replace("fd:", "")));
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const rows = [];
for (const lg of ["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED", "ELC", "FL2"]) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m) => ({ homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date }));
  for (const date of [...new Set(L.filter((m) => m.date >= "2024-08-01").map((m) => m.date))]) {
    const S = seasonOf(date), past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const prev = new Set(); for (const f of past) if (f.season === S - 1) { prev.add(f.homeId); prev.add(f.awayId); }
    const cur = new Set(); for (const m of L) if (seasonOf(m.date) === S) { cur.add(m.home); cur.add(m.away); }
    const nc = new Set([...cur].filter((t) => !prev.has(t)));
    const newcomers = TOP.has(lg) && prev.size && nc.size && nc.size <= MODEL.promotedMaxTeams ? nc : null;
    const model = buildModel(past, { newcomers });
    for (const m of L.filter((x) => x.date === date)) {
      const o = [m.avgH, m.avgD, m.avgA]; if (!o.every((x) => x > 1)) continue;
      const p = calculate_match_prediction({ teamDomId: m.home, teamExtId: m.away, date }, { model, leagueId: lg, season: S }).poisson;
      const b = o.map((x) => 1 / x), s = b.reduce((a, c) => a + c, 0);
      rows.push({ lg, date, S, k: res(m), dp: [p.proba1, p.probaN, p.proba2], bk: b.map((x) => x / s), elo: [model.elo[m.home] ?? 1500, model.elo[m.away] ?? 1500], newH: !!newcomers?.has(m.home), newA: !!newcomers?.has(m.away) });
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify(rows));
console.log(rows.length, "matchs exportés");
