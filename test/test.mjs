// Tests Duel Prono V7 : robot, pronostics, stats, coupes, face-à-face, état, limites Cloudflare gratuites
import { NOW, SIM, STRENGTH, installFetch, makeKV, makeD1, calls, DB as WORLD } from "./sim.mjs";
import worker from "../src/index.js";
import { runRobot } from "../src/robot.js";
import { robotSources } from "../src/config.js";
import { calculate_poisson_match } from "../src/model.js";
import { weekOf, pointsFor } from "../src/arena.js";
import { nationName, nationsPredict, fitLambdas, applyResults } from "../src/nations.js";
import SEED from "../src/nations-seed.js";

let ok = 0, ko = 0;
const check = (name, cond, info = "") => { cond ? ok++ : ko++; console.log(`${cond ? "OK   " : "ÉCHEC"} ${name}${info ? "  → " + info : ""}`); };
installFetch();
const realNow = Date.now; Date.now = () => SIM.now;
let T = 0;
const tick = async (env, t) => { SIM.now = t; return runRobot(env, t); };

const env = { FOOTBALL_DATA_KEY: "x", ...makeKV() };
const get = async (path) => { const r = await worker.fetch(new Request("https://w" + path), env, { waitUntil: () => {} }); return r.json(); };

const get61 = async (e) => (await worker.fetch(new Request("https://w/league-predictions?leagueId=61"), e, { waitUntil() {} })).json();

// ---- 1. Le robot remplit tout tout seul ----
console.log("\n— Robot —");
const total = robotSources(2026).length;
let runs = 0, status;
const writes0 = env.stats.writes;
for (; runs < 500; runs++) {
  await tick(env, NOW + runs * 600000);
  status = await get("/status");
  if (status.progression === `${total}/${total} sources à jour`) break;
}
check(`Toutes les sources remplies (${total})`, status.progression === `${total}/${total} sources à jour`, `${runs + 1} passages = ${((runs + 1) * 10 / 60).toFixed(1)} h`);
check("Aucune erreur de source", status.sources.every((s) => !s.etat.startsWith("erreur")));
const fillWrites = env.stats.writes - writes0;

// Régime de croisière : 24 h de robot après remplissage
const w1 = env.stats.writes, fd1 = calls.fd, espn1 = calls.espn;
T = NOW + (runs + 1) * 600000;
for (let i = 0; i < 144; i++) { await tick(env, T); T += 600000; }
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
{ // on laisse tourner le robot jusqu'au prochain coup d'envoi de Ligue 1 + 30 min : le match doit être "en direct"
  const { DB } = await import("./sim.mjs");
  const next = DB["fd:FL1@2026"].filter((m) => m.ts > SIM.now).sort((a, b) => a.ts - b.ts)[0];
  while (SIM.now < next.ts + 30 * 60000) await tick(env, SIM.now + 10 * 60000);
  T = SIM.now + 600000;
  const live = await get("/league-predictions?leagueId=61");
  check("Match en direct listé", live.predictions.some((x) => x.status === "IN_PLAY"));
}
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
  const faibles = C.predictions.filter((x) => x.donnees.fiabilite === "faible");
  check(`${nom} : fiabilité moyenne ou élevée (≥ 80 % des matchs)`, faibles.length <= 0.2 * C.count, `${faibles.length} faible(s), toujours justifiée(s) par < 4 matchs`);
  check(`${nom} : « faible » seulement si une équipe a moins de 4 matchs`, faibles.every((x) => Math.min(x.donnees.matchsDomicile, x.donnees.matchsExterieur) < 4));
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

// ---- Classement par groupe (sélections) ----
{
  const { groupTables } = await import("../src/model.js");
  const F = (homeId, awayId, hg, ag) => ({ homeId, awayId, hg, ag });
  // Deux groupes de 4 ; groupe 1 : Chypre 2e, Arménie 3e (comme en vrai le 12/11/2026)
  const fin = [F("MNE", "ARM", 3, 2), F("CYP", "LVA", 2, 1), F("ARM", "LVA", 2, 0), F("MNE", "CYP", 1, 1), F("CYP", "ARM", 2, 0), F("MNE", "LVA", 2, 0), F("MNE", "ARM", 0, 0), F("LVA", "CYP", 1, 0),
    F("A", "B", 1, 0), F("C", "D", 0, 0), F("A", "C", 2, 0)];
  const g = groupTables(fin, [["ARM", "CYP"], ["B", "D"]]);
  check("Sélections : rang dans le groupe, pas au classement général", g.get("CYP").rang === 2 && g.get("ARM").rang === 3 && g.get("MNE").rang === 1 && g.get("A").rang === 1 && g.get("ARM").groupe === true && g.get("ARM").pts === 4);
  check("Sélections : aucun rang si les groupes ne se lisent pas (phase finale, données partielles)", groupTables([...fin, F("MNE", "A", 1, 0)], []) === null && groupTables([F("X", "Y", 1, 0)], []) === null);
}

