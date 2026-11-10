// ============================================================
// PRONO ARENA — Configuration centrale
// ============================================================

export const VERSION = "v7";

export const MODEL = {
  halfLifeDays: 120,     // un match d'il y a 4 mois compte moitié moins
  priorMatches: 3,       // lissage vers la moyenne (évite les extrêmes)
  specificWeight: 0.3,   // part domicile/extérieur spécifique vs global
  defaultAvgHome: 1.45,
  defaultAvgAway: 1.15,
  minLeagueMatches: 30,
  rho: -0.08,            // correction Dixon-Coles
  maxGoalsCalc: 10,
  maxGoalsMatrix: 5,
  lambdaMin: 0.2,
  lambdaMax: 4.0,
  eloStart: 1500,
  eloK: 20,
  eloHomeAdv: 60,
  eloSeasonCarry: 0.8,   // entre deux saisons, l'Elo revient de 20 % vers 1500
  cupDomesticPrior: 6,   // en coupe : nb de matchs de coupe pour peser autant que le championnat
  unknownLeagueCoef: 0.72,
};

// Niveau relatif des championnats (pour comparer les équipes en coupe d'Europe)
// Ordre inspiré du classement UEFA ; 1 = Premier League.
export const LEAGUE_COEF = {
  "fd:PL": 1.0, "espn:eng.1": 1.0,
  "fd:PD": 0.96, "espn:esp.1": 0.96,
  "fd:SA": 0.94, "espn:ita.1": 0.94,
  "fd:BL1": 0.94, "espn:ger.1": 0.94,
  "fd:FL1": 0.88, "espn:fra.1": 0.88,
  "fd:PPL": 0.84, "espn:por.1": 0.84,
  "fd:DED": 0.82, "espn:ned.1": 0.82,
  "espn:bel.1": 0.78, "espn:tur.1": 0.76, "espn:sco.1": 0.72,
};

const FD_DOMESTIC = ["fd:PL", "fd:PD", "fd:SA", "fd:BL1", "fd:FL1", "fd:PPL", "fd:DED"];
const ESPN_DOMESTIC = ["espn:eng.1", "espn:esp.1", "espn:ita.1", "espn:ger.1", "espn:fra.1", "espn:por.1", "espn:ned.1", "espn:bel.1", "espn:tur.1", "espn:sco.1"];

// leagueId (utilisé par le site) -> source de données
export const LEAGUES = {
  61: { name: "Ligue 1", src: "fd:FL1" },
  39: { name: "Premier League", src: "fd:PL" },
  140: { name: "LaLiga", src: "fd:PD" },
  135: { name: "Serie A", src: "fd:SA" },
  78: { name: "Bundesliga", src: "fd:BL1" },
  94: { name: "Liga Portugal", src: "fd:PPL" },
  88: { name: "Eredivisie", src: "fd:DED" },
  40: { name: "Championship", src: "fd:ELC" },
  71: { name: "Brasileirão", src: "fd:BSA" },
  2: { name: "Ligue des champions", src: "fd:CL", cup: true, domestic: FD_DOMESTIC },
  62: { name: "Ligue 2", src: "espn:fra.2" },
  3: { name: "Europa League", src: "espn:uefa.europa", cup: true, domestic: ESPN_DOMESTIC },
  848: { name: "Conference League", src: "espn:uefa.europa.conf", cup: true, domestic: ESPN_DOMESTIC },
  5: { name: "Ligue des Nations", src: "espn:uefa.nations", cup: true },
  15: { name: "Coupe du monde", src: "fd:WC", cup: true, robot: false },
  4: { name: "Euro", src: "fd:EC", cup: true, robot: false },
};

export function currentSeason(now = new Date()) {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

// Toutes les sources que le robot entretient, avec la saison et la priorité
export function robotSources(season) {
  const list = new Map();
  const add = (src, s, kind) => { const k = `${src}@${s}`; if (!list.has(k)) list.set(k, { src, season: s, kind }); };
  for (const lg of Object.values(LEAGUES)) {
    if (lg.robot === false) continue;
    add(lg.src, season, "live");
    if (!lg.cup) add(lg.src, season - 1, "history"); // saison précédente : Elo + forces + face-à-face
  }
  for (const d of ESPN_DOMESTIC) add(d, season, "live");
  return [...list.values()];
}

// Ligues dont le calcul dépend d'une source (pour recalculer après une mise à jour)
export function leaguesUsing(src) {
  return Object.entries(LEAGUES)
    .filter(([, lg]) => lg.robot !== false && (lg.src === src || (lg.domestic || []).includes(src)))
    .map(([id]) => Number(id));
}
