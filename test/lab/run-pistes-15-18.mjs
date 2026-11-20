// Pistes 15 à 18 (20/11/2026). Base = moteur en ligne (promus + mélange Elo 25 %).
// 15 : mélange avec le modèle PronostiK · 16 : moins compter les matchs avec carton rouge · 17 : corners mêlés aux buts
// dans les forces · 18 : part domicile/extérieur (specificWeight, actuel 0,3). Réglage sur 2024-25, jugement saison par saison.
// Nécessite dans computeTeamRatings le poids par match « * (f.weight ?? 1) » (version de laboratoire, non publiée).
// Usage : node test/lab/run-pistes-15-18.mjs <history.json> <model.mjs PronostiK>
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { computeTeamRatings, computeElo, calculate_match_prediction } from "../../src/model.js";
import { LEAGUES, MODEL } from "../../src/config.js";
const [H, PKM] = process.argv.slice(2);
const all = JSON.parse(fs.readFileSync(H, "utf8")).filter((m) => (m.division || "L1") === "L1");
const { createRatings } = await import(pathToFileURL(fs.realpathSync(PKM)).href);
const PROMUS = new Set(Object.values(LEAGUES).filter((l) => l.promus).map((l) => l.src.replace("fd:", "")));
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
// Variantes (fixées avant le calcul) : rc = poids d'un match avec carton rouge ; c = part des corners ; sw = part domicile/extérieur
const VAR = { base: {}, rc25: { rc: 0.25 }, rc50: { rc: 0.5 }, rc75: { rc: 0.75 }, c10: { c: 0.1 }, c20: { c: 0.2 }, c30: { c: 0.3 }, sw0: { sw: 0 }, sw15: { sw: 0.15 }, sw45: { sw: 0.45 }, sw60: { sw: 0.6 } };
const rows = [];
for (const lg of ["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED", "ELC", "FL2"]) {
  const L = all.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const PK = createRatings(L);
  const fin = L.map((m) => ({ homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date, red: (m.hr || 0) + (m.ar || 0) > 0, hc: m.hc, ac: m.ac }));
  for (const date of [...new Set(L.filter((m) => m.date >= "2024-08-01").map((m) => m.date))]) {
    const S = seasonOf(date), past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const prevT = new Set(); for (const f of past) if (f.season === S - 1) { prevT.add(f.homeId); prevT.add(f.awayId); }
    const curT = new Set(); for (const f of fin) if (f.season === S) { curT.add(f.homeId); curT.add(f.awayId); }
    const nc = new Set([...curT].filter((t) => !prevT.has(t)));
    const opts = { newcomers: PROMUS.has(lg) && prevT.size && nc.size && nc.size <= MODEL.promotedMaxTeams ? nc : null };
    const elo = computeElo(past, opts);
    const goals = past.reduce((s, f) => s + f.hg + f.ag, 0), corners = past.reduce((s, f) => s + (f.hc ?? 0) + (f.ac ?? 0), 0), ratio = corners ? goals / corners : 0;
    const games = L.filter((x) => x.date === date && [x.avgH, x.avgD, x.avgA].every((o) => o > 1));
    const out = games.map((m) => { const pk = PK.predict(m.home, m.away, m.date); return { lg, date, S, k: res(m), pk: pk ? pk.p : null, p: {} }; });
    for (const [name, v] of Object.entries(VAR)) {
      const pf = past.map((f) => ({ ...f, weight: v.rc && f.red ? v.rc : 1,
        ...(v.c && f.hc != null ? { hg: (1 - v.c) * f.hg + v.c * f.hc * ratio, ag: (1 - v.c) * f.ag + v.c * f.ac * ratio } : {}) }));
      MODEL.specificWeight = v.sw ?? 0.3;
      const model = { ...computeTeamRatings(pf, opts), elo };
      games.forEach((m, i) => { const p = calculate_match_prediction({ teamDomId: m.home, teamExtId: m.away, date }, { model, leagueId: lg, season: S, eloMix: true }).poisson; out[i].p[name] = [p.proba1, p.probaN, p.proba2]; });
      MODEL.specificWeight = 0.3;
    }
    rows.push(...out);
  }
}
const SEAS = [2024, 2025, 2026], LGS = [...new Set(rows.map((r) => r.lg))];
const gapF = (l, f) => l.reduce((s, r) => s + brier(f(r), r.k) - brier(r.p.base, r.k), 0) / l.length;
const fmt = (x) => (x >= 0 ? "+" : "") + x.toFixed(4);
const line = (f, filt = () => true) => SEAS.map((S) => fmt(gapF(rows.filter((r) => r.S === S && filt(r)), f))).join(" / ");
const A = rows.filter((r) => r.S === 2024);
const show = (title, f) => { console.log(`${title} : ${line(f)}`); console.log("    " + LGS.map((lg) => `${lg} ${line(f, (r) => r.lg === lg)}`).join("\n    ")); };
console.log(`${rows.length} matchs. Écarts de Brier 2024-25 / 2025-26 / 2026-27 (négatif = mieux que le moteur en ligne)\n`);
// 15 : PronostiK
const withPk = (r, w) => (r.pk ? r.p.base.map((v, i) => (1 - w) * v + w * r.pk[i]) : r.p.base);
const W = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
const wBest = W.reduce((b, w) => (gapF(A, (r) => withPk(r, w)) < gapF(A, (r) => withPk(r, b)) ? w : b), 0);
console.log(`Piste 15 — PronostiK (matchs sans prévision PronostiK : ${rows.filter((r) => !r.pk).length}) ; poids choisi sur 2024-25 : ${wBest}`);
for (const w of W.slice(1)) console.log(`  poids ${w} : ${line((r) => withPk(r, w))}`);
show(`  détail poids ${wBest}`, (r) => withPk(r, wBest));
for (const [title, keys] of [["Piste 16 — cartons rouges (poids du match)", ["rc25", "rc50", "rc75"]], ["Piste 17 — corners mêlés aux buts", ["c10", "c20", "c30"]], ["Piste 18 — part domicile/extérieur (actuel 0,3)", ["sw0", "sw15", "sw45", "sw60"]]]) {
  const best = keys.reduce((b, k) => (gapF(A, (r) => r.p[k]) < gapF(A, (r) => r.p[b]) ? k : b), keys[0]);
  console.log(`\n${title} ; choisi sur 2024-25 : ${best}`);
  for (const k of keys) console.log(`  ${k} : ${line((r) => r.p[k])}`);
  show(`  détail ${best}`, (r) => r.p[best]);
}
