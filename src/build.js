// ============================================================
// DUEL PRONO — Construction des pronostics, face-à-face et Verdict
// à partir des données préparées par le robot (aucun appel API ici)
// ============================================================
import { LEAGUES, LEAGUE_COEF, MODEL, VERSION, BACKUP_AFTER_MS } from "./config.js";
import { kvGet, srcKey, toFinished, toUpcoming } from "./sources.js";
import { buildModel, computeTeamRatings, teamStats, leagueTable, groupTables, calculate_match_prediction } from "./model.js";
import { nationalContext } from "./nations.js";

const r3 = (x) => Math.round(x * 1000) / 1000;
export const predsKey = (leagueId, season) => `preds:${leagueId}@${season}`;
export const archiveKey = (leagueId, season) => `archive:${leagueId}@${season}`;
export const INDEX_KEY = "robot:index";
export const allKey = (season) => `preds:all@${season}`;

// ---------- Tous les matchs à venir, toutes compétitions confondues (page d'accueil) ----------
// Version allégée de chaque pronostic (ce qu'il faut pour une carte), sur les 7 prochains jours,
// + la date du prochain match de chaque compétition (pour trier la liste des compétitions).
const UPCOMING_DAYS = 7, UPCOMING_MAX = 200;

// ---------- Matchs offerts aux visiteurs non inscrits ----------
// Chaque jour (heure de Paris), 2 matchs sont visibles par tout le monde ; les autres sont réservés aux inscrits.
// Le choix est fait une fois par jour et ne bouge plus de la journée : les mêmes 2 matchs pour tous.
export const FREE_PER_DAY = 2;
export const freeKey = (leagueId, matchId) => `${leagueId}:${matchId}`;
const FREE_PRIORITY = [2, 61, 39, 140, 135, 78, 3, 5, 848, 62, 94, 88, 40, 71, 15, 4]; // les affiches d'abord
const parisDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));
export function chooseFree(cands, now) {
  const rank = (a, b) => FREE_PRIORITY.indexOf(a.leagueId) - FREE_PRIORITY.indexOf(b.leagueId) || b.elo - a.elo || a.ts - b.ts;
  const ahead = cands.filter((c) => c.ts > now);
  const picked = ahead.filter((c) => parisDay(c.ts) === parisDay(now)).sort(rank).slice(0, FREE_PER_DAY);
  // Pas assez de matchs aujourd'hui : on complète avec les prochains à venir
  if (picked.length < FREE_PER_DAY) picked.push(...ahead.filter((c) => !picked.includes(c)).sort((a, b) => a.ts - b.ts || rank(a, b)).slice(0, FREE_PER_DAY - picked.length));
  return picked.map((c) => c.key);
}
const slimTeam = (x) => ({ id: x.id, name: x.name, logo: x.logo });
// Ce qu'un visiteur non inscrit reçoit pour un match réservé : l'affiche, sans aucune probabilité
export const lockPrediction = (p, leagueId) => ({
  matchId: p.matchId, leagueId: p.leagueId ?? leagueId, date: p.date, status: p.status, source: p.source, verrouille: true,
  teams: { domicile: slimTeam(p.teams.domicile), exterieur: slimTeam(p.teams.exterieur) },
});

