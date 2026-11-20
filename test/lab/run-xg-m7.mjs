// ============================================================
// TEST HORS LIGNE — apport des xG PAR-DESSUS M7 (20/11/2026). Rien n'est publié, le moteur n'est pas modifié.
// Variante unique, fixée AVANT le calcul (la même que le test du 19/11, posée sur M7) :
//   M7X = M7, mais la part « buts » des forces (70 %) devient 50 % buts réels + 50 % xG mesurés.
//   Forces = 0,7 × (0,5 buts + 0,5 xG) + 0,3 × corners convertis ; matchs sans corners : 0,5 buts + 0,5 xG.
//   Elo, promus, classement : inchangés (vrais buts). Aucun autre réglage, aucun essai d'autres poids.
// Règles fixées avant le calcul :
//  - xG utilisé seulement si statut « mesure » ; sinon le match garde ses buts réels ;
//  - mêmes matchs, mêmes règles que l'audit du 20/11 (audit-20nov.mjs) : modèle construit le jour du match avec les seuls
//    matchs terminés avant ce jour (saison en cours + précédente), matchs avec cotes moyennes seulement ;
//  - saisons testées : 2024-25 et 2025-26 (les xG couvrent 2023-24 → 2025-26 ; 2023-24 sert d'historique) ;
//  - 5 championnats couverts par les xG : Ligue 1, Premier League, Liga, Serie A, Bundesliga ;
//  - liaison xG ↔ match : même championnat, date ± 1 jour, même score, équipes reconnues par leurs dates de match ;
//  - écarts appariés M7X − M7 (et M0X − M0 pour comparaison), IC 95 % bootstrap regroupé par date, 3 000 tirages, graine 20261120.
// Usage : node test/lab/run-xg-m7.mjs <history.json> <xg_bzzoiro.csv> [sortie.json]
// Le fichier xG n'est jamais versé dans le dépôt (public) : seuls les résultats agrégés sont affichés.
// ============================================================
import fs from "node:fs";
import { buildModel, computeTeamRatings, computeElo, calculate_match_prediction } from "../../src/model.js";
import { LEAGUES, MODEL } from "../../src/config.js";
import { blendCorners, CORNERS_LEAGUES, CORNERS_SHARE } from "../../src/corners.js";

const [H, XG, JOUT = null] = process.argv.slice(2);
const hist = JSON.parse(fs.readFileSync(H, "utf8")).filter((m) => (m.division || "L1") === "L1");
const BZ = { "Ligue 1": "FL1", "Premier League": "PL", "La Liga": "PD", "Serie A": "SA", "Bundesliga": "BL1" };
const LGS = Object.values(BZ);
const FD = Object.fromEntries(Object.entries(LEAGUES).map(([id, l]) => [id, l.src.replace(/^fd:/, "")]));
const PROMUS = new Set(Object.values(LEAGUES).filter((l) => l.promus).map((l) => l.src.replace("fd:", "")));
const CORNERS = new Set(Object.keys(CORNERS_LEAGUES).map((id) => (id === "62" ? "FL2" : FD[id])));
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const DAY = 864e5, day = (d) => Math.round(Date.parse(d + "T12:00:00Z") / DAY);
const res = (m) => (m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2);
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0);
const logl = (p, k) => -Math.log(Math.max(1e-15, p[k]));

