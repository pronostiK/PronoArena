/**
 * PRONO ARENA - Worker (V6 : moteur de calcul réel)
 *
 * Nouveautés V6 :
 *  - Forces d'attaque / défense calculées pour chaque équipe à partir des matchs
 *    joués de la saison (domicile et extérieur séparés, matchs récents plus lourds).
 *  - Elo réel calculé sur la saison (fini le 1500 pour tout le monde).
 *  - Poisson avec correction Dixon-Coles (scores serrés 0-0, 1-0, 0-1, 1-1).
 *  - Nouveaux marchés : doubles chances (1X, X2, 12), +/- 1,5 et 3,5 buts, score le plus probable.
 *  - Indicateur de fiabilité selon le nombre de matchs analysés.
 *  - Format de réponse identique à la V5 (champs ajoutés, aucun champ supprimé).
 */

const CORS_HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

// ---------- Réglages du modèle ----------
const MODEL = {
  version: "v6",
  halfLifeDays: 120,     // un match d'il y a 4 mois compte moitié moins qu'un match d'hier
  priorMatches: 3,       // "matchs fictifs" moyens ajoutés à chaque équipe (évite les extrêmes en début de saison)
  specificWeight: 0.3,   // part des stats domicile/extérieur spécifiques vs stats globales
  defaultAvgHome: 1.45,  // moyennes de secours si la compétition a trop peu de matchs joués
  defaultAvgAway: 1.15,
  minLeagueMatches: 30,
  rho: -0.08,            // correction Dixon-Coles
  maxGoalsCalc: 10,      // calcul interne jusqu'à 10 buts
  maxGoalsMatrix: 5,     // matrice renvoyée au site : 0 à 5 buts (comme avant)
  lambdaMin: 0.2,
  lambdaMax: 4.0,
  eloStart: 1500,
  eloK: 20,
  eloHomeAdv: 60,
};

// ---------- Poisson + Dixon-Coles ----------
const factorialCache = [1, 1, 2, 6, 24, 120];
function factorial(n) {
  if (factorialCache[n] !== undefined) return factorialCache[n];
  let r = factorialCache[factorialCache.length - 1];
  for (let i = factorialCache.length; i <= n; i++) { r *= i; factorialCache[i] = r; }
  return r;
}
function poissonProb(lambda, k) {
  if (lambda === 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}
function dcTau(i, j, l1, l2, rho) {
  if (i === 0 && j === 0) return 1 - l1 * l2 * rho;
  if (i === 0 && j === 1) return 1 + l1 * rho;
  if (i === 1 && j === 0) return 1 + l2 * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}
const r3 = (x) => Math.round(x * 1000) / 1000;

function calculate_poisson_match(lambdaDom, lambdaExt, rho = MODEL.rho) {
  const N = MODEL.maxGoalsCalc;
  const pD = [], pE = [];
  for (let k = 0; k <= N; k++) { pD.push(poissonProb(lambdaDom, k)); pE.push(poissonProb(lambdaExt, k)); }

  const m = [];
  let total = 0;
  for (let i = 0; i <= N; i++) {
    m[i] = [];
    for (let j = 0; j <= N; j++) {
      const p = Math.max(0, pD[i] * pE[j] * dcTau(i, j, lambdaDom, lambdaExt, rho));
      m[i][j] = p; total += p;
    }
  }

  let p1 = 0, pN = 0, p2 = 0, o15 = 0, o25 = 0, o35 = 0, btts = 0;
  let best = { i: 0, j: 0, p: 0 };
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const p = m[i][j] / total;
    m[i][j] = p;
    if (i > j) p1 += p; else if (i === j) pN += p; else p2 += p;
    const g = i + j;
    if (g > 1.5) o15 += p;
    if (g > 2.5) o25 += p;
    if (g > 3.5) o35 += p;
    if (i > 0 && j > 0) btts += p;
    if (p > best.p) best = { i, j, p };
  }

  const M = MODEL.maxGoalsMatrix;
  return {
    matrix: m.slice(0, M + 1).map((row) => row.slice(0, M + 1).map((p) => Math.round(p * 10000) / 10000)),
    proba1: r3(p1),
    probaN: r3(pN),
    proba2: r3(p2),
    proba1X: r3(p1 + pN),
    probaX2: r3(pN + p2),
    proba12: r3(p1 + p2),
    probaOver15: r3(o15),
    probaUnder15: r3(1 - o15),
    probaOver25: r3(o25),
    probaUnder25: r3(1 - o25),
    probaOver35: r3(o35),
    probaUnder35: r3(1 - o35),
    probaBTTS: r3(btts),
    probaNoBTTS: r3(1 - btts),
    scoreProbable: { dom: best.i, ext: best.j, proba: r3(best.p) },
  };
}

