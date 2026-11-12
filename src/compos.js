// ============================================================
// DUEL PRONO — Compositions (onze aligné au dernier match, source ESPN)
// Méthode reprise de PronostiK. Stockage : une seule clé "compos:all"
//   { idmap: { fdId: espnId }, idmapAt, teams: { espnId: { ev, d, opp, side, score, f, xi:[[n°, nom, poste]] } } }
// ============================================================
import { LEAGUES } from "./config.js";
import { kvGet, srcKey, ESPN_HEADERS } from "./sources.js";

export const COMPOS_KEY = "compos:all";
const DAY = 86400000;

// Onze de départ d'un match ESPN (format identique à PronostiK)
export async function espnLineup(slug, id) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${id}`, { headers: ESPN_HEADERS });
  if (!res.ok) throw new Error(`ESPN compo [${res.status}]`);
  const j = await res.json();
  const out = {};
  for (const r of j.rosters || []) {
    const xi = (r.roster || []).filter((p) => p.starter)
      .map((p) => [p.jersey || "", p.athlete?.shortName || p.athlete?.displayName || "", p.position?.abbreviation || "", +p.formationPlace || 0])
      .sort((a, b) => (a[3] || 99) - (b[3] || 99)).map((p) => [p[0], p[1], p[2]]);
    if (xi.length >= 10) out[String(r.team?.id || "")] = { f: r.formation || "", xi, side: r.homeAway };
  }
  return out;
}

// Correspondance identifiants football-data -> ESPN, déduite des matchs communs
// (même jour, même score) entre une compétition football-data et sa source de secours ESPN.
export async function buildIdMap(env, season) {
  const votes = {};
  for (const lg of Object.values(LEAGUES)) {
    if (!lg.src.startsWith("fd:") || !lg.backup) continue;
    const [fd, es] = await Promise.all([kvGet(env, srcKey(lg.src, season)), kvGet(env, srcKey(lg.backup, season))]);
    if (!fd || !es) continue;
    const byDay = new Map();
    for (const e of es.finished) { const k = `${Math.floor(e[5] / DAY)}|${e[3]}-${e[4]}`; (byDay.get(k) || byDay.set(k, []).get(k)).push(e); }
    for (const f of fd.finished) {
      const cands = [-1, 0, 1].flatMap((dd) => byDay.get(`${Math.floor(f[5] / DAY) + dd}|${f[3]}-${f[4]}`) || []);
      for (const e of cands) {
        for (const [a, b] of [[f[1], e[1]], [f[2], e[2]]]) { const v = (votes[a] ||= {}); v[b] = (v[b] || 0) + 1; }
      }
    }
  }
  const map = {};
  for (const [fdId, v] of Object.entries(votes)) {
    const s = Object.entries(v).sort((a, b) => b[1] - a[1]);
    if (s[0][1] >= 3 && (!s[1] || s[0][1] >= 2 * s[1][1])) map[fdId] = s[0][0];
  }
  return map;
}

// Dernier match terminé de chaque équipe dans une source ESPN (calculé à chaque mise à jour)
export function lastEvents(data) {
  const last = {};
  for (const f of data.finished || []) {
    for (const [id, opp, side] of [[f[1], f[2], "D"], [f[2], f[1], "E"]]) {
      if (!last[id] || last[id][1] < f[5]) last[id] = [f[0], f[5], opp, side, side === "D" ? `${f[3]}-${f[4]}` : `${f[4]}-${f[3]}`];
    }
  }
  return last;
}

// Choisit au plus une équipe dont la composition est à mettre à jour, et la récupère.
export async function refreshOneCompo(env, index, season, now) {
  const compos = (await kvGet(env, COMPOS_KEY)) || { idmap: {}, idmapAt: 0, teams: {} };

  // Correspondance des identifiants : recalculée une fois par jour (ce passage ne fait que ça)
  if (now - (compos.idmapAt || 0) > DAY) {
    compos.idmap = await buildIdMap(env, season);
    compos.idmapAt = now;
    await env.PRONO_CACHE.put(COMPOS_KEY, JSON.stringify(compos));
    return `correspondance des équipes : ${Object.keys(compos.idmap).length} équipes`;
  }

  // Équipes qui ont un match à venir, traduites en identifiants ESPN
  const wanted = new Set();
  for (const [k, ids] of Object.entries(index)) {
    if (!k.startsWith("teams:")) continue;
    const lg = LEAGUES[k.slice(6)];
    if (!lg || lg.src === "espn:uefa.nations" || lg.src.startsWith("sp:")) continue; // pas de compositions pour les sélections ni pour SportAPI (ses identifiants ne sont pas ceux d'ESPN)
    for (const id of ids) { const e = lg.src.startsWith("fd:") ? compos.idmap[id] : id; if (e) wanted.add(e); }
  }

  // Dernier match de chaque équipe, toutes sources ESPN confondues
  let todo = null;
  for (const [k, last] of Object.entries(index)) {
    if (!k.startsWith("last:")) continue;
    const slug = k.slice(5).split("@")[0].replace("espn:", "");
    for (const id of wanted) {
      const ev = last[id];
      if (!ev || compos.teams[id]?.ev === ev[0]) continue;
      if (compos.teams[id] && compos.teams[id].ts >= ev[1]) continue;
      if (!todo || ev[1] > todo.ev[1]) todo = { id, slug, ev };
    }
  }
  if (!todo) return null;

  const lineup = await espnLineup(todo.slug, todo.ev[0]);
  const names = index[`names:${todo.slug}`] || {};
  const mine = lineup[todo.id];
  compos.teams[todo.id] = mine
    ? { ev: todo.ev[0], ts: todo.ev[1], opp: names[todo.ev[2]] || null, side: todo.ev[3], score: todo.ev[4], f: mine.f, xi: mine.xi }
    : { ev: todo.ev[0], ts: todo.ev[1], indisponible: true };
  // L'adversaire aussi : même match, même appel
  const oppId = String(todo.ev[2]), theirs = lineup[oppId];
  if (theirs && (!compos.teams[oppId] || compos.teams[oppId].ts <= todo.ev[1])) {
    compos.teams[oppId] = { ev: todo.ev[0], ts: todo.ev[1], opp: names[todo.id] || null, side: todo.ev[3] === "D" ? "E" : "D", score: todo.ev[4].split("-").reverse().join("-"), f: theirs.f, xi: theirs.xi };
  }
  await env.PRONO_CACHE.put(COMPOS_KEY, JSON.stringify(compos));
  return `composition ${todo.slug} équipe ${todo.id}: ${mine ? "ok" : "indisponible"}`;
}

export function composFor(compos, provider, teamId) {
  if (!compos || provider === "sportapi") return null; // pas de composition pour SportAPI (ses identifiants ne sont pas ceux d'ESPN)
  const id = provider === "football-data" ? compos.idmap?.[teamId] : teamId;
  const c = id && compos.teams?.[id];
  return c && !c.indisponible ? c : null;
}
