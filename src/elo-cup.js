// Elo commun des clubs pour les coupes d'Europe (23-24/11/2026). Le modèle de buts ne voit que la saison en cours et compresse les
// favoris ; l'Elo, lui, résume plusieurs saisons et relie les championnats entre eux par les matchs européens.
// Point de départ : elo-cup-seed.js ; chaque match de coupe terminé après sa date le met à jour (même formule que le calcul du seed).
// Mesuré sur 420 matchs réels : 25 à 50 % d'Elo améliore le Brier sur 2025-26 et 2026-27 (test/lab/RESULTATS-CDC-ELO.md).
import { CUP_ELO_SEED } from "./elo-cup-seed.js";
import { MODEL } from "./config.js";

export const eloKey = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ø/g, "o").replace(/ł/g, "l").replace(/[^a-z0-9 ]/g, " ")
  .replace(/\b(fc|cf|sc|ac|as|afc|fk|sk|rc|ssc|us|ud|cd|sv|bv|vfb|vfl|tsg|rb|ca|sl|club|de|the|1907|1909|1913|1893|calcio|balompie|bk|if|ik|pae)\b/g, " ").replace(/\s+/g, " ").trim();

const KEYS = Object.keys(CUP_ELO_SEED.ratings);
// Nom du site -> clé du seed : égalité, sinon tous les mots du plus court contenus dans l'autre, à condition qu'une seule clé convienne
export function seedKeyFor(name) {
  const k = eloKey(name); if (!k) return null;
  if (CUP_ELO_SEED.ratings[k] !== undefined) return k;
  const tk = new Set(k.split(" "));
  const hits = KEYS.filter((s) => { const ts = new Set(s.split(" ")); const [small, big] = ts.size <= tk.size ? [ts, tk] : [tk, ts]; return [...small].every((w) => big.has(w)); });
  return hits.length === 1 ? hits[0] : null;
}

// teams : { id: [nom, logo] } ; finished : matchs de la coupe [{homeId, awayId, hg, ag, ts}] -> { elo: Map(id -> Elo), inconnus: [noms] }
export function cupEloFor(teams, finished) {
  const E = MODEL.cupElo, byKey = {}, elo = new Map(), inconnus = [];
  for (const [id, v] of Object.entries(teams || {})) {
    const k = seedKeyFor(v?.[0]);
    if (k) { elo.set(String(id), CUP_ELO_SEED.ratings[k]); byKey[k] = String(id); } else inconnus.push(v?.[0] || id);
  }
  for (const f of [...finished].filter((x) => x.ts > CUP_ELO_SEED.asOf).sort((a, b) => a.ts - b.ts)) {
    const h = String(f.homeId), a = String(f.awayId);
    if (!elo.has(h) || !elo.has(a)) continue; // une équipe sans Elo : le match ne change rien
    const rh = elo.get(h), ra = elo.get(a), exp = 1 / (1 + Math.pow(10, (ra - (rh + E.home)) / 400));
    const res = f.hg > f.ag ? 1 : f.hg === f.ag ? 0.5 : 0;
    const d = E.K * (1 + Math.log(1 + Math.abs(f.hg - f.ag))) * (res - exp);
    elo.set(h, rh + d); elo.set(a, ra - d);
  }
  return { elo, inconnus };
}
