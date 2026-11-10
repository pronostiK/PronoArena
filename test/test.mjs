import worker, { calculate_poisson_match, buildModel, calculate_match_prediction } from "../worker.js";
let ok = 0, ko = 0;
const check = (name, cond) => { cond ? ok++ : ko++; console.log(`${cond ? "OK " : "ÉCHEC"}  ${name}`); };

// Saison simulée : 10 équipes, force réelle connue
const strength = { A: 2.2, B: 1.8, C: 1.5, D: 1.3, E: 1.2, F: 1.1, G: 1.0, H: 0.9, I: 0.75, J: 0.6 };
const ids = Object.keys(strength);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pois = (l) => { let k = 0, p = Math.exp(-l), s = p, u = rnd(); while (u > s) { k++; p *= l / k; s += p; } return k; };
const finished = []; let day = 0;
for (const h of ids) for (const a of ids) if (h !== a) {
  day++; finished.push({ homeId: h, awayId: a, hg: pois(1.45 * strength[h] / strength[a] ** 0.8), ag: pois(1.15 * strength[a] / strength[h] ** 0.8), date: new Date(Date.now() - (200 - day) * 86400000).toISOString() });
}
const model = buildModel(finished);
const pred = (d, e) => calculate_match_prediction({ matchId: 1, teamDomId: d, teamExtId: e, domName: d, extName: e }, 61, 2026, model);

const AJ = pred("A", "J"), JA = pred("J", "A"), EF = pred("E", "F");
console.log("\nA (fort) vs J (faible):", AJ.lambdas, AJ.poisson.proba1, AJ.poisson.probaN, AJ.poisson.proba2, "Elo", AJ.teams.domicile.elo, AJ.teams.exterieur.elo);
console.log("J vs A:", JA.lambdas, JA.poisson.proba1, JA.poisson.probaN, JA.poisson.proba2);
console.log("E vs F (proches):", EF.lambdas, EF.poisson.proba1, EF.poisson.probaN, EF.poisson.proba2, "\n");

check("Fort à domicile contre faible : victoire > 60 %", AJ.poisson.proba1 > 0.6);
check("Faible contre fort : victoire extérieur > victoire domicile", JA.poisson.proba2 > JA.poisson.proba1);
check("A–J et J–A donnent des résultats différents", AJ.poisson.proba1 !== JA.poisson.proba2);
let err = 0, errV5 = 0, nPairs = 0;
for (const h of ids) for (const a of ids) if (h !== a) {
  const P = pred(h, a);
  err += Math.abs(P.lambdas.lambdaDom - 1.45 * strength[h] / strength[a] ** 0.8) / (1.45 * strength[h] / strength[a] ** 0.8);
  err += Math.abs(P.lambdas.lambdaExt - 1.15 * strength[a] / strength[h] ** 0.8) / (1.15 * strength[a] / strength[h] ** 0.8);
  errV5 += Math.abs(1.35 - 1.45 * strength[h] / strength[a] ** 0.8) / (1.45 * strength[h] / strength[a] ** 0.8) + Math.abs(1.15 - 1.15 * strength[a] / strength[h] ** 0.8) / (1.15 * strength[a] / strength[h] ** 0.8);
  nPairs += 2;
}
console.log(`Écart buts attendus / réalité : V6 ${(100 * err / nPairs).toFixed(1)} % contre V5 ${(100 * errV5 / nPairs).toFixed(1)} %`);
check("V6 au moins 25 % plus précise que la V5", err < 0.75 * errV5);
check("Elo du fort > Elo du faible", AJ.teams.domicile.elo > AJ.teams.exterieur.elo + 100);
for (const P of [AJ, JA, EF]) {
  const s = P.poisson.proba1 + P.poisson.probaN + P.poisson.proba2;
  check(`1+N+2 = 100 % (${s.toFixed(3)})`, Math.abs(s - 1) < 0.003);
  check("Matrice 6x6 (format du site conservé)", P.poisson.matrix.length === 6 && P.poisson.matrix[0].length === 6);
  check("Cotes justes cohérentes", Math.abs(P.cotesJustes.cote1 - 1 / P.poisson.proba1) < 0.05);
}
const unknown = pred("Z", "Y");
check("Équipe inconnue : pas de plantage, fiabilité faible", unknown.donnees.fiabilite === "faible" && unknown.poisson.proba1 > 0);
check("Fiabilité élevée avec une saison complète", AJ.donnees.fiabilite === "élevée");

// Précision : le modèle retrouve-t-il les vraies forces ? (corrélation attaque estimée / force réelle)
const est = ids.map((t) => model.ratings[t].attHome + model.ratings[t].attAway);
const tru = ids.map((t) => strength[t]);
const mean = (v) => v.reduce((a, b) => a + b) / v.length;
const me = mean(est), mt = mean(tru);
const corr = est.reduce((s, e, i) => s + (e - me) * (tru[i] - mt), 0) / Math.sqrt(est.reduce((s, e) => s + (e - me) ** 2, 0) * tru.reduce((s, t) => s + (t - mt) ** 2, 0));
console.log(`\nCorrélation force estimée / force réelle : ${corr.toFixed(2)}`);
check("Le modèle retrouve la hiérarchie réelle (corrélation > 0,85)", corr > 0.85);

// Test de bout en bout de la route, avec fausse API football-data et faux cache
const kv = new Map();
const env = { FOOTBALL_DATA_KEY: "x", PRONO_CACHE: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) } };
let calls = 0;
globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ matches: [
  ...finished.map((f, i) => ({ id: i, status: "FINISHED", utcDate: f.date, homeTeam: { id: f.homeId }, awayTeam: { id: f.awayId }, score: { fullTime: { home: f.hg, away: f.ag } } })),
  { id: 999, status: "TIMED", utcDate: new Date(Date.now() + 86400000).toISOString(), homeTeam: { id: "A", name: "Équipe A", crest: "a.png" }, awayTeam: { id: "J", name: "Équipe J", crest: "j.png" }, score: { fullTime: { home: null, away: null } } },
] }) }; };
const pending = [];
const res = await worker.fetch(new Request("https://x/league-predictions?leagueId=61&season=2026"), env, { waitUntil: (p) => pending.push(p) });
await Promise.all(pending);
const body = await res.json();
check("Route /league-predictions répond", body.success && body.count === 1);
check("Champs de la V5 tous présents", ["matchId","leagueId","season","date","status","source","teams","lambdas","poisson","cotesJustes"].every((k) => k in body.predictions[0]));
check("Logo et nom transmis au site", body.predictions[0].teams.domicile.logo === "a.png");
await worker.fetch(new Request("https://x/league-predictions?leagueId=61&season=2026"), env, {});
check("Cache : 2e appel ne consomme pas la clé API", calls === 1);

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
