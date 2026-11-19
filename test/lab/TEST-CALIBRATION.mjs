// ============================================================
// DUEL PRONO — Test de calibration par température du moteur M0 (19/11/2026). Aucun fichier de production modifié.
// p'_i = p_i^(1/T) / somme_j(p_j^(1/T)), sur les probabilités 1-N-2 de M0 lues dans PREDICTIONS-PONDERATION.csv (colonnes M0_1, M0_N, M0_2).
// Protocole fixé avant le calcul :
//  - T parmi 0,85 ; 0,90 ; 0,95 ; 1,00 ; 1,05 ; 1,10 ; 1,15 ; 1,20 (aucune autre valeur) ;
//  - choix de T sur la période A seule, au Brier moyen le plus bas (T = 1,00 est la référence : on ne quitte T = 1 que si un autre T a un Brier strictement plus bas) ;
//  - le T choisi est évalué sur B sans réajustement, puis sur C affiché à part (diagnostic déjà consulté) ;
//  - Brier 1-N-2 (somme des carrés), log loss 1-N-2, calibration des favoris ; mêmes matchs pour tous les T ;
//  - IC 95 % des écarts par rééchantillonnage regroupé par date (3 000 tirages, graine 11).
// Remarque : les probabilités du fichier sont arrondies à 3 décimales (comme dans le moteur) ; T = 1,00 renormalise donc légèrement (somme à 1) ;
//   la ligne « M0 brut » donne les probabilités non transformées pour contrôle.
// Usage : node test/lab/TEST-CALIBRATION.mjs PREDICTIONS-PONDERATION.csv [PREDICTIONS-CALIBRATION.csv]
// ============================================================
import fs from "node:fs";
const IN = process.argv[2], OUT = process.argv[3] || "PREDICTIONS-CALIBRATION.csv";
const lines = fs.readFileSync(IN, "utf8").trim().split(/\r?\n/), head = lines[0].split(",");
const rows = lines.slice(1).map((l) => { const c = l.split(","), o = Object.fromEntries(head.map((h, i) => [h, c[i]])); return { date: o.date, lg: o.championnat, per: o.periode, home: o.domicile, away: o.exterieur, res: o.resultat, k: "1N2".indexOf(o.resultat), p0: [+o.M0_1, +o.M0_N, +o.M0_2] }; });
const TS = [0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15, 1.20];
const temp = (p, T) => { const q = p.map((v) => Math.pow(Math.max(v, 1e-12), 1 / T)), s = q[0] + q[1] + q[2]; return q.map((v) => v / s); };
for (const r of rows) { r.pT = Object.fromEntries(TS.map((T) => [T, temp(r.p0, T)])); }
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const logloss = (p, k) => -Math.log(Math.max(1e-12, p[k]));
const mean = (L, f) => L.reduce((s, r) => s + f(r), 0) / L.length;
const r5 = (x) => Math.round(x * 100000) / 100000, r4 = (x) => Math.round(x * 10000) / 10000;
const A = rows.filter((r) => r.per === "A"), B = rows.filter((r) => r.per === "B"), C = rows.filter((r) => r.per === "C");
console.log(`prédictions M0 lues : ${rows.length} (A ${A.length}, B ${B.length}, C ${C.length})`);
function ci(L, get, metric) {
  const f = (r) => metric(get(r), r.k) - metric(r.pT[1], r.k);
  const byD = new Map(); for (const r of L) { const e = byD.get(r.date) || [0, 0]; e[0] += f(r); e[1]++; byD.set(r.date, e); }
  const D = [...byD.values()], m = D.reduce((s, e) => s + e[0], 0) / L.length;
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sims = []; for (let t = 0; t < 3000; t++) { let s = 0, c = 0; for (let i = 0; i < D.length; i++) { const e = D[(rnd() * D.length) | 0]; s += e[0]; c += e[1]; } sims.push(s / c); }
  sims.sort((a, b) => a - b); return [r5(m), r5(sims[75]), r5(sims[2924])];
}
const out = [];
const say = (s = "") => { out.push(s); console.log(s); };

// 1) Choix de T sur A
say("## Choix de T sur la période A seule");
say("| T | Brier A | Écart vs T = 1 | Log loss A |"); say("|---|---|---|---|");
const bA = Object.fromEntries(TS.map((T) => [T, mean(A, (r) => brier(r.pT[T], r.k))]));
for (const T of TS) say(`| ${T.toFixed(2)} | ${r5(bA[T])} | ${T === 1 ? "—" : (bA[T] - bA[1] >= 0 ? "+" : "") + r5(bA[T] - bA[1])} | ${r5(mean(A, (r) => logloss(r.pT[T], r.k)))} |`);
say(`| M0 brut (sans renormalisation) | ${r5(mean(A, (r) => brier(r.p0, r.k)))} | — | ${r5(mean(A, (r) => logloss(r.p0, r.k)))} |`);
let Tsel = 1; for (const T of TS) if (bA[T] < bA[Tsel]) Tsel = T;
say(`\nT retenu sur A : **${Tsel.toFixed(2)}**${Tsel === 1 ? " (aucun T n'améliore le Brier de A : on reste à T = 1)" : ""}`);

