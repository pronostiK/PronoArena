// ============================================================
// DUEL PRONO — Sélections nationales (Ligue des Nations, Euro, Coupe du monde)
// Une sélection joue trop peu de matchs par saison pour être jugée sur sa seule compétition :
// on utilise un classement Elo calculé sur tous les matchs internationaux (méthode et réglages de PronostiK).
// ============================================================
import SEED from "./nations-seed.js";
import { MODEL } from "./config.js";

export const NATIONS_KEY = "nations:seed";
const SEED_URL = "https://raw.githubusercontent.com/pronostiK/PronostiK/main/data/nations-seed.json";

// Noms des fournisseurs de données -> noms de la base de résultats internationaux
const ALIASES = {
  "Türkiye": "Turkey", "Turkiye": "Turkey", "Czechia": "Czech Republic", "Bosnia-Herzegovina": "Bosnia and Herzegovina", "Bosnia & Herzegovina": "Bosnia and Herzegovina",
  "FYR Macedonia": "North Macedonia", "Macedonia": "North Macedonia", "Ireland": "Republic of Ireland", "USA": "United States", "Korea Republic": "South Korea",
  "IR Iran": "Iran", "Cape Verde Islands": "Cape Verde", "Congo DR": "DR Congo", "Côte d'Ivoire": "Ivory Coast",
};
export const nationName = (n) => { const x = String(n ?? "").normalize("NFC").trim(); return ALIASES[x] || x.replace("İ", "I"); };

// Mise à jour Elo après un match (poids : Ligue des Nations / qualifications = 40, écart de buts pris en compte)
const G = (gd) => (gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8);
export function applyResults(seed, matches, K = 40) {
  const P = seed.params, r = new Map(Object.entries(seed.ratings));
  for (const m of [...matches].sort((a, b) => a.ts - b.ts)) {
    if (!r.has(m.home) || !r.has(m.away)) continue;
    const rh = r.get(m.home), ra = r.get(m.away);
    const E = 1 / (1 + 10 ** (-(rh + P.H - ra) / 400)), S = m.hg > m.ag ? 1 : m.hg === m.ag ? 0.5 : 0, k = K * P.kMul * G(Math.abs(m.hg - m.ag));
    r.set(m.home, rh + k * (S - E)); r.set(m.away, ra - k * (S - E));
  }
  return r;
}

// Probabilités 1-N-2 et buts attendus d'après l'écart Elo (l'équipe qui reçoit a l'avantage du terrain)
const sig = (z) => 1 / (1 + Math.exp(-z));
export function nationsPredict(rh, ra, P) {
  const x = (rh + P.H - ra) / 100, q = P.ord, pA = sig(q.t1 - q.b * x), pAD = sig(q.t2 - q.b * x), g = P.goals;
  return { p: [1 - pAD, Math.max(1e-9, pAD - pA), pA], lam: [Math.exp(g.home.a + g.home.b * x), Math.exp(g.away.a - g.away.b * x)] };
}

// Le reste du site déduit tous les marchés d'une grille de scores (loi de Poisson). On garde le total de buts
// attendu et on répartit entre les deux équipes pour retrouver le même rapport de forces que les probabilités Elo.
function balance(lD, lE, rho) {
  const pois = (l, k) => { let q = Math.exp(-l); for (let i = 1; i <= k; i++) q *= l / i; return q; };
  let p1 = 0, p2 = 0, tot = 0;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const t = i === 0 && j === 0 ? 1 - lD * lE * rho : i === 0 && j === 1 ? 1 + lD * rho : i === 1 && j === 0 ? 1 + lE * rho : i === 1 && j === 1 ? 1 - rho : 1;
    const p = Math.max(0, pois(lD, i) * pois(lE, j) * t); tot += p; if (i > j) p1 += p; else if (j > i) p2 += p;
  }
  return (p1 - p2) / tot;
}
export function fitLambdas(pred, rho = MODEL.rho) {
  const total = pred.lam[0] + pred.lam[1], target = pred.p[0] - pred.p[2];
  let lo = 0.05, hi = 0.95;
  for (let k = 0; k < 30; k++) { const s = (lo + hi) / 2; if (balance(total * s, total * (1 - s), rho) < target) lo = s; else hi = s; }
  const s = (lo + hi) / 2;
  return [total * s, total * (1 - s)];
}

// Notes en vigueur : celles du fichier de départ, ou la version plus récente rafraîchie par le robot
export async function loadSeed(env) {
  let kv = null;
  try { const raw = env.PRONO_CACHE ? await env.PRONO_CACHE.get(NATIONS_KEY) : null; kv = raw ? JSON.parse(raw) : null; } catch { /* on garde le fichier de départ */ }
  return kv && kv.asOf >= SEED.asOf && kv.ratings && kv.params ? kv : SEED;
}
// Une fois par semaine, le robot reprend les notes à jour publiées par PronostiK (tous matchs internationaux)
export async function refreshSeed(env) {
  const res = await fetch(SEED_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`notes des sélections [${res.status}]`);
  const d = await res.json(), cur = await loadSeed(env);
  if (!d?.asOf || !d.params?.ord || !d.ratings || Object.keys(d.ratings).length < 150 || d.asOf <= cur.asOf) return false;
  await env.PRONO_CACHE.put(NATIONS_KEY, JSON.stringify({ asOf: d.asOf, params: d.params, ratings: d.ratings }));
  return true;
}

// Contexte de calcul pour une compétition de sélections : notes à jour des matchs joués depuis la date du fichier
export async function nationalContext(env, finished, teams) {
  const seed = await loadSeed(env), since = Date.parse(seed.asOf + "T23:59:59Z");
  const nameOf = (id) => nationName(teams[id]?.[0]);
  const after = finished.filter((f) => f.ts > since).map((f) => ({ ts: f.ts, home: nameOf(f.homeId), away: nameOf(f.awayId), hg: f.hg, ag: f.ag }));
  return { ratings: applyResults(seed, after), params: seed.params, nameOf, asOf: seed.asOf, unknown: new Set() };
}
