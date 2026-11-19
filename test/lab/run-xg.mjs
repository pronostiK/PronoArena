// ============================================================
// DUEL PRONO — Test xG (une seule variante fixée à l'avance, 19/11/2026)
// Variante : buts marqués ET encaissés des forces = 50 % buts réels + 50 % xG mesuré (moyennes du championnat avec le même mélange).
// Tout le reste identique au moteur (80 derniers matchs, 8 récents ×1,5, lissage 6, Dixon-Coles, Elo calculé sur les buts RÉELS).
// Règles fixées avant le calcul :
//  - xG utilisé seulement si statut « mesure » ; sinon (estimé / sans xG) le match garde ses buts réels ;
//  - matchs de barrage retirés (équipes ayant < 10 matchs dans la saison du championnat) ;
//  - mêmes règles que le site : le modèle ne voit que les matchs déjà joués, saison en cours + précédente, au moins 20 matchs ;
//  - test à partir du 01/08/2024 (2023-24 = historique de départ) ; périodes A ≤ 30/06/2025, B 01/07/2025 → 28/02/2026, C ≥ 01/03/2026 ;
//  - écart de Brier (variante − moteur), IC 95 % par rééchantillonnage regroupé par date (3 000 tirages).
// Usage : node test/lab/run-xg.mjs <xg_bzzoiro.csv>
// ============================================================
import fs from "node:fs";
import { computeTeamRatings, computeElo, calculate_match_prediction } from "../../src/model.js";

const CSV = process.argv[2];
const lines = fs.readFileSync(CSV, "utf8").trim().split(/\r?\n/);
const head = lines[0].split(",");
const all = lines.slice(1).map((l) => { const c = l.split(","); const o = Object.fromEntries(head.map((h, i) => [h, c[i]])); return o; });
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const cnt = new Map();
for (const r of all) for (const t of [r.domicile, r.exterieur]) { const k = `${r.championnat}|${seasonOf(r.date)}|${t}`; cnt.set(k, (cnt.get(k) || 0) + 1); }
const regular = all.filter((r) => ["domicile", "exterieur"].every((s) => cnt.get(`${r.championnat}|${seasonOf(r.date)}|${r[s]}`) >= 10));
console.log(`matchs ${all.length} → championnat seulement ${regular.length} (barrages retirés : ${all.length - regular.length})`);

const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const rows = [];
for (const lg of [...new Set(regular.map((r) => r.championnat))]) {
  const L = regular.filter((r) => r.championnat === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((r, i) => {
    const hg = +r.buts_domicile, ag = +r.buts_exterieur, ok = r.statut === "mesure";
    return { id: i, homeId: r.domicile, awayId: r.exterieur, hg, ag, bhg: ok ? 0.5 * hg + 0.5 * +r.xg_domicile : hg, bag: ok ? 0.5 * ag + 0.5 * +r.xg_exterieur : ag, ts: Date.parse(r.date + "T12:00:00Z"), season: seasonOf(r.date), date: r.date, ok };
  });
  const dates = [...new Set(fin.filter((f) => f.date >= "2024-08-01").map((f) => f.date))];
  for (const date of dates) {
    const S = seasonOf(date);
    const past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const elo = computeElo(past);
    const base = { ...computeTeamRatings(past), elo };
    const xgm = { ...computeTeamRatings(past.map((f) => ({ ...f, hg: f.bhg, ag: f.bag }))), elo };
    for (const f of fin.filter((x) => x.date === date)) {
      const m = { matchId: f.id, teamDomId: f.homeId, teamExtId: f.awayId, date };
      const pb = calculate_match_prediction(m, { model: base, leagueId: lg, season: S }).poisson;
      const px = calculate_match_prediction(m, { model: xgm, leagueId: lg, season: S }).poisson;
      rows.push({ lg, date, k: res(f), b: [pb.proba1, pb.probaN, pb.proba2], x: [px.proba1, px.probaN, px.proba2] });
    }
  }
}
const per = (r) => (r.date <= "2025-06-30" ? "A" : r.date <= "2026-02-28" ? "B" : "C");
const r4 = (x) => Math.round(x * 10000) / 10000;
function ci(list) {
  const byD = new Map(); for (const r of list) { const d = brier(r.x, r.k) - brier(r.b, r.k); const e = byD.get(r.date) || [0, 0]; e[0] += d; e[1]++; byD.set(r.date, e); }
  const D = [...byD.values()], n = list.length, mean = D.reduce((s, e) => s + e[0], 0) / n;
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sims = []; for (let t = 0; t < 3000; t++) { let s = 0, c = 0; for (let i = 0; i < D.length; i++) { const e = D[(rnd() * D.length) | 0]; s += e[0]; c += e[1]; } sims.push(s / c); }
  sims.sort((a, b) => a - b); return [r4(mean), r4(sims[75]), r4(sims[2924])];
}
const line = (name, list) => { const b = list.reduce((s, r) => s + brier(r.b, r.k), 0) / list.length, x = list.reduce((s, r) => s + brier(r.x, r.k), 0) / list.length; const [e, lo, hi] = ci(list); console.log(`${name.padEnd(16)} n=${String(list.length).padStart(5)}  moteur ${r4(b).toFixed(4)}  xG 50/50 ${r4(x).toFixed(4)}  écart ${e >= 0 ? "+" : ""}${e} [${lo} ; ${hi}]`); };
line("Tous", rows);
for (const p of ["A", "B", "C"]) line("Période " + p, rows.filter((r) => per(r) === p));
for (const lg of [...new Set(rows.map((r) => r.lg))]) line(lg, rows.filter((r) => r.lg === lg));
const nul = (k) => rows.reduce((s, r) => s + r[k][1], 0) / rows.length;
console.log(`nuls annoncés : moteur ${r4(nul("b"))}  xG ${r4(nul("x"))}  observés ${r4(rows.filter((r) => r.k === 1).length / rows.length)}`);
const fav = (k) => { const F = rows.filter((r) => Math.max(r[k][0], r[k][2]) >= 0.6); return `${F.length} matchs, annoncé ${r4(F.reduce((s, r) => s + Math.max(r[k][0], r[k][2]), 0) / F.length)}, observé ${r4(F.filter((r) => r.k === (r[k][0] > r[k][2] ? 0 : 2)).length / F.length)}`; };
console.log("favoris ≥ 60 % — moteur :", fav("b"), "| xG :", fav("x"));