export async function buildUpcoming(env, season, now = Date.now(), prevFree = null) {
  const matchs = [], prochains = {}, cands = [];
  for (const id of Object.keys(LEAGUES).map(Number)) {
    const raw = await env.PRONO_CACHE.get(predsKey(id, season));
    if (!raw) continue;
    const preds = (JSON.parse(raw).predictions || []).filter((p) => Date.parse(p.date) > now - 3 * 3600000);
    if (!preds.length) continue;
    prochains[id] = Math.min(...preds.map((p) => Date.parse(p.date)));
    for (const p of preds) {
      cands.push({ key: freeKey(id, p.matchId), leagueId: id, ts: Date.parse(p.date), elo: (p.teams.domicile.elo || 0) + (p.teams.exterieur.elo || 0) });
      if (Date.parse(p.date) > now + UPCOMING_DAYS * 86400000) continue;
      const P = p.poisson, t = slimTeam;
      matchs.push({
        matchId: p.matchId, leagueId: id, date: p.date, status: p.status, source: p.source,
        teams: { domicile: t(p.teams.domicile), exterieur: t(p.teams.exterieur) },
        poisson: { proba1: P.proba1, probaN: P.probaN, proba2: P.proba2, probaOver25: P.probaOver25, probaUnder25: P.probaUnder25, probaBTTS: P.probaBTTS },
        donnees: { fiabilite: p.donnees?.fiabilite },
      });
    }
  }
  matchs.sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.leagueId - b.leagueId);
  const jour = parisDay(now);
  const gratuits = prevFree?.jour === jour && prevFree.ids?.length ? prevFree : { jour, ids: chooseFree(cands, now) };
  const free = new Set(gratuits.ids);
  for (const m of matchs) if (free.has(freeKey(m.leagueId, m.matchId))) m.gratuit = true;
  return { success: true, season, jours: UPCOMING_DAYS, count: Math.min(matchs.length, UPCOMING_MAX), prochains, gratuits, matchs: matchs.slice(0, UPCOMING_MAX) };
}

// Source principale, ou ESPN si football-data est en panne depuis plus de 12 h
export function chooseSource(lg, season, index, now) {
  const meta = index?.[`${lg.src}@${season}`];
  const broken = meta?.error && now - (meta.lastOk || 0) > BACKUP_AFTER_MS;
  if (lg.backup && broken) {
    const b = index?.[`${lg.backup}@${season}`];
    if (b && !b.error) return { src: lg.backup, secours: true };
  }
  return { src: lg.src, secours: false };
}

export async function buildLeague(env, leagueId, season, now = Date.now(), index = null) {
  const lg = LEAGUES[leagueId];
  if (!lg) return null;
  index = index || (await kvGet(env, INDEX_KEY)) || {};
  const { src, secours } = chooseSource(lg, season, index, now);
  const provider = src.split(":")[0];

  const cur = await kvGet(env, srcKey(src, season));
  if (!cur) return null;
  const prev = lg.cup || secours ? null : await kvGet(env, srcKey(src, season - 1));

  const finishedCur = toFinished(cur);
  const finishedAll = prev ? [...toFinished(prev), ...finishedCur] : finishedCur;
  const model = buildModel(finishedAll);

  // Coupes : forces en championnat de chaque équipe
  let domestic = null;
  const formePool = [...finishedCur];
  const domesticStatus = [];
  const extraNames = {};
  if (lg.domestic && !secours) {
    domestic = new Map();
    const srcs = await Promise.all(lg.domestic.map((d) => kvGet(env, srcKey(d, season))));
    lg.domestic.forEach((d, i) => {
      const s = srcs[i];
      domesticStatus.push({ source: d, disponible: !!s, matchs: s?.finished?.length || 0 });
      if (!s) return;
      Object.assign(extraNames, s.teams);
      const f = toFinished(s);
      formePool.push(...f);
      const rt = computeTeamRatings(f);
      for (const [id, rating] of Object.entries(rt.ratings)) {
        if (!domestic.has(id)) domestic.set(id, { rating, coef: LEAGUE_COEF[d] ?? MODEL.unknownLeagueCoef, played: rating.played, league: d });
      }
    });
  }

  const table = leagueTable(finishedCur);
  // Sélections : rang dans le groupe (ou rien si les groupes ne se lisent pas) ; ailleurs : rang au classement général
  const rank = lg.national ? groupTables(finishedCur, (cur.upcoming || []).map((u) => [u[1], u[2]])) || new Map() : new Map(table.map((r) => [r.id, r]));
  const names = { ...extraNames, ...(prev?.teams || {}), ...cur.teams };

  const national = lg.national ? await nationalContext(env, finishedCur, cur.teams) : null;
  const upcoming = toUpcoming(cur, provider).sort((a, b) => a.ts - b.ts).slice(0, 10);
  const predictions = upcoming.map((m) => {
    const p = calculate_match_prediction(m, { model, leagueId, season, domestic, national });
    for (const side of ["domicile", "exterieur"]) {
      const team = p.teams[side];
      const st = teamStats(team.id, formePool);
      if (st) for (const f of st.formeDetail) { f.logo = names[f.adversaire]?.[1] || null; f.adversaire = names[f.adversaire]?.[0] || f.adversaire; }
      const row = rank.get(team.id);
      team.stats = st;
      team.classement = row ? { rang: row.rang, points: row.pts, joues: row.j, diff: row.diff, ...(row.groupe ? { groupe: true } : {}) } : null;
    }
    return p;
  });

  return {
    success: true,
    leagueId,
    season,
    count: predictions.length,
    modele: {
      version: VERSION,
      matchsAnalyses: model.matchesAnalysed,
      moyenneButsDom: r3(model.avgHome),
      moyenneButsExt: r3(model.avgAway),
      donneesMisesAJour: new Date(cur.updatedAt).toISOString(),
      source: secours ? "secours" : "principale",
      ...(domesticStatus.length ? { championnatsUtilises: domesticStatus } : {}),
      ...(national ? { selections: { notesAu: national.asOf, inconnues: [...national.unknown] } } : {}),
    },
    classement: table.map((r) => ({ rang: r.rang, id: r.id, nom: names[r.id]?.[0] || r.id, logo: names[r.id]?.[1] || null, joues: r.j, v: r.v, n: r.n, d: r.d, bp: r.bp, bc: r.bc, diff: r.diff, points: r.pts })),
    predictions,
  };
}

