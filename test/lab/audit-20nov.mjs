// ============================================================
// AUDIT REPRODUCTIBLE DES MODIFICATIONS DU 20/11/2026 (promus, Elo 25 %, corners 30 %)
// Aucune optimisation : tous les paramètres sont lus tels quels dans src/config.js et src/corners.js (production).
// 8 configurations sur exactement les mêmes matchs : M0 ancien moteur, M1 promus, M2 Elo, M3 corners, M4 promus+Elo,
// M5 promus+corners, M6 Elo+corners, M7 les trois. Plus une variante de sensibilité M7r (corners connus seulement
// pour les matchs joués au moins 4 jours avant : le fichier football-data.co.uk n'est mis à jour que quelques fois par semaine).
// Données : data/history.json du dépôt public PronostiK (football-data.co.uk : résultats, corners, cotes moyennes).
// Usage : node test/lab/audit-20nov.mjs <history.json> <sortie.csv> [sortie-resultats.json]
// ============================================================
import fs from "node:fs";
import { buildModel, computeTeamRatings, computeElo, calculate_match_prediction } from "../../src/model.js";
import { LEAGUES, MODEL } from "../../src/config.js";
import { blendCorners, CORNERS_LEAGUES } from "../../src/corners.js";
const [H, CSV = "audit-20nov-predictions.csv", JOUT = null] = process.argv.slice(2);
const hist = JSON.parse(fs.readFileSync(H, "utf8")).filter((m) => (m.division || "L1") === "L1");
const LGS = ["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED", "ELC", "FL2"];
// Championnats concernés, lus dans la configuration de production
const FD = Object.fromEntries(Object.entries(LEAGUES).map(([id, l]) => [id, l.src.replace(/^fd:/, "")]));
const PROMUS = new Set(Object.values(LEAGUES).filter((l) => l.promus).map((l) => l.src.replace("fd:", "")));
const CORNERS = new Set(Object.keys(CORNERS_LEAGUES).map((id) => (id === "62" ? "FL2" : FD[id])));
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const logl = (p, k) => -Math.log(Math.max(1e-15, p[k]));
const CONF = { M0: [0, 0, 0], M1: [1, 0, 0], M2: [0, 1, 0], M3: [0, 0, 1], M4: [1, 1, 0], M5: [1, 0, 1], M6: [0, 1, 1], M7: [1, 1, 1], M7r: [1, 1, 2] };
const checks = { journees: 0, fuiteResultat: 0, fuiteCorners: 0 };
const rows = [];
for (const lg of LGS) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m, i) => ({ id: `${lg}-${i}`, homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date, hc: m.hc, ac: m.ac }));
  for (const date of [...new Set(L.filter((m) => m.date >= "2024-08-01").map((m) => m.date))]) {
    const S = seasonOf(date);
    // Données accessibles pour une prédiction le jour « date » : matchs terminés AVANT ce jour, saison en cours + précédente
    const past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    checks.journees++;
    if (past.some((f) => f.date >= date)) checks.fuiteResultat++;
    // Promus : équipes du calendrier de la saison S (connu avant la saison) absentes des matchs terminés de S−1.
    const prevT = new Set(); for (const f of past) if (f.season === S - 1) { prevT.add(f.homeId); prevT.add(f.awayId); }
    const curT = new Set(); for (const f of fin) if (f.season === S) { curT.add(f.homeId); curT.add(f.awayId); }
    const nc = new Set([...curT].filter((t) => !prevT.has(t)));
    const newcomers = PROMUS.has(lg) && prevT.size && nc.size && nc.size <= MODEL.promotedMaxTeams ? nc : null;
    // Corners : seulement ceux des matchs passés (même table que la production : identifiant de match → [corners dom., ext.])
    const cmap = (lagDays) => ({ m: Object.fromEntries(past.filter((f) => f.hc != null && f.ac != null && Date.parse(date) - Date.parse(f.date) >= lagDays * 864e5).map((f) => [f.id, [f.hc, f.ac]])) });
    for (const id of Object.keys(cmap(0).m)) if (!past.some((f) => f.id === id)) checks.fuiteCorners++;
    const models = {};
    const getModel = (pro, cor) => {
      const key = `${pro}${cor}`;
      if (models[key]) return models[key];
      const opts = { newcomers: pro ? newcomers : null };
      if (cor && CORNERS.has(lg)) { const bl = blendCorners(past, [cmap(cor === 2 ? 4 : 0)]); return (models[key] = { ...computeTeamRatings(bl.finished, opts), elo: computeElo(past) }); }
      return (models[key] = buildModel(past, opts));
    };
    for (const m of L.filter((x) => x.date === date && [x.avgH, x.avgD, x.avgA].every((o) => o > 1))) {
      const row = { lg, date, S, home: m.home, away: m.away, hg: m.hg, ag: m.ag, k: res(m), p: {} };
      for (const [c, [pro, elo, cor]] of Object.entries(CONF)) {
        const p = calculate_match_prediction({ teamDomId: m.home, teamExtId: m.away, date }, { model: getModel(pro, cor), leagueId: lg, season: S, eloMix: !!elo }).poisson;
        const t = p.proba1 + p.probaN + p.proba2; row.p[c] = [p.proba1 / t, p.probaN / t, p.proba2 / t];
      }
      rows.push(row);
    }
  }
}
// ---------- Résultats ----------
const NAMES = Object.keys(CONF), r4 = (x) => Math.round(x * 10000) / 10000, r5 = (x) => Math.round(x * 100000) / 100000;
const score = (l, c) => ({ n: l.length, brier: r4(l.reduce((s, r) => s + brier(r.p[c], r.k), 0) / l.length), logloss: r4(l.reduce((s, r) => s + logl(r.p[c], r.k), 0) / l.length) });
function paired(l, c, f) { // écart apparié c − M0, IC 95 % par bootstrap regroupé par date (3 000 tirages)
  const byD = new Map(); for (const r of l) { const x = byD.get(r.date) || [0, 0]; x[0] += f(r.p[c], r.k) - f(r.p.M0, r.k); x[1]++; byD.set(r.date, x); }
  const G = [...byD.values()], mean = G.reduce((s, g) => s + g[0], 0) / G.reduce((s, g) => s + g[1], 0);
  let seed = 20261120; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); const sims = [];
  for (let t = 0; t < 3000; t++) { let s = 0, n = 0; for (let i = 0; i < G.length; i++) { const g = G[(rnd() * G.length) | 0]; s += g[0]; n += g[1]; } sims.push(s / n); }
  sims.sort((a, b) => a - b); return [r5(mean), r5(sims[75]), r5(sims[2924])];
}
const SEAS = [...new Set(rows.map((r) => r.S))].sort();
const out = { matchs: rows.length, du: rows.reduce((a, r) => (r.date < a ? r.date : a), "9"), au: rows.reduce((a, r) => (r.date > a ? r.date : a), "0"), controles: checks, global: {}, saisons: {}, championnats: {} };
for (const c of NAMES) out.global[c] = { ...score(rows, c), ecartBrier: paired(rows, c, brier), ecartLogloss: paired(rows, c, logl) };
for (const S of SEAS) { const l = rows.filter((r) => r.S === S); out.saisons[S] = Object.fromEntries(NAMES.map((c) => [c, { ...score(l, c), ecartBrier: paired(l, c, brier), ecartLogloss: paired(l, c, logl) }])); }
for (const lg of LGS) { const l = rows.filter((r) => r.lg === lg); out.championnats[lg] = Object.fromEntries(NAMES.map((c) => [c, { ...score(l, c), ecartBrier: paired(l, c, brier) }])); }
if (JOUT) fs.writeFileSync(JOUT, JSON.stringify(out, null, 1));
// CSV : date, championnat, saison, équipes, score, résultat, probabilités 1-N-2 des 9 colonnes
const head = ["date", "championnat", "saison", "domicile", "exterieur", "buts_dom", "buts_ext", "resultat", ...NAMES.flatMap((c) => [`${c}_1`, `${c}_N`, `${c}_2`])];
fs.writeFileSync(CSV, [head.join(","), ...rows.map((r) => [r.date, r.lg, `${r.S}-${String(r.S + 1).slice(2)}`, `"${r.home}"`, `"${r.away}"`, r.hg, r.ag, ["1", "N", "2"][r.k], ...NAMES.flatMap((c) => r.p[c].map((x) => x.toFixed(5)))].join(","))].join("\n"));
// Affichage
const f = (x) => (x >= 0 ? "+" : "") + x.toFixed(4);
console.log(`${out.matchs} matchs, du ${out.du} au ${out.au}. Contrôles : ${JSON.stringify(checks)}\n`);
console.log("Config  Brier   LogLoss   écart Brier vs M0 [IC 95 %]        écart LogLoss vs M0 [IC 95 %]");
for (const c of NAMES) { const g = out.global[c]; console.log(`${c.padEnd(6)} ${g.brier.toFixed(4)}  ${g.logloss.toFixed(4)}   ${f(g.ecartBrier[0])} [${f(g.ecartBrier[1])} ; ${f(g.ecartBrier[2])}]   ${f(g.ecartLogloss[0])} [${f(g.ecartLogloss[1])} ; ${f(g.ecartLogloss[2])}]`); }
for (const S of SEAS) { console.log(`\nSaison ${S}-${String(S + 1).slice(2)} (${out.saisons[S].M0.n})`); for (const c of NAMES) { const g = out.saisons[S][c]; console.log(`  ${c.padEnd(6)} ${g.brier.toFixed(4)} ${g.logloss.toFixed(4)}  ${f(g.ecartBrier[0])} [${f(g.ecartBrier[1])} ; ${f(g.ecartBrier[2])}]  LL ${f(g.ecartLogloss[0])} [${f(g.ecartLogloss[1])} ; ${f(g.ecartLogloss[2])}]`); } }
console.log("\nPar championnat, écart Brier vs M0 (M1 / M2 / M3 / M7) :");
for (const lg of LGS) { const C = out.championnats[lg]; console.log(`  ${lg.padEnd(4)} n=${C.M0.n}  M0 ${C.M0.brier.toFixed(4)}  ` + ["M1", "M2", "M3", "M7"].map((c) => `${c} ${f(C[c].ecartBrier[0])} [${f(C[c].ecartBrier[1])};${f(C[c].ecartBrier[2])}]`).join("  ")); }