// ---------- Forces des équipes ----------
// finished : [{ homeId, awayId, hg, ag, date }]
function computeTeamRatings(finished, now = Date.now()) {
  const decay = (date) => {
    const ageDays = Math.max(0, (now - new Date(date).getTime()) / 86400000);
    return Math.pow(0.5, ageDays / MODEL.halfLifeDays);
  };

  let sumW = 0, sumHG = 0, sumAG = 0;
  for (const f of finished) { const w = decay(f.date); sumW += w; sumHG += w * f.hg; sumAG += w * f.ag; }

  // Moyennes de la compétition (mélangées avec les valeurs de secours si peu de matchs)
  const n = finished.length;
  const blend = Math.min(1, n / MODEL.minLeagueMatches);
  const rawH = sumW > 0 ? sumHG / sumW : MODEL.defaultAvgHome;
  const rawA = sumW > 0 ? sumAG / sumW : MODEL.defaultAvgAway;
  const avgHome = Math.max(0.5, blend * rawH + (1 - blend) * MODEL.defaultAvgHome);
  const avgAway = Math.max(0.4, blend * rawA + (1 - blend) * MODEL.defaultAvgAway);

  const teams = {};
  const T = (id) => (teams[id] ||= { hf: 0, ha: 0, hw: 0, af: 0, aa: 0, aw: 0, played: 0 });
  for (const f of finished) {
    const w = decay(f.date);
    const h = T(f.homeId), a = T(f.awayId);
    // buts normalisés par la moyenne de la compétition
    h.hf += w * f.hg / avgHome; h.ha += w * f.ag / avgAway; h.hw += w; h.played++;
    a.af += w * f.ag / avgAway; a.aa += w * f.hg / avgHome; a.aw += w; a.played++;
  }

  const K = MODEL.priorMatches, s = MODEL.specificWeight;
  const ratings = {};
  for (const [id, t] of Object.entries(teams)) {
    const attAll = (t.hf + t.af + K) / (t.hw + t.aw + K);
    const defAll = (t.ha + t.aa + K) / (t.hw + t.aw + K);
    ratings[id] = {
      attHome: s * (t.hf + K) / (t.hw + K) + (1 - s) * attAll,
      defHome: s * (t.ha + K) / (t.hw + K) + (1 - s) * defAll,
      attAway: s * (t.af + K) / (t.aw + K) + (1 - s) * attAll,
      defAway: s * (t.aa + K) / (t.aw + K) + (1 - s) * defAll,
      played: t.played,
    };
  }
  return { avgHome, avgAway, ratings, matchesAnalysed: n };
}

function computeElo(finished) {
  const elo = {};
  const get = (id) => (elo[id] ??= MODEL.eloStart);
  const sorted = [...finished].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const f of sorted) {
    const rh = get(f.homeId), ra = get(f.awayId);
    const exp = 1 / (1 + Math.pow(10, (ra - (rh + MODEL.eloHomeAdv)) / 400));
    const res = f.hg > f.ag ? 1 : f.hg === f.ag ? 0.5 : 0;
    const mov = 1 + Math.log(1 + Math.abs(f.hg - f.ag));
    const d = MODEL.eloK * mov * (res - exp);
    elo[f.homeId] = rh + d;
    elo[f.awayId] = ra - d;
  }
  return elo;
}

