// ============================================================
// TEST HORS LIGNE — pistes « forme domicile / extérieur » et « saison en cours » (24/11/2026).
// Autorisé par l'auditeur hors production. Rien n'est publié ; le moteur en ligne reste figé.
// Règles : historique seulement, AUCUN match du suivi prospectif (matchs à partir du 20/11/2026 exclus des prédictions
// ET des données d'entraînement) ; variantes fixées AVANT le calcul ; nombre d'essais annoncé.
// Base REF = M7 (promus, Elo 25 %, corners 30 % pris dans le fichier), mêmes matchs que l'audit du 20/11.
// Variantes (6) :
//   DE_FORME  : bonus de forme récente compté par lieu (4 derniers matchs à domicile ×1,5 pour la force à domicile,
//               4 derniers à l'extérieur ×1,5 pour la force à l'extérieur) ; la partie générale ne change pas.
//   DE_50     : poids de la force propre au lieu 50 % (au lieu de 30 %).
//   DE_15     : poids de la force propre au lieu 15 % (contrôle du sens).
//   PREC_50   : matchs de la saison précédente comptés à moitié (tous championnats, toujours).
//   PREC_50_8 : idem, seulement quand chaque équipe a joué au moins 8 matchs de la saison en cours.
//   SAISON_L1L2 : saison en cours seule (règle des 8 matchs) en Ligue 1 et Ligue 2 uniquement ; ailleurs = REF.
// 6 variantes × 9 championnats = 54 comparaisons par championnat (risque de « bons » résultats par hasard).
// Usage : node test/lab/run-pistes-domext-saison.mjs <history.json>
// ============================================================
import fs from "node:fs";
import { computeTeamRatings, computeElo, calculate_match_prediction } from "../../src/model.js";
import { LEAGUES, MODEL } from "../../src/config.js";
import { blendCorners, CORNERS_LEAGUES } from "../../src/corners.js";
const CUTOFF = "2026-11-20";
const hist = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).filter((m) => (m.division || "L1") === "L1" && m.date < CUTOFF);
const LGS = ["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED", "ELC", "FL2"];
const FD = Object.fromEntries(Object.entries(LEAGUES).map(([id, l]) => [id, l.src.replace(/^fd:/, "")]));
const PROMUS = new Set(Object.values(LEAGUES).filter((l) => l.promus).map((l) => l.src.replace("fd:", "")));
const CORNERS = new Set(Object.keys(CORNERS_LEAGUES).map((id) => (id === "62" ? "FL2" : FD[id])));
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const logl = (p, k) => -Math.log(Math.max(1e-15, p[k]));
const VARS = ["REF", "DE_FORME", "DE_50", "DE_15", "PREC_50", "PREC_50_8", "SAISON_L1L2"];

