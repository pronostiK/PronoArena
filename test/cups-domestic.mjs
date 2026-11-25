// Test : Ligue des champions + championnats ESPN (Turquie, Belgique, Écosse) via la correspondance d'identifiants
import { buildLeague } from "../src/build.js";
import { srcKey } from "../src/sources.js";
import { COMPOS_KEY } from "../src/compos.js";

let ok = 0, ko = 0;
const check = (name, cond, info = "") => { cond ? ok++ : ko++; console.log(`${cond ? "OK   " : "ÉCHEC"} ${name}${info ? "  → " + info : ""}`); };

const NOW = Date.UTC(2026, 10, 22, 12, 0), DAY = 86400000;
const mkEnv = (store) => ({ PRONO_CACHE: { get: async (k) => (k in store ? store[k] : null), put: async (k, v) => { store[k] = v; } } });
const put = (store, k, v) => { store[k] = JSON.stringify(v); };

// Ligue des champions (football-data) : équipe 10 = club turc, 11 = club d'un pays sans données, 12 à 17 = autres
const clTeams = {}; for (let i = 10; i <= 17; i++) clTeams[i] = [`Club ${i}`, null];
const clFinished = [];
let mid = 1;
// 4 matchs chacun, résultats médiocres pour 10 et 11 : sur la seule coupe, les deux équipes se valent
for (const [h, a, hg, ag] of [[10, 12, 1, 1], [13, 10, 1, 1], [10, 14, 1, 1], [15, 10, 1, 1], [11, 16, 1, 1], [17, 11, 1, 1], [11, 12, 1, 1], [13, 11, 1, 1], [12, 14, 1, 0], [16, 15, 2, 1], [14, 17, 1, 2], [15, 13, 0, 1]])
  clFinished.push([mid++, String(h), String(a), hg, ag, NOW - (30 - mid) * DAY]);
const cl = { teams: clTeams, finished: clFinished, upcoming: [[900, "10", "11", NOW + 2 * DAY, "TIMED"]], updatedAt: NOW, complete: true };

// Championnat de Turquie (ESPN) : l'équipe turque « t1 » (= 10 chez football-data) y domine
const turTeams = { t1: ["Club 10", null] }, turFinished = [];
for (let i = 2; i <= 10; i++) turTeams[`t${i}`] = [`Turc ${i}`, null];
let k = 5000;
for (let i = 2; i <= 10; i++) { turFinished.push([k++, "t1", `t${i}`, 4, 0, NOW - (60 - i) * DAY]); turFinished.push([k++, `t${i}`, "t1", 0, 3, NOW - (40 - i) * DAY]); }
for (let i = 2; i <= 9; i++) turFinished.push([k++, `t${i}`, `t${i + 1}`, 1, 1, NOW - (20 - i) * DAY]);
const tur = { teams: turTeams, finished: turFinished, upcoming: [], updatedAt: NOW, complete: true };

const season = 2026;
const run = async (idmap) => {
  const store = {};
  put(store, srcKey("fd:CL", season), cl);
  put(store, srcKey("espn:tur.1", season), tur);
  if (idmap) put(store, COMPOS_KEY, { idmap, idmapAt: NOW, teams: {} });
  const r = await buildLeague(mkEnv(store), 2, season, NOW, {});
  return r;
};

const sans = await run(null);
const avec = await run({ 10: "t1" });
const pS = sans.predictions[0].poisson, pA = avec.predictions[0].poisson;

check("sans correspondance : calcul d'avant inchangé (aucune équipe retrouvée)", sans.modele.championnatsUtilises?.find((x) => x.source === "espn:tur.1")?.equipesRetrouvees === 0);
check("avec correspondance : l'équipe turque est retrouvée", avec.modele.championnatsUtilises.find((x) => x.source === "espn:tur.1")?.equipesRetrouvees >= 1, JSON.stringify(avec.modele.championnatsUtilises.find((x) => x.source === "espn:tur.1")));
check("le club turc dominant en Turquie est plus favori qu'avec la seule coupe", pA.proba1 > pS.proba1 + 0.03, `${(pS.proba1 * 100).toFixed(1)} % → ${(pA.proba1 * 100).toFixed(1)} %`);
check("probabilités cohérentes (somme = 1)", Math.abs(pA.proba1 + pA.probaN + pA.proba2 - 1) < 0.002);
check("source ESPN absente : aucune erreur, calcul d'avant", await (async () => { const store = {}; put(store, srcKey("fd:CL", season), cl); put(store, COMPOS_KEY, { idmap: { 10: "t1" }, idmapAt: NOW, teams: {} }); const r = await buildLeague(mkEnv(store), 2, season, NOW, {}); return Math.abs(r.predictions[0].poisson.proba1 - pS.proba1) < 1e-9; })());

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