// ---- 3 bis. Sélections nationales : classement Elo sur tous les matchs internationaux ----
console.log("\n— Sélections —");
{
  const R = SEED.ratings, P = SEED.params;
  const tb = nationsPredict(R[nationName("Türkiye")], R.Belgium, P), [lD, lE] = fitLambdas(tb), g = calculate_poisson_match(lD, lE);
  check("Turquie – Belgique (à domicile) : la Turquie garde de vraies chances", g.proba1 > 0.18 && g.proba1 < 0.33 && g.proba2 > g.proba1 && g.probaN > 0.2, `Turquie ${Math.round(100 * g.proba1)} % · nul ${Math.round(100 * g.probaN)} % · Belgique ${Math.round(100 * g.proba2)} %`);
  check("Marchés cohérents avec les probabilités Elo", Math.abs(g.proba1 - g.proba2 - (tb.p[0] - tb.p[2])) < 0.01 && Math.abs(lD + lE - tb.lam[0] - tb.lam[1]) < 1e-6);
  const eq = calculate_poisson_match(...fitLambdas(nationsPredict(1800, 1800, P))), big = calculate_poisson_match(...fitLambdas(nationsPredict(R.Spain, R["San Marino"], P)));
  check("Deux sélections de même niveau : léger avantage à celle qui reçoit", eq.proba1 > eq.proba2 && eq.proba1 < 0.5, `${Math.round(100 * eq.proba1)} % / ${Math.round(100 * eq.proba2)} %`);
  check("Très gros écart : très net favori", big.proba1 > 0.93, `Espagne – Saint-Marin : ${Math.round(100 * big.proba1)} %`);
  check("Noms des fournisseurs reconnus (Türkiye, Czechia, Bosnia-Herzegovina…)", ["Türkiye", "Czechia", "Bosnia-Herzegovina", "Republic of Ireland", "North Macedonia", "Northern Ireland", "Faroe Islands", "Kosovo", "Wales", "Scotland"].every((n) => nationName(n) in R));
  const up = applyResults(SEED, [{ ts: 1, home: "Turkey", away: "Belgium", hg: 2, ag: 0 }]);
  check("Une victoire fait monter la note, une défaite la fait baisser", up.get("Turkey") > R.Turkey + 10 && up.get("Belgium") < R.Belgium - 10 && Math.abs(up.get("Turkey") + up.get("Belgium") - R.Turkey - R.Belgium) < 1e-6);
  check("Ligue des Nations calculée par l'Elo des sélections, aucune inconnue", NL.predictions.every((x) => x.donnees.calcul === "elo-selections" && x.donnees.fiabilite === "élevée") && NL.modele.selections.inconnues.length === 0 && NL.predictions.some((x) => x.teams.domicile.elo > 1900), `notes au ${NL.modele.selections.notesAu}`);
  const worst = Math.min(...NL.predictions.filter((x) => x.teams.domicile.name !== "San Marino" && x.teams.exterieur.name !== "San Marino").flatMap((x) => [x.poisson.proba1, x.poisson.proba2]));
  check("Aucune grande sélection donnée perdante d'avance (moins de 5 %)", worst > 0.05, `plus faible probabilité de victoire : ${Math.round(100 * worst)} %`);
  check("/status indique l'état des sélections", (await get("/status")).selections["Ligue des Nations"]?.inconnues.length === 0);
}

// ---- 4. Face-à-face et détails ----
console.log("\n— Détails de match —");
const md = await get(`/match-details?matchId=${encodeURIComponent(p.matchId)}&source=football-data&teamDomId=${d.id}&teamExtId=${p.teams.exterieur.id}`);
check("Stats renvoyées par /match-details", md.stats.domicile.forme?.length === 5 && md.stats.domicile.classement?.rang >= 1);
check("Face-à-face football-data", md.h2h.length >= 1, `${md.h2h.length} matchs`);
const okOrient = md.h2h.every((h) => (h.scoreDom > h.scoreExt ? "domicile" : h.scoreDom < h.scoreExt ? "exterieur" : "nul") === h.vainqueur);
check("Face-à-face orienté vers l'équipe du match", okOrient);
check("Face-à-face sans aucun appel API (zéro risque de blocage)", calls.h2h === 0);
const L2 = await get("/league-predictions?leagueId=62");
const e = L2.predictions[0];
const md2 = await get(`/match-details?matchId=${e.matchId}&source=espn&teamDomId=${e.teams.domicile.id}&teamExtId=${e.teams.exterieur.id}`);
check("Face-à-face ESPN (Ligue 2, saison précédente)", md2.h2h.length >= 1, `${md2.h2h.length} matchs`);

// ---- 4 bis. Nouveaux marchés et compositions ----
console.log("\n— Marchés et compositions —");
const P0 = L1.predictions[0].poisson;
check("Nouveaux marchés présents", ["miTemps", "rembourseSiNul", "butsDomicile", "butsExterieur", "victoireSansEncaisser", "victoireEtBTTS", "scoresExacts"].every((k) => k in P0));
check("Marchés cohérents (sans encaisser + avec BTTS = victoire)", Math.abs(P0.victoireSansEncaisser.dom + P0.victoireEtBTTS.dom - P0.proba1) < 0.003);
check("Forme : logos des adversaires", L1.predictions[0].teams.domicile.stats.formeDetail.every((f) => f.logo));
const C2 = (await get("/league-predictions?leagueId=2")).predictions[0];
check("Forme en coupe : adversaires de championnat nommés", C2.teams.domicile.stats.formeDetail.every((f) => !/^\d+$/.test(f.adversaire)));
const L2b = (await get("/league-predictions?leagueId=62")).predictions[0];
const mdL2 = await get(`/match-details?matchId=${L2b.matchId}&source=espn&teamDomId=${L2b.teams.domicile.id}&teamExtId=${L2b.teams.exterieur.id}&leagueId=62`);
check("Compositions ESPN (Ligue 2)", mdL2.compositions.domicile?.xi?.length === 11 && mdL2.compositions.exterieur?.xi?.length === 11, mdL2.compositions.domicile?.f);
const mdL1 = await get(`/match-details?matchId=${p.matchId}&source=football-data&teamDomId=${d.id}&teamExtId=${p.teams.exterieur.id}&leagueId=61`);
check("Compositions football-data (via correspondance ESPN)", mdL1.compositions.domicile?.xi?.length === 11 || mdL1.compositions.exterieur?.xi?.length === 11);
console.log(`     info : ${calls.compos} compositions récupérées`);

