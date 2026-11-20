// Piste 14 — absents (20/11/2026) avec le moteur en ligne (promus + mélange Elo).
// Données : absents « Missing Fixture » d'API-Football par match (2023-24 et 2024-25, 5 grands championnats) et minutes
// jouées la saison précédente (importance du joueur), récupérées pour l'étude PronostiK du 08/11/2026 (branche experience-absences).
// Données non versées dans ce dépôt public. Méthode reprise de PronostiK : buts attendus × exp(−α·absents offensifs adverses…).
// Réglage sur 2023-24, jugement sur 2024-25 (et ses deux moitiés). Usage : node test/lab/run-absents.mjs <history.json> <dossier absences>
import fs from "node:fs";
import { buildModel, calculate_match_prediction, calculate_poisson_match } from "../../src/model.js";
import { MODEL } from "../../src/config.js";
const [HP, AB] = process.argv.slice(2);
const hist = JSON.parse(fs.readFileSync(HP, "utf8")).filter((m) => (m.division || "L1") === "L1");
const LGS = ["FL1", "PL", "BL1", "SA", "PD"], GAMES = { BL1: 34, FL1: 34 };
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const files = fs.readdirSync(AB);
const imp = { 2023: {}, 2024: {} };
for (const f of files.filter((f) => f.startsWith("team-"))) {
  const [, lg, s] = f.split("-"), S = +s + 1;
  for (const p of JSON.parse(fs.readFileSync(`${AB}/${f}`))) { const sh = Math.min(1, (p.min || 0) / ((GAMES[lg] || 38) * 90)), att = p.pos === "Attacker" || p.pos === "Midfielder"; if (!imp[S][p.pid] || imp[S][p.pid].sh < sh) imp[S][p.pid] = { sh, att }; }
}
const sig = (z) => 1 / (1 + Math.exp(-z)), E = MODEL.eloMix, clamp = (x) => Math.max(MODEL.lambdaMin, Math.min(MODEL.lambdaMax, x));
const rows = []; let unmatched = 0;
for (const lg of LGS) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m) => ({ homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date }));
  const fx = new Map(), apiDates = {};
  for (const S of [2023, 2024]) for (const i of JSON.parse(fs.readFileSync(`${AB}/inj-${lg}-${S}.json`))) {
    const d = i.date.slice(0, 10); (apiDates[i.teamId] ||= new Set()).add(d);
    if (i.type !== "Missing Fixture") continue;
    const k = d + "|" + i.teamId, o = fx.get(k) || { att: 0, def: 0, n: 0 }, w = imp[S][i.pid];
    if (w) o[w.att ? "att" : "def"] += w.sh; o.n++; fx.set(k, o);
  }
  const hDates = {}; L.forEach((m) => { (hDates[m.home] ||= new Set()).add(m.date); (hDates[m.away] ||= new Set()).add(m.date); });
  const map = {};
  for (const [id, ds] of Object.entries(apiDates)) { let best = null, bs = 0; for (const [n, hs] of Object.entries(hDates)) { let c = 0; ds.forEach((d) => hs.has(d) && c++); if (c > bs) { bs = c; best = n; } } if (bs >= 5) map[best] = id; }
  for (const date of [...new Set(L.filter((m) => m.date >= "2023-08-01" && m.date < "2025-07-01").map((m) => m.date))]) {
    const S = seasonOf(date), past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const prev = new Set(); for (const f of past) if (f.season === S - 1) { prev.add(f.homeId); prev.add(f.awayId); }
    const cur = new Set(); for (const m of L) if (seasonOf(m.date) === S) { cur.add(m.home); cur.add(m.away); }
    const nc = new Set([...cur].filter((t) => !prev.has(t)));
    const model = buildModel(past, { newcomers: prev.size && nc.size && nc.size <= 4 ? nc : null });
    for (const m of L.filter((x) => x.date === date)) {
      const ih = map[m.home], ia = map[m.away]; if (!ih || !ia) { unmatched++; continue; }
      const p = calculate_match_prediction({ teamDomId: m.home, teamExtId: m.away, date }, { model, leagueId: lg, season: S });
      const g = (id) => fx.get(date + "|" + id) || { att: 0, def: 0, n: 0 };
      rows.push({ lg, date, S, k: res(m), lam: [p.lambdas.lambdaDom, p.lambdas.lambdaExt], elo: [model.elo[m.home] ?? 1500, model.elo[m.away] ?? 1500], h: g(ih), a: g(ia) });
    }
  }
}
function pred(r, al, be) {
  const lD = clamp(r.lam[0] * Math.exp(-al * r.h.att + be * r.a.def)), lE = clamp(r.lam[1] * Math.exp(-al * r.a.att + be * r.h.def));
  const p = calculate_poisson_match(lD, lE), b = [p.proba1, p.probaN, p.proba2], t = b[0] + b[1] + b[2];
  const x = (r.elo[0] - r.elo[1]) / 100, pA = sig(E.cut1 - E.slope * x), pAD = sig(E.cut2 - E.slope * x), e = [1 - pAD, Math.max(pAD - pA, 1e-9), pA];
  return b.map((v, i) => (1 - E.alpha) * (v / t) + E.alpha * e[i]);
}
for (const r of rows) r.p0 = pred(r, 0, 0);
const REG = rows.filter((r) => r.S === 2023), TEST = rows.filter((r) => r.S === 2024);
let best = { al: 0, be: 0, v: Infinity };
for (let al = 0; al <= 0.8001; al += 0.05) for (let be = 0; be <= 0.8001; be += 0.05) { const v = REG.reduce((s, r) => s + brier(pred(r, al, be), r.k), 0) / REG.length; if (v < best.v) best = { al: +al.toFixed(2), be: +be.toFixed(2), v }; }
const gap = (l) => l.reduce((s, r) => s + brier(pred(r, best.al, best.be), r.k) - brier(r.p0, r.k), 0) / l.length;
const f = (x) => (x >= 0 ? "+" : "") + x.toFixed(4);
console.log(`${rows.length} matchs (non reliés : ${unmatched}). Réglage sur 2023-24 : alpha ${best.al} (absents offensifs), beta ${best.be} (absents défensifs)`);
console.log(`Écart de Brier (avec absents − moteur en ligne) : 2023-24 ${f(gap(REG))} (réglage) · 2024-25 ${f(gap(TEST))} · 2024-25 1re moitié ${f(gap(TEST.filter((r) => r.date < "2025-01-01")))} · 2e moitié ${f(gap(TEST.filter((r) => r.date >= "2025-01-01")))}`);
for (const lg of LGS) console.log(`  ${lg.padEnd(4)} 2023-24 ${f(gap(REG.filter((r) => r.lg === lg)))} · 2024-25 ${f(gap(TEST.filter((r) => r.lg === lg)))}`);
const avg = (k) => (TEST.reduce((s, r) => s + r.h[k] + r.a[k], 0) / TEST.length / 2).toFixed(3);
console.log(`Part moyenne de minutes absente par équipe : offensifs ${avg("att")}, défensifs ${avg("def")}`);
