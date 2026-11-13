// ============================================================
// DUEL PRONO — Scores en direct (/live)
// Appelé par le site toutes les 60 secondes, seulement quand un match affiché est en cours.
//   - ESPN (gratuit, sans clé) : score et minute, rafraîchis toutes les 60 secondes.
//   - SportScore (Belgique, Écosse, CAN : ESPN ne les suit pas) : score et mi-temps chaque minute (pas de minute de jeu).
//   - SportAPI : secours si SportScore est indisponible ou ne donne pas le match.
//     Le quota gratuit est limité : un seul appel toutes les 15 minutes, partagé par tous les visiteurs
//     (toutes les 5 minutes pendant les 45 premières minutes d'un match qui manque encore au relevé : coup d'envoi retardé).
// Aucune écriture dans le cache pour ESPN (mémoire seulement) ; 4 écritures par heure au plus pour SportAPI.
// ============================================================
import { LEAGUES, currentSeason } from "./config.js";
import { ESPN_HEADERS } from "./sources.js";
import { allKey } from "./build.js";

const MIN = 60000;
export const LIVE_WINDOW_MS = 210 * MIN;   // un match est suivi jusqu'à 3 h 30 après son coup d'envoi
export const LIVE_ESPN_MS = 55000;         // ESPN : au plus un appel par compétition toutes les ~60 s
export const LIVE_SP_MS = 15 * MIN;        // SportAPI : au plus un appel toutes les 15 minutes
export const LIVE_SP_FAST_MS = 5 * MIN;    // match commencé mais pas encore dans le dernier relevé (coup d'envoi retardé) : nouvel essai après 5 min…
export const LIVE_SP_FAST_WINDOW = 45 * MIN; // …seulement pendant les 45 premières minutes du match (au plus 9 appels de plus par match)
export const LIVE_SP_KEY = "live:sp";
const ymd = (ts) => new Date(ts).toISOString().slice(0, 10).replace(/-/g, "");
const isoDay = (ts) => new Date(ts).toISOString().slice(0, 10);
export const liveKey = (leagueId, matchId) => `${leagueId}:${matchId}`;

// Compétition ESPN qui donne le direct d'une compétition du site (null : ESPN ne la suit pas en direct)
export function espnLiveCode(lg) {
  if (!lg) return null;
  if (lg.live === false) return null;
  if (typeof lg.live === "string") return lg.live.replace(/^espn:/, "");
  if (lg.src.startsWith("espn:")) return lg.src.slice(5);
  if (lg.backup?.startsWith("espn:")) return lg.backup.slice(5);
  return null;
}

// ---------- Rapprochement des matchs entre deux fournisseurs (les identifiants diffèrent) ----------
const STOP = new Set(["fc", "cf", "ac", "as", "sc", "afc", "ssc", "club", "de", "del", "da", "do", "the", "sv", "vfb", "vfl", "rc", "ogc", "cd", "ud", "sk", "fk", "kv", "kvc", "kaa", "krc", "rsc", "royal", "calcio", "futbol", "football", "spor", "kulubu", "as", "us", "ss", "ca", "sd", "rcd", "tsg", "1"]);
export const nameTokens = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w && !STOP.has(w));
export function nameSim(a, b) {
  const A = nameTokens(a), B = nameTokens(b);
  if (!A.length || !B.length) return 0;
  const same = (x, y) => x === y || (x.length >= 4 && y.length >= 4 && x.slice(0, 4) === y.slice(0, 4)) || (x.length >= 5 && y.length >= 5 && x.slice(0, 3) === y.slice(0, 3)); // Rennais/Rennes, München/Munich
  const [S, L] = A.length <= B.length ? [A, B] : [B, A];
  return S.filter((x) => L.some((y) => same(x, y))).length / S.length;
}
// ours : [{ key, ts, dom, ext }] ; events : [{ ts, home, away, ... }] → Map(key → event)
export function pairMatches(ours, events) {
  const out = new Map(), usedO = new Set(), usedE = new Set(), cands = [];
  const near = (o, e) => Math.abs(o.ts - e.ts) <= 45 * MIN;
  ours.forEach((o, i) => events.forEach((e, j) => {
    if (!near(o, e)) return;
    const s = nameSim(o.dom, e.home) + nameSim(o.ext, e.away);
    if (s >= 1) cands.push([s, i, j]);
  }));
  cands.sort((x, y) => y[0] - x[0]);
  for (const [, i, j] of cands) { if (usedO.has(i) || usedE.has(j)) continue; usedO.add(i); usedE.add(j); out.set(ours[i].key, events[j]); }
  // Une seule des deux équipes reconnue à moitié (noms très différents) : accepté seulement s'il ne reste
  // qu'un match de chaque côté à cette heure-là. Aucun nom en commun = aucun score (jamais le score d'un autre match).
  ours.forEach((o, i) => {
    if (usedO.has(i)) return;
    const freeE = events.map((e, j) => j).filter((j) => !usedE.has(j) && near(o, events[j]));
    const freeO = ours.map((x, k) => k).filter((k) => !usedO.has(k) && freeE.some((j) => near(ours[k], events[j])));
    if (freeE.length !== 1 || freeO.length !== 1) return;
    const e = events[freeE[0]];
    if (nameSim(o.dom, e.home) + nameSim(o.ext, e.away) >= 0.5) { usedO.add(i); usedE.add(freeE[0]); out.set(o.key, e); }
  });
  return out;
}

