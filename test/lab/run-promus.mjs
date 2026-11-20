// ============================================================
// Piste 9 — équipes promues (nouvelles venues dans le championnat), 20/11/2026
// Question : le moteur traite une équipe absente du championnat la saison précédente comme
// une équipe moyenne (lissage vers 1). Est-elle surestimée ?
// Variante unique, définie avant le calcul : pour une nouvelle venue, le lissage tire vers
// a0 (attaque) et d0 (défense) au lieu de 1, avec Kn matchs fictifs au lieu de 6.
// Réglage sur A = saison 2024-25 uniquement ; B = 2025-26 jugée sans réglage ; C = 2026-27 (jamais vue).
// Données : history.json de PronostiK (football-data.co.uk, 1re division seulement, cotes moyennes).
// Usage : node test/lab/run-promus.mjs <history.json>
// ============================================================
import fs from "node:fs";
import { buildModel, calculate_poisson_match } from "../../src/model.js";
import { MODEL } from "../../src/config.js";

const HIST = process.argv[2] || "../pronostik/pronostik/data/history.json";
const hist = JSON.parse(fs.readFileSync(HIST, "utf8")).filter((m) => (m.division || "L1") === "L1");
const LGS = ["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED", "ELC", "FL2"];
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const r3 = (x) => Math.round(x * 1000) / 1000;

// Sommes brutes d'une équipe (mêmes règles que computeTeamRatings)
function sums(id, past, avgHome, avgAway) {
  const list = past.filter((f) => f.homeId === id || f.awayId === id).sort((a, b) => b.ts - a.ts).slice(0, MODEL.windowMatches);
  const v = { hf: 0, ha: 0, hw: 0, af: 0, aa: 0, aw: 0, n: list.length };
  list.forEach((f, i) => {
    const x = i < MODEL.recentMatches ? MODEL.recentWeight : 1;
    if (f.homeId === id) { v.hf += x * f.hg / avgHome; v.ha += x * f.ag / avgAway; v.hw += x; }
    else { v.af += x * f.ag / avgAway; v.aa += x * f.hg / avgHome; v.aw += x; }
  });
  return v;
}
// Note : avec a0 = d0 = 1 et K = 6, c'est exactement le moteur actuel
function rating(v, K, a0, d0) {
  const s = MODEL.specificWeight;
  const attAll = (v.hf + v.af + K * a0) / (v.hw + v.aw + K), defAll = (v.ha + v.aa + K * d0) / (v.hw + v.aw + K);
  return {
    attHome: s * (v.hf + K * a0) / (v.hw + K) + (1 - s) * attAll, defHome: s * (v.ha + K * d0) / (v.hw + K) + (1 - s) * defAll,
    attAway: s * (v.af + K * a0) / (v.aw + K) + (1 - s) * attAll, defAway: s * (v.aa + K * d0) / (v.aw + K) + (1 - s) * defAll,
  };
}
function predict(row, P) {
  const K = MODEL.priorMatches;
  const D = row.newH && P ? rating(row.vH, P.K, P.a0, P.d0) : rating(row.vH, K, 1, 1);
  const E = row.newA && P ? rating(row.vA, P.K, P.a0, P.d0) : rating(row.vA, K, 1, 1);
  const lD = r3(clamp(row.avgHome * D.attHome * E.defAway, MODEL.lambdaMin, MODEL.lambdaMax));
  const lE = r3(clamp(row.avgAway * E.attAway * D.defHome, MODEL.lambdaMin, MODEL.lambdaMax));
  const p = calculate_poisson_match(lD, lE);
  return [p.proba1, p.probaN, p.proba2];
}

const rows = [];
for (const lg of LGS) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m) => ({ homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date }));
  const dates = [...new Set(L.filter((m) => m.date >= "2024-08-01").map((m) => m.date))];
  for (const date of dates) {
    const S = seasonOf(date);
    const past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const model = buildModel(past);
    const prev = new Set(); for (const f of past) if (f.season === S - 1) { prev.add(f.homeId); prev.add(f.awayId); }
    if (!prev.size) continue; // saison précédente absente : impossible de savoir qui est nouveau
    for (const m of L.filter((x) => x.date === date)) {
      const o = [m.avgH, m.avgD, m.avgA]; if (!o.every((x) => x > 1)) continue;
      const b = o.map((x) => 1 / x), bs = b.reduce((a, c) => a + c, 0);
      const row = { lg, date, S, k: res(m), bk: b.map((x) => x / bs), avgHome: model.avgHome, avgAway: model.avgAway,
        newH: !prev.has(m.home), newA: !prev.has(m.away),
        vH: sums(m.home, past, model.avgHome, model.avgAway), vA: sums(m.away, past, model.avgHome, model.avgAway) };
      row.base = predict(row, null);
      row.nNew = Math.min(row.newH ? row.vH.n : 99, row.newA ? row.vA.n : 99); // matchs déjà joués par la nouvelle venue
      rows.push(row);
    }
  }
}

