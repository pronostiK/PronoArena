// Elo des clubs en complément (reprise de la piste 3), par-dessus la correction des promus. 20/11/2026.
// Même méthode qu'en piste 3 : régression ordonnée sur l'écart d'Elo (réglée sur A), mélange (1−α)·moteur + α·Elo, α choisi sur A.
// Périodes par saison : A = 2024-25, B = 2025-26, C = 2026-27. Usage : node test/lab/run-elo2.mjs <baseline-promus.json>
import fs from "node:fs";
const rows = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sig = (z) => 1 / (1 + Math.exp(-z));
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const ord = (x, [b, t1, t2]) => { const pA = sig(t1 - b * x), pAD = sig(t2 - b * x); return [1 - pAD, Math.max(pAD - pA, 1e-9), pA]; };
const xOf = (r) => (r.elo[0] - r.elo[1]) / 100;
const A = rows.filter((r) => r.S === 2024);
// Ajustement par maximum de vraisemblance (descente de coordonnées, pas décroissants)
const nll = (th) => A.reduce((s, r) => s - Math.log(ord(xOf(r), th)[r.k]), 0);
let th = [0.5, -0.6, 0.6], f = nll(th);
for (let step = 0.2; step > 1e-4; step /= 2) { let moved = true; while (moved) { moved = false; for (let i = 0; i < 3; i++) for (const d of [step, -step]) { const t = [...th]; t[i] += d; const g = nll(t); if (g < f) { f = g; th = t; moved = true; } } } }
console.log(`Paramètres Elo réglés sur A : pente ${th[0].toFixed(3)}, seuils ${th[1].toFixed(3)} ${th[2].toFixed(3)}`);
const mix = (r, a) => { const e = ord(xOf(r), th); return r.dp.map((p, i) => (1 - a) * p + a * e[i]); };
let best = 0, bb = Infinity;
for (let a = 0; a <= 1.0001; a += 0.05) { const b = A.reduce((s, r) => s + brier(mix(r, a), r.k), 0) / A.length; if (b < bb) { bb = b; best = +a.toFixed(2); } }
console.log(`α choisi sur A : ${best}`);
function ci(list, a) {
  const byD = new Map(); for (const r of list) { const d = brier(mix(r, a), r.k) - brier(r.dp, r.k); const x = byD.get(r.date) || [0, 0]; x[0] += d; x[1]++; byD.set(r.date, x); }
  const G = [...byD.values()], tot = G.reduce((s, g) => s + g[0], 0) / G.reduce((s, g) => s + g[1], 0);
  let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); const sims = [];
  for (let t = 0; t < 2000; t++) { let s = 0, n = 0; for (let i = 0; i < G.length; i++) { const g = G[(rnd() * G.length) | 0]; s += g[0]; n += g[1]; } sims.push(s / n); }
  sims.sort((x, y) => x - y); return `${tot >= 0 ? "+" : ""}${tot.toFixed(4)} [${sims[50].toFixed(4)} ; ${sims[1949].toFixed(4)}]`;
}
for (const a of [best, 0.2, 0.3]) {
  console.log(`\nMélange α = ${a} (écart de Brier avec le moteur actuel, négatif = mieux)`);
  for (const [n, S] of [["A 2024-25", 2024], ["B 2025-26", 2025], ["C 2026-27", 2026]]) { const l = rows.filter((r) => r.S === S); console.log(`  ${n} (${l.length}) : ${ci(l, a)}`); }
  const BC = rows.filter((r) => r.S >= 2025);
  console.log("  Par championnat, saisons B et C :");
  for (const lg of [...new Set(rows.map((r) => r.lg))]) { const l = BC.filter((r) => r.lg === lg); const per = [2024, 2025, 2026].map((S) => { const x = rows.filter((r) => r.lg === lg && r.S === S); return (x.reduce((s, r) => s + brier(mix(r, a), r.k) - brier(r.dp, r.k), 0) / x.length).toFixed(4); }); console.log(`    ${lg.padEnd(4)} ${ci(l, a)}   par saison ${per.join(" / ")}`); }
  const fav = (S) => { const l = rows.filter((r) => r.S === S && Math.max(...mix(r, a)) >= 0.6); return l.length ? `${(100 * l.reduce((s, r) => s + Math.max(...mix(r, a)), 0) / l.length).toFixed(1)} % annoncé / ${(100 * l.filter((r) => mix(r, a).indexOf(Math.max(...mix(r, a))) === r.k).length / l.length).toFixed(1)} % réel (${l.length})` : "-"; };
  console.log(`  Favoris ≥ 60 % : ${[2024, 2025, 2026].map(fav).join(" · ")}`);
}
