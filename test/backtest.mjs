// ============================================================
// DUEL PRONO — Test honnête du modèle sur des matchs passés réels
// Pour chaque match, le modèle ne voit QUE les matchs joués avant lui (aucune triche),
// puis on compare sa prévision au vrai résultat, à côté :
//   - des cotes moyennes des bookmakers (marge retirée) : la référence à battre ;
//   - du modèle de PronostiK, sur les mêmes matchs ;
//   - d'une prévision « naïve » (les fréquences domicile / nul / extérieur du championnat).
// Données : historique réel de PronostiK (football-data.co.uk, cotes moyennes comprises).
// Usage : node test/backtest.mjs <chemin de history.json> [chemin de model.mjs de PronostiK] [fichier de sortie]
// ============================================================
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { buildModel, calculate_match_prediction } from "../src/model.js";

const [HIST = "../pronostik/pronostik/data/history.json", PK_MODEL = "../pronostik/pronostik/model.mjs", OUT = "site/public/backtest.json"] = process.argv.slice(2);
const hist = JSON.parse(fs.readFileSync(HIST, "utf8")).filter((m) => (m.division || "L1") === "L1");
let createRatings = null;
try { ({ createRatings } = await import(pathToFileURL(fs.realpathSync(PK_MODEL)).href)); } catch { console.log("(modèle PronostiK introuvable : comparaison sans lui)"); }

const NAMES = { FL1: "Ligue 1", PL: "Premier League", PD: "LaLiga", SA: "Serie A", BL1: "Bundesliga", PPL: "Liga Portugal", DED: "Eredivisie", ELC: "Championship", FL2: "Ligue 2" };
const TEST_FROM = "2024-08-01"; // 2023-24 sert seulement d'historique de départ
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const logl = (p, k) => -Math.log(Math.max(1e-6, p[k]));
const top = (p) => p.indexOf(Math.max(...p));

const rows = [];
for (const lg of Object.keys(NAMES)) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  if (!L.length) continue;
  const fin = L.map((m, i) => ({ id: `${lg}${i}`, homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date }));
  const PK = createRatings ? createRatings(L) : null;
  const byDate = new Map();
  for (let i = 0; i < L.length; i++) if (L[i].date >= TEST_FROM) (byDate.get(L[i].date) || byDate.set(L[i].date, []).get(L[i].date)).push(i);
  for (const [date, idx] of byDate) {
    const S = seasonOf(date);
    // Comme sur le site : saison en cours + saison précédente, uniquement des matchs déjà joués
    const past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const model = buildModel(past);
    // Prévision naïve : fréquences 1/N/2 du championnat sur les matchs passés
    const base = [0, 0, 0]; for (const f of past) base[res(f)]++; const naive = base.map((x) => x / past.length);
    // Références naïves des marchés de buts : fréquences des matchs PASSÉS seulement (jamais celles des matchs évalués)
    const nO25 = past.filter((f) => f.hg + f.ag > 2.5).length / past.length, nBTTS = past.filter((f) => f.hg > 0 && f.ag > 0).length / past.length;
    for (const i of idx) {
      const m = L[i];
      const p = calculate_match_prediction({ matchId: i, teamDomId: m.home, teamExtId: m.away, date }, { model, leagueId: lg, season: S }).poisson;
      const dp = [p.proba1, p.probaN, p.proba2];
      const o = [m.avgH, m.avgD, m.avgA];
      const bk = o.every((x) => x > 1) ? o.map((x) => 1 / x) : null;
      const pk = PK ? PK.predict(m.home, m.away, m.date) : null;
      const known = (model.ratings[m.home]?.played || 0) >= 4 && (model.ratings[m.away]?.played || 0) >= 4;
      rows.push({ lg, date, S, k: res(m), goals: m.hg + m.ag, btts: m.hg > 0 && m.ag > 0, dp, o25: p.probaOver25, pbtts: p.probaBTTS, nO25, nBTTS, naive,
        bk: bk ? bk.map((x) => x / bk.reduce((a, b) => a + b, 0)) : null, pk: pk ? pk.p : null, known });
    }
  }
}