// Copie de computeTeamRatings (src/model.js) avec options : spec (poids lieu), venueRecent, w(f) (poids par match)
function ratingsVar(finished, newcomers, o = {}) {
  const w = o.w || (() => 1), s = o.spec ?? MODEL.specificWeight;
  let sH = 0, sA = 0; for (const f of finished) { sH += f.hg; sA += f.ag; }
  const n = finished.length, blend = Math.min(1, n / MODEL.minLeagueMatches);
  const avgHome = Math.max(0.5, blend * (n ? sH / n : MODEL.defaultAvgHome) + (1 - blend) * MODEL.defaultAvgHome);
  const avgAway = Math.max(0.4, blend * (n ? sA / n : MODEL.defaultAvgAway) + (1 - blend) * MODEL.defaultAvgAway);
  const byTeam = {};
  for (const f of finished) { (byTeam[f.homeId] ||= []).push(f); (byTeam[f.awayId] ||= []).push(f); }
  if (newcomers) for (const id of newcomers) byTeam[id] ||= [];
  const ratings = {};
  for (const [id, list] of Object.entries(byTeam)) {
    const isNew = !!newcomers?.has(String(id));
    const K = isNew ? MODEL.promoted.priorMatches : MODEL.priorMatches;
    const a0 = isNew ? MODEL.promoted.attack : 1, d0 = isNew ? MODEL.promoted.defense : 1;
    const recent = list.sort((a, b) => b.ts - a.ts).slice(0, MODEL.windowMatches);
    const v = { hf: 0, ha: 0, hw: 0, af: 0, aa: 0, aw: 0 }, u = { hf: 0, ha: 0, hw: 0, af: 0, aa: 0, aw: 0 };
    let ih = 0, ia = 0;
    recent.forEach((f, i) => {
      const x = (i < MODEL.recentMatches ? MODEL.recentWeight : 1) * w(f);
      if (String(f.homeId) === id) { v.hf += x * f.hg / avgHome; v.ha += x * f.ag / avgAway; v.hw += x; const y = (ih++ < 4 ? MODEL.recentWeight : 1) * w(f); u.hf += y * f.hg / avgHome; u.ha += y * f.ag / avgAway; u.hw += y; }
      else { v.af += x * f.ag / avgAway; v.aa += x * f.hg / avgHome; v.aw += x; const y = (ia++ < 4 ? MODEL.recentWeight : 1) * w(f); u.af += y * f.ag / avgAway; u.aa += y * f.hg / avgHome; u.aw += y; }
    });
    const attAll = (v.hf + v.af + K * a0) / (v.hw + v.aw + K), defAll = (v.ha + v.aa + K * d0) / (v.hw + v.aw + K);
    const z = o.venueRecent ? u : v;
    ratings[id] = {
      attHome: s * (z.hf + K * a0) / (z.hw + K) + (1 - s) * attAll, defHome: s * (z.ha + K * d0) / (z.hw + K) + (1 - s) * defAll,
      attAway: s * (z.af + K * a0) / (z.aw + K) + (1 - s) * attAll, defAway: s * (z.aa + K * d0) / (z.aw + K) + (1 - s) * defAll,
      attAll, defAll, played: recent.length, ...(isNew ? { promu: true } : {}),
    };
  }
  return { avgHome, avgAway, ratings, matchesAnalysed: n };
}