// ---------- xG : lecture et liaison aux matchs football-data ----------
const lines = fs.readFileSync(XG, "utf8").trim().split(/\r?\n/);
const head = lines[0].split(",");
const xrows = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((c, i) => [head[i], c]))).filter((r) => BZ[r.championnat]);
const liaison = {};
const xgOf = new Map(); // `${lg}|${date}|${home}|${away}` (noms football-data) → [xgD, xgE]
for (const lg of LGS) {
  const X = xrows.filter((r) => BZ[r.championnat] === lg), F = hist.filter((m) => m.lg === lg && m.date >= "2023-07-01" && m.date < "2026-07-01");
  const playedF = {}; for (const m of F) for (const t of [m.home, m.away]) (playedF[t] ||= new Set()).add(day(m.date));
  const daysX = {}; for (const r of X) for (const t of [r.domicile, r.exterieur]) (daysX[t] ||= []).push(day(r.date));
  const map = {}, taken = new Set();
  for (const [name, ds] of Object.entries(daysX).sort((a, b) => b[1].length - a[1].length)) {
    let best = null, bs = 0;
    for (const [t, set] of Object.entries(playedF)) { if (taken.has(t)) continue; let c = 0; for (const d of ds) if (set.has(d) || set.has(d - 1) || set.has(d + 1)) c++; if (c > bs) { bs = c; best = t; } }
    if (best && bs >= 0.6 * ds.length && bs >= Math.min(3, ds.length)) { map[name] = best; taken.add(best); }
  }
  const byPair = new Map(); for (const m of F) { const k = `${m.home}|${m.away}`; (byPair.get(k) || byPair.set(k, []).get(k)).push(m); }
  let n = 0, mes = 0;
  for (const r of X) {
    const h = map[r.domicile], a = map[r.exterieur]; if (!h || !a) continue;
    const m = (byPair.get(`${h}|${a}`) || []).find((x) => Math.abs(day(x.date) - day(r.date)) <= 1 && x.hg === +r.buts_domicile && x.ag === +r.buts_exterieur);
    if (!m) continue;
    n++;
    if (r.statut === "mesure" && r.xg_domicile !== "" && r.xg_exterieur !== "") { xgOf.set(`${lg}|${m.date}|${m.home}|${m.away}`, [+r.xg_domicile, +r.xg_exterieur]); mes++; }
  }
  liaison[lg] = { matchsFootballData: F.length, lignesXg: X.length, relies: n, xgMesures: mes, equipesNonReconnues: Object.keys(daysX).filter((t) => !map[t]) };
}

// ---------- Prédictions jour par jour ----------
const CONF = ["M0", "M0X", "M7", "M7X"];
const rows = [];
for (const lg of LGS) {
  const L = hist.filter((m) => m.lg === lg).sort((a, b) => a.date.localeCompare(b.date));
  const fin = L.map((m, i) => ({ id: `${lg}-${i}`, homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, ts: Date.parse(m.date + "T12:00:00Z"), season: seasonOf(m.date), date: m.date, hc: m.hc, ac: m.ac, xg: xgOf.get(`${lg}|${m.date}|${m.home}|${m.away}`) || null }));
  for (const date of [...new Set(L.filter((m) => m.date >= "2024-08-01" && m.date < "2026-07-01").map((m) => m.date))]) {
    const S = seasonOf(date);
    const past = fin.filter((f) => f.date < date && f.season >= S - 1);
    if (past.length < 20) continue;
    const prevT = new Set(); for (const f of past) if (f.season === S - 1) { prevT.add(f.homeId); prevT.add(f.awayId); }
    const curT = new Set(); for (const f of fin) if (f.season === S) { curT.add(f.homeId); curT.add(f.awayId); }
    const nc = new Set([...curT].filter((t) => !prevT.has(t)));
    const newcomers = PROMUS.has(lg) && prevT.size && nc.size && nc.size <= MODEL.promotedMaxTeams ? nc : null;
    const cmap = { m: Object.fromEntries(past.filter((f) => f.hc != null && f.ac != null).map((f) => [f.id, [f.hc, f.ac]])) };
    const elo = computeElo(past);
    const withXg = (list, base) => list.map((f, i) => { const o = past[i]; if (!o.xg) return f; const w = (cmap.m[o.id] && base ? 1 - CORNERS_SHARE : 1) * 0.5; return { ...f, hg: f.hg + w * (o.xg[0] - o.hg), ag: f.ag + w * (o.xg[1] - o.ag) }; });
    const M = {};
    M.M0 = buildModel(past);
    M.M0X = { ...computeTeamRatings(withXg(past, false)), elo };
    const bl = CORNERS.has(lg) ? blendCorners(past, [cmap]).finished : past;
    M.M7 = { ...computeTeamRatings(bl, { newcomers }), elo };
    M.M7X = { ...computeTeamRatings(withXg(bl, CORNERS.has(lg)), { newcomers }), elo };
    for (const m of L.filter((x) => x.date === date && [x.avgH, x.avgD, x.avgA].every((o) => o > 1))) {
      const row = { lg, date, S, k: res(m), p: {} };
      for (const c of CONF) {
        const p = calculate_match_prediction({ teamDomId: m.home, teamExtId: m.away, date }, { model: M[c], leagueId: lg, season: S, eloMix: c.startsWith("M7") }).poisson;
        const t = p.proba1 + p.probaN + p.proba2; row.p[c] = [p.proba1 / t, p.probaN / t, p.proba2 / t];
      }
      rows.push(row);
    }
  }
}