// ---------- ESPN ----------
const ESPN_OFF = ["STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_ABANDONED", "STATUS_SUSPENDED", "STATUS_DELAYED"];
export function espnEvents(data) {
  const out = [];
  for (const ev of data?.events || []) {
    const c = ev.competitions?.[0];
    const h = c?.competitors?.find((x) => x.homeAway === "home"), a = c?.competitors?.find((x) => x.homeAway === "away");
    const type = ev.status?.type || {};
    if (!h || !a || ESPN_OFF.includes(type.name)) continue;
    const d = parseInt(h.score, 10), e = parseInt(a.score, 10);
    const done = !!type.completed || type.state === "post";
    const playing = type.state === "in" || /IN_PROGRESS|HALFTIME|FIRST_HALF|SECOND_HALF|EXTRA_TIME|OVERTIME|SHOOTOUT|END_OF_REGULATION|END_OF_EXTRATIME/.test(type.name || "");
    if ((!done && !playing) || !Number.isFinite(d) || !Number.isFinite(e)) continue; // pas commencé : rien à afficher
    const half = /HALFTIME/.test(type.name || "");
    const clock = String(ev.status?.displayClock || "").trim();
    out.push({ id: String(ev.id), ts: Date.parse(ev.date), home: h.team?.displayName || "", away: a.team?.displayName || "", d, e, etat: done ? "fin" : half ? "mt" : "live", min: done || half || !clock || clock === "0'" ? null : clock });
  }
  return out;
}
const espnMemo = new Map(); // "code@jour" -> { t, events } (mémoire du Worker, partagée par les visiteurs)
async function espnLive(code, day, now) {
  const k = `${code}@${day}`, hit = espnMemo.get(k);
  if (hit && now - hit.t < LIVE_ESPN_MS) return hit.events;
  let events = hit?.events || [];
  try {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard?dates=${day}`, { headers: ESPN_HEADERS });
    if (res.ok) events = espnEvents(await res.json());
  } catch { /* ESPN indisponible : on garde le dernier score connu */ }
  espnMemo.set(k, { t: now, events });
  if (espnMemo.size > 60) espnMemo.delete(espnMemo.keys().next().value);
  return events;
}

// ---------- SportAPI (un appel donne tous les matchs du jour, toutes compétitions) ----------
const SP_DONE = ["FT", "AET", "PENS"];
export function spRows(rows, leagueIds) {
  const out = {};
  for (const m of rows || []) {
    if (!leagueIds.has(Number(m.league_id))) continue;
    const d = Number(m.home_score), e = Number(m.away_score);
    const done = SP_DONE.includes(m.status), playing = m.status === "LIVE";
    if ((!done && !playing) || m.home_score == null || m.away_score == null || !Number.isFinite(d) || !Number.isFinite(e)) continue;
    out[String(m.id)] = [d, e, done ? "fin" : String(m.minute || "").toUpperCase() === "HT" ? "mt" : "live"];
  }
  return out;
}
let spLast = 0; // garde-fou en mémoire : même si le cache refuse l'écriture, jamais plus d'un appel par quart d'heure (5 min si un match qui vient de commencer manque)
// matches : [{ id, ts }] suivis chez SportAPI. Relevé toutes les 15 min ; toutes les 5 min tant qu'un match qui vient de commencer manque encore.
async function spLive(env, days, leagueIds, now, matches = []) {
  let cached = null;
  try { const raw = await env.PRONO_CACHE.get(LIVE_SP_KEY); cached = raw ? JSON.parse(raw) : null; } catch { /* cache illisible */ }
  const waiting = !!cached && matches.some((m) => now - m.ts < LIVE_SP_FAST_WINDOW && !(m.id in (cached.rows || {})));
  const every = waiting ? LIVE_SP_FAST_MS : LIVE_SP_MS;
  if (cached && now - cached.at < every && days.every((d) => cached.days?.includes(d))) return cached;
  if (!env.SPORTAPI_KEY || now - spLast < every) return cached;
  spLast = now;
  const fresh = { at: now, days, rows: {} };
  try {
    for (const day of days) {
      const res = await fetch(`https://sportapi.ai/api/fixtures/date/${day}`, { headers: { "X-Api-Key": env.SPORTAPI_KEY, Accept: "application/json" } });
      if (!res.ok) throw new Error(`SportAPI [${res.status}]`);
      Object.assign(fresh.rows, spRows((await res.json())?.data, leagueIds));
    }
  } catch {
    // Quota atteint ou panne : on garde l'ancien score (avec son heure) et on ne réessaie pas avant 15 minutes
    if (cached) { fresh.rows = cached.rows; fresh.dataAt = cached.dataAt ?? cached.at; } else fresh.dataAt = 0;
  }
  try { await env.PRONO_CACHE.put(LIVE_SP_KEY, JSON.stringify(fresh), { expirationTtl: 6 * 3600 }); } catch { /* limite d'écritures : le garde-fou en mémoire prend le relais */ }
  return fresh;
}
export const resetLive = () => { espnMemo.clear(); scMemo.clear(); spLast = 0; liveMemo = null; };