// Contrôle : la reproduction du moteur actuel doit donner exactement ses probabilités
import { calculate_match_prediction } from "../../src/model.js";
{
  const L = hist.filter((m) => m.lg === "FL1").sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m) => ({ homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date }));
  let bad = 0, n = 0;
  for (const r of rows.filter((x) => x.lg === "FL1").slice(0, 300)) {
    const m = L.find((x) => x.date === r.date && x.home && fin); // premier match du jour suffit pour la vérification
    const past = fin.filter((f) => f.date < r.date && f.season >= r.S - 1), model = buildModel(past);
    const p = calculate_match_prediction({ teamDomId: m.home, teamExtId: m.away, date: r.date }, { model, leagueId: "FL1", season: r.S }).poisson;
    const mine = predict({ ...r, vH: sums(m.home, past, model.avgHome, model.avgAway), vA: sums(m.away, past, model.avgHome, model.avgAway) }, null);
    n++; if (Math.abs(p.proba1 - mine[0]) > 1e-9 || Math.abs(p.proba2 - mine[2]) > 1e-9) bad++;
  }
  console.log(`Contrôle de reproduction du moteur : ${n - bad}/${n} identiques`);
}

const PER = { A: (r) => r.S === 2024, B: (r) => r.S === 2025, C: (r) => r.S === 2026 };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const f4 = (x) => (x >= 0 ? "+" : "") + x.toFixed(4);
function ci(list, fa, fb) { // écart moyen (a − b) par match, IC 95 % par rééchantillonnage regroupé par date
  const byD = new Map(); for (const r of list) { const d = brier(fa(r), r.k) - brier(fb(r), r.k); const x = byD.get(r.date) || [0, 0]; x[0] += d; x[1]++; byD.set(r.date, x); }
  const G = [...byD.values()], tot = G.reduce((s, g) => s + g[0], 0) / G.reduce((s, g) => s + g[1], 0);
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); const sims = [];
  for (let t = 0; t < 3000; t++) { let s = 0, n = 0; for (let i = 0; i < G.length; i++) { const g = G[(rnd() * G.length) | 0]; s += g[0]; n += g[1]; } sims.push(s / n); }
  sims.sort((a, b) => a - b); return [tot, sims[75], sims[2924]];
}

// 1) Diagnostic : les nouvelles venues sont-elles surestimées ?
console.log(`\n${rows.length} matchs avec cotes (2024-08 → ${rows.reduce((a, r) => (r.date > a ? r.date : a), "")})`);
for (const [pn, inP] of Object.entries(PER)) {
  const P = rows.filter(inP), N = P.filter((r) => r.newH || r.newA), O = P.filter((r) => !r.newH && !r.newA);
  const bs = (l, f) => mean(l.map((r) => brier(f(r), r.k)));
  console.log(`\nPériode ${pn} : ${P.length} matchs, dont ${N.length} avec une nouvelle venue`);
  console.log(`  Brier moteur / bookmakers — avec nouvelle venue : ${bs(N, (r) => r.base).toFixed(4)} / ${bs(N, (r) => r.bk).toFixed(4)} · sans : ${bs(O, (r) => r.base).toFixed(4)} / ${bs(O, (r) => r.bk).toFixed(4)}`);
  // Points attendus de la nouvelle venue (victoire 3, nul 1) : annoncés par le moteur, par les bookmakers, et réels
  const pts = (p, home) => (home ? 3 * p[0] + p[1] : 3 * p[2] + p[1]);
  for (const [lbl, f] of [["10 premiers matchs", (r) => r.nNew < 10], ["matchs 11 et +", (r) => r.nNew >= 10]]) {
    const l = P.filter((r) => (r.newH !== r.newA) && f(r)); if (!l.length) continue;
    const real = mean(l.map((r) => (r.newH ? [3, 1, 0][r.k] : [0, 1, 3][r.k])));
    console.log(`  Nouvelle venue, ${lbl} (${l.length} matchs) : points par match annoncés moteur ${mean(l.map((r) => pts(r.base, r.newH))).toFixed(2)} · bookmakers ${mean(l.map((r) => pts(r.bk, r.newH))).toFixed(2)} · réels ${real.toFixed(2)}`);
  }
}

