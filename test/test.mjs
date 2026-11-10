// Tests Prono Arena V7 : robot, pronostics, stats, coupes, face-à-face, état, limites Cloudflare gratuites
import { NOW, STRENGTH, installFetch, makeKV, calls } from "./sim.mjs";
import worker from "../src/index.js";
import { runRobot } from "../src/robot.js";
import { robotSources } from "../src/config.js";
import { calculate_poisson_match } from "../src/model.js";

let ok = 0, ko = 0;
const check = (name, cond, info = "") => { cond ? ok++ : ko++; console.log(`${cond ? "OK   " : "ÉCHEC"} ${name}${info ? "  → " + info : ""}`); };
installFetch();
const realNow = Date.now; Date.now = () => NOW;

const env = { FOOTBALL_DATA_KEY: "x", ...makeKV() };
const get = async (path) => { const r = await worker.fetch(new Request("https://w" + path), env, { waitUntil: () => {} }); return r.json(); };

// ---- 1. Le robot remplit tout tout seul ----
console.log("\n— Robot —");
const total = robotSources(2026).length;
let runs = 0, status;
const writes0 = env.stats.writes;
for (; runs < 200; runs++) {
  await runRobot(env, NOW + runs * 600000);
  status = await get("/status");
  if (status.progression === `${total}/${total} sources à jour`) break;
}
check(`Toutes les sources remplies (${total})`, status.progression === `${total}/${total} sources à jour`, `${runs + 1} passages = ${((runs + 1) * 10 / 60).toFixed(1)} h`);
check("Aucune erreur de source", status.sources.every((s) => !s.etat.startsWith("erreur")));
const fillWrites = env.stats.writes - writes0;

// Régime de croisière : 24 h de robot après remplissage
const w1 = env.stats.writes, fd1 = calls.fd, espn1 = calls.espn;
for (let i = 0; i < 144; i++) await runRobot(env, NOW + (runs + 1 + i) * 600000);
const dayWrites = env.stats.writes - w1;
check("Écritures cache par jour < 600 (limite gratuite 1000)", dayWrites < 600, `${dayWrites} écritures/jour (remplissage initial : ${fillWrites})`);
check("Appels football-data raisonnables (< 400/jour)", calls.fd - fd1 < 400, `${calls.fd - fd1} appels/jour`);
console.log(`     info : ESPN ${calls.espn - espn1} appels/jour`);

// ---- 2. Pronostics de championnat ----
console.log("\n— Ligue 1 —");
const L1 = await get("/league-predictions?leagueId=61");
check("Ligue 1 : 10 pronostics", L1.success && L1.count === 10);
const p = L1.predictions[0];
check("Champs V5/V6 conservés", ["matchId", "leagueId", "season", "date", "status", "source", "teams", "lambdas", "poisson", "cotesJustes", "donnees"].every((k) => k in p));
check("Saison précédente intégrée", L1.modele.matchsAnalyses > 200, `${L1.modele.matchsAnalyses} matchs analysés`);
check("Match en direct listé", L1.predictions.some((x) => x.status === "IN_PLAY"));
const d = p.teams.domicile;
check("Forme sur 5 matchs", Array.isArray(d.stats?.forme) && d.stats.forme.length === 5, d.stats?.forme?.join(" "));
check("Stats buts / over / BTTS / clean sheet", ["butsMarquesParMatch", "butsEncaissesParMatch", "pctOver25", "pctBTTS", "pctCleanSheet"].every((k) => typeof d.stats[k] === "number"));
check("Adversaires de la forme nommés", d.stats.formeDetail.every((f) => f.adversaire.startsWith("Équipe")));
check("Classement présent", d.classement?.rang >= 1 && L1.classement.length === 18, `rang ${d.classement?.rang}`);
const top = L1.classement[0], bottom = L1.classement[17];
check("Classement cohérent avec les forces réelles", STRENGTH[top.id] > STRENGTH[bottom.id], `1er ${top.id}, dernier ${bottom.id}`);
// Elo : le meilleur club n'est plus "remis à zéro"
const eloTop = Math.max(...L1.predictions.flatMap((x) => [x.teams.domicile.elo, x.teams.exterieur.elo]));
check("Elo reporté de la saison précédente (écart > 150)", eloTop - Math.min(...L1.predictions.flatMap((x) => [x.teams.domicile.elo, x.teams.exterieur.elo])) > 150);

