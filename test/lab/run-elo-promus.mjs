// Piste 10 — Elo de départ des promus (20/11/2026). Moteur actuel = promus + mélange Elo 25 %.
// Une seule question : les promus doivent-ils démarrer leur Elo plus bas que 1500 ? Écart réglé sur 2024-25, jugé sur 2025-26 et 2026-27.
// Usage : node test/lab/run-elo-promus.mjs <history.json>
import fs from "node:fs";
import { buildModel, calculate_match_prediction } from "../../src/model.js";
import { MODEL } from "../../src/config.js";
const hist = JSON.parse(fs.readFileSync(process.argv[2] || "../pronostik/pronostik/data/history.json", "utf8")).filter((m) => (m.division || "L1") === "L1");
const TOP = new Set(["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED"]);
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const GAPS = [0, 50, 100, 150, 200, 250, 300];
const rows = [];
for (const lg of [...TOP, "ELC", "FL2"]) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m) => ({ homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date }));
  for (const date of [...new Set(L.filter((m) => m.date >= "2024-08-01").map((m) => m.date))]) {
    const S = seasonOf(date), past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const prev = new Set(); for (const f of past) if (f.season === S - 1) { prev.add(f.homeId); prev.add(f.awayId); }
    const cur = new Set(); for (const m of L) if (seasonOf(m.date) === S) { cur.add(m.home); cur.add(m.away); }
    const nc = new Set([...cur].filter((t) => !prev.has(t)));
    const newcomers = TOP.has(lg) && prev.size && nc.size && nc.size <= MODEL.promotedMaxTeams ? nc : null;
    const games = L.filter((x) => x.date === date && [x.avgH, x.avgD, x.avgA].every((o) => o > 1));
    const out = games.map((m) => ({ lg, date, S, k: res(m), promu: !!(newcomers?.has(m.home) || newcomers?.has(m.away)), p: {} }));
    for (const g of GAPS) {
      MODEL.promotedEloGap = g; // nécessite la version de computeElo avec opts.newcomers (non retenue, voir rapport)
      const model = buildModel(past, { newcomers });
      games.forEach((m, i) => { const p = calculate_match_prediction({ teamDomId: m.home, teamExtId: m.away, date }, { model, leagueId: lg, season: S, eloMix: true }).poisson; out[i].p[g] = [p.proba1, p.probaN, p.proba2]; });
    }
    rows.push(...out);
  }
}
MODEL.promotedEloGap = 0;
const avg = (l, g) => l.reduce((s, r) => s + brier(r.p[g], r.k) - brier(r.p[0], r.k), 0) / l.length;
const A = rows.filter((r) => r.S === 2024);
const best = GAPS.reduce((b, g) => (avg(A, g) < avg(A, b) ? g : b), 0);
console.log("Écart de Brier par rapport au moteur actuel (négatif = mieux), tous matchs / matchs avec un promu :");
for (const g of GAPS) console.log(`  Elo de départ ${1500 - g} : ` + [2024, 2025, 2026].map((S) => { const l = rows.filter((r) => r.S === S), lp = l.filter((r) => r.promu); return `${S}-${String(S + 1).slice(2)} ${avg(l, g).toFixed(4)} / ${avg(lp, g).toFixed(4)}`; }).join(" · "));
console.log(`Choisi sur 2024-25 : départ ${1500 - best} (écart ${best})`);
// IC 95 % regroupé par date pour le choix
for (const S of [2024, 2025, 2026]) {
  const byD = new Map(); for (const r of rows.filter((x) => x.S === S)) { const x = byD.get(r.date) || [0, 0]; x[0] += brier(r.p[best], r.k) - brier(r.p[0], r.k); x[1]++; byD.set(r.date, x); }
  const G = [...byD.values()]; let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); const sims = [];
  for (let t = 0; t < 2000; t++) { let s = 0, n = 0; for (let i = 0; i < G.length; i++) { const g = G[(rnd() * G.length) | 0]; s += g[0]; n += g[1]; } sims.push(s / n); }
  sims.sort((a, b) => a - b); console.log(`  ${S} : IC 95 % [${sims[50].toFixed(4)} ; ${sims[1949].toFixed(4)}]`);
}
