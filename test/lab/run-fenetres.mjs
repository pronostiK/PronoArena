// ============================================================
// TEST HORS LIGNE — longueur de la mémoire (fenêtre de matchs) sur M7 (21/11/2026, demande de Kay). Rien n'est publié.
// Le moteur en production est figé (suivi M0 / M7) : toute adoption passerait par l'auditeur après l'évaluation.
// Variantes fixées avant le calcul (tout le reste = M7 : promus, Elo 25 % sur tous les matchs passés, corners 30 %) :
//   W80 = M7 actuel (80 derniers matchs par équipe, saisons en cours + précédente) ; W40 ; W30 ; W20 ;
//   SAISON = saison en cours seule dès que chaque équipe du championnat y a joué au moins 8 matchs, sinon comme W80.
// Mêmes matchs et mêmes règles que l'audit du 20/11 (audit-20nov.mjs) : 9 championnats, 2024-25 → 2026-27, matchs avec cotes.
// Sous-groupes : matchs avec un promu ; matchs avec un club « qui a beaucoup changé » (points par match de la saison en cours,
// avant le match, à plus de 0,5 de ceux de la saison précédente ; au moins 6 matchs joués), calculé sans information future.
// Usage : node test/lab/run-fenetres.mjs <history.json>
// ============================================================
import fs from "node:fs";
import { computeTeamRatings, computeElo, calculate_match_prediction } from "../../src/model.js";
import { LEAGUES, MODEL } from "../../src/config.js";
import { blendCorners, CORNERS_LEAGUES } from "../../src/corners.js";
const hist = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).filter((m) => (m.division || "L1") === "L1");
const LGS = ["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED", "ELC", "FL2"];
const FD = Object.fromEntries(Object.entries(LEAGUES).map(([id, l]) => [id, l.src.replace(/^fd:/, "")]));
const PROMUS = new Set(Object.values(LEAGUES).filter((l) => l.promus).map((l) => l.src.replace("fd:", "")));
const CORNERS = new Set(Object.keys(CORNERS_LEAGUES).map((id) => (id === "62" ? "FL2" : FD[id])));
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const logl = (p, k) => -Math.log(Math.max(1e-15, p[k]));
const W0 = MODEL.windowMatches;
const VARS = ["W80", "W40", "W30", "W20", "SAISON"];
const rows = [];
let saisonActive = 0, journees = 0;
for (const lg of LGS) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m, i) => ({ id: `${lg}-${i}`, homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date, hc: m.hc, ac: m.ac }));
  for (const date of [...new Set(L.filter((m) => m.date >= "2024-08-01").map((m) => m.date))]) {
    const S = seasonOf(date);
    const past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    journees++;
    const prevT = new Set(); for (const f of past) if (f.season === S - 1) { prevT.add(f.homeId); prevT.add(f.awayId); }
    const curT = new Set(); for (const f of fin) if (f.season === S) { curT.add(f.homeId); curT.add(f.awayId); }
    const nc = new Set([...curT].filter((t) => !prevT.has(t)));
    const newcomers = PROMUS.has(lg) && prevT.size && nc.size && nc.size <= MODEL.promotedMaxTeams ? nc : null;
    const elo = computeElo(past);
    const ratings = (list) => { const cm = { m: Object.fromEntries(list.filter((f) => f.hc != null && f.ac != null).map((f) => [f.id, [f.hc, f.ac]])) }; return computeTeamRatings(CORNERS.has(lg) ? blendCorners(list, [cm]).finished : list, { newcomers }); };
    // Points par match, saison en cours / précédente (pour le sous-groupe « a beaucoup changé »)
    const ppm = (season) => { const o = {}; for (const f of past) if (f.season === season) { const [ph, pa] = f.hg > f.ag ? [3, 0] : f.hg === f.ag ? [1, 1] : [0, 3]; for (const [t, p] of [[f.homeId, ph], [f.awayId, pa]]) { const x = (o[t] ||= [0, 0]); x[0] += p; x[1]++; } } return o; };
    const pc = ppm(S), pp = ppm(S - 1);
    const changed = (t) => pc[t] && pp[t] && pc[t][1] >= 6 && Math.abs(pc[t][0] / pc[t][1] - pp[t][0] / pp[t][1]) > 0.5;
    const M = {};
    for (const [v, w] of [["W80", W0], ["W40", 40], ["W30", 30], ["W20", 20]]) { MODEL.windowMatches = w; M[v] = { ...ratings(past), elo }; }
    MODEL.windowMatches = W0;
    const cur = past.filter((f) => f.season === S), cnt = {};
    for (const f of cur) { cnt[f.homeId] = (cnt[f.homeId] || 0) + 1; cnt[f.awayId] = (cnt[f.awayId] || 0) + 1; }
    const enough = curT.size && [...curT].every((t) => (cnt[t] || 0) >= 8);
    if (enough) saisonActive++;
    M.SAISON = enough ? { ...computeTeamRatings(CORNERS.has(lg) ? blendCorners(cur, [{ m: Object.fromEntries(cur.filter((f) => f.hc != null && f.ac != null).map((f) => [f.id, [f.hc, f.ac]])) }]).finished : cur, { newcomers: null }), elo } : M.W80;
    for (const m of L.filter((x) => x.date === date && [x.avgH, x.avgD, x.avgA].every((o) => o > 1))) {
      const row = { lg, date, S, k: res(m), promu: !!(newcomers && (newcomers.has(m.home) || newcomers.has(m.away))), change: changed(m.home) || changed(m.away), p: {} };
      for (const v of VARS) { const p = calculate_match_prediction({ teamDomId: m.home, teamExtId: m.away, date }, { model: M[v], leagueId: lg, season: S, eloMix: true }).poisson; const t = p.proba1 + p.probaN + p.proba2; row.p[v] = [p.proba1 / t, p.probaN / t, p.proba2 / t]; }
      const t = 1 / m.avgH + 1 / m.avgD + 1 / m.avgA; row.p.BOOK = [1 / m.avgH / t, 1 / m.avgD / t, 1 / m.avgA / t];
      rows.push(row);
    }
  }
}
function paired(l, c, f) {
  const byD = new Map(); for (const r of l) { const x = byD.get(r.date) || [0, 0]; x[0] += f(r.p[c], r.k) - f(r.p.W80, r.k); x[1]++; byD.set(r.date, x); }
  const G = [...byD.values()], mean = G.reduce((s, g) => s + g[0], 0) / G.reduce((s, g) => s + g[1], 0);
  let seed = 20261121; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); const sims = [];
  for (let t = 0; t < 3000; t++) { let s = 0, n = 0; for (let i = 0; i < G.length; i++) { const g = G[(rnd() * G.length) | 0]; s += g[0]; n += g[1]; } sims.push(s / n); }
  sims.sort((a, b) => a - b); return [mean, sims[75], sims[2924]];
}
const f = (x) => (x >= 0 ? "+" : "") + x.toFixed(4), ci = (a) => `${f(a[0])} [${f(a[1])} ; ${f(a[2])}]`;
const avg = (l, c, fn) => l.reduce((s, r) => s + fn(r.p[c], r.k), 0) / l.length;
const show = (t, l) => { console.log(`\n${t} (n=${l.length})  W80 Brier ${avg(l, "W80", brier).toFixed(4)}  bookmakers ${avg(l, "BOOK", brier).toFixed(4)}`); for (const v of VARS.slice(1)) console.log(`  ${v.padEnd(6)} Brier ${ci(paired(l, v, brier))}   LL ${ci(paired(l, v, logl))}`); };
console.log(`${rows.length} matchs, ${journees} journées ; « saison seule » active sur ${saisonActive} journées`);
show("TOTAL", rows);
for (const S of [2024, 2025, 2026]) show(`Saison ${S}-${String(S + 1).slice(2)}`, rows.filter((r) => r.S === S));
show("Matchs avec un promu", rows.filter((r) => r.promu));
show("Matchs avec un club qui a beaucoup changé", rows.filter((r) => r.change));
console.log("\nPar championnat (Brier, écart à W80) :");
for (const lg of LGS) { const l = rows.filter((r) => r.lg === lg); console.log(`  ${lg.padEnd(4)} n=${l.length} ` + VARS.slice(1).map((v) => `${v} ${f(paired(l, v, brier)[0])}`).join("  ")); }
console.log("\nPar championnat et saison (Brier, écart à W80 : W40 / SAISON) :");
for (const lg of LGS) console.log(`  ${lg.padEnd(4)} ` + [2024, 2025, 2026].map((S) => { const l = rows.filter((r) => r.lg === lg && r.S === S); return `${S}: ${f(paired(l, "W40", brier)[0])} / ${f(paired(l, "SAISON", brier)[0])}`; }).join("   "));
