// ============================================================
// IMPACT HORS LIGNE DU CORRECTIF DE LIAISON (24/11/2026) — rien n'est publié, aucun coefficient ne change.
// Compare, sur les 7 437 matchs de l'audit (9 championnats, 2024-25 → 2026-27, matchs du suivi exclus) :
//   M7P = M7 avec les corners reliés comme en production aujourd'hui (matchCorners, équipes reconnues par les dates,
//         rejoué à chaque journée avec seulement les données disponibles avant la journée, noms rendus anonymes) ;
//   M7C = M7 avec les corners reliés par la table explicite (liaison stricte, src/liaison.js) — ici équivalent à la
//         liaison par le nom exact, puisque l'historique porte les mêmes noms des deux côtés.
// Mesures : Brier et log loss (écart M7C − M7P, intervalle par journées), écart moyen et maximal des probabilités,
// couverture des corners vue par chaque version au moment de chaque prédiction.
// Usage : node test/lab/liaison/impact.mjs <history.json>
// ============================================================
import fs from "node:fs";
import { computeTeamRatings, computeElo, calculate_match_prediction } from "../../../src/model.js";
import { LEAGUES, MODEL } from "../../../src/config.js";
import { blendCorners, matchCorners, CORNERS_LEAGUES } from "../../../src/corners.js";
import { linkStrict } from "../../../src/liaison.js";
const CUTOFF = "2026-11-20";
const hist = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).filter((m) => (m.division || "L1") === "L1" && m.date < CUTOFF);
const LGS = ["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED", "ELC", "FL2"];
const FD = Object.fromEntries(Object.entries(LEAGUES).map(([id, l]) => [id, l.src.replace(/^fd:/, "")]));
const PROMUS = new Set(Object.values(LEAGUES).filter((l) => l.promus).map((l) => l.src.replace("fd:", "")));
const CORNERS = new Set(Object.keys(CORNERS_LEAGUES).map((id) => (id === "62" ? "FL2" : FD[id])));
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const logl = (p, k) => -Math.log(Math.max(1e-15, p[k]));
let seed = 20261124; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rows = [], cov = {};
for (const lg of LGS) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const teams = [...new Set(L.flatMap((m) => [m.home, m.away]))].sort(() => rnd() - 0.5);
  const anon = Object.fromEntries(teams.map((t, i) => [t, String(9000 + i)])); // identifiants « robot »
  const table = Object.fromEntries(teams.map((t) => [t, anon[t]]));            // table explicite (vérifiée ailleurs)
  const fin = L.map((m, i) => ({ id: `${lg}-${i}`, homeId: anon[m.home], awayId: anon[m.away], hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date }));
  const csv = L.filter((m) => m.hc != null && m.ac != null).map((m) => ({ s: seasonOf(m.date), date: m.date, r: [Date.parse(m.date), m.home, m.away, m.hg, m.ag, m.hc, m.ac] }));
  for (const date of [...new Set(L.filter((m) => m.date >= "2024-08-01").map((m) => m.date))]) {
    const S = seasonOf(date);
    const past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const prevT = new Set(); for (const f of past) if (f.season === S - 1) { prevT.add(f.homeId); prevT.add(f.awayId); }
    const curT = new Set(); for (const f of fin) if (f.season === S) { curT.add(f.homeId); curT.add(f.awayId); }
    const nc = new Set([...curT].filter((t) => !prevT.has(t)));
    const newcomers = PROMUS.has(lg) && prevT.size && nc.size && nc.size <= MODEL.promotedMaxTeams ? nc : null;
    const elo = computeElo(past);
    const maps = { P: [], C: [] };
    if (CORNERS.has(lg)) for (const s of [S - 1, S]) {
      const rs = csv.filter((x) => x.s === s && x.date < date).map((x) => x.r), fs_ = past.filter((f) => f.season === s);
      maps.P.push(matchCorners(rs, fs_)); maps.C.push(linkStrict(rs, fs_, table));
    }
    const M = {}, n = {};
    for (const v of ["P", "C"]) { const b = CORNERS.has(lg) ? blendCorners(past, maps[v]) : { finished: past, n: 0 }; n[v] = b.n; M[v] = { ...computeTeamRatings(b.finished, { newcomers }), elo }; }
    const c = (cov[`${lg}@${S}`] ||= { P: 0, C: 0, tot: 0, j: 0 }); c.P += n.P; c.C += n.C; c.tot += past.length; c.j++;
    for (const m of L.filter((x) => x.date === date && [x.avgH, x.avgD, x.avgA].every((o) => o > 1))) {
      const row = { lg, date, S, k: res(m), p: {} };
      for (const v of ["P", "C"]) { const p = calculate_match_prediction({ teamDomId: anon[m.home], teamExtId: anon[m.away], date }, { model: M[v], leagueId: lg, season: S, eloMix: true }).poisson; const t = p.proba1 + p.probaN + p.proba2; row.p[v] = [p.proba1 / t, p.probaN / t, p.proba2 / t]; }
      rows.push(row);
    }
  }
}
function paired(l, fn) {
  const byD = new Map(); for (const r of l) { const x = byD.get(r.date) || [0, 0]; x[0] += fn(r.p.C, r.k) - fn(r.p.P, r.k); x[1]++; byD.set(r.date, x); }
  const G = [...byD.values()], mean = G.reduce((s, g) => s + g[0], 0) / G.reduce((s, g) => s + g[1], 0);
  let sd = 20261124; const rr = () => ((sd = (sd * 16807) % 2147483647) / 2147483647); const sims = [];
  for (let t = 0; t < 3000; t++) { let s = 0, n = 0; for (let i = 0; i < G.length; i++) { const g = G[(rr() * G.length) | 0]; s += g[0]; n += g[1]; } sims.push(s / n); }
  sims.sort((a, b) => a - b); return [mean, sims[75], sims[2924]];
}
const f = (x) => (x >= 0 ? "+" : "") + x.toFixed(4), ci = (a) => `${f(a[0])} [${f(a[1])} ; ${f(a[2])}]`;
const avg = (l, v, fn) => l.reduce((s, r) => s + fn(r.p[v], r.k), 0) / l.length;
const dp = (l) => { let s = 0, mx = 0; for (const r of l) for (let i = 0; i < 3; i++) { const d = Math.abs(r.p.C[i] - r.p.P[i]); s += d; mx = Math.max(mx, d); } return [s / (3 * l.length), mx]; };
const show = (t, l) => { if (!l.length) return; const [md, mx] = dp(l); console.log(`${t.padEnd(16)} n=${String(l.length).padStart(4)}  M7P ${avg(l, "P", brier).toFixed(4)}  M7C ${avg(l, "C", brier).toFixed(4)}  écart Brier ${ci(paired(l, brier))}  LL ${ci(paired(l, logl))}  proba : écart moyen ${(100 * md).toFixed(2)} pt, max ${(100 * mx).toFixed(1)} pt`); };
console.log(`${rows.length} matchs (avant le ${CUTOFF})\n`);
show("TOTAL", rows);
for (const S of [2024, 2025, 2026]) show(`Saison ${S}`, rows.filter((r) => r.S === S));
console.log("");
for (const lg of LGS) show(lg, rows.filter((r) => r.lg === lg));
console.log("\nCouverture moyenne des corners au moment des prédictions (part des matchs passés utilisés) :");
for (const [k, c] of Object.entries(cov).sort()) if (c.C) console.log(`  ${k.padEnd(9)} production ${(100 * c.P / c.tot).toFixed(0).padStart(3)} %   correctif ${(100 * c.C / c.tot).toFixed(0).padStart(3)} %`);