function buildModel(finished) {
  return { ...computeTeamRatings(finished), elo: computeElo(finished) };
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const NEUTRAL = { attHome: 1, defHome: 1, attAway: 1, defAway: 1, played: 0 };

function fiabilite(minPlayed) {
  if (minPlayed >= 8) return "élevée";
  if (minPlayed >= 4) return "moyenne";
  return "faible";
}

function calculate_match_prediction(match, leagueId, season, model) {
  const dom = model.ratings[match.teamDomId] || NEUTRAL;
  const ext = model.ratings[match.teamExtId] || NEUTRAL;

  const lambdaDom = r3(clamp(model.avgHome * dom.attHome * ext.defAway, MODEL.lambdaMin, MODEL.lambdaMax));
  const lambdaExt = r3(clamp(model.avgAway * ext.attAway * dom.defHome, MODEL.lambdaMin, MODEL.lambdaMax));
  const poisson = calculate_poisson_match(lambdaDom, lambdaExt);

  const cote = (p) => (p > 0 ? Math.round((1 / p) * 100) / 100 : null);
  const eloDom = Math.round(model.elo[match.teamDomId] ?? MODEL.eloStart);
  const eloExt = Math.round(model.elo[match.teamExtId] ?? MODEL.eloStart);

  return {
    matchId: match.matchId,
    leagueId,
    season,
    date: match.date,
    status: match.status || "SCHEDULED",
    source: match.source,
    teams: {
      domicile: { id: match.teamDomId, name: match.domName, logo: match.domLogo, elo: eloDom },
      exterieur: { id: match.teamExtId, name: match.extName, logo: match.extLogo, elo: eloExt },
    },
    lambdas: { lambdaDom, lambdaExt },
    poisson,
    cotesJustes: {
      cote1: cote(poisson.proba1),
      coteN: cote(poisson.probaN),
      cote2: cote(poisson.proba2),
      cote1X: cote(poisson.proba1X),
      coteX2: cote(poisson.probaX2),
      cote12: cote(poisson.proba12),
    },
    donnees: {
      modele: MODEL.version,
      matchsDomicile: dom.played,
      matchsExterieur: ext.played,
      matchsCompetition: model.matchesAnalysed,
      fiabilite: fiabilite(Math.min(dom.played, ext.played)),
    },
  };
}

// ---------- Sources de données ----------
const LEAGUE_CODE_MAP = { 61: "FL1", 39: "PL", 140: "PD", 135: "SA", 78: "BL1", 94: "PPL", 88: "DED", 2: "CL", 40: "ELC", 71: "BSA", 15: "WC", 4: "EC" };
// Codes ESPN corrigés (la V5 utilisait "uef.europa" / "fif.nations", qui n'existent pas)
const ESPN_MAP = { 62: "fra.2", 3: "uefa.europa", 848: "uefa.europa.conf", 5: "uefa.nations" };

const FD_UPCOMING = ["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "LIVE"];

async function getFootballDataLeague(code, season, key) {
  const url = `https://api.football-data.org/v4/competitions/${code}/matches?season=${season}`;
  const res = await fetch(url, { headers: { "X-Auth-Token": key } });
  if (!res.ok) throw new Error(`Erreur football-data.org [${res.status}]`);
  const data = await res.json();
  const all = data.matches || [];

  const finished = all
    .filter((m) => m.status === "FINISHED" && m.score?.fullTime?.home != null && m.score?.fullTime?.away != null)
    .map((m) => ({ homeId: String(m.homeTeam.id), awayId: String(m.awayTeam.id), hg: m.score.fullTime.home, ag: m.score.fullTime.away, date: m.utcDate }));

  const upcoming = all
    .filter((m) => FD_UPCOMING.includes(m.status) && m.homeTeam?.id && m.awayTeam?.id)
    .map((m) => ({
      matchId: m.id,
      teamDomId: String(m.homeTeam.id),
      teamExtId: String(m.awayTeam.id),
      domName: m.homeTeam.name,
      extName: m.awayTeam.name,
      domLogo: m.homeTeam.crest,
      extLogo: m.awayTeam.crest,
      date: m.utcDate,
      status: m.status,
      source: "football-data",
    }));

  return { finished, upcoming };
}

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

async function fetchEspnRange(leagueKey, from, to) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueKey}/scoreboard?dates=${ymd(from)}-${ymd(to)}&limit=1000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erreur ESPN [${res.status}]`);
  const data = await res.json();
  return data.events || [];
}

const ESPN_SKIP = ["STATUS_CANCELED", "STATUS_POSTPONED", "STATUS_ABANDONED", "STATUS_FORFEIT"];

async function getEspnLeague(leagueKey, season) {
  const now = new Date();
  const seasonStart = new Date(Date.UTC(season, 6, 1)); // 1er juillet de la saison
  const in30 = new Date(now.getTime() + 30 * 86400000);

  const [past, future] = await Promise.all([
    fetchEspnRange(leagueKey, seasonStart, now).catch(() => []),
    fetchEspnRange(leagueKey, now, in30).catch(() => []),
  ]);

  const parse = (ev) => {
    const comp = ev.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === "home");
    const away = comp?.competitors?.find((c) => c.homeAway === "away");
    return { ev, home, away, type: ev.status?.type };
  };

  const finished = [];
  const upcoming = [];
  const seen = new Set();

  for (const ev of [...past, ...future]) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    const { home, away, type } = parse(ev);
    if (!home || !away) continue;
    const status = type?.name || "STATUS_SCHEDULED";
    if (ESPN_SKIP.includes(status)) continue;

    if (type?.completed) {
      const hg = parseInt(home.score, 10), ag = parseInt(away.score, 10);
      if (Number.isFinite(hg) && Number.isFinite(ag)) {
        finished.push({ homeId: String(home.id), awayId: String(away.id), hg, ag, date: ev.date });
      }
    } else {
      upcoming.push({
        matchId: ev.id,
        teamDomId: String(home.id),
        teamExtId: String(away.id),
        domName: home.team?.displayName || "Domicile",
        extName: away.team?.displayName || "Extérieur",
        domLogo: home.team?.logo || null,
        extLogo: away.team?.logo || null,
        date: ev.date,
        status,
        source: "espn",
      });
    }
  }
  return { finished, upcoming };
}

async function getLeagueData(leagueId, season, env) {
  if (LEAGUE_CODE_MAP[leagueId]) return getFootballDataLeague(LEAGUE_CODE_MAP[leagueId], season, env.FOOTBALL_DATA_KEY);
  if (ESPN_MAP[leagueId]) return getEspnLeague(ESPN_MAP[leagueId], season);
  return { finished: [], upcoming: [] };
}

// ---------- H2H (inchangé, sera retravaillé à l'étape 2) ----------
async function getRealStatsAndH2H(matchId, source, teamDomId, teamExtId, env) {
  const cacheKey = `h2h-data-${matchId}`;
  if (env.PRONO_CACHE) {
    const cached = await env.PRONO_CACHE.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  let stats = { domicile: {}, exterieur: {} };
  let h2h = [];

  try {
    if (source === "football-data") {
      const url = `https://api.football-data.org/v4/matches/${matchId}/head2head`;
      const response = await fetch(url, { headers: { "X-Auth-Token": env.FOOTBALL_DATA_KEY } });
      if (response.ok) {
        const data = await response.json();
        if (data.matches && data.matches.length > 0) {
          h2h = data.matches.slice(0, 5).map((m) => {
            let vainqueur = "nul";
            if (m.score.winner === "HOME_TEAM") vainqueur = String(m.homeTeam.id) === String(teamDomId) ? "domicile" : "exterieur";
            if (m.score.winner === "AWAY_TEAM") vainqueur = String(m.awayTeam.id) === String(teamExtId) ? "exterieur" : "domicile";
            return {
              date: m.utcDate ? m.utcDate.split("T")[0] : "Date inconnue",
              scoreDom: m.score.fullTime.home !== null ? m.score.fullTime.home : "-",
              scoreExt: m.score.fullTime.away !== null ? m.score.fullTime.away : "-",
              vainqueur,
            };
          });
        }
      }
    }
  } catch (error) {
    console.warn(`Erreur stats match ${matchId}`, error);
  }

  const result = { stats, h2h };
  if (env.PRONO_CACHE && h2h.length > 0) {
    await env.PRONO_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 });
  }
  return result;
}