// ---- 5. Verdict : pronostics figés puis comparés aux résultats ----
console.log("\n— Verdict —");
const allArchives = () => { const o = {}; for (const [k, v] of env.store) if (k.startsWith("archive:")) for (const e of Object.values(JSON.parse(v))) o[`${k}/${e.id}`] = e; return o; };
const snap = allArchives();
const started = Object.entries(snap).filter(([, e]) => e.ts < T);
for (let i = 0; i < 144; i++) { await tick(env, T); T += 600000; } // 24 h de plus
const after = allArchives();
check("Pronostics figés après le coup d'envoi (jamais modifiés)", started.length >= 10 && started.every(([k, e]) => JSON.stringify(after[k]) === JSON.stringify(e)), `${started.length} matchs vérifiés`);
const V = await get("/verdict?leagueId=all");
check("Verdict : matchs terminés avec score et prono du moteur", V.success && V.matchs.length >= 10 && V.matchs.every((m) => m.score && m.moteur.prono), `${V.bilan.matchs} matchs`);
check("Verdict : taux de réussite calculés", [V.bilan["1N2"], V.bilan.doubleChance, V.bilan.plusMoins25].every((x) => x >= 0 && x <= 100), `1N2 ${V.bilan["1N2"]} % · double chance ${V.bilan.doubleChance} % · +/-2,5 ${V.bilan.plusMoins25} %`);
const okRes = V.matchs.every((m) => { const r = m.score.dom > m.score.ext ? "1" : m.score.dom < m.score.ext ? "2" : "N"; return m.juste["1N2"] === (m.moteur.prono === r); });
check("Verdict : « vu juste / raté » exact", okRes);
check("Verdict par compétition", (await get("/verdict?leagueId=61")).matchs.every((m) => m.leagueId === 61));
const LG = await get("/leagues");
const UP = await get("/upcoming");
check("Accueil : tous les matchs des 7 prochains jours, de plusieurs compétitions, triés par date", UP.success && UP.matchs.length >= 20 && new Set(UP.matchs.map((m) => m.leagueId)).size >= 6 && UP.matchs.every((m, i) => (i === 0 || Date.parse(m.date) >= Date.parse(UP.matchs[i - 1].date)) && Date.parse(m.date) < SIM.now + 7 * 86400000 && Math.abs(m.poisson.proba1 + m.poisson.probaN + m.poisson.proba2 - 1) < 0.01 && m.teams.domicile.name), `${UP.matchs.length} matchs, ${new Set(UP.matchs.map((m) => m.leagueId)).size} compétitions`);
{ const l1 = (await get("/league-predictions?leagueId=61")).predictions, next = LG.competitions.find((c) => c.id === 61).prochain;
  check("Compétitions : date du prochain match fournie pour le tri", LG.competitions.filter((c) => c.matchsAVenir > 0).every((c) => c.prochain) && Date.parse(next) === Math.min(...l1.map((p) => Date.parse(p.date)).filter((t) => t > SIM.now - 3 * 3600000)), next); }
check("Chaque compétition a son logo", LG.competitions.every((c) => /^https:\/\/a\.espncdn\.com\/i\/leaguelogos\/soccer\/500\/\d+\.png$/.test(c.logo)) && new Set(LG.competitions.map((c) => c.logo)).size === 16);
check("Liste des compétitions avec matchs à venir", LG.competitions.length === 16 && LG.competitions.find((c) => c.id === 71)?.matchsAVenir > 0, "Brésil inclus");

// ---- 6. Panne football-data : bascule sur ESPN ----
console.log("\n— Secours —");
SIM.fdDown.add("FL1");
for (let i = 0; i < 6 * 15; i++) { await tick(env, T); T += 600000; } // 15 h de panne
const L1s = await get("/league-predictions?leagueId=61");
check("Panne > 12 h : Ligue 1 bascule sur la source de secours", L1s.modele.source === "secours" && L1s.count > 0, `${L1s.count} pronostics`);
SIM.fdDown.delete("FL1");
for (let i = 0; i < 6 * 4; i++) { await tick(env, T); T += 600000; }
check("Retour de football-data : source principale rétablie", (await get("/league-predictions?leagueId=61")).modele.source === "principale");

// ---- 6 bis. ESPN refuse les appels (403) : pause, puis reprise ----
console.log("\n— ESPN bloqué —");
{
  SIM.espnBlocked = true; calls.espnRefus = 0;
  for (let i = 0; i < 6 * 6; i++) { await tick(env, T); T += 600000; } // 6 h de blocage
  const st = await get("/status");
  check("ESPN refuse (403) : le robot se met en pause au lieu d'insister", st.espn.etat === "en pause" && calls.espnRefus <= 6, `${calls.espnRefus} appels refusés en 6 h (36 passages), pause jusqu'à ${st.espn.jusqua}`);
  check("Pendant la pause, les championnats football-data continuent", (await get("/league-predictions?leagueId=61")).count > 0 && st.sources.find((s) => s.source === "fd:FL1@2026").etat === "à jour");
  SIM.espnBlocked = false;
  for (let i = 0; i < 6 * 6; i++) { await tick(env, T); T += 600000; } // ESPN répond de nouveau
  const st2 = await get("/status");
  check("ESPN répond de nouveau : reprise automatique", st2.espn.etat === "ok" && st2.sources.filter((s) => s.source.startsWith("espn:")).every((s) => !s.etat.startsWith("erreur")), st2.progression);
}

