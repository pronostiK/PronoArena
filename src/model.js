// ============================================================
// DUEL PRONO — Moteur de calcul
// Matchs terminés au format : { id, homeId, awayId, hg, ag, ts, season }
// ============================================================
import { MODEL, VERSION } from "./config.js";

const r3 = (x) => Math.round(x * 1000) / 1000;
const r1 = (x) => Math.round(x * 10) / 10;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------- Poisson + Dixon-Coles ----------
const fact = [1];
for (let i = 1; i <= 20; i++) fact[i] = fact[i - 1] * i;
const pois = (l, k) => (l === 0 ? (k === 0 ? 1 : 0) : (Math.pow(l, k) * Math.exp(-l)) / fact[k]);
function tau(i, j, l1, l2, rho) {
  if (i === 0 && j === 0) return 1 - l1 * l2 * rho;
  if (i === 0 && j === 1) return 1 + l1 * rho;
  if (i === 1 && j === 0) return 1 + l2 * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

export function calculate_poisson_match(lD, lE, rho = MODEL.rho) {
  const N = MODEL.maxGoalsCalc;
  const m = [];
  let total = 0;
  for (let i = 0; i <= N; i++) {
    m[i] = [];
    for (let j = 0; j <= N; j++) { const p = Math.max(0, pois(lD, i) * pois(lE, j) * tau(i, j, lD, lE, rho)); m[i][j] = p; total += p; }
  }
  let p1 = 0, pN = 0, p2 = 0, o15 = 0, o25 = 0, o35 = 0, btts = 0, best = { i: 0, j: 0, p: 0 };
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const p = (m[i][j] /= total);
    if (i > j) p1 += p; else if (i === j) pN += p; else p2 += p;
    if (i + j > 1.5) o15 += p;
    if (i + j > 2.5) o25 += p;
    if (i + j > 3.5) o35 += p;
    if (i > 0 && j > 0) btts += p;
    if (p > best.p) best = { i, j, p };
  }
  // Marchés supplémentaires, tous déduits de la même grille de scores
  let dom05 = 0, dom15 = 0, ext05 = 0, ext15 = 0, wnDom = 0, wnExt = 0, wbDom = 0, wbExt = 0, by2Dom = 0, by2Ext = 0;
  const scores = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const p = m[i][j];
    if (i >= 1) dom05 += p; if (i >= 2) dom15 += p;
    if (j >= 1) ext05 += p; if (j >= 2) ext15 += p;
    if (i > j && j === 0) wnDom += p; if (j > i && i === 0) wnExt += p;
    if (i > j && j > 0) wbDom += p; if (j > i && i > 0) wbExt += p;
    if (i - j >= 2) by2Dom += p; if (j - i >= 2) by2Ext += p;
    scores.push({ dom: i, ext: j, p });
  }
  // Mi-temps : environ 45 % des buts sont marqués avant la pause
  const h1 = lD * 0.45, h2 = lE * 0.45;
  let mt1 = 0, mtN = 0, mt2 = 0;
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) { const p = pois(h1, i) * pois(h2, j); if (i > j) mt1 += p; else if (i === j) mtN += p; else mt2 += p; }
  const mtT = mt1 + mtN + mt2;

  const M = MODEL.maxGoalsMatrix;
  return {
    miTemps: { proba1: r3(mt1 / mtT), probaN: r3(mtN / mtT), proba2: r3(mt2 / mtT) },
    rembourseSiNul: { dom: r3(p1 / (p1 + p2)), ext: r3(p2 / (p1 + p2)) },
    butsDomicile: { plus05: r3(dom05), plus15: r3(dom15) },
    butsExterieur: { plus05: r3(ext05), plus15: r3(ext15) },
    victoireSansEncaisser: { dom: r3(wnDom), ext: r3(wnExt) },
    victoireEtBTTS: { dom: r3(wbDom), ext: r3(wbExt) },
    victoireDe2ButsOuPlus: { dom: r3(by2Dom), ext: r3(by2Ext) },
    scoresExacts: scores.sort((a, b) => b.p - a.p).slice(0, 6).map((x) => ({ dom: x.dom, ext: x.ext, proba: r3(x.p) })),
    matrix: m.slice(0, M + 1).map((row) => row.slice(0, M + 1).map((p) => Math.round(p * 10000) / 10000)),
    proba1: r3(p1), probaN: r3(pN), proba2: r3(p2),
    proba1X: r3(p1 + pN), probaX2: r3(pN + p2), proba12: r3(p1 + p2),
    probaOver15: r3(o15), probaUnder15: r3(1 - o15),
    probaOver25: r3(o25), probaUnder25: r3(1 - o25),
    probaOver35: r3(o35), probaUnder35: r3(1 - o35),
    probaBTTS: r3(btts), probaNoBTTS: r3(1 - btts),
    scoreProbable: { dom: best.i, ext: best.j, proba: r3(best.p) },
  };
}