// ---- 3. Coupes renforcées ----
console.log("\n— Coupes —");
for (const [id, nom] of [[2, "Ligue des champions"], [3, "Europa League"], [848, "Conference League"]]) {
  const C = await get(`/league-predictions?leagueId=${id}`);
  const withDom = C.predictions.filter((x) => x.donnees.calcul.startsWith("competition+championnats")).length;
  check(`${nom} : pronostics nourris par les championnats`, C.count > 0 && withDom === C.count, `${withDom}/${C.count}`);
  check(`${nom} : fiabilité moyenne ou élevée`, C.predictions.every((x) => x.donnees.fiabilite !== "faible"));
  // Précision : buts attendus vs vérité, coupe seule vs coupe + championnats
  let errMix = 0, errCup = 0, n = 0;
  for (const x of C.predictions) {
    const [h, a] = [x.teams.domicile.id, x.teams.exterieur.id];
    const lh = 1.45 * STRENGTH[h] / STRENGTH[a] ** 0.8, la = 1.15 * STRENGTH[a] / STRENGTH[h] ** 0.8;
    errMix += Math.abs(x.lambdas.lambdaDom - lh) / lh + Math.abs(x.lambdas.lambdaExt - la) / la; n += 2;
  }
  console.log(`     info : écart buts attendus / réalité = ${(100 * errMix / n).toFixed(0)} %`);
  check(`${nom} : forme mélangeant coupe et championnat`, C.predictions[0].teams.domicile.stats?.matchs > 4);
}
const NL = await get("/league-predictions?leagueId=5");
check("Ligue des Nations : pronostics présents", NL.count > 0);

// ---- 4. Face-à-face et détails ----
console.log("\n— Détails de match —");
const md = await get(`/match-details?matchId=${encodeURIComponent(p.matchId)}&source=football-data&teamDomId=${d.id}&teamExtId=${p.teams.exterieur.id}`);
check("Stats renvoyées par /match-details", md.stats.domicile.forme?.length === 5 && md.stats.domicile.classement?.rang >= 1);
check("Face-à-face football-data", md.h2h.length >= 1, `${md.h2h.length} matchs`);
const okOrient = md.h2h.every((h) => (h.scoreDom > h.scoreExt ? "domicile" : h.scoreDom < h.scoreExt ? "exterieur" : "nul") === h.vainqueur);
check("Face-à-face orienté vers l'équipe du match", okOrient);
const h0 = calls.h2h;
await get(`/match-details?matchId=${encodeURIComponent(p.matchId)}&source=football-data&teamDomId=${d.id}&teamExtId=${p.teams.exterieur.id}`);
check("Face-à-face mis en cache (pas de 2e appel API)", calls.h2h === h0);
const L2 = await get("/league-predictions?leagueId=62");
const e = L2.predictions[0];
const md2 = await get(`/match-details?matchId=${e.matchId}&source=espn&teamDomId=${e.teams.domicile.id}&teamExtId=${e.teams.exterieur.id}`);
check("Face-à-face ESPN (Ligue 2, saison précédente)", md2.h2h.length >= 1, `${md2.h2h.length} matchs`);

// ---- 5. Sécurité de fonctionnement ----
console.log("\n— Robustesse —");
const env2 = { FOOTBALL_DATA_KEY: "x", ...makeKV() };
const r = await worker.fetch(new Request("https://w/league-predictions?leagueId=39"), env2, {});
const j = await r.json();
check("Site utilisable avant le premier passage du robot", j.success && j.count === 10);
check("Compétition inconnue : réponse vide propre", (await get("/league-predictions?leagueId=999")).count === 0);
check("Route inconnue : erreur 404 propre", (await worker.fetch(new Request("https://w/xyz"), env, {})).status === 404);
const failEnv = { FOOTBALL_DATA_KEY: "x", ...makeKV() };
const saved = globalThis.fetch; globalThis.fetch = async () => ({ ok: false, status: 429 });
const rep = await runRobot(failEnv, NOW);
globalThis.fetch = saved;
check("API en panne : le robot note l'erreur sans planter", rep.every((x) => x.includes("ERREUR")));
const s = calculate_poisson_match(1.4, 1.1);
check("Probabilités 1N2 = 100 %", Math.abs(s.proba1 + s.probaN + s.proba2 - 1) < 0.003);

console.log(`\n${ok} réussis, ${ko} échoués`);
Date.now = realNow;
process.exit(ko ? 1 : 0);