// ---- 7. Sécurité de fonctionnement ----
console.log("\n— Robustesse —");
const env2 = { FOOTBALL_DATA_KEY: "x", ...makeKV() };
const r = await worker.fetch(new Request("https://w/league-predictions?leagueId=39"), env2, {});
const j = await r.json();
check("Site utilisable avant le premier passage du robot", j.success && j.count === 10);
check("Compétition inconnue : réponse vide propre", (await get("/league-predictions?leagueId=999")).count === 0);
check("Route inconnue : erreur 404 propre", (await worker.fetch(new Request("https://w/xyz"), env, {})).status === 404);
const failEnv = { FOOTBALL_DATA_KEY: "x", ...makeKV() };
const saved = globalThis.fetch; globalThis.fetch = async () => ({ ok: false, status: 429 });
const rep = await runRobot(failEnv, SIM.now);
globalThis.fetch = saved;
check("API en panne : le robot note l'erreur sans planter", rep.filter((x) => x.includes("@")).every((x) => x.includes("ERREUR")));
const s = calculate_poisson_match(1.4, 1.1);
check("Probabilités 1N2 = 100 %", Math.abs(s.proba1 + s.probaN + s.proba2 - 1) < 0.003);


// ---- 8. Arène : comptes, pronostics des joueurs, notation, classement ----
console.log("\n— Arène —");
{
  const d1 = await makeD1();
  const A = { FOOTBALL_DATA_KEY: "x", ...makeKV(), DB: d1.DB };
  // Lundi 9 nov. 2026, 9 h (Paris) : début de semaine
  let t = Date.UTC(2026, 10, 9, 8, 0);
  const run = async (until) => { for (; t <= until; t += 600000) { SIM.now = t; await runRobot(A, t); } SIM.now = t; };
  await run(t + 40 * 600000);
  const call = async (path, { body, token, method } = {}) => {
    const r = await worker.fetch(new Request("https://w" + path, { method: method || (body ? "POST" : "GET"), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "CF-Connecting-IP": "1.2.3.4" }, body: body ? JSON.stringify(path === "/account/signup" && !("accepte" in body) ? { ...body, accepte: true } : body) : undefined }), A, { waitUntil() {} });
    return { status: r.status, ...(await r.json()) };
  };

  // Comptes
  const s1 = await call("/account/signup", { body: { pseudo: "Zizou", email: "Zizou@Exemple.fr", motDePasse: "motdepasse1" } });
  check("Inscription : compte créé et connecté", s1.status === 200 && s1.token?.length === 64 && s1.pseudo === "Zizou");
  const stored = d1.raw.prepare("SELECT * FROM joueurs").all()[0];
  check("Mot de passe jamais stocké en clair", stored.mdp.startsWith("pbkdf2$100000$") && !stored.mdp.includes("motdepasse1") && stored.email === "zizou@exemple.fr");
  check("Jeton de connexion jamais stocké en clair", !d1.raw.prepare("SELECT jeton FROM sessions").all().some((x) => x.jeton === s1.token));
  check("Pseudo déjà pris refusé (même en majuscules)", (await call("/account/signup", { body: { pseudo: "ZIZOU", email: "a@b.fr", motDePasse: "motdepasse1" } })).status === 409);
  check("E-mail déjà utilisé refusé", (await call("/account/signup", { body: { pseudo: "Autre", email: "zizou@exemple.fr", motDePasse: "motdepasse1" } })).status === 409);
  const bad = [{ pseudo: "ab", email: "a@b.fr", motDePasse: "motdepasse1" }, { pseudo: "<script>", email: "a@b.fr", motDePasse: "motdepasse1" }, { pseudo: "Valide", email: "pasunmail", motDePasse: "motdepasse1" }, { pseudo: "Valide", email: "a@b.fr", motDePasse: "court" }, { pseudo: "admin", email: "a@b.fr", motDePasse: "motdepasse1" }];
  let badOk = true; for (const b of bad) badOk = badOk && (await call("/account/signup", { body: b })).status === 400;
  check("Inscriptions invalides refusées (pseudo, e-mail, mot de passe trop court)", badOk);
  const noAge = await call("/account/signup", { body: { pseudo: "Mineur", email: "m@exemple.fr", motDePasse: "motdepasse1", accepte: false } });
  check("Inscription refusée sans la case « 18 ans et conditions »", noAge.status === 400 && /18 ans/.test(noAge.error) && d1.raw.prepare("SELECT COUNT(*) n FROM joueurs WHERE pseudo = 'Mineur'").get().n === 0);
  check("Connexion par pseudo", (await call("/account/login", { body: { identifiant: "zizou", motDePasse: "motdepasse1" } })).status === 200);
  const l2 = await call("/account/login", { body: { identifiant: "zizou@exemple.fr", motDePasse: "motdepasse1" } });
  check("Connexion par e-mail", l2.status === 200 && l2.pseudo === "Zizou");
  check("Mauvais mot de passe refusé", (await call("/account/login", { body: { identifiant: "zizou", motDePasse: "mauvais-mdp" } })).status === 401);
  check("Sans connexion : accès refusé", (await call("/me")).status === 401 && (await call("/picks", { body: { leagueId: 61, matchId: "x", choix: "1" } })).status === 401 && (await call("/me", { token: "f".repeat(64) })).status === 401);
  let blocked = 0; for (let i = 0; i < 12; i++) if ((await call("/account/login", { body: { identifiant: "victime", motDePasse: "essai" + i } })).status === 429) blocked++;
  check("Anti-abus : essais de connexion à la chaîne bloqués", blocked === 2, `${blocked} essais bloqués sur 12`);

  // Pronostics
  const s2 = await call("/account/signup", { body: { pseudo: "Platoche", email: "p@exemple.fr", motDePasse: "motdepasse2" } });
  const s3 = await call("/account/signup", { body: { pseudo: "Titi", email: "t@exemple.fr", motDePasse: "motdepasse3" } });
  // Accès réservé : 2 matchs offerts par jour aux visiteurs, tout pour les inscrits
  { const anon = await call("/upcoming"), full = await call("/upcoming", { token: s1.token });
    const open = anon.matchs.filter((m) => !m.verrouille), shut = anon.matchs.filter((m) => m.verrouille);
    check("Visiteur : seulement 2 matchs avec probabilités, les mêmes pour tous", open.length === 2 && open.every((m) => m.gratuit && m.poisson) && anon.matchs.length === full.matchs.length && anon.gratuits.jour === "2026-11-09", open.map((m) => `${m.teams.domicile.name} – ${m.teams.exterieur.name}`).join(" · "));
    check("Visiteur : aucune probabilité dans les matchs réservés", shut.length > 20 && shut.every((m) => !("poisson" in m) && !("lambdas" in m) && !("donnees" in m) && m.teams.domicile.name && m.date) && !/proba|lambda|cote/i.test(JSON.stringify(shut)));
    check("Inscrit : toutes les probabilités", full.matchs.length > 20 && full.matchs.every((m) => m.poisson && !m.verrouille));
    const f = open[0], lgA = await call(`/league-predictions?leagueId=${f.leagueId}`), lgF = await call(`/league-predictions?leagueId=${f.leagueId}`, { token: s1.token });
    const freeIn = lgA.predictions.filter((p) => !p.verrouille), lockIn = lgA.predictions.filter((p) => p.verrouille);
    check("Visiteur : même règle dans la page d'une compétition", freeIn.length >= 1 && freeIn.length <= 2 && freeIn.every((p) => p.gratuit && p.poisson.matrix) && lockIn.length >= 8 && lockIn.every((p) => !p.poisson && !p.lambdas && !p.cotesJustes) && lgF.predictions.every((p) => p.poisson && p.lambdas));
    const l0 = lockIn[0], det = (m, lid, tok) => call(`/match-details?matchId=${encodeURIComponent(m.matchId)}&source=${m.source}&teamDomId=${m.teams.domicile.id}&teamExtId=${m.teams.exterieur.id}&leagueId=${lid}`, { token: tok });
    check("Visiteur : analyse d'un match réservé refusée, celle d'un match offert ouverte", (await det(l0, f.leagueId)).status === 401 && (await det(f, f.leagueId)).status === 200 && (await det(l0, f.leagueId, s1.token)).status === 200 && (await det(l0, "")).status === 401);
    check("Faux jeton : traité comme un visiteur", (await call("/upcoming", { token: "f".repeat(64) })).matchs.filter((m) => !m.verrouille).length === 2);
    const before = anon.gratuits.ids.join();
    await run(t + 6 * 3600000); SIM.now += 61000;
    const later = await call("/upcoming");
    check("Les 2 matchs offerts ne changent pas dans la journée", later.gratuits.ids.join() === before && later.gratuits.jour === "2026-11-09" && later.matchs.filter((m) => !m.verrouille).length <= 2, `${later.matchs.filter((m) => !m.verrouille).length} encore à l'affiche en fin de journée`);
    await run(Date.UTC(2026, 10, 9, 23, 30)); SIM.now += 61000;
    const next = await call("/upcoming");
    check("Le lendemain : 2 nouveaux matchs offerts", next.gratuits.jour === "2026-11-10" && next.gratuits.ids.length === 2 && next.gratuits.ids.join() !== before && next.matchs.filter((m) => !m.verrouille).length === 2);
  }
  const L = await call("/league-predictions?leagueId=61", { token: s1.token });
  const upcoming = L.predictions.filter((x) => Date.parse(x.date) > SIM.now && x.status !== "IN_PLAY").slice(0, 4);
  const m0 = upcoming[0];
  const fav = (x) => (x.poisson.proba1 >= x.poisson.proba2 ? "1" : "2"), out = (x) => (x.poisson.proba1 >= x.poisson.proba2 ? "2" : "1");
  const proba = (x, c) => (c === "1" ? x.poisson.proba1 : c === "N" ? x.poisson.probaN : x.poisson.proba2);
  const k1 = await call("/picks", { token: s1.token, body: { leagueId: 61, matchId: m0.matchId, choix: fav(m0) } });
  check("Pronostic enregistré avec ses points en jeu", k1.status === 200 && k1.prono.mise === pointsFor(proba(m0, fav(m0))), `favori à ${Math.round(100 * proba(m0, fav(m0)))} % → ${k1.prono?.mise} pts`);
  const k1b = await call("/picks", { token: s1.token, body: { leagueId: 61, matchId: m0.matchId, choix: out(m0) } });
  check("Surprise = plus de points que le favori", k1b.prono.mise > k1.prono.mise, `outsider → ${k1b.prono.mise} pts`);
  check("Changement de pronostic avant le match : un seul pronostic gardé", d1.raw.prepare("SELECT COUNT(*) n FROM pronos WHERE joueur_id = 1").get().n === 1);
  await call("/picks", { token: s1.token, body: { leagueId: 61, matchId: m0.matchId, choix: fav(m0) } });
  check("Pronostics invalides refusés", (await call("/picks", { token: s1.token, body: { leagueId: 61, matchId: m0.matchId, choix: "X" } })).status === 400 && (await call("/picks", { token: s1.token, body: { leagueId: 61, matchId: "inconnu", choix: "1" } })).status === 404);
  // Chaque joueur pronostique les 4 prochains matchs : Zizou le favori, Platoche l'outsider, Titi le nul
  for (const x of upcoming) {
    await call("/picks", { token: s1.token, body: { leagueId: 61, matchId: x.matchId, choix: fav(x) } });
    await call("/picks", { token: s2.token, body: { leagueId: 61, matchId: x.matchId, choix: out(x) } });
    await call("/picks", { token: s3.token, body: { leagueId: 61, matchId: x.matchId, choix: "N" } });
  }
  const me0 = await call("/me", { token: s1.token });
  check("Mes pronostics : en attente, sans points", me0.pronos.length === 4 && me0.pronos.every((x) => x.points === null && x.domicile.nom && x.exterieur.nom) && me0.semaine.attente === 4);

  // Coup d'envoi : verrouillage
  const last = upcoming[upcoming.length - 1];
  await run(Date.parse(m0.date) + 20 * 60000);
  const late = await call("/picks", { token: s1.token, body: { leagueId: 61, matchId: m0.matchId, choix: out(m0) } });
  check("Pronostic refusé après le coup d'envoi", late.status === 409, late.error);
  check("Pronostic inchangé après la tentative tardive", d1.raw.prepare("SELECT choix FROM pronos WHERE joueur_id = 1 AND match_id = ?").get(String(m0.matchId)).choix === fav(m0));

  // Fin des matchs : notation par le robot
  const q0 = d1.stats.queries;
  await run(Date.parse(last.date) + 4 * 3600000);
  const rows = d1.raw.prepare("SELECT p.*, j.pseudo FROM pronos p JOIN joueurs j ON j.id = p.joueur_id").all();
  const truth = (id) => { const m = WORLD["fd:FL1@2026"].find((x) => String(x.id) === String(id)); return m.hg > m.ag ? "1" : m.hg < m.ag ? "2" : "N"; };
  check("Tous les pronostics notés après les matchs", rows.length === 12 && rows.every((r) => r.points !== null));
  check("Notation exacte : points en jeu si juste, 0 sinon", rows.every((r) => r.resultat === truth(r.match_id) && r.points === (r.choix === truth(r.match_id) ? r.mise_pts : 0)));
  const gradedLate = await call("/picks", { token: s1.token, body: { leagueId: 61, matchId: m0.matchId, choix: "N" } });
  check("Pronostic noté intouchable", gradedLate.status !== 200);

  // Classement
  const board = await call("/arena");
  const expect = ["Zizou", "Platoche", "Titi"].map((p) => ({ p, pts: rows.filter((r) => r.pseudo === p).reduce((a, r) => a + r.points, 0), justes: rows.filter((r) => r.pseudo === p && r.points > 0).length }))
    .sort((a, b) => b.pts - a.pts || b.justes - a.justes || a.p.localeCompare(b.p));
  check("Classement de la semaine trié par points", board.joueurs === 3 && board.classement.map((c) => c.pseudo).join() === expect.map((e) => e.p).join() && board.classement.every((c, i) => c.points === expect[i].pts && c.rang === i + 1), board.classement.map((c) => `${c.rang}. ${c.pseudo} ${c.points} pts (${c.justes}/${c.joues})`).join(" · "));
  check("Classement sans donnée privée (ni e-mail ni identifiant)", !JSON.stringify(board).includes("exemple.fr") && Object.keys(board.classement[0]).join() === "rang,pseudo,club,points,justes,joues,attente");
  const meZ = await call("/me", { token: s1.token });
  check("Mon bilan : même rang et mêmes points que le classement", meZ.semaine.rang === board.classement.find((c) => c.pseudo === "Zizou").rang && meZ.semaine.points === expect.find((e) => e.p === "Zizou").pts);

  // Semaine : lundi → dimanche, heure de Paris
  check("Semaine : dimanche 23 h 59 et lundi 0 h (Paris) séparés", weekOf(Date.UTC(2026, 10, 15, 22, 59)) === "2026-11-09" && weekOf(Date.UTC(2026, 10, 15, 23, 0)) === "2026-11-16" && weekOf(Date.UTC(2026, 6, 5, 21, 59)) === "2026-06-29" && weekOf(Date.UTC(2026, 6, 5, 22, 0)) === "2026-07-06");
  const weekNow = weekOf(SIM.now);
  d1.raw.exec(`UPDATE pronos SET semaine = '2026-11-02'`);
  SIM.now += 61000; // le classement est gardé 1 min en mémoire
  const cur = await call("/arena"), prev = await call("/arena?semaine=precedente");
  check("Nouvelle semaine : classement remis à zéro, l'ancien reste consultable", weekNow === "2026-11-09" && cur.classement.length === 0 && prev.classement.length === 3 && prev.semaine.debut === "2026-11-02" && prev.semaine.fin === "2026-11-08");

  // Espace personnel
  const team = L.classement[3];
  const pr = await call("/account/profile", { token: s1.token, body: { prenom: "  Zinédine <b> ", ville: "Marseille", club: { leagueId: 61, teamId: team.id } } });
  check("Espace perso : prénom, ville et club enregistrés", pr.status === 200 && pr.profil.prenom === "Zinédine b" && pr.profil.ville === "Marseille" && pr.profil.club.nom === team.nom && pr.profil.club.logo === team.logo, `${pr.profil?.club?.nom}`);
  check("Espace perso : club inventé refusé", (await call("/account/profile", { token: s1.token, body: { club: { leagueId: 61, teamId: "faux" } } })).status === 400);
  const meP = await call("/me", { token: s1.token });
  check("Mon espace : mes infos, mon e-mail et mon bilan total", meP.profil.email === "zizou@exemple.fr" && meP.profil.club.nom === team.nom && meP.total.joues === 4 && meP.total.notes === 4 && meP.total.points === rows.filter((r) => r.pseudo === "Zizou").reduce((a, r) => a + r.points, 0));
  SIM.now += 61000;
  const b2 = await call("/arena?semaine=precedente");
  check("Classement : blason du club favori, prénom et ville jamais montrés", b2.classement.find((c) => c.pseudo === "Zizou").club.logo === team.logo && !JSON.stringify(b2).includes("Marseille") && !JSON.stringify(b2).includes("Zinédine"));
  check("Retirer son club", (await call("/account/profile", { token: s1.token, body: { prenom: "Zinédine", ville: "Marseille", club: null } })).profil.club === null);
  check("Changer d'e-mail : mot de passe exigé, doublon refusé", (await call("/account/email", { token: s1.token, body: { email: "z2@exemple.fr", motDePasse: "faux-mot" } })).status === 401 && (await call("/account/email", { token: s1.token, body: { email: "p@exemple.fr", motDePasse: "motdepasse1" } })).status === 409);
  const em = await call("/account/email", { token: s1.token, body: { email: "Z2@exemple.fr", motDePasse: "motdepasse1" } });
  check("Changer d'e-mail", em.status === 200 && (await call("/account/login", { body: { identifiant: "z2@exemple.fr", motDePasse: "motdepasse1" } })).status === 200);
  const other = await call("/account/login", { body: { identifiant: "zizou", motDePasse: "motdepasse1" } });
  check("Changer de mot de passe : l'ancien est exigé", (await call("/account/password", { token: s1.token, body: { ancien: "pas-le-bon", nouveau: "nouveau-mdp-1" } })).status === 401 && (await call("/account/password", { token: s1.token, body: { ancien: "motdepasse1", nouveau: "court" } })).status === 400);
  const pw = await call("/account/password", { token: s1.token, body: { ancien: "motdepasse1", nouveau: "nouveau-mdp-1" } });
  check("Changer de mot de passe : nouveau accepté, ancien refusé", pw.status === 200 && (await call("/account/login", { body: { identifiant: "zizou", motDePasse: "nouveau-mdp-1" } })).status === 200 && (await call("/account/login", { body: { identifiant: "zizou", motDePasse: "motdepasse1" } })).status === 401);
  check("Changer de mot de passe : les autres appareils sont déconnectés, pas celui-ci", (await call("/me", { token: other.token })).status === 401 && (await call("/me", { token: s1.token })).status === 200);

  // Mot de passe oublié (e-mail envoyé par Resend, simulé)
  check("Mot de passe oublié : désactivé tant que la clé d'envoi n'est pas réglée", (await call("/leagues")).options.motDePasseOublie === false && (await call("/account/forgot", { body: { email: "z2@exemple.fr" } })).status === 503);
  A.RESEND_API_KEY = "re_test";
  check("Mot de passe oublié : proposé une fois la clé réglée", (await call("/leagues")).options.motDePasseOublie === true);
  SIM.mails.length = 0;
  const fg = await call("/account/forgot", { body: { email: "Z2@exemple.fr", lang: "en" } }), fgNone = await call("/account/forgot", { body: { email: "personne@exemple.fr" } });
  const mail = SIM.mails[0], link = /\/#\/nouveau-mot-de-passe\/([a-f0-9]{64})/.exec(mail?.text || "")?.[1];
  check("Mot de passe oublié : un e-mail avec un lien, en anglais si demandé", fg.status === 200 && SIM.mails.length === 1 && mail.to[0] === "z2@exemple.fr" && mail.from === "Duel Prono <noreply@duelprono.com>" && /new password/.test(mail.subject) && !!link && mail.auth === "Bearer re_test");
  check("Mot de passe oublié : même réponse pour une adresse inconnue, aucun e-mail", fgNone.status === 200 && JSON.stringify(fgNone) === JSON.stringify(fg) && SIM.mails.length === 1);
  check("Lien jamais stocké en clair", !d1.raw.prepare("SELECT jeton FROM resets").all().some((x) => x.jeton === link));
  check("Lien faux ou trop court : refusé", (await call("/account/reset", { body: { jeton: "a".repeat(64), nouveau: "encore-un-mdp" } })).status === 400 && (await call("/account/reset", { body: { jeton: "123", nouveau: "encore-un-mdp" } })).status === 400);
  const other2 = await call("/account/login", { body: { identifiant: "zizou", motDePasse: "nouveau-mdp-1" } });
  const rs = await call("/account/reset", { body: { jeton: link, nouveau: "mdp-retrouve-9" } });
  check("Nouveau mot de passe : connecté aussitôt, ancien mot de passe refusé", rs.status === 200 && rs.pseudo === "Zizou" && (await call("/me", { token: rs.token })).status === 200 && (await call("/account/login", { body: { identifiant: "zizou", motDePasse: "nouveau-mdp-1" } })).status === 401 && (await call("/account/login", { body: { identifiant: "zizou", motDePasse: "mdp-retrouve-9" } })).status === 200);
  check("Nouveau mot de passe : les anciennes connexions sont fermées", (await call("/me", { token: other2.token })).status === 401 && (await call("/me", { token: s1.token })).status === 401);
  check("Lien utilisable une seule fois", (await call("/account/reset", { body: { jeton: link, nouveau: "autre-mdp-77" } })).status === 400);
  SIM.mails.length = 0; await call("/account/forgot", { body: { email: "z2@exemple.fr" } });
  const link2 = /nouveau-mot-de-passe\/([a-f0-9]{64})/.exec(SIM.mails[0].text)[1];
  SIM.now += 61 * 60000;
  check("Lien expiré après 1 heure", (await call("/account/reset", { body: { jeton: link2, nouveau: "autre-mdp-77" } })).status === 400 && /Bonjour Zizou/.test(SIM.mails[0].text));
  let blockedF = 0; for (let i = 0; i < 4; i++) if ((await call("/account/forgot", { body: { email: "z2@exemple.fr" } })).status === 429) blockedF++;
  check("Anti-abus : pas plus de 3 e-mails par heure pour une même adresse", blockedF >= 1, `${blockedF} demande(s) bloquée(s)`);
  s1.token = (await call("/account/login", { body: { identifiant: "zizou", motDePasse: "mdp-retrouve-9" } })).token;

  // E-mail de bienvenue
  SIM.now += 61 * 60000; SIM.mails.length = 0;
  const w1 = await call("/account/signup", { body: { pseudo: "Nouveau1", email: "Nouveau1@exemple.fr", motDePasse: "secret-bienvenue-1" } });
  const wm = SIM.mails[0];
  check("Bienvenue : un e-mail avec le pseudo et l'e-mail du compte", w1.status === 200 && SIM.mails.length === 1 && wm.to[0] === "nouveau1@exemple.fr" && wm.subject === "Bienvenue sur Duel Prono" && /Pseudo : Nouveau1/.test(wm.text) && /E-mail : nouveau1@exemple\.fr/.test(wm.text) && /duelprono\.com\/#\/compte/.test(wm.html));
  check("Bienvenue : le mot de passe n'est jamais dans l'e-mail", !JSON.stringify(wm).includes("secret-bienvenue-1"));
  SIM.mails.length = 0;
  const w2 = await call("/account/signup", { body: { pseudo: "Nouveau2", email: "nouveau2@exemple.fr", motDePasse: "secret-bienvenue-2", lang: "en" } });
  check("Bienvenue : en anglais si le site est en anglais", w2.status === 200 && SIM.mails[0]?.subject === "Welcome to Duel Prono" && /Username: Nouveau2/.test(SIM.mails[0].text));
  SIM.mailDown = true;
  const w3 = await call("/account/signup", { body: { pseudo: "Nouveau3", email: "nouveau3@exemple.fr", motDePasse: "secret-bienvenue-3" } });
  SIM.mailDown = false;
  check("Bienvenue : un envoi raté ne bloque pas l'inscription", w3.status === 200 && w3.token?.length === 64 && (await call("/me", { token: w3.token })).status === 200);
  SIM.mails.length = 0;
  check("Bienvenue : aucun e-mail si le pseudo ou l'e-mail est déjà pris", (await call("/account/signup", { body: { pseudo: "Nouveau1", email: "autre@exemple.fr", motDePasse: "secret-bienvenue-4" } })).status === 409 && SIM.mails.length === 0);

  // Quotas et vie du compte
  const perDay = (d1.stats.queries - q0) / ((Date.parse(last.date) + 4 * 3600000 - Date.parse(m0.date)) / 86400000);
  check("Base : le robot reste très en dessous des limites gratuites", perDay < 1000, `≈ ${Math.round(perDay)} appels base/jour pendant une journée de matchs`);
  const st = await call("/status");
  check("/status montre l'Arène", st.arene.ouverte && st.arene.joueurs === 6 && st.arene.pronostics === 12 && st.arene.enAttenteDeResultat === 0);
  check("Déconnexion : le jeton ne marche plus", (await call("/account/logout", { token: s3.token, method: "POST" })).status === 200 && (await call("/me", { token: s3.token })).status === 401);
  check("Suppression de compte : mot de passe exigé", (await call("/account/delete", { token: s2.token, body: { motDePasse: "faux-mot-de-passe" } })).status === 401);
  const del = await call("/account/delete", { token: s2.token, body: { motDePasse: "motdepasse2" } });
  check("Suppression de compte : tout est effacé", del.status === 200 && d1.raw.prepare("SELECT COUNT(*) n FROM joueurs WHERE pseudo = 'Platoche'").get().n === 0 && d1.raw.prepare("SELECT COUNT(*) n FROM pronos WHERE joueur_id = 2").get().n === 0 && (await call("/me", { token: s2.token })).status === 401);
  const noDb = await worker.fetch(new Request("https://w/account/login", { method: "POST", body: JSON.stringify({ identifiant: "zizou", motDePasse: "motdepasse1" }) }), env, {});
  check("Base absente : réponse propre, le reste du site continue", noDb.status === 503 && (await get("/league-predictions?leagueId=61")).success);
}

console.log(`\n${ok} réussis, ${ko} échoués`);
Date.now = realNow;
process.exit(ko ? 1 : 0);