// ---------- Archive (pronostics figés au coup d'envoi) ----------
// Entrée : { id, ts, h:[nom, logo], a:[nom, logo], p:[p1,pN,p2], o25, btts, l:[lD,lE], src }
// Mise à jour tant que le match n'a pas commencé ; ensuite plus jamais modifiée.
const ARCHIVE_DAYS = 120;
export function mergeArchive(archive, result, now) {
  const out = { ...(archive || {}) };
  for (const p of result.predictions) {
    const ts = Date.parse(p.date);
    if (ts <= now) continue; // déjà commencé : figé
    out[p.matchId] = {
      id: p.matchId, ts,
      h: [p.teams.domicile.name, p.teams.domicile.logo], a: [p.teams.exterieur.name, p.teams.exterieur.logo],
      p: [p.poisson.proba1, p.poisson.probaN, p.poisson.proba2], o25: p.poisson.probaOver25, btts: p.poisson.probaBTTS,
      l: [p.lambdas.lambdaDom, p.lambdas.lambdaExt], src: p.source,
    };
  }
  for (const [id, e] of Object.entries(out)) if (now - e.ts > ARCHIVE_DAYS * 86400000) delete out[id];
  return out;
}

// ---------- Verdict ----------
const pick1N2 = (p) => (p[0] >= p[1] && p[0] >= p[2] ? "1" : p[2] >= p[1] ? "2" : "N");
const dcOf = (p) => [["1X", p[0] + p[1]], ["X2", p[1] + p[2]], ["12", p[0] + p[2]]].sort((x, y) => y[1] - x[1])[0][0];