// 2) Réglage de la variante sur A seulement
const grid = [];
for (const K of [6, 10, 15]) for (const a0 of [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7]) for (const d0 of [1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3]) grid.push({ K, a0, d0 });
const A = rows.filter(PER.A);
let best = null;
for (const P of grid) { const b = mean(A.map((r) => brier(predict(r, P), r.k))); if (!best || b < best.b) best = { P, b }; }
console.log(`\nRéglage sur A (${grid.length} essais) : meilleur K=${best.P.K}, attaque ${best.P.a0}, défense ${best.P.d0}`);

// 3) Jugement
for (const [pn, inP] of Object.entries(PER)) {
  const P = rows.filter(inP), N = P.filter((r) => r.newH || r.newA);
  const [d, lo, hi] = ci(P, (r) => predict(r, best.P), (r) => r.base);
  const [dn, lon, hin] = ci(N, (r) => predict(r, best.P), (r) => r.base);
  console.log(`  ${pn} : tous ${P.length} matchs ${f4(d)} [${f4(lo)} ; ${f4(hi)}] · matchs avec nouvelle venue ${N.length} ${f4(dn)} [${f4(lon)} ; ${f4(hin)}]`);
}
const BC = rows.filter((r) => r.S >= 2025);
const [d, lo, hi] = ci(BC, (r) => predict(r, best.P), (r) => r.base);
console.log(`  B+C : ${BC.length} matchs ${f4(d)} [${f4(lo)} ; ${f4(hi)}]`);
console.log(`  Par championnat (B+C, matchs avec nouvelle venue) :`);
for (const lg of LGS) { const l = BC.filter((r) => r.lg === lg && (r.newH || r.newA)); if (l.length < 20) continue; const [x, a, b] = ci(l, (r) => predict(r, best.P), (r) => r.base); console.log(`    ${lg.padEnd(4)} ${String(l.length).padStart(4)} ${f4(x)} [${f4(a)} ; ${f4(b)}]`); }
// Points annoncés après correction
for (const [pn, inP] of Object.entries(PER)) {
  const l = rows.filter((r) => inP(r) && r.newH !== r.newA && r.nNew < 10); if (!l.length) continue;
  const pts = (p, home) => (home ? 3 * p[0] + p[1] : 3 * p[2] + p[1]);
  console.log(`  ${pn}, 10 premiers matchs : points annoncés après correction ${mean(l.map((r) => pts(predict(r, best.P), r.newH))).toFixed(2)} (avant ${mean(l.map((r) => pts(r.base, r.newH))).toFixed(2)}, réels ${mean(l.map((r) => (r.newH ? [3, 1, 0][r.k] : [0, 1, 3][r.k]))).toFixed(2)})`);
}

// 4) Correction ajoutée APRÈS avoir vu B (à juger avec prudence) : en Championship et Ligue 2,
// une nouvelle venue peut être un promu de 3e division (faible) OU un relégué de 1re division (fort).
// Variante appliquée seulement aux 7 championnats de 1re division, où une nouvelle venue est toujours un promu.
{
  const SECOND = new Set(["ELC", "FL2"]);
  const pv = (r, P) => (SECOND.has(r.lg) ? r.base : predict(r, P));
  let b2 = null;
  for (const P of grid) { const b = mean(A.map((r) => brier(pv(r, P), r.k))); if (!b2 || b < b2.b) b2 = { P, b }; }
  console.log(`\nVariante 1re division seulement — réglage sur A : K=${b2.P.K}, attaque ${b2.P.a0}, défense ${b2.P.d0}`);
  for (const [pn, inP] of Object.entries({ ...PER, "B+C": (r) => r.S >= 2025 })) {
    const P = rows.filter(inP), N = P.filter((r) => !SECOND.has(r.lg) && (r.newH || r.newA));
    const [d, lo, hi] = ci(P, (r) => pv(r, b2.P), (r) => r.base), [dn, lon, hin] = ci(N, (r) => pv(r, b2.P), (r) => r.base);
    console.log(`  ${pn.padEnd(3)} : tous ${P.length} ${f4(d)} [${f4(lo)} ; ${f4(hi)}] · avec promu ${N.length} ${f4(dn)} [${f4(lon)} ; ${f4(hin)}]`);
  }
}