// ---------- Résultats ----------
const r4 = (x) => Math.round(x * 10000) / 10000;
function score(list, key) {
  const n = list.length;
  return { n, brier: r4(list.reduce((s, r) => s + brier(r[key], r.k), 0) / n), logloss: r4(list.reduce((s, r) => s + logl(r[key], r.k), 0) / n), reussite: r4(list.filter((r) => top(r[key]) === r.k).length / n) };
}
// Intervalle de confiance à 95 % de l'écart de Brier (modèle − bookmakers), par rééchantillonnage
function gapCI(list, a, b) {
  const d = list.map((r) => brier(r[a], r.k) - brier(r[b], r.k)), n = d.length, mean = d.reduce((s, x) => s + x, 0) / n;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sims = []; for (let t = 0; t < 1000; t++) { let s = 0; for (let i = 0; i < n; i++) s += d[(rnd() * n) | 0]; sims.push(s / n); }
  sims.sort((x, y) => x - y);
  return { ecart: r4(mean), bas: r4(sims[25]), haut: r4(sims[974]) };
}
const fair = rows.filter((r) => r.bk && r.pk); // mêmes matchs pour tout le monde
const out = {
  genere: new Date().toISOString().slice(0, 10), periode: { du: fair.reduce((a, r) => (r.date < a ? r.date : a), "9999"), au: fair.reduce((a, r) => (r.date > a ? r.date : a), "0000") },
  matchs: fair.length,
  total: { duelProno: score(fair, "dp"), bookmakers: score(fair, "bk"), pronostik: score(fair, "pk"), naif: score(fair, "naive"), ecartBookmakers: gapCI(fair, "dp", "bk"), ecartPronostik: gapCI(fair, "dp", "pk") },
  championnats: Object.keys(NAMES).map((lg) => { const l = fair.filter((r) => r.lg === lg); return l.length ? { code: lg, nom: NAMES[lg], duelProno: score(l, "dp"), bookmakers: score(l, "bk"), pronostik: score(l, "pk"), naif: score(l, "naive") } : null; }).filter(Boolean),
  saisons: [...new Set(fair.map((r) => r.S))].sort().map((S) => { const l = fair.filter((r) => r.S === S); return { saison: `${S}-${String(S + 1).slice(2)}`, duelProno: score(l, "dp"), bookmakers: score(l, "bk"), pronostik: score(l, "pk") }; }),
  // Calibration : quand le modèle annonce environ X %, l'issue arrive-t-elle environ X % du temps ?
  calibration: Array.from({ length: 10 }, (_, b) => {
    let n = 0, hit = 0, sum = 0;
    for (const r of fair) for (let k = 0; k < 3; k++) { const p = r.dp[k]; if (Math.min(9, Math.floor(p * 10)) === b) { n++; sum += p; if (r.k === k) hit++; } }
    return n ? { tranche: `${b * 10}-${b * 10 + 10} %`, annonce: r4(sum / n), observe: r4(hit / n), n } : null;
  }).filter(Boolean),
  equipesConnues: { duelProno: score(fair.filter((r) => r.known), "dp"), bookmakers: score(fair.filter((r) => r.known), "bk") },
  buts: (() => { const l = rows; const b = (f, y) => r4(l.reduce((s, r) => s + (f(r) - (y(r) ? 1 : 0)) ** 2, 0) / l.length);
    // Référence naïve : fréquence observée sur les matchs passés à la date de chaque match (pas sur les matchs évalués)
    return { n: l.length, plus25: { duelProno: b((r) => r.o25, (r) => r.goals > 2.5), naif: b((r) => r.nO25, (r) => r.goals > 2.5) }, deuxMarquent: { duelProno: b((r) => r.pbtts, (r) => r.btts), naif: b((r) => r.nBTTS, (r) => r.btts) } }; })(),
  // Calibration séparée par issue (domicile / nul / extérieur) et par période : B = 01/07/2025-28/02/2026, C = depuis le 01/03/2026
  calibrationParIssue: (() => {
    const PER = { B: (d) => d >= "2025-07-01" && d < "2026-03-01", C: (d) => d >= "2026-03-01" };
    const out = {};
    for (const [pn, inP] of Object.entries(PER)) {
      out[pn] = {};
      const sub = fair.filter((r) => inP(r.date));
      for (const [k, nom] of [[0, "domicile"], [1, "nul"], [2, "exterieur"]]) {
        const bins = new Map();
        for (const r of sub) { const b = Math.min(19, Math.floor(r.dp[k] / 0.05)); const x = bins.get(b) || { n: 0, sp: 0, hit: 0 }; x.n++; x.sp += r.dp[k]; if (r.k === k) x.hit++; bins.set(b, x); }
        out[pn][nom] = { n: sub.length, annonceMoyen: r4(sub.reduce((a, r) => a + r.dp[k], 0) / sub.length), observe: r4(sub.filter((r) => r.k === k).length / sub.length),
          tranches: [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([b, x]) => ({ tranche: `${5 * b}-${5 * b + 5} %`, n: x.n, annonce: r4(x.sp / x.n), observe: r4(x.hit / x.n), ecart: r4(x.hit / x.n - x.sp / x.n) })) };
      }
    }
    return out;
  })(),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

const T = out.total, f3 = (x) => x.toFixed(3);
console.log(`\nTest sur ${out.matchs} matchs réels (${out.periode.du} → ${out.periode.au}), mêmes matchs pour tous :\n`);
console.log("                 Brier   log-loss  réussite");
for (const [n, k] of [["Duel Prono", "duelProno"], ["PronostiK", "pronostik"], ["Bookmakers", "bookmakers"], ["Naïf", "naif"]]) console.log(`  ${n.padEnd(13)}  ${f3(T[k].brier)}   ${f3(T[k].logloss)}    ${Math.round(100 * T[k].reussite)} %`);
console.log(`\n  Écart Duel Prono − bookmakers : ${T.ecartBookmakers.ecart > 0 ? "+" : ""}${f3(T.ecartBookmakers.ecart)}  [${f3(T.ecartBookmakers.bas)} ; ${f3(T.ecartBookmakers.haut)}]`);
console.log(`  Écart Duel Prono − PronostiK  : ${T.ecartPronostik.ecart > 0 ? "+" : ""}${f3(T.ecartPronostik.ecart)}  [${f3(T.ecartPronostik.bas)} ; ${f3(T.ecartPronostik.haut)}]`);
console.log("\n  Par championnat (Brier : Duel Prono / PronostiK / bookmakers / naïf) :");
for (const c of out.championnats) console.log(`    ${c.nom.padEnd(15)} ${String(c.duelProno.n).padStart(5)} matchs   ${f3(c.duelProno.brier)} / ${f3(c.pronostik.brier)} / ${f3(c.bookmakers.brier)} / ${f3(c.naif.brier)}`);
console.log("\n  Par saison :"); for (const s of out.saisons) console.log(`    ${s.saison}  ${String(s.duelProno.n).padStart(5)} matchs   ${f3(s.duelProno.brier)} / ${f3(s.pronostik.brier)} / ${f3(s.bookmakers.brier)}`);
console.log("\n  Calibration (annoncé → observé) :"); for (const c of out.calibration) console.log(`    ${c.tranche.padEnd(10)} ${String(Math.round(100 * c.annonce)).padStart(3)} % → ${String(Math.round(100 * c.observe)).padStart(3)} %   (${c.n})`);
for (const pn of ["B", "C"]) for (const nom of ["domicile", "nul", "exterieur"]) {
  const c = out.calibrationParIssue[pn][nom];
  console.log(`\n  Calibration « ${nom} », période ${pn} (${c.n} matchs ; annoncé moyen ${f3(c.annonceMoyen)} · observé ${f3(c.observe)}) :`);
  console.log("    tranche      nombre   annoncé   observé   écart");
  for (const t of c.tranches) console.log(`    ${t.tranche.padEnd(11)} ${String(t.n).padStart(6)}   ${f3(t.annonce)}     ${f3(t.observe)}    ${(t.ecart >= 0 ? "+" : "") + f3(t.ecart)}${t.n < 30 ? "  (peu fiable)" : ""}`);
}
console.log(`\n  Buts (Brier, Duel Prono / naïf) : +2,5 ${f3(out.buts.plus25.duelProno)} / ${f3(out.buts.plus25.naif)} · les deux marquent ${f3(out.buts.deuxMarquent.duelProno)} / ${f3(out.buts.deuxMarquent.naif)}`);
