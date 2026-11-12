// Variantes expérimentales du calcul des forces (jamais utilisées par le site).
import { MODEL } from "../../src/config.js";
import { computeTeamRatings } from "../../src/model.js";

const DAY = 86400000;
// Forces attaque / défense avec poids qui décroît avec l'ancienneté : w = 0,5^(jours / demi-vie)
// opts : { H: demi-vie en jours, K: lissage, s: part spécifique domicile/extérieur, cap: nb max de matchs (0 = aucun plafond) }
export function ratingsDecay(finished, nowTs, opts) {
  const { H, K = MODEL.priorMatches, s = MODEL.specificWeight, cap = 0 } = opts;
  let sH = 0, sA = 0;
  for (const f of finished) { sH += f.hg; sA += f.ag; }
  const n = finished.length;
  const blend = Math.min(1, n / MODEL.minLeagueMatches);
  const avgHome = Math.max(0.5, blend * (n ? sH / n : MODEL.defaultAvgHome) + (1 - blend) * MODEL.defaultAvgHome);
  const avgAway = Math.max(0.4, blend * (n ? sA / n : MODEL.defaultAvgAway) + (1 - blend) * MODEL.defaultAvgAway);
  const byTeam = {};
  for (const f of finished) { (byTeam[f.homeId] ||= []).push(f); (byTeam[f.awayId] ||= []).push(f); }
  const ratings = {};
  for (const [id, list] of Object.entries(byTeam)) {
    const recent = [...list].sort((a, b) => b.ts - a.ts).slice(0, cap || list.length);
    const v = { hf: 0, ha: 0, hw: 0, af: 0, aa: 0, aw: 0 };
    for (const f of recent) {
      const x = Math.pow(0.5, Math.max(0, nowTs - f.ts) / DAY / H);
      if (f.homeId === id) { v.hf += x * f.hg / avgHome; v.ha += x * f.ag / avgAway; v.hw += x; }
      else { v.af += x * f.ag / avgAway; v.aa += x * f.hg / avgHome; v.aw += x; }
    }
    const attAll = (v.hf + v.af + K) / (v.hw + v.aw + K), defAll = (v.ha + v.aa + K) / (v.hw + v.aw + K);
    ratings[id] = {
      attHome: s * (v.hf + K) / (v.hw + K) + (1 - s) * attAll, defHome: s * (v.ha + K) / (v.hw + K) + (1 - s) * defAll,
      attAway: s * (v.af + K) / (v.aw + K) + (1 - s) * attAll, defAway: s * (v.aa + K) / (v.aw + K) + (1 - s) * defAll,
      attAll, defAll, played: recent.length,
    };
  }
  return { avgHome, avgAway, ratings, matchesAnalysed: n, elo: {} };
}
export const ratingsCurrent = (finished) => ({ ...computeTeamRatings(finished), elo: {} });
