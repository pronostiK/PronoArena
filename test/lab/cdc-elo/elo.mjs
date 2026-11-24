import { run, summary, mean, DOM, CL } from "./harness.mjs";
import { MODEL } from "./src/config.js";
// Elo commun : tous les matchs (championnats + Ligue des champions) dans l'ordre du temps, un seul classement pour tous les clubs.
const P = { K: 20, Kcl: 32, home: 60, carry: 0.8, start: 1500 };
export function eloSnapshots(P) {
  const ev = [...DOM.map((m) => ({ ...m, t: "d" })), ...CL.map((m) => ({ ts: m.ts, homeId: m.hId, awayId: m.aId, hg: m.hg, ag: m.ag, season: m.season, t: "c", ref: m }))].sort((a, b) => a.ts - b.ts || (a.t === "c") - (b.t === "c"));
  const elo = {}, last = {}, lgOf = {}, snap = new Map();
  const mean_ = (lg) => { const v = Object.entries(lgOf).filter(([, l]) => l === lg).map(([id]) => elo[id]).filter((x) => x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : P.start; };
  for (const f of ev) {
    for (const id of [f.homeId, f.awayId]) {
      if (elo[id] === undefined) elo[id] = P.start;
      else if (last[id] !== undefined && f.season !== last[id]) { const c = lgOf[id] ? mean_(lgOf[id]) : P.start; elo[id] = c + (elo[id] - c) * P.carry; }
      last[id] = f.season;
      if (f.t === "d") lgOf[id] = f.lg;
    }
    if (f.t === "c") snap.set(f.ref, [elo[f.homeId], elo[f.awayId]]);
    const rh = elo[f.homeId], ra = elo[f.awayId], K = f.t === "c" ? P.Kcl : P.K;
    const exp = 1 / (1 + Math.pow(10, (ra - (rh + P.home)) / 400));
    const res = f.hg > f.ag ? 1 : f.hg === f.ag ? 0.5 : 0;
    const d = K * (1 + Math.log(1 + Math.abs(f.hg - f.ag))) * (res - exp);
    elo[f.homeId] = rh + d; elo[f.awayId] = ra - d;
  }
  return { snap, elo, lgOf };
}
const sig = (x) => 1 / (1 + Math.exp(-x));
const probs = (dElo, th) => { const x = dElo / 100; const pA = sig(th.c1 - th.s * x), pAD = sig(th.c2 - th.s * x); return [1 - pAD, Math.max(pAD - pA, 1e-9), pA]; };
export function fitTheta(rows) { // moindres carrés (Brier) sur une grille
  let best = null; for (const s of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) for (const c1 of [-1.4, -1.2, -1.0, -0.8, -0.6]) for (const c2 of [-0.1, 0.1, 0.3, 0.5, 0.7, 0.9]) { const th = { s, c1, c2 }; const b = mean(rows, (r) => { const p = probs(r.d, th); return p.reduce((a, v, i) => a + (v - (i === r.k ? 1 : 0)) ** 2, 0); }); if (!best || b < best.b) best = { ...th, b }; }
  return best;
}
if (process.argv[1].endsWith("elo.mjs")) {
  const { snap } = eloSnapshots(P);
  const base = run({ domSeasons: 1, coef: (lg) => ({ eng: 1, esp: .96, ita: .94, ger: .94, fra: .88, por: .84, ned: .82, bel: .78, tur: .76, sco: .72, nor: .7, aut: .72, gre: .7 }[lg] ** 1.5) });
  // associe chaque ligne à son match
  const byKey = new Map(CL.map((m) => [m.ts + m.h + m.a, m]));
  const rows = base.map((r) => { const m = byKey.get(r.ts + r.h + r.a); const [eh, ea] = snap.get(m); return { ...r, d: eh - ea + P.home }; });
  const fitRows = rows.filter((r) => r.season === 2024);
  const th = fitTheta(fitRows); console.log("loi Elo→probabilités réglée sur 2024-25:", th);
  const sc = (f, ss) => { const r = rows.filter((x) => ss.includes(x.season)); return mean(r, (x) => { const p = f(x); return p.reduce((a, v, i) => a + (v - (i === x.k ? 1 : 0)) ** 2, 0); }).toFixed(4); };
  for (const a of [0, 0.25, 0.4, 0.5, 0.75, 1]) console.log("part Elo", a, "| 25-26:", sc((x) => { const e = probs(x.d, th); return x.pr.map((v, i) => (1 - a) * v + a * e[i]); }, [2025]), "| 26-27:", sc((x) => { const e = probs(x.d, th); return x.pr.map((v, i) => (1 - a) * v + a * e[i]); }, [2026]), "| 24-25 (réglage):", sc((x) => { const e = probs(x.d, th); return x.pr.map((v, i) => (1 - a) * v + a * e[i]); }, [2024]));
}
