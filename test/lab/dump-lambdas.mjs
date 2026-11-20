// Export pour les pistes 11-13 (20/11/2026) : buts attendus du moteur actuel (promus compris), Elo, jours de repos,
// et buts attendus avec d'autres poids des matchs récents (M2 = 10 derniers ×2, M3 = 15 derniers ×1,5).
// Usage : node test/lab/dump-lambdas.mjs <history.json> <sortie.json>
import fs from "node:fs";
import { buildModel, calculate_match_prediction } from "../../src/model.js";
import { MODEL } from "../../src/config.js";
const [H = "../pronostik/pronostik/data/history.json", OUT = "lambdas.json"] = process.argv.slice(2);
const hist = JSON.parse(fs.readFileSync(H, "utf8")).filter((m) => (m.division || "L1") === "L1");
const TOP = new Set(["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED"]);
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const CONF = { M0: [8, 1.5], M2: [10, 2], M3: [15, 1.5] };
const rows = [];
for (const lg of [...TOP, "ELC", "FL2"]) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m) => ({ homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date }));
  const last = {}; // dernier match de championnat de chaque équipe
  const lastBefore = new Map();
  for (const m of L) { lastBefore.set(m, [last[m.home] || null, last[m.away] || null]); last[m.home] = m.date; last[m.away] = m.date; }
  for (const date of [...new Set(L.filter((m) => m.date >= "2024-08-01").map((m) => m.date))]) {
    const S = seasonOf(date), past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const prev = new Set(); for (const f of past) if (f.season === S - 1) { prev.add(f.homeId); prev.add(f.awayId); }
    const cur = new Set(); for (const m of L) if (seasonOf(m.date) === S) { cur.add(m.home); cur.add(m.away); }
    const nc = new Set([...cur].filter((t) => !prev.has(t)));
    const newcomers = TOP.has(lg) && prev.size && nc.size && nc.size <= MODEL.promotedMaxTeams ? nc : null;
    const games = L.filter((x) => x.date === date && [x.avgH, x.avgD, x.avgA].every((o) => o > 1));
    const out = games.map((m) => { const [lh, la] = lastBefore.get(m); const days = (d) => (d ? Math.round((Date.parse(date) - Date.parse(d)) / 864e5) : null);
      return { lg, date, S, k: res(m), restH: days(lh), restA: days(la), lam: {} }; });
    for (const [c, [n, w]] of Object.entries(CONF)) {
      MODEL.recentMatches = n; MODEL.recentWeight = w;
      const model = buildModel(past, { newcomers });
      games.forEach((m, i) => { const p = calculate_match_prediction({ teamDomId: m.home, teamExtId: m.away, date }, { model, leagueId: lg, season: S }); out[i].lam[c] = [p.lambdas.lambdaDom, p.lambdas.lambdaExt]; if (c === "M0") out[i].elo = [p.teams.domicile.elo, p.teams.exterieur.elo]; });
    }
    MODEL.recentMatches = 8; MODEL.recentWeight = 1.5;
    rows.push(...out);
  }
}
fs.writeFileSync(OUT, JSON.stringify(rows)); console.log(rows.length, "matchs");
