// ============================================================
// DUEL PRONO — Test de pondération des matchs récents (19/11/2026). Aucun fichier de production modifié.
// Quatre configurations, BUTS RÉELS SEULEMENT (aucun xG utilisé) :
//   M0 = moteur actuel, inchangé (valeurs lues dans src/config.js) ; M1 = 5 derniers ×2 ; M2 = 10 derniers ×2 ; M3 = 15 derniers ×1,5.
// Tout le reste est celui du moteur : fenêtre de 80 matchs, lissage, forces domicile/extérieur, Poisson + Dixon-Coles (src/model.js appelé tel quel).
// Seuls MODEL.recentMatches et MODEL.recentWeight sont changés EN MÉMOIRE, le temps du calcul, puis rétablis.
// Règles (les mêmes que la Piste 6, fixées avant le calcul) :
//  - matchs de barrage retirés (équipes ayant < 10 matchs dans la saison du championnat) ;
//  - pour chaque date, le modèle ne voit que les matchs de dates STRICTEMENT antérieures (aucun match du jour), saison en cours + précédente, au moins 20 matchs ;
//  - test à partir du 01/08/2024 ; périodes A ≤ 30/06/2025, B 01/07/2025 → 28/02/2026, C ≥ 01/03/2026 ;
//  - mêmes matchs pour les quatre modèles ; Brier 1-N-2 (somme des carrés sur les 3 issues) et log loss 1-N-2 ;
//  - IC 95 % des écarts (modèle − M0) par rééchantillonnage regroupé par date (3 000 tirages, graine 11).
// Usage : node test/lab/TEST-PONDERATION.mjs <xg_bzzoiro.csv> [PREDICTIONS-PONDERATION.csv]
//   (le CSV n'est lu que pour la date, les équipes et les BUTS ; les colonnes xG ne sont jamais lues.)
// ============================================================
import fs from "node:fs";
import { MODEL } from "../../src/config.js";
import { computeTeamRatings, calculate_match_prediction } from "../../src/model.js";

const CSV = process.argv[2], OUT = process.argv[3] || "PREDICTIONS-PONDERATION.csv";
const lines = fs.readFileSync(CSV, "utf8").trim().split(/\r?\n/);
const head = lines[0].split(",");
const all = lines.slice(1).map((l) => { const c = l.split(","); return Object.fromEntries(head.map((h, i) => [h, c[i]])); });
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const cnt = new Map();
for (const r of all) for (const t of [r.domicile, r.exterieur]) { const k = `${r.championnat}|${seasonOf(r.date)}|${t}`; cnt.set(k, (cnt.get(k) || 0) + 1); }
const regular = all.filter((r) => ["domicile", "exterieur"].every((s) => cnt.get(`${r.championnat}|${seasonOf(r.date)}|${r[s]}`) >= 10));
console.log(`matchs ${all.length} → championnat seulement ${regular.length} (barrages retirés : ${all.length - regular.length})`);

const ORIG = { recentMatches: MODEL.recentMatches, recentWeight: MODEL.recentWeight };
const CONFIGS = [
  { name: "M0", label: "moteur actuel", n: ORIG.recentMatches, w: ORIG.recentWeight },
  { name: "M1", label: "5 derniers ×2", n: 5, w: 2 },
  { name: "M2", label: "10 derniers ×2", n: 10, w: 2 },
  { name: "M3", label: "15 derniers ×1,5", n: 15, w: 1.5 },
];
console.log(`Moteur actuel lu dans src/config.js : ${ORIG.recentMatches} derniers matchs ×${ORIG.recentWeight}, fenêtre ${MODEL.windowMatches} matchs, lissage ${MODEL.priorMatches}, poids spécifique ${MODEL.specificWeight}, rho ${MODEL.rho}`);