export async function buildVerdict(env, leagueIds, season, now = Date.now(), days = 30) {
  const out = [];
  for (const id of leagueIds) {
    const lg = LEAGUES[id];
    if (!lg) continue;
    const archive = await kvGet(env, archiveKey(id, season));
    if (!archive) continue;
    const scores = new Map();
    for (const s of [lg.src, lg.backup].filter(Boolean)) {
      const data = await kvGet(env, srcKey(s, season));
      for (const f of data?.finished || []) scores.set(String(f[0]), [f[3], f[4]]);
    }
    for (const e of Object.values(archive)) {
      const sc = scores.get(String(e.id));
      if (!sc || now - e.ts > days * 86400000) continue;
      const [hg, ag] = sc;
      const res = hg > ag ? "1" : hg < ag ? "2" : "N";
      const prono = pick1N2(e.p), dc = dcOf(e.p);
      out.push({
        matchId: e.id, leagueId: id, competition: lg.name, date: new Date(e.ts).toISOString(),
        domicile: { nom: e.h[0], logo: e.h[1] }, exterieur: { nom: e.a[0], logo: e.a[1] },
        score: { dom: hg, ext: ag },
        moteur: { prono, proba: e.p[prono === "1" ? 0 : prono === "N" ? 1 : 2], doubleChance: dc, plus25: e.o25 },
        juste: { "1N2": prono === res, doubleChance: dc.includes(res), plusMoins25: (e.o25 >= 0.5) === (hg + ag > 2.5) },
        brier: ["1", "N", "2"].reduce((s, k, i) => s + (e.p[i] - (k === res ? 1 : 0)) ** 2, 0),
      });
    }
  }
  out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const n = out.length, pct = (k) => (n ? Math.round((100 * out.filter((x) => x.juste[k]).length) / n) : null);
  // Erreur de Brier : 0 = parfait, 0,667 = « un tiers partout ». Plus c'est bas, mieux c'est.
  const brier = n ? Math.round((1000 * out.reduce((s, x) => s + x.brier, 0)) / n) / 1000 : null;
  for (const x of out) delete x.brier;
  return { success: true, periodeJours: days, bilan: { matchs: n, "1N2": pct("1N2"), doubleChance: pct("doubleChance"), plusMoins25: pct("plusMoins25"), brier }, matchs: out.slice(0, 60) };
}

// ---------- Face-à-face (depuis les données stockées, aucun appel API) ----------
function orient(list, teamDomId, teamExtId, names) {
  const seen = new Set();
  return list
    .filter((f) => (f.homeId === teamDomId && f.awayId === teamExtId) || (f.homeId === teamExtId && f.awayId === teamDomId))
    .sort((a, b) => b.ts - a.ts)
    .filter((f) => { const k = `${f.ts}-${f.hg}-${f.ag}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 5)
    .map((f) => {
      const domAtHome = f.homeId === teamDomId;
      const sd = domAtHome ? f.hg : f.ag, se = domAtHome ? f.ag : f.hg;
      return {
        date: new Date(f.ts).toISOString().slice(0, 10),
        scoreDom: sd, scoreExt: se,
        vainqueur: sd > se ? "domicile" : sd < se ? "exterieur" : "nul",
        lieu: domAtHome ? "domicile" : "exterieur",
        equipeDomicile: names?.[f.homeId]?.[0] || null,
        equipeExterieur: names?.[f.awayId]?.[0] || null,
        butsDomicile: f.hg, butsExterieur: f.ag,
      };
    });
}

export async function getH2H(env, { source, teamDomId, teamExtId, leagueId }, season) {
  const provider = source === "football-data" ? "fd:" : "espn:";
  const keys = new Set();
  // Économie de quota : seulement les données de la compétition du match (2 à 11 lectures au lieu de 40)
  const leagues = leagueId && LEAGUES[leagueId] ? [LEAGUES[leagueId]] : Object.values(LEAGUES);
  for (const lg of leagues) {
    for (const s of [lg.src, lg.backup].filter((x) => x && x.startsWith(provider))) {
      keys.add(srcKey(s, season)); if (!lg.cup) keys.add(srcKey(s, season - 1));
    }
    for (const d of (lg.domestic || []).filter((x) => x.startsWith(provider))) keys.add(srcKey(d, season));
  }
  const srcs = (await Promise.all([...keys].map((k) => kvGet(env, k)))).filter(Boolean);
  const all = [], names = {};
  for (const s of srcs) { all.push(...toFinished(s)); Object.assign(names, s.teams); }
  return { h2h: orient(all, String(teamDomId), String(teamExtId), names) };
}
