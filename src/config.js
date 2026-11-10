// ============================================================
// DUEL PRONO — Configuration centrale
// ============================================================

export const VERSION = "v7";

export const MODEL = {
  windowMatches: 40,     // règle du projet : les 40 derniers matchs de chaque équipe…
  recentMatches: 5,      // …dont les 5 plus récents…
  recentWeight: 2,       // …comptent double
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

// Logo officiel de chaque compétition (images ESPN, comme les logos des clubs)
const logo = (n) => `https://a.espncdn.com/i/leaguelogos/soccer/500/${n}.png`;

// leagueId (utilisé par le site) -> source de données
export const LEAGUES = {
  61: { name: "Ligue 1", logo: logo(9), country: "France", src: "fd:FL1", backup: "espn:fra.1" },
  39: { name: "Premier League", logo: logo(23), country: "Angleterre", src: "fd:PL", backup: "espn:eng.1" },
  140: { name: "LaLiga", logo: logo(15), country: "Espagne", src: "fd:PD", backup: "espn:esp.1" },
  135: { name: "Serie A", logo: logo(12), country: "Italie", src: "fd:SA", backup: "espn:ita.1" },
  78: { name: "Bundesliga", logo: logo(10), country: "Allemagne", src: "fd:BL1", backup: "espn:ger.1" },
  94: { name: "Liga Portugal", logo: logo(14), country: "Portugal", src: "fd:PPL", backup: "espn:por.1" },
  88: { name: "Eredivisie", logo: logo(11), country: "Pays-Bas", src: "fd:DED", backup: "espn:ned.1" },
  40: { name: "Championship", logo: logo(24), country: "Angleterre", src: "fd:ELC", backup: "espn:eng.2" },
  71: { name: "Brasileirão", logo: logo(85), country: "Brésil", src: "fd:BSA", backup: "espn:bra.1" },
  2: { name: "Ligue des champions", logo: logo(2), country: "Europe", src: "fd:CL", backup: "espn:uefa.champions", cup: true, domestic: FD_DOMESTIC },
  62: { name: "Ligue 2", logo: logo(96), country: "France", src: "espn:fra.2" },
  3: { name: "Europa League", logo: logo(2310), country: "Europe", src: "espn:uefa.europa", cup: true, domestic: ESPN_DOMESTIC },
  848: { name: "Conference League", logo: logo(20296), country: "Europe", src: "espn:uefa.europa.conf", cup: true, domestic: ESPN_DOMESTIC },
  5: { name: "Ligue des Nations", logo: logo(2395), country: "Europe", src: "espn:uefa.nations", cup: true },
  15: { name: "Coupe du monde", logo: logo(4), country: "Monde", src: "fd:WC", cup: true, robot: false },
  4: { name: "Euro", logo: logo(74), country: "Europe", src: "fd:EC", cup: true, robot: false },
};

export function currentSeason(now = new Date()) {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

// Toutes les sources que le robot entretient, avec la saison et la priorité
export function robotSources(season) {
  const list = new Map();
  // main : source principale d'une compétition affichée (chargée avant les sources de secours)
  const add = (src, s, kind, main = false) => { const k = `${src}@${s}`; if (!list.has(k)) list.set(k, { src, season: s, kind, main }); else if (main) list.get(k).main = true; };
  for (const lg of Object.values(LEAGUES)) {
    if (lg.robot === false) continue;
    add(lg.src, season, "live", true);
    if (!lg.cup) add(lg.src, season - 1, "history"); // saison précédente : Elo + forces + face-à-face
    if (lg.backup) add(lg.backup, season, "live");   // source de secours (ESPN) si football-data tombe
  }
  for (const d of ESPN_DOMESTIC) add(d, season, "live");
  return [...list.values()];
}

// Ligues dont le calcul dépend d'une source (pour recalculer après une mise à jour)
export function leaguesUsing(src) {
  return Object.entries(LEAGUES)
    .filter(([, lg]) => lg.robot !== false && (lg.src === src || lg.backup === src || (lg.domestic || []).includes(src)))
    .map(([id]) => Number(id));
}

// Bascule sur la source de secours si la principale est en erreur depuis plus de 12 h
export const BACKUP_AFTER_MS = 12 * 3600000;