// ---------- Routes ----------
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: CORS_HEADERS });

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, "") || "/";

    if (pathname === "/league-predictions") {
      try {
        const leagueId = parseInt(url.searchParams.get("leagueId"));
        const season = parseInt(url.searchParams.get("season") || "2026");
        if (!leagueId) throw new Error("LeagueId manquant.");

        const cacheKey = `league-preds-v6:${leagueId}:${season}`;
        if (env.PRONO_CACHE) {
          const cached = await env.PRONO_CACHE.get(cacheKey);
          if (cached) return new Response(cached, { headers: CORS_HEADERS });
        }

        const { finished, upcoming } = await getLeagueData(leagueId, season, env);
        const model = buildModel(finished);

        const next = upcoming.sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 10);
        const predictions = next.map((m) => calculate_match_prediction(m, leagueId, season, model));

        const finalResult = {
          success: true,
          leagueId,
          season,
          count: predictions.length,
          modele: { version: MODEL.version, matchsAnalyses: model.matchesAnalysed, moyenneButsDom: r3(model.avgHome), moyenneButsExt: r3(model.avgAway) },
          predictions,
        };
        const body = JSON.stringify(finalResult);
        if (env.PRONO_CACHE) {
          ctx?.waitUntil?.(env.PRONO_CACHE.put(cacheKey, body, { expirationTtl: 600 }));
        }
        return new Response(body, { headers: CORS_HEADERS });
      } catch (err) {
        return json({ success: false, error: err.message }, 400);
      }
    }

    if (pathname === "/match-details") {
      try {
        const matchId = url.searchParams.get("matchId");
        const source = url.searchParams.get("source");
        const teamDomId = url.searchParams.get("teamDomId");
        const teamExtId = url.searchParams.get("teamExtId");
        if (!matchId || !source) throw new Error("Paramètres manquants");
        const realData = await getRealStatsAndH2H(matchId, source, teamDomId, teamExtId, env);
        return json({ success: true, stats: realData.stats, h2h: realData.h2h });
      } catch (err) {
        return json({ success: false, error: err.message }, 400);
      }
    }

    return json({ success: false, error: "Route inconnue" }, 404);
  },
};

// Exporté pour les tests
export { calculate_poisson_match, computeTeamRatings, computeElo, buildModel, calculate_match_prediction };
