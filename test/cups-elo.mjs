// Test : Elo commun des clubs en Ligue des champions (src/elo-cup.js)
import { seedKeyFor, cupEloFor } from "../src/elo-cup.js";
import { CUP_ELO_SEED } from "../src/elo-cup-seed.js";
import { calculate_match_prediction, computeTeamRatings } from "../src/model.js";

let ok = 0, ko = 0;
const check = (name, cond, info = "") => { cond ? ok++ : ko++; console.log(`${cond ? "OK   " : "ÉCHEC"} ${name}${info ? "  → " + info : ""}`); };

// Noms tels que le site les affiche (football-data) : tous doivent retrouver leur Elo
const NAMES = ["Galatasaray SK", "Aston Villa FC", "FK Bodø/Glimt", "LASK Linz", "Real Madrid CF", "PSV", "Manchester City FC", "SSC Napoli", "Arsenal FC", "Borussia Dortmund", "Feyenoord Rotterdam", "FC Porto", "ŠK Slovan Bratislava", "Real Betis Balompié", "RB Leipzig", "Racing Club de Lens", "Como 1907", "PAE AEK", "Sabah FK", "FC Barcelona"];
const miss = NAMES.filter((n) => !seedKeyFor(n));
check("les 20 équipes du 24-25/11 retrouvent leur Elo", miss.length === 0, miss.join(", "));
const wrong = [["Real Madrid CF", "real madrid"], ["Real Betis Balompié", "real betis"], ["PAE AEK", "aek athens"], ["Racing Club de Lens", "lens"], ["Manchester City FC", "manchester city"]].filter(([n, k]) => seedKeyFor(n) !== k);
check("pas de confusion entre clubs au nom proche", wrong.length === 0, wrong.map((w) => w.join("→")).join(", "));
check("nom inconnu : pas d'Elo (jamais inventé)", seedKeyFor("Club Imaginaire United") === null);

// Mise à jour : un match après la date du seed change les Elo, un match avant ne change rien
const teams = { 1: ["Arsenal FC", null], 2: ["Borussia Dortmund", null], 3: ["Club Imaginaire", null] };
const a0 = CUP_ELO_SEED.ratings.arsenal, d0 = CUP_ELO_SEED.ratings["borussia dortmund"];
const avant = cupEloFor(teams, [{ homeId: "1", awayId: "2", hg: 5, ag: 0, ts: CUP_ELO_SEED.asOf - 1000 }]);
const apres = cupEloFor(teams, [{ homeId: "1", awayId: "2", hg: 5, ag: 0, ts: CUP_ELO_SEED.asOf + 1000 }]);
check("match avant la date du seed : Elo inchangés", avant.elo.get("1") === a0 && avant.elo.get("2") === d0);
check("match après la date du seed : le vainqueur monte, le battu descend", apres.elo.get("1") > a0 && apres.elo.get("2") < d0, `${a0}→${Math.round(apres.elo.get("1"))}`);
check("équipe sans Elo signalée", apres.inconnus.includes("Club Imaginaire") && !apres.elo.has("3"));

// Prévision : l'Elo rapproche le favori du marché, les probabilités restent cohérentes, sans Elo rien ne change
const fin = []; let k = 1; for (const [h, a] of [[1, 2], [2, 1], [1, 3], [3, 2]]) fin.push({ id: k++, homeId: String(h), awayId: String(a), hg: 1, ag: 1, ts: 1000 * k, season: 2026 });
const model = { ...computeTeamRatings(fin), elo: {} };
const m = { matchId: 1, teamDomId: "1", teamExtId: "2", domName: "A", extName: "B", date: "2026-11-24" };
const sans = calculate_match_prediction(m, { model, leagueId: 2, season: 2026 });
const avec = calculate_match_prediction(m, { model, leagueId: 2, season: 2026, cupElo: cupEloFor(teams, []).elo });
const p = avec.poisson;
check("avec Elo : Arsenal (Elo plus haut) plus favori qu'avec les seuls buts", p.proba1 > sans.poisson.proba1, `${(sans.poisson.proba1 * 100).toFixed(1)} % → ${(p.proba1 * 100).toFixed(1)} %`);
check("probabilités cohérentes (somme = 1)", Math.abs(p.proba1 + p.probaN + p.proba2 - 1) < 0.01);
const un = calculate_match_prediction({ ...m, teamExtId: "3" }, { model, leagueId: 2, season: 2026, cupElo: cupEloFor(teams, []).elo });
const un0 = calculate_match_prediction({ ...m, teamExtId: "3" }, { model, leagueId: 2, season: 2026 });
check("une équipe sans Elo : calcul d'avant strictement inchangé", un.poisson.proba1 === un0.poisson.proba1 && un.donnees.calcul === un0.donnees.calcul);
console.log(`\n${ok} réussis, ${ko} échoués`);
if (ko) process.exit(1);