// ---------- Forces attaque / défense ----------
export function computeTeamRatings(finished) {
  // Moyennes de la compétition sur tous les matchs utilisés
  let sH = 0, sA = 0;
  for (const f of finished) { sH += f.hg; sA += f.ag; }
  const n = finished.length;
  const blend = Math.min(1, n / MODEL.minLeagueMatches);
  const avgHome = Math.max(0.5, blend * (n ? sH / n : MODEL.defaultAvgHome) + (1 - blend) * MODEL.defaultAvgHome);
  const avgAway = Math.max(0.4, blend * (n ? sA / n : MODEL.defaultAvgAway) + (1 - blend) * MODEL.defaultAvgAway);

  // Pour chaque équipe : ses 40 derniers matchs, les 5 plus récents comptent double
  const byTeam = {};
  for (const f of finished) { (byTeam[f.homeId] ||= []).push(f); (byTeam[f.awayId] ||= []).push(f); }

  const K = MODEL.priorMatches, s = MODEL.specificWeight, ratings = {};
  for (const [id, list] of Object.entries(byTeam)) {
    const recent = list.sort((a, b) => b.ts - a.ts).slice(0, MODEL.windowMatches);
    const v = { hf: 0, ha: 0, hw: 0, af: 0, aa: 0, aw: 0 };
    recent.forEach((f, i) => {
      const x = i < MODEL.recentMatches ? MODEL.recentWeight : 1;
      if (f.homeId === id) { v.hf += x * f.hg / avgHome; v.ha += x * f.ag / avgAway; v.hw += x; }
      else { v.af += x * f.ag / avgAway; v.aa += x * f.hg / avgHome; v.aw += x; }
    });
    const attAll = (v.hf + v.af + K) / (v.hw + v.aw + K);
    const defAll = (v.ha + v.aa + K) / (v.hw + v.aw + K);
    ratings[id] = {
      attHome: s * (v.hf + K) / (v.hw + K) + (1 - s) * attAll,
      defHome: s * (v.ha + K) / (v.hw + K) + (1 - s) * defAll,
      attAway: s * (v.af + K) / (v.aw + K) + (1 - s) * attAll,
      defAway: s * (v.aa + K) / (v.aw + K) + (1 - s) * defAll,
      attAll, defAll, played: recent.length,
    };
  }
  return { avgHome, avgAway, ratings, matchesAnalysed: n };
}

// ---------- Elo (reporté d'une saison à l'autre) ----------
export function computeElo(finished) {
  const elo = {}, lastSeason = {};
  const sorted = [...finished].sort((a, b) => a.ts - b.ts);
  for (const f of sorted) {
    for (const id of [f.homeId, f.awayId]) {
      if (elo[id] === undefined) elo[id] = MODEL.eloStart;
      else if (lastSeason[id] !== undefined && f.season !== lastSeason[id]) elo[id] = MODEL.eloStart + (elo[id] - MODEL.eloStart) * MODEL.eloSeasonCarry;
      lastSeason[id] = f.season;
    }
    const rh = elo[f.homeId], ra = elo[f.awayId];
    const exp = 1 / (1 + Math.pow(10, (ra - (rh + MODEL.eloHomeAdv)) / 400));
    const res = f.hg > f.ag ? 1 : f.hg === f.ag ? 0.5 : 0;
    const d = MODEL.eloK * (1 + Math.log(1 + Math.abs(f.hg - f.ag))) * (res - exp);
    elo[f.homeId] = rh + d; elo[f.awayId] = ra - d;
  }
  return elo;
}

export function buildModel(finished) {
  return { ...computeTeamRatings(finished), elo: computeElo(finished) };
}

// ---------- Forme et statistiques d'une équipe ----------
export function teamStats(teamId, matches) {
  const mine = matches.filter((f) => f.homeId === teamId || f.awayId === teamId).sort((a, b) => b.ts - a.ts);
  if (!mine.length) return null;
  let v = 0, n = 0, d = 0, bm = 0, be = 0, o25 = 0, btts = 0, cs = 0, hp = 0, hbm = 0, hbe = 0, ap = 0, abm = 0, abe = 0;
  const forme = [];
  for (const f of mine) {
    const home = f.homeId === teamId;
    const gf = home ? f.hg : f.ag, ga = home ? f.ag : f.hg;
    const res = gf > ga ? "V" : gf === ga ? "N" : "D";
    if (res === "V") v++; else if (res === "N") n++; else d++;
    bm += gf; be += ga;
    if (gf + ga > 2.5) o25++;
    if (gf > 0 && ga > 0) btts++;
    if (ga === 0) cs++;
    if (home) { hp++; hbm += gf; hbe += ga; } else { ap++; abm += gf; abe += ga; }
    if (forme.length < 5) forme.push({ r: res, score: `${gf}-${ga}`, adversaire: home ? f.awayId : f.homeId, domicile: home, date: new Date(f.ts).toISOString().slice(0, 10) });
  }
  const P = mine.length, pct = (x) => Math.round((100 * x) / P);
  const pts5 = forme.reduce((s, f) => s + (f.r === "V" ? 3 : f.r === "N" ? 1 : 0), 0);
  return {
    matchs: P, victoires: v, nuls: n, defaites: d,
    forme: forme.map((f) => f.r), formeDetail: forme, pointsForme: pts5,
    butsMarquesParMatch: r1(bm / P), butsEncaissesParMatch: r1(be / P),
    domicile: hp ? { matchs: hp, butsMarques: r1(hbm / hp), butsEncaisses: r1(hbe / hp) } : null,
    exterieur: ap ? { matchs: ap, butsMarques: r1(abm / ap), butsEncaisses: r1(abe / ap) } : null,
    pctOver25: pct(o25), pctBTTS: pct(btts), pctCleanSheet: pct(cs),
  };
}