// ---------- SportScore (sportscore.com : API publique gratuite, sans clé obligatoire) ----------
// Source principale du direct pour les compétitions SportAPI (Belgique, Écosse, CAN) : un appel par compétition et par minute.
// Conditions du niveau gratuit : lien visible « Powered by SportScore » dans le pied de page du site (index.html).
// Une clé gratuite optionnelle (secret SPORTSCORE_KEY, en-tête X-Api-Key) relève la limite de débit (~10 000 requêtes/jour/IP sans clé).
export const LIVE_SC_MS = 55000;
export function scEvents(data) {
  const out = [];
  for (const m of data?.matches || []) {
    const ts = Date.parse(m.time);
    if (!Number.isFinite(ts)) continue;
    const st = String(m.status || "").toLowerCase(), txt = String(m.status_text || "").toLowerCase();
    const d = parseInt(m.home_score, 10), e = parseInt(m.away_score, 10);
    let etat = null, per = null;
    if (Number.isFinite(d) && Number.isFinite(e)) {
      if (st === "finished") etat = "fin";
      else if (st === "live") {
        etat = /half ?time|^ht$|break/.test(txt) ? "mt" : "live";
        per = /1st/.test(txt) ? 1 : /2nd/.test(txt) ? 2 : /extra|overtime|penalt|shootout/.test(txt) ? "p" : null;
      }
    }
    out.push({ ts, home: String(m.home || ""), away: String(m.away || ""), d, e, etat, per }); // etat null : pas commencé, reporté…
  }
  return out;
}
const scMemo = new Map(); // "slug@jour" -> { t, events }
async function scLive(env, slug, day, now) {
  const k = `${slug}@${day}`, hit = scMemo.get(k);
  if (hit && now - hit.t < LIVE_SC_MS) return hit.events;
  let events = null; // null = SportScore indisponible : le moteur se rabat sur SportAPI
  try {
    const res = await fetch(`https://sportscore.com/api/v1/fixtures/?sport=football&competition=${slug}&date=${day}&limit=100`, { headers: { Accept: "application/json", "User-Agent": "DuelProno/1.0 (+https://duelprono.com)", ...(env.SPORTSCORE_KEY ? { "X-Api-Key": env.SPORTSCORE_KEY } : {}) } });
    if (res.ok) { const j = await res.json(); if (Array.isArray(j?.matches)) events = scEvents(j); }
  } catch { /* SportScore injoignable */ }
  scMemo.set(k, { t: now, events });
  if (scMemo.size > 40) scMemo.delete(scMemo.keys().next().value);
  return events;
}