// ---------- Résultats ----------
const r4 = (x) => Math.round(x * 10000) / 10000, r5 = (x) => Math.round(x * 100000) / 100000;
const score = (l, c) => ({ n: l.length, brier: r4(l.reduce((s, r) => s + brier(r.p[c], r.k), 0) / l.length), logloss: r4(l.reduce((s, r) => s + logl(r.p[c], r.k), 0) / l.length) });
function paired(l, c, ref, f) {
  const byD = new Map(); for (const r of l) { const x = byD.get(r.date) || [0, 0]; x[0] += f(r.p[c], r.k) - f(r.p[ref], r.k); x[1]++; byD.set(r.date, x); }
  const G = [...byD.values()], mean = G.reduce((s, g) => s + g[0], 0) / G.reduce((s, g) => s + g[1], 0);
  let seed = 20261120; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); const sims = [];
  for (let t = 0; t < 3000; t++) { let s = 0, n = 0; for (let i = 0; i < G.length; i++) { const g = G[(rnd() * G.length) | 0]; s += g[0]; n += g[1]; } sims.push(s / n); }
  sims.sort((a, b) => a - b); return [r5(mean), r5(sims[75]), r5(sims[2924])];
}
const bloc = (l) => ({ n: l.length, scores: Object.fromEntries(CONF.map((c) => [c, score(l, c)])), xgSurM7: { brier: paired(l, "M7X", "M7", brier), logloss: paired(l, "M7X", "M7", logl) }, xgSurM0: { brier: paired(l, "M0X", "M0", brier), logloss: paired(l, "M0X", "M0", logl) } });
const out = { matchs: rows.length, liaison, global: bloc(rows), saisons: {}, championnats: {}, championnatSaison: {} };
for (const S of [2024, 2025]) out.saisons[S] = bloc(rows.filter((r) => r.S === S));
for (const lg of LGS) { out.championnats[lg] = bloc(rows.filter((r) => r.lg === lg)); for (const S of [2024, 2025]) out.championnatSaison[`${lg} ${S}`] = paired(rows.filter((r) => r.lg === lg && r.S === S), "M7X", "M7", brier); }
if (JOUT) fs.writeFileSync(JOUT, JSON.stringify(out, null, 1));
const f = (x) => (x >= 0 ? "+" : "") + x.toFixed(4), ci = (a) => `${f(a[0])} [${f(a[1])} ; ${f(a[2])}]`;
console.log("Liaison xG ↔ matchs :"); for (const [lg, v] of Object.entries(liaison)) console.log(`  ${lg} : ${v.relies}/${v.lignesXg} lignes xG reliées, ${v.xgMesures} xG mesurés${v.equipesNonReconnues.length ? `, non reconnues : ${v.equipesNonReconnues.join(" / ")}` : ""}`);
const show = (t, b) => console.log(`${t} (n=${b.n})  M7 ${b.scores.M7.brier.toFixed(4)}  M7X ${b.scores.M7X.brier.toFixed(4)}  | xG sur M7 : Brier ${ci(b.xgSurM7.brier)}  LL ${ci(b.xgSurM7.logloss)}  | xG sur M0 : Brier ${ci(b.xgSurM0.brier)}`);
console.log(""); show("TOTAL", out.global);
for (const S of [2024, 2025]) show(`Saison ${S}-${String(S + 1).slice(2)}`, out.saisons[S]);
for (const lg of LGS) show(`  ${lg}`, out.championnats[lg]);
console.log("\nxG sur M7, par championnat et saison (Brier) :"); for (const [k, v] of Object.entries(out.championnatSaison)) console.log(`  ${k} : ${ci(v)}`);