// ---------- Classement ----------
export function leagueTable(finished) {
  const t = {};
  const T = (id) => (t[id] ||= { id, j: 0, v: 0, n: 0, d: 0, bp: 0, bc: 0, pts: 0 });
  for (const f of finished) {
    const h = T(f.homeId), a = T(f.awayId);
    h.j++; a.j++; h.bp += f.hg; h.bc += f.ag; a.bp += f.ag; a.bc += f.hg;
    if (f.hg > f.ag) { h.v++; a.d++; h.pts += 3; } else if (f.hg < f.ag) { a.v++; h.d++; a.pts += 3; } else { h.n++; a.n++; h.pts++; a.pts++; }
  }
  const rows = Object.values(t).sort((a, b) => b.pts - a.pts || (b.bp - b.bc) - (a.bp - a.bc) || b.bp - a.bp);
  rows.forEach((r, i) => { r.rang = i + 1; r.diff = r.bp - r.bc; });
  return rows;
}

export function fiabilite(minPlayed) {
  if (minPlayed >= 8) return "élevée";
  if (minPlayed >= 4) return "moyenne";
  return "faible";
}

// ---------- Pronostic d'un match ----------
// ctx : { model, leagueId, season, domestic?: Map(teamId -> { rating, avgHome, avgAway, coef, played }) }
const NEUTRAL = { attHome: 1, defHome: 1, attAway: 1, defAway: 1, attAll: 1, defAll: 1, played: 0 };

export function calculate_match_prediction(match, ctx) {
  const { model, leagueId, season } = ctx;
  const dom = model.ratings[match.teamDomId] || NEUTRAL;
  const ext = model.ratings[match.teamExtId] || NEUTRAL;

  let lD = model.avgHome * dom.attHome * ext.defAway;
  let lE = model.avgAway * ext.attAway * dom.defHome;
  let playedD = dom.played, playedE = ext.played, sourceCalc = "competition";

  // Coupes : on mélange avec la force en championnat, corrigée du niveau du championnat
  if (ctx.domestic) {
    const dd = ctx.domestic.get(match.teamDomId), de = ctx.domestic.get(match.teamExtId);
    if (dd || de) {
      const u = { rating: NEUTRAL, coef: MODEL.unknownLeagueCoef, played: 0 };
      const A = dd || u, B = de || u;
      const lDdom = model.avgHome * A.rating.attAll * B.rating.defAll * (A.coef / B.coef);
      const lEdom = model.avgAway * B.rating.attAll * A.rating.defAll * (B.coef / A.coef);
      const cupPlayed = Math.min(dom.played, ext.played);
      const wCup = cupPlayed / (cupPlayed + MODEL.cupDomesticPrior);
      lD = wCup * lD + (1 - wCup) * lDdom;
      lE = wCup * lE + (1 - wCup) * lEdom;
      playedD = Math.max(dom.played, A.played);
      playedE = Math.max(ext.played, B.played);
      sourceCalc = dd && de ? "competition+championnats" : "competition+championnat-partiel";
    }
  }

  const lambdaDom = r3(clamp(lD, MODEL.lambdaMin, MODEL.lambdaMax));
  const lambdaExt = r3(clamp(lE, MODEL.lambdaMin, MODEL.lambdaMax));
  const poisson = calculate_poisson_match(lambdaDom, lambdaExt);
  const cote = (p) => (p > 0 ? Math.round((1 / p) * 100) / 100 : null);

  return {
    matchId: match.matchId,
    leagueId,
    season,
    date: match.date,
    status: match.status || "SCHEDULED",
    source: match.source,
    teams: {
      domicile: { id: match.teamDomId, name: match.domName, logo: match.domLogo, elo: Math.round(model.elo[match.teamDomId] ?? MODEL.eloStart) },
      exterieur: { id: match.teamExtId, name: match.extName, logo: match.extLogo, elo: Math.round(model.elo[match.teamExtId] ?? MODEL.eloStart) },
    },
    lambdas: { lambdaDom, lambdaExt },
    poisson,
    cotesJustes: {
      cote1: cote(poisson.proba1), coteN: cote(poisson.probaN), cote2: cote(poisson.proba2),
      cote1X: cote(poisson.proba1X), coteX2: cote(poisson.probaX2), cote12: cote(poisson.proba12),
    },
    donnees: {
      modele: VERSION,
      calcul: sourceCalc,
      matchsDomicile: playedD,
      matchsExterieur: playedE,
      matchsCompetition: model.matchesAnalysed,
      fiabilite: fiabilite(Math.min(playedD, playedE)),
    },
  };
}