// ---------- Réponse de /live ----------
let liveMemo = null;
export async function buildLive(env, now = Date.now()) {
  if (liveMemo && now - liveMemo.t < 45000 && now >= liveMemo.t) return liveMemo.v;
  const matchs = {};
  let all = null;
  try { const raw = env.PRONO_CACHE ? await env.PRONO_CACHE.get(allKey(currentSeason(new Date(now)))) : null; all = raw ? JSON.parse(raw) : null; } catch { /* rien de prêt */ }
  const current = (all?.matchs || []).filter((m) => { const ts = Date.parse(m.date); return ts <= now && ts > now - LIVE_WINDOW_MS; });
  const byLeague = new Map();
  for (const m of current) { if (!byLeague.has(m.leagueId)) byLeague.set(m.leagueId, []); byLeague.get(m.leagueId).push(m); }

  const spTodo = [];
  await Promise.all([...byLeague].map(async ([leagueId, list]) => {
    const lg = LEAGUES[leagueId], code = espnLiveCode(lg);
    const left = new Set(list.map((m) => String(m.matchId)));
    if (code) {
      const days = [...new Set(list.map((m) => ymd(Date.parse(m.date))))];
      const events = (await Promise.all(days.map((d) => espnLive(code, d, now)))).flat();
      const put = (m, ev) => { matchs[liveKey(leagueId, m.matchId)] = { d: ev.d, e: ev.e, etat: ev.etat, ...(ev.min ? { min: ev.min } : {}) }; left.delete(String(m.matchId)); };
      const byId = new Map(events.map((ev) => [ev.id, ev]));
      const others = [];
      for (const m of list) { const ev = m.source === "espn" ? byId.get(String(m.matchId)) : null; if (ev) put(m, ev); else if (m.source !== "espn") others.push(m); }
      if (others.length) {
        const pairs = pairMatches(others.map((m) => ({ key: String(m.matchId), ts: Date.parse(m.date), dom: m.teams.domicile.name, ext: m.teams.exterieur.name })), events);
        for (const m of others) { const ev = pairs.get(String(m.matchId)); if (ev) put(m, ev); }
      }
    }
    // SportScore d'abord (chaque minute, avec la mi-temps) ; SportAPI seulement pour les matchs que SportScore ne donne pas
    if (lg?.sc && lg.src.startsWith("sp:")) {
      const days = [...new Set(list.map((m) => isoDay(Date.parse(m.date))))];
      const lists = await Promise.all(days.map((d) => scLive(env, lg.sc, d, now)));
      if (lists.every(Boolean)) {
        const events = lists.flat();
        const pairs = pairMatches(list.map((m) => ({ key: String(m.matchId), ts: Date.parse(m.date), dom: m.teams.domicile.name, ext: m.teams.exterieur.name })), events);
        for (const m of list) {
          const ev = pairs.get(String(m.matchId));
          if (!ev) continue;
          if (ev.etat) { matchs[liveKey(leagueId, m.matchId)] = { d: ev.d, e: ev.e, etat: ev.etat, ...(ev.per ? { per: ev.per } : {}) }; left.delete(String(m.matchId)); }
          else if (now - Date.parse(m.date) < 30 * MIN) left.delete(String(m.matchId)); // pas encore commencé chez SportScore (coup d'envoi retardé) : rien à afficher, pas de score inventé
        }
      }
    }
    if (lg?.src.startsWith("sp:")) for (const m of list) if (left.has(String(m.matchId)) && m.source === "sportapi") spTodo.push(m);
  }));

  if (spTodo.length) {
    const ids = new Set(Object.values(LEAGUES).filter((lg) => lg.src.startsWith("sp:")).flatMap((lg) => lg.src.slice(3).split("+").map(Number)));
    const days = [...new Set(spTodo.map((m) => isoDay(Date.parse(m.date))))].sort();
    const sp = await spLive(env, days, ids, now, spTodo.map((m) => ({ id: String(m.matchId), ts: Date.parse(m.date) })));
    const at = sp ? sp.dataAt ?? sp.at : 0;
    if (sp && at) for (const m of spTodo) {
      const r = sp.rows?.[String(m.matchId)];
      // "at" : heure du relevé (ce score peut dater de 15 minutes, le site l'indique)
      if (r) matchs[liveKey(m.leagueId, m.matchId)] = { d: r[0], e: r[1], etat: r[2], at };
    }
  }
  const v = { success: true, ts: now, enCours: current.length, matchs };
  liveMemo = { t: now, v };
  return v;
}
