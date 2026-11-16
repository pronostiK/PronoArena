// ============================================================
// DUEL PRONO — logos des clubs pour les championnats suivis via SportAPI (qui ne fournit pas de logos) : Belgique, Écosse.
// Source : SportScore (fixtures par jour, champs home_logo / away_logo). Le robot remonte dans le temps, 3 jours par passage,
// jusqu'à avoir vu tous les clubs, puis garde le résultat dans KV (`clublogos:<ligue>`). Affichage uniquement.
// Règle « tout ou rien » : les logos ne sont appliqués à un championnat que si TOUS ses clubs ont été retrouvés.
// ============================================================
import { LEAGUES } from "./config.js";
import { kvGet } from "./sources.js";
import { nameSim, nameTokens } from "./live.js";

const DAY = 86400000, PER_TICK = 3, SCAN_DAYS = 80, REDO_MS = 45 * DAY;
export const logoKey = (id) => `clublogos:${id}`;
export const usesClubLogos = (lg) => !!(lg && lg.sc && !lg.national && String(lg.src).startsWith("sp:"));

export async function refreshClubLogos(env, now = Date.now()) {
  if (!env.PRONO_CACHE) return null;
  for (const [id, lg] of Object.entries(LEAGUES)) {
    if (!usesClubLogos(lg)) continue;
    let rec = await kvGet(env, logoKey(id));
    if (rec?.done && now - rec.done < REDO_MS) continue;
    if (!rec || rec.done) rec = { m: rec?.m || {}, n: 0, done: 0 }; // nouveau passage (on garde ce qu'on sait déjà)
    let calls = 0;
    for (; calls < PER_TICK && rec.n < SCAN_DAYS; calls++, rec.n++) {
      const day = new Date(now - rec.n * DAY).toISOString().slice(0, 10);
      try {
        const res = await fetch(`https://sportscore.com/api/v1/fixtures/?sport=football&competition=${lg.sc}&date=${day}&limit=100`, { headers: { Accept: "application/json", "User-Agent": "DuelProno/1.0 (+https://duelprono.com)", ...(env.SPORTSCORE_KEY ? { "X-Api-Key": env.SPORTSCORE_KEY } : {}) } });
        if (!res.ok) break; // on réessaiera au prochain passage
        const j = await res.json();
        for (const x of j?.matches || []) {
          if (x.home && /^https?:\/\//.test(x.home_logo || "")) rec.m[x.home] = x.home_logo;
          if (x.away && /^https?:\/\//.test(x.away_logo || "")) rec.m[x.away] = x.away_logo;
        }
      } catch { break; }
    }
    if (rec.n >= SCAN_DAYS) rec.done = now;
    await env.PRONO_CACHE.put(logoKey(id), JSON.stringify(rec));
    return `Logos clubs ${lg.name} : ${Object.keys(rec.m).length} clubs, ${rec.n}/${SCAN_DAYS} jours${rec.done ? " (terminé)" : ""}`;
  }
  return null;
}

// Cherche le logo d'un club par son nom (noms légèrement différents d'un fournisseur à l'autre).
// Le meilleur candidat doit être net : s'il y a égalité entre deux clubs (Club Brugge / Cercle Brugge), on ne prend rien.
export function clubLogo(map, name) {
  const A = nameTokens(name);
  let best = null, bs = 0, tie = false;
  for (const [n, u] of Object.entries(map || {})) {
    const B = nameTokens(n);
    if (!A.length || !B.length || Math.min(nameSim(name, n), nameSim(n, name)) < 0.99) continue;
    const s = Math.min(A.length, B.length) / Math.max(A.length, B.length);
    if (s > bs) { bs = s; best = u; tie = false; } else if (s === bs && u !== best) tie = true;
  }
  return bs >= 0.5 && !tie ? best : null;
}

// teams : { id: [nom, logo] } ; tout ou rien : rien n'est modifié si un seul club manque.
export function applyClubLogos(teams, map) {
  const found = {};
  for (const [id, t] of Object.entries(teams || {})) {
    if (t[1]) continue;
    const u = clubLogo(map, t[0]);
    if (!u) return false;
    found[id] = u;
  }
  for (const [id, u] of Object.entries(found)) teams[id][1] = u;
  return true;
}