const res = (hg, ag) => (hg > ag ? 0 : hg === ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const logloss = (p, k) => -Math.log(Math.max(1e-12, p[k]));
const rows = [];
for (const lg of [...new Set(regular.map((r) => r.championnat))]) {
  const L = regular.filter((r) => r.championnat === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((r, i) => ({ id: i, homeId: r.domicile, awayId: r.exterieur, hg: +r.buts_domicile, ag: +r.buts_exterieur, ts: Date.parse(r.date + "T12:00:00Z"), date: r.date, season: seasonOf(r.date) }));
  const dates = [...new Set(fin.filter((f) => f.date >= "2024-08-01").map((f) => f.date))];
  for (const date of dates) {
    const S = seasonOf(date);
    const past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const models = CONFIGS.map((c) => {
      MODEL.recentMatches = c.n; MODEL.recentWeight = c.w;
      try { return { ...computeTeamRatings(past.map((f) => ({ ...f }))), elo: {} }; } finally { MODEL.recentMatches = ORIG.recentMatches; MODEL.recentWeight = ORIG.recentWeight; }
    });
    for (const f of fin.filter((x) => x.date === date)) {
      const m = { matchId: f.id, teamDomId: f.homeId, teamExtId: f.awayId, date };
      const p = models.map((mod) => { const q = calculate_match_prediction(m, { model: mod, leagueId: lg, season: S }).poisson; return [q.proba1, q.probaN, q.proba2]; });
      rows.push({ lg, date, home: f.homeId, away: f.awayId, k: res(f.hg, f.ag), p });
    }
  }
}
if (MODEL.recentMatches !== ORIG.recentMatches || MODEL.recentWeight !== ORIG.recentWeight) throw new Error("Réglages du moteur non rétablis");

const per = (r) => (r.date <= "2025-06-30" ? "A" : r.date <= "2026-02-28" ? "B" : "C");
const r5 = (x) => Math.round(x * 100000) / 100000;
const mean = (list, f) => list.reduce((s, r) => s + f(r), 0) / list.length;
function ci(list, mi, metric) {
  const f = (r) => metric(r.p[mi], r.k) - metric(r.p[0], r.k);
  const byD = new Map(); for (const r of list) { const e = byD.get(r.date) || [0, 0]; e[0] += f(r); e[1]++; byD.set(r.date, e); }
  const D = [...byD.values()], n = list.length, m = D.reduce((s, e) => s + e[0], 0) / n;
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sims = []; for (let t = 0; t < 3000; t++) { let s = 0, c = 0; for (let i = 0; i < D.length; i++) { const e = D[(rnd() * D.length) | 0]; s += e[0]; c += e[1]; } sims.push(s / c); }
  sims.sort((a, b) => a - b); return [r5(m), r5(sims[75]), r5(sims[2924])];
}
const tables = [];
function table(title, list) {
  const out = [`### ${title} — ${list.length} matchs`, "", "| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |", "|---|---|---|---|---|"];
  CONFIGS.forEach((c, i) => {
    const b = mean(list, (r) => brier(r.p[i], r.k)), l = mean(list, (r) => logloss(r.p[i], r.k));
    if (i === 0) out.push(`| M0 ${c.label} | ${r5(b)} | — | ${r5(l)} | — |`);
    else { const [e, lo, hi] = ci(list, i, brier), [e2, lo2, hi2] = ci(list, i, logloss); out.push(`| ${c.name} ${c.label} | ${r5(b)} | ${e >= 0 ? "+" : ""}${e} [${lo} ; ${hi}] | ${r5(l)} | ${e2 >= 0 ? "+" : ""}${e2} [${lo2} ; ${hi2}] |`); }
  });
  tables.push(out.join("\n")); console.log("\n" + out.join("\n"));
}
table("Tous les matchs testés", rows);
for (const p of ["A", "B", "C"]) table("Période " + p, rows.filter((r) => per(r) === p));
for (const lg of [...new Set(rows.map((r) => r.lg))]) table(lg + " (toutes périodes)", rows.filter((r) => r.lg === lg));
for (const lg of [...new Set(rows.map((r) => r.lg))]) for (const p of ["A", "B", "C"]) table(`${lg} — période ${p}`, rows.filter((r) => r.lg === lg && per(r) === p));

fs.writeFileSync(OUT.replace(/\.csv$/, ".tables.md"), tables.join("\n\n") + "\n");
const csv = ["date,championnat,periode,domicile,exterieur,resultat,M0_1,M0_N,M0_2,M1_1,M1_N,M1_2,M2_1,M2_N,M2_2,M3_1,M3_N,M3_2"];
for (const r of rows.sort((a, b) => a.date.localeCompare(b.date) || a.lg.localeCompare(b.lg))) csv.push([r.date, r.lg, per(r), r.home, r.away, "1N2"[r.k], ...r.p.flatMap((q) => q.map((v) => r5(v)))].join(","));
fs.writeFileSync(OUT, csv.join("\n") + "\n");
console.log(`\n${rows.length} prédictions écrites dans ${OUT}`);
