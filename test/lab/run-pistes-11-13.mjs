// Pistes 11 (nuls par championnat), 12 (enchaînement des matchs), 13 (poids des matchs récents), 20/11/2026.
// Base = moteur en ligne (promus + mélange Elo 25 %). Réglage sur 2024-25, jugement saison par saison (règle de Kay :
// on garde si l'écart va dans le même sens sur 2024-25, 2025-26 et 2026-27 et n'abîme rien ailleurs).
// Usage : node test/lab/run-pistes-11-13.mjs <lambdas.json (dump-lambdas.mjs)>
import fs from "node:fs";
import { calculate_poisson_match } from "../../src/model.js";
import { MODEL } from "../../src/config.js";
const rows = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const sig = (z) => 1 / (1 + Math.exp(-z)), E = MODEL.eloMix, clamp = (x) => Math.max(MODEL.lambdaMin, Math.min(MODEL.lambdaMax, x));
function pred(r, { conf = "M0", rho = MODEL.rho, gamma = 0, short = 4 } = {}) {
  let [lD, lE] = r.lam[conf];
  if (gamma) { if (r.restH !== null && r.restH <= short) lD *= 1 - gamma; if (r.restA !== null && r.restA <= short) lE *= 1 - gamma; }
  const p = calculate_poisson_match(clamp(lD), clamp(lE), rho), b = [p.proba1, p.probaN, p.proba2], t = b[0] + b[1] + b[2];
  const x = (r.elo[0] - r.elo[1]) / 100, pA = sig(E.cut1 - E.slope * x), pAD = sig(E.cut2 - E.slope * x), e = [1 - pAD, Math.max(pAD - pA, 1e-9), pA];
  return b.map((v, i) => (1 - E.alpha) * (v / t) + E.alpha * e[i]);
}
for (const r of rows) r.base = pred(r);
const SEAS = [2024, 2025, 2026], LGS = [...new Set(rows.map((r) => r.lg))];
const gap = (l, f) => l.reduce((s, r) => s + brier(f(r), r.k) - brier(r.base, r.k), 0) / l.length;
const line = (f, filt = () => true) => SEAS.map((S) => { const l = rows.filter((r) => r.S === S && filt(r)); return (gap(l, f) >= 0 ? "+" : "") + gap(l, f).toFixed(4); }).join(" / ");
const A = rows.filter((r) => r.S === 2024);

console.log("Écarts de Brier par saison 2024-25 / 2025-26 / 2026-27 (négatif = mieux que le moteur en ligne)\n");
// Piste 11 : rho (nuls) par championnat, réglé sur 2024-25
console.log("Piste 11 — réglage des nuls par championnat (rho actuel −0,08)");
const RHOS = [-0.2, -0.16, -0.12, -0.1, -0.08, -0.06, -0.04, 0, 0.04];
const rhoOf = {};
for (const lg of LGS) { const l = A.filter((r) => r.lg === lg); rhoOf[lg] = RHOS.reduce((b, x) => (gap(l, (r) => pred(r, { rho: x })) < gap(l, (r) => pred(r, { rho: b })) ? x : b), -0.08); }
const f11 = (r) => pred(r, { rho: rhoOf[r.lg] });
console.log("  rho choisis : " + LGS.map((lg) => `${lg} ${rhoOf[lg]}`).join(", "));
console.log("  tous : " + line(f11)); for (const lg of LGS) console.log(`    ${lg.padEnd(4)} ${line(f11, (r) => r.lg === lg)}`);
const rhoAll = RHOS.reduce((b, x) => (gap(A, (r) => pred(r, { rho: x })) < gap(A, (r) => pred(r, { rho: b })) ? x : b), -0.08);
console.log(`  Variante un seul rho pour tous (choisi ${rhoAll}) : ${line((r) => pred(r, { rho: rhoAll }))}`);
const draws = (f) => SEAS.map((S) => { const l = rows.filter((r) => r.S === S); return `${(100 * l.reduce((s, r) => s + f(r)[1], 0) / l.length).toFixed(1)}/${(100 * l.filter((r) => r.k === 1).length / l.length).toFixed(1)}`; }).join(" · ");
console.log(`  Nuls annoncés/réels (%) moteur : ${draws((r) => r.base)} ; piste 11 : ${draws(f11)}`);

// Piste 12 : enchaînement (dernier match de championnat ≤ 4 jours avant), attaque réduite de gamma
console.log("\nPiste 12 — enchaînement des matchs (championnat seulement, coupes inconnues)");
const sh = rows.filter((r) => r.restH !== null && r.restA !== null);
console.log(`  Matchs avec au moins une équipe à ≤ 4 jours : ${rows.filter((r) => r.restH <= 4 || r.restA <= 4).length} / ${rows.length}`);
const GAM = [0, 0.02, 0.04, 0.06, 0.08, 0.1, -0.02, -0.04];
for (const short of [3, 4]) {
  const g = GAM.reduce((b, x) => (gap(A, (r) => pred(r, { gamma: x, short })) < gap(A, (r) => pred(r, { gamma: b, short })) ? x : b), 0);
  console.log(`  repos ≤ ${short} j : gamma choisi ${g} → ${line((r) => pred(r, { gamma: g, short }))} ; matchs concernés ${line((r) => pred(r, { gamma: g, short }), (r) => r.restH <= short || r.restA <= short)}`);
}

// Piste 13 : poids des matchs récents
console.log("\nPiste 13 — poids des matchs récents (actuel : 8 derniers ×1,5)");
for (const [c, lbl] of [["M2", "10 derniers ×2"], ["M3", "15 derniers ×1,5"]]) { console.log(`  ${lbl} : ${line((r) => pred(r, { conf: c }))}`); for (const lg of LGS) console.log(`    ${lg.padEnd(4)} ${line((r) => pred(r, { conf: c }), (r) => r.lg === lg)}`); }