// 2) Évaluation
const FB = [[0, 0.5, "favori M0 < 50 %"], [0.5, 0.6, "50-60 %"], [0.6, 0.7, "60-70 %"], [0.7, 1.01, "≥ 70 %"]];
const fav = (p) => (p[0] >= p[2] ? 0 : 2);
function evalBlock(title, L) {
  say(`\n### ${title} — ${L.length} matchs`);
  say("| Modèle | Brier | Écart Brier vs T = 1 [IC 95 %] | Log loss | Écart log loss vs T = 1 [IC 95 %] |"); say("|---|---|---|---|---|");
  const cand = [1, ...(Tsel !== 1 ? [Tsel] : [])];
  for (const T of cand) {
    const b = mean(L, (r) => brier(r.pT[T], r.k)), l = mean(L, (r) => logloss(r.pT[T], r.k));
    if (T === 1) say(`| T = 1,00 (référence) | ${r5(b)} | — | ${r5(l)} | — |`);
    else { const [e, lo, hi] = ci(L, (r) => r.pT[T], brier), [e2, lo2, hi2] = ci(L, (r) => r.pT[T], logloss); say(`| T = ${T.toFixed(2)} | ${r5(b)} | ${e >= 0 ? "+" : ""}${e} [${lo} ; ${hi}] | ${r5(l)} | ${e2 >= 0 ? "+" : ""}${e2} [${lo2} ; ${hi2}] |`); }
  }
  say(`| M0 brut (contrôle) | ${r5(mean(L, (r) => brier(r.p0, r.k)))} | — | ${r5(mean(L, (r) => logloss(r.p0, r.k)))} | — |`);
  say("\nCalibration du favori (groupes définis par la probabilité M0 du favori, donc mêmes matchs pour tous les T ; annoncé = moyenne de la probabilité du favori après correction ; observé = part de victoires du favori) :");
  say("| Groupe | Matchs | Observé | Annoncé T = 1 | Annoncé T retenu |"); say("|---|---|---|---|---|");
  for (const [lo, hi, name] of FB) {
    const G = L.filter((r) => { const m = Math.max(r.p0[0], r.p0[2]); return m >= lo && m < hi; }); if (!G.length) continue;
    const obs = G.filter((r) => r.k === fav(r.p0)).length / G.length, ann = (T) => mean(G, (r) => r.pT[T][fav(r.p0)]);
    say(`| ${name} | ${G.length} | ${r4(obs)} | ${r4(ann(1))} | ${r4(ann(Tsel))} |`);
  }
  const G = L.filter((r) => Math.max(r.p0[0], r.p0[2]) >= 0.6);
  say(`| Tous favoris ≥ 60 % (M0) | ${G.length} | ${r4(G.filter((r) => r.k === fav(r.p0)).length / G.length)} | ${r4(mean(G, (r) => r.pT[1][fav(r.p0)]))} | ${r4(mean(G, (r) => r.pT[Tsel][fav(r.p0)]))} |`);
  const N = L; say(`| Nuls : fréquence observée ${r4(N.filter((r) => r.k === 1).length / N.length)} | | | annoncé T = 1 : ${r4(mean(N, (r) => r.pT[1][1]))} | annoncé T retenu : ${r4(mean(N, (r) => r.pT[Tsel][1]))} |`);
}
say("\n## Évaluation du T retenu (sans réajustement)");
evalBlock("Période A (période de choix, exploratoire)", A);
evalBlock("Période B (vérification de stabilité)", B);
evalBlock("Période C (diagnostic historique déjà consulté, pas une validation)", C);
evalBlock("Tous les matchs (A + B + C)", rows);
say("\n## Information seulement : tous les T sur B et C (NON utilisé pour choisir T ; le choix est fait sur A)");
say("| T | Brier B | Écart vs T = 1 | Brier C | Écart vs T = 1 |"); say("|---|---|---|---|---|");
for (const T of TS) { const b = mean(B, (r) => brier(r.pT[T], r.k)), c = mean(C, (r) => brier(r.pT[T], r.k)), b1 = mean(B, (r) => brier(r.pT[1], r.k)), c1 = mean(C, (r) => brier(r.pT[1], r.k)); say(`| ${T.toFixed(2)} | ${r5(b)} | ${T === 1 ? "—" : (b - b1 >= 0 ? "+" : "") + r5(b - b1)} | ${r5(c)} | ${T === 1 ? "—" : (c - c1 >= 0 ? "+" : "") + r5(c - c1)} |`); }
say("\n## Par championnat (toutes périodes, T retenu)");
say("| Championnat | Matchs | Écart Brier T retenu − T = 1 [IC 95 %] |"); say("|---|---|---|");
for (const lg of [...new Set(rows.map((r) => r.lg))]) { const L = rows.filter((r) => r.lg === lg); if (Tsel === 1) { say(`| ${lg} | ${L.length} | 0 (T = 1) |`); continue; } const [e, lo, hi] = ci(L, (r) => r.pT[Tsel], brier); say(`| ${lg} | ${L.length} | ${e >= 0 ? "+" : ""}${e} [${lo} ; ${hi}] |`); }
fs.writeFileSync(OUT.replace(/\.csv$/, ".tables.md"), out.join("\n") + "\n");
const csv = ["date,championnat,periode,domicile,exterieur,resultat,M0_1,M0_N,M0_2," + `T${Tsel.toFixed(2)}_1,T${Tsel.toFixed(2)}_N,T${Tsel.toFixed(2)}_2`];
for (const r of rows) csv.push([r.date, r.lg, r.per, r.home, r.away, r.res, ...r.p0, ...r.pT[Tsel].map((v) => r5(v))].join(","));
fs.writeFileSync(OUT, csv.join("\n") + "\n");
console.log(`\nT retenu ${Tsel} ; ${rows.length} prédictions écrites dans ${OUT}`);
