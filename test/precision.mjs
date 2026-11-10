// Précision du moteur sur des saisons simulées dont on connaît la vérité (V7 vs ancienne V5)
import { buildModel, calculate_match_prediction } from "../src/model.js";
const strength = { A: 2.2, B: 1.8, C: 1.5, D: 1.3, E: 1.2, F: 1.1, G: 1.0, H: 0.9, I: 0.75, J: 0.6 };
const ids = Object.keys(strength);
const tl = (h, a) => [1.45 * strength[h] / strength[a] ** 0.8, 1.15 * strength[a] / strength[h] ** 0.8];
function run(seasons, seed) {
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pois = (l) => { let k = 0, p = Math.exp(-l), s = p, u = rnd(); while (u > s) { k++; p *= l / k; s += p; } return k; };
  const f = []; let d = 0;
  for (let s = 0; s < seasons; s++) for (const h of ids) for (const a of ids) if (h !== a) { const [lh, la] = tl(h, a); f.push({ homeId: h, awayId: a, hg: pois(lh), ag: pois(la), ts: Date.now() - (5 + (d++ % 150)) * 86400000, season: s }); }
  const model = buildModel(f); let e = 0, e5 = 0, n = 0;
  for (const h of ids) for (const a of ids) if (h !== a) {
    const P = calculate_match_prediction({ teamDomId: h, teamExtId: a }, { model, leagueId: 61, season: 2026 }); const [lh, la] = tl(h, a);
    e += Math.abs(P.lambdas.lambdaDom - lh) / lh + Math.abs(P.lambdas.lambdaExt - la) / la;
    e5 += Math.abs(1.35 - lh) / lh + Math.abs(1.15 - la) / la; n += 2;
  }
  return [e / n, e5 / n];
}
for (const s of [1, 3, 10]) {
  let a = 0, b = 0; for (let k = 1; k <= 20; k++) { const [x, y] = run(s, k * 7919); a += x; b += y; }
  console.log(`${s} saison(s) simulée(s) : écart V7 = ${(5 * a).toFixed(1)} %  |  écart ancienne V5 = ${(5 * b).toFixed(1)} %`);
}
