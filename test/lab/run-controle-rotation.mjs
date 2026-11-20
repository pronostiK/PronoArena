// Contrôle anti-surapprentissage (20/11/2026, demandé par Kay). Pour chaque saison jugée H (2024-25, 2025-26, 2026-27),
// TOUS les choix sont refaits sur les deux autres saisons seulement : réglages des promus + championnats où ils s'appliquent,
// part des corners + championnats exclus, poids et paramètres de l'Elo. Puis on mesure sur H, comparé au moteur d'origine
// (sans aucune des 3 corrections). Chaque prédiction n'utilise que les matchs joués avant la date du match (contrôlé plus bas).
// Usage : node test/lab/run-controle-rotation.mjs <history.json>
import fs from "node:fs";
import { calculate_poisson_match, computeElo } from "../../src/model.js";
import { MODEL } from "../../src/config.js";
const hist = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).filter((m) => (m.division || "L1") === "L1");
const LGS = ["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED", "ELC", "FL2"], CS = [0, 0.2, 0.3, 0.4];
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const clamp = (x) => Math.max(MODEL.lambdaMin, Math.min(MODEL.lambdaMax, x)), r3 = (x) => Math.round(x * 1000) / 1000;
let leak = 0;
function sums(id, past, aH, aA) {
  const list = past.filter((f) => f.homeId === id || f.awayId === id).sort((a, b) => b.ts - a.ts).slice(0, MODEL.windowMatches);
  const v = { hf: 0, ha: 0, hw: 0, af: 0, aa: 0, aw: 0 };
  list.forEach((f, i) => { const x = i < MODEL.recentMatches ? MODEL.recentWeight : 1; if (f.homeId === id) { v.hf += x * f.hg / aH; v.ha += x * f.ag / aA; v.hw += x; } else { v.af += x * f.ag / aA; v.aa += x * f.hg / aH; v.aw += x; } });
  return v;
}
function rating(v, K, a0, d0) {
  const s = MODEL.specificWeight, attAll = (v.hf + v.af + K * a0) / (v.hw + v.aw + K), defAll = (v.ha + v.aa + K * d0) / (v.hw + v.aw + K);
  return { attHome: s * (v.hf + K * a0) / (v.hw + K) + (1 - s) * attAll, defHome: s * (v.ha + K * d0) / (v.hw + K) + (1 - s) * defAll, attAway: s * (v.af + K * a0) / (v.aw + K) + (1 - s) * attAll, defAway: s * (v.aa + K * d0) / (v.aw + K) + (1 - s) * defAll };
}
const avgs = (past) => { const n = past.length, b = Math.min(1, n / MODEL.minLeagueMatches); let sH = 0, sA = 0; for (const f of past) { sH += f.hg; sA += f.ag; } return [Math.max(0.5, b * (n ? sH / n : MODEL.defaultAvgHome) + (1 - b) * MODEL.defaultAvgHome), Math.max(0.4, b * (n ? sA / n : MODEL.defaultAvgAway) + (1 - b) * MODEL.defaultAvgAway)]; };
const rows = [];
for (const lg of LGS) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m) => ({ homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, hc: m.hc, ac: m.ac, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date }));
  for (const date of [...new Set(L.filter((m) => m.date >= "2024-08-01").map((m) => m.date))]) {
    const S = seasonOf(date), past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    if (past.some((f) => f.date >= date)) leak++;
    const prevT = new Set(); for (const f of past) if (f.season === S - 1) { prevT.add(f.homeId); prevT.add(f.awayId); }
    const curT = new Set(); for (const f of fin) if (f.season === S) { curT.add(f.homeId); curT.add(f.awayId); }
    const nc = new Set([...curT].filter((t) => !prevT.has(t))), useNc = prevT.size && nc.size && nc.size <= MODEL.promotedMaxTeams;
    const elo = computeElo(past);
    let g = 0, c = 0; for (const f of past) if (f.hc != null) { g += f.hg + f.ag; c += f.hc + f.ac; }
    const ratio = c ? g / c : 0;
    const blended = CS.map((w) => (w ? past.map((f) => (f.hc != null ? { ...f, hg: (1 - w) * f.hg + w * f.hc * ratio, ag: (1 - w) * f.ag + w * f.ac * ratio } : f)) : past));
    const av = blended.map(avgs);
    for (const m of L.filter((x) => x.date === date && [x.avgH, x.avgD, x.avgA].every((o) => o > 1))) {
      rows.push({ lg, date, S, k: res(m), newH: useNc && nc.has(m.home), newA: useNc && nc.has(m.away), x: ((elo[m.home] ?? 1500) - (elo[m.away] ?? 1500)) / 100,
        c: CS.map((w, i) => ({ av: av[i], vH: sums(m.home, blended[i], ...av[i]), vA: sums(m.away, blended[i], ...av[i]) })) });
    }
  }
}
console.log(`${rows.length} matchs ; contrôle de fuite : ${leak} journée(s) utilisant un match du jour ou futur`);
// Prédiction : ci = indice de la part de corners, P = réglage promus (ou null), proLg = championnats avec promus, E = { alpha, th } Elo
const sig = (z) => 1 / (1 + Math.exp(-z));
const ord = (x, [b, t1, t2]) => { const pA = sig(t1 - b * x), pAD = sig(t2 - b * x); return [1 - pAD, Math.max(pAD - pA, 1e-9), pA]; };
function pred(r, { ci = 0, P = null, proLg = null, E = null }) {
  const C = r.c[ci], pro = P && proLg?.has(r.lg);
  const D = pro && r.newH ? rating(C.vH, P.K, P.a0, P.d0) : rating(C.vH, 6, 1, 1), X = pro && r.newA ? rating(C.vA, P.K, P.a0, P.d0) : rating(C.vA, 6, 1, 1);
  const p = calculate_poisson_match(r3(clamp(C.av[0] * D.attHome * X.defAway)), r3(clamp(C.av[1] * X.attAway * D.defHome)));
  let b = [p.proba1, p.probaN, p.proba2]; const t = b[0] + b[1] + b[2]; b = b.map((v) => v / t);
  if (E) { const e = ord(r.x, E.th); b = b.map((v, i) => (1 - E.alpha) * v + E.alpha * e[i]); }
  return b;
}
const mean = (l, f) => l.reduce((s, r) => s + brier(f(r), r.k), 0) / l.length;
const SEAS = [2024, 2025, 2026], fmt = (x) => (x >= 0 ? "+" : "") + x.toFixed(4);
const GRID = []; for (const K of [6, 10, 15, 20]) for (const a0 of [1, 0.9, 0.8, 0.75, 0.7, 0.6]) for (const d0 of [1, 1.1, 1.2, 1.3, 1.4, 1.5]) GRID.push({ K, a0, d0 });
const total = { promus: 0, corners: 0, elo: 0, tout: 0, n: 0 };
for (const H of SEAS) {
  const T = rows.filter((r) => r.S !== H), V = rows.filter((r) => r.S === H);
  // 1) Promus : réglage sur T (tous championnats), puis championnats gardés = ceux où le gain sur T est négatif
  const allLg = new Set(LGS);
  let P = GRID.reduce((b, g) => (mean(T, (r) => pred(r, { P: g, proLg: allLg })) < mean(T, (r) => pred(r, { P: b, proLg: allLg })) ? g : b), GRID[0]);
  let proLg = new Set(LGS.filter((lg) => { const l = T.filter((r) => r.lg === lg); return mean(l, (r) => pred(r, { P, proLg: allLg })) < mean(l, (r) => pred(r, {})); }));
  P = GRID.reduce((b, g) => (mean(T, (r) => pred(r, { P: g, proLg })) < mean(T, (r) => pred(r, { P: b, proLg })) ? g : b), P); // réglage refait sur les championnats gardés
  // 2) Corners : part choisie sur T (avec promus), puis championnats exclus = gain positif sur T
  const ciAll = [1, 2, 3].reduce((b, i) => (mean(T, (r) => pred(r, { ci: i, P, proLg })) < mean(T, (r) => pred(r, { ci: b, P, proLg })) ? i : b), 1);
  const cLg = new Set(LGS.filter((lg) => { const l = T.filter((r) => r.lg === lg); return mean(l, (r) => pred(r, { ci: ciAll, P, proLg })) < mean(l, (r) => pred(r, { P, proLg })); }));
  const predC = (r, o = {}) => pred(r, { ci: cLg.has(r.lg) ? ciAll : 0, P, proLg, ...o });
  // 3) Elo : paramètres de la régression ordonnée ajustés sur T, puis alpha choisi sur T
  const nll = (th) => T.reduce((s, r) => s - Math.log(ord(r.x, th)[r.k]), 0);
  let th = [0.5, -0.6, 0.6], f = nll(th);
  for (let st = 0.2; st > 1e-3; st /= 2) { let mv = true; while (mv) { mv = false; for (let i = 0; i < 3; i++) for (const d of [st, -st]) { const t2 = [...th]; t2[i] += d; const g = nll(t2); if (g < f) { f = g; th = t2; mv = true; } } } }
  const alpha = [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4].reduce((b, a) => (mean(T, (r) => predC(r, { E: { alpha: a, th } })) < mean(T, (r) => predC(r, { E: { alpha: b, th } })) ? a : b), 0);
  const E = { alpha, th };
  // Mesure sur H (jamais utilisée pour les choix ci-dessus)
  const base = mean(V, (r) => pred(r, {}));
  const g1 = mean(V, (r) => pred(r, { P, proLg })) - base, g2 = mean(V, (r) => predC(r)) - mean(V, (r) => pred(r, { P, proLg })), g3 = mean(V, (r) => predC(r, { E })) - mean(V, (r) => predC(r)), gt = mean(V, (r) => predC(r, { E })) - base;
  const ga = mean(V, (r) => pred(r, { E: { alpha, th } })) - base; // Elo seul
  console.log(`\nSaison jugée ${H}-${String(H + 1).slice(2)} (${V.length} matchs), choix faits sur les 2 autres :`);
  console.log(`  promus K=${P.K} att ${P.a0} déf ${P.d0}, championnats : ${[...proLg].join(" ")}`);
  console.log(`  corners ${CS[ciAll] * 100} %, championnats : ${[...cLg].join(" ")}`);
  console.log(`  Elo : poids ${alpha}, pente ${th[0].toFixed(3)}`);
  console.log(`  Gains sur ${H}-${String(H + 1).slice(2)} : promus ${fmt(g1)} · + corners ${fmt(g2)} · + Elo ${fmt(g3)} · TOTAL ${fmt(gt)} (Elo seul sur moteur d'origine ${fmt(ga)})`);
  // IC 95 % du total, regroupé par date
  const byD = new Map(); for (const r of V) { const x = byD.get(r.date) || [0, 0]; x[0] += brier(predC(r, { E }), r.k) - brier(pred(r, {}), r.k); x[1]++; byD.set(r.date, x); }
  const G = [...byD.values()]; let seed = 9; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); const sims = [];
  for (let t = 0; t < 2000; t++) { let s = 0, n = 0; for (let i = 0; i < G.length; i++) { const q = G[(rnd() * G.length) | 0]; s += q[0]; n += q[1]; } sims.push(s / n); }
  sims.sort((a, b) => a - b); console.log(`  TOTAL IC 95 % [${fmt(sims[50])} ; ${fmt(sims[1949])}]`);
  for (const lg of LGS) { const l = V.filter((r) => r.lg === lg); process.stdout.write(`${lg} ${fmt(mean(l, (r) => predC(r, { E })) - mean(l, (r) => pred(r, {})))}  `); } console.log();
  total.promus += g1 * V.length; total.corners += g2 * V.length; total.elo += g3 * V.length; total.tout += gt * V.length; total.n += V.length;
}
console.log(`\nMoyenne sur les 3 saisons jugées : promus ${fmt(total.promus / total.n)} · corners ${fmt(total.corners / total.n)} · Elo ${fmt(total.elo / total.n)} · TOTAL ${fmt(total.tout / total.n)}`);