const rows = [];
let ecartRef = 0, saisonActive = 0, journees = 0;
for (const lg of LGS) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m, i) => ({ id: `${lg}-${i}`, homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date, hc: m.hc, ac: m.ac }));
  for (const date of [...new Set(L.filter((m) => m.date >= "2024-08-01").map((m) => m.date))]) {
    const S = seasonOf(date);
    const past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    journees++;
    const prevT = new Set(); for (const f of past) if (f.season === S - 1) { prevT.add(f.homeId); prevT.add(f.awayId); }
    const curT = new Set(); for (const f of fin) if (f.season === S) { curT.add(f.homeId); curT.add(f.awayId); }
    const nc = new Set([...curT].filter((t) => !prevT.has(t)));
    const newcomers = PROMUS.has(lg) && prevT.size && nc.size && nc.size <= MODEL.promotedMaxTeams ? nc : null;
    const elo = computeElo(past);
    const mix = (list) => (CORNERS.has(lg) ? blendCorners(list, [{ m: Object.fromEntries(list.filter((f) => f.hc != null && f.ac != null).map((f) => [f.id, [f.hc, f.ac]])) }]).finished : list);
    const P = mix(past);
    const cur = past.filter((f) => f.season === S), cnt = {};
    for (const f of cur) { cnt[f.homeId] = (cnt[f.homeId] || 0) + 1; cnt[f.awayId] = (cnt[f.awayId] || 0) + 1; }
    const enough = curT.size && [...curT].every((t) => (cnt[t] || 0) >= 8);
    if (enough) saisonActive++;
    const half = (f) => (f.season === S - 1 ? 0.5 : 1);
    const M = {
      REF: { ...ratingsVar(P, newcomers), elo },
      DE_FORME: { ...ratingsVar(P, newcomers, { venueRecent: true }), elo },
      DE_50: { ...ratingsVar(P, newcomers, { spec: 0.5 }), elo },
      DE_15: { ...ratingsVar(P, newcomers, { spec: 0.15 }), elo },
      PREC_50: { ...ratingsVar(P, newcomers, { w: half }), elo },
      PREC_50_8: enough ? { ...ratingsVar(P, newcomers, { w: half }), elo } : null,
      SAISON_L1L2: enough && (lg === "FL1" || lg === "FL2") ? { ...computeTeamRatings(mix(cur), { newcomers: null }), elo } : null,
    };
    M.PREC_50_8 ||= M.REF; M.SAISON_L1L2 ||= M.REF;
    // Contrôle : la copie REF donne exactement le moteur
    const off = computeTeamRatings(P, { newcomers });
    for (const [t, r] of Object.entries(off.ratings)) ecartRef = Math.max(ecartRef, Math.abs(r.attHome - M.REF.ratings[t].attHome), Math.abs(r.defAway - M.REF.ratings[t].defAway));
    for (const m of L.filter((x) => x.date === date && [x.avgH, x.avgD, x.avgA].every((o) => o > 1))) {
      const row = { lg, date, S, k: res(m), p: {} };
      for (const v of VARS) { const p = calculate_match_prediction({ teamDomId: m.home, teamExtId: m.away, date }, { model: M[v], leagueId: lg, season: S, eloMix: true }).poisson; const t = p.proba1 + p.probaN + p.proba2; row.p[v] = [p.proba1 / t, p.probaN / t, p.proba2 / t]; }
      rows.push(row);
    }
  }
}
function paired(l, c, fn) {
  const byD = new Map(); for (const r of l) { const x = byD.get(r.date) || [0, 0]; x[0] += fn(r.p[c], r.k) - fn(r.p.REF, r.k); x[1]++; byD.set(r.date, x); }
  const G = [...byD.values()], mean = G.reduce((s, g) => s + g[0], 0) / G.reduce((s, g) => s + g[1], 0);
  let seed = 20261124; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); const sims = [];
  for (let t = 0; t < 3000; t++) { let s = 0, n = 0; for (let i = 0; i < G.length; i++) { const g = G[(rnd() * G.length) | 0]; s += g[0]; n += g[1]; } sims.push(s / n); }
  sims.sort((a, b) => a - b); return [mean, sims[75], sims[2924]];
}
const f = (x) => (x >= 0 ? "+" : "") + x.toFixed(4), ci = (a) => `${f(a[0])} [${f(a[1])} ; ${f(a[2])}]`;
const avg = (l, c, fn) => l.reduce((s, r) => s + fn(r.p[c], r.k), 0) / l.length;
console.log(`${rows.length} matchs (avant le ${CUTOFF}), ${journees} journées ; règle des 8 matchs active sur ${saisonActive} journées ; écart max copie REF / moteur = ${ecartRef.toExponential(1)}`);
const show = (t, l) => { console.log(`\n${t} (n=${l.length})  REF Brier ${avg(l, "REF", brier).toFixed(4)}`); for (const v of VARS.slice(1)) console.log(`  ${v.padEnd(11)} Brier ${ci(paired(l, v, brier))}   LL ${ci(paired(l, v, logl))}`); };
show("TOTAL", rows);
for (const S of [2024, 2025, 2026]) show(`Saison ${S}-${String(S + 1).slice(2)}`, rows.filter((r) => r.S === S));
console.log("\nPar championnat (Brier, écart à REF ; par saison 2024 / 2025 / 2026) :");
for (const lg of LGS) { const l = rows.filter((r) => r.lg === lg); console.log(`  ${lg.padEnd(4)} n=${l.length}`); for (const v of VARS.slice(1)) console.log(`     ${v.padEnd(11)} ${f(paired(l, v, brier)[0])}   (${[2024, 2025, 2026].map((S) => f(paired(l.filter((r) => r.S === S), v, brier)[0])).join(" / ")})`); }
