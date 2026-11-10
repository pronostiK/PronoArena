// ============================================================
// PRONO ARENA — Sources de données (football-data.org et ESPN)
// Format compact stocké dans le cache KV, clé "src:<source>@<saison>" :
// { src, season, updatedAt, complete, cursor,
//   teams: { id: [nom, logo] },
//   finished: [[matchId, homeId, awayId, butsDom, butsExt, timestamp]],
//   upcoming: [[matchId, homeId, awayId, timestamp, statut]] }
// ============================================================

const DAY = 86400000;
export const srcKey = (src, season) => `src:${src}@${season}`;

// ---------- KV ----------
export async function kvGet(env, key) {
  if (!env.PRONO_CACHE) return null;
  const raw = await env.PRONO_CACHE.get(key);
  return raw ? JSON.parse(raw) : null;
}
// N'écrit que si le contenu a changé (le plan gratuit limite les écritures à 1000/jour)
export async function kvPutIfChanged(env, key, value, compareFields, opts) {
  if (!env.PRONO_CACHE) return false;
  const body = JSON.stringify(value);
  const old = await env.PRONO_CACHE.get(key);
  if (old) {
    const pick = (o) => JSON.stringify(compareFields ? compareFields(o) : o);
    if (pick(JSON.parse(old)) === pick(value)) return false;
  }
  await env.PRONO_CACHE.put(key, body, opts);
  return true;
}

// ---------- football-data.org (une saison entière en un appel) ----------
const FD_UPCOMING = ["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "LIVE"];

export async function fetchFootballData(code, season, key) {
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/matches?season=${season}`, { headers: { "X-Auth-Token": key } });
  if (!res.ok) throw new Error(`football-data ${code} ${season} [${res.status}]`);
  const data = await res.json();
  const teams = {}, finished = [], upcoming = [];
  for (const m of data.matches || []) {
    const h = m.homeTeam, a = m.awayTeam;
    if (!h?.id || !a?.id) continue;
    teams[h.id] = [h.name || h.shortName || "Domicile", h.crest || null];
    teams[a.id] = [a.name || a.shortName || "Extérieur", a.crest || null];
    const ts = Date.parse(m.utcDate);
    const ft = m.score?.fullTime;
    if (m.status === "FINISHED" && ft?.home != null && ft?.away != null) finished.push([m.id, String(h.id), String(a.id), ft.home, ft.away, ts]);
    else if (FD_UPCOMING.includes(m.status)) upcoming.push([m.id, String(h.id), String(a.id), ts, m.status]);
  }
  return { teams, finished, upcoming, complete: true, cursor: null };
}

// ---------- ESPN (fenêtres de 90 jours pour rester léger) ----------
const ESPN_SKIP = ["STATUS_CANCELED", "STATUS_POSTPONED", "STATUS_ABANDONED", "STATUS_FORFEIT"];
const ymd = (ts) => new Date(ts).toISOString().slice(0, 10).replace(/-/g, "");

async function espnWindow(league, from, to) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${ymd(from)}-${ymd(to)}&limit=1000`);
  if (!res.ok) throw new Error(`ESPN ${league} [${res.status}]`);
  const data = await res.json();
  const teams = {}, finished = [], upcoming = [];
  for (const ev of data.events || []) {
    const c = ev.competitions?.[0];
    const h = c?.competitors?.find((x) => x.homeAway === "home");
    const a = c?.competitors?.find((x) => x.homeAway === "away");
    if (!h?.id || !a?.id) continue;
    const type = ev.status?.type || {};
    if (ESPN_SKIP.includes(type.name)) continue;
    teams[h.id] = [h.team?.displayName || "Domicile", h.team?.logo || null];
    teams[a.id] = [a.team?.displayName || "Extérieur", a.team?.logo || null];
    const ts = Date.parse(ev.date);
    if (type.completed) {
      const hg = parseInt(h.score, 10), ag = parseInt(a.score, 10);
      if (Number.isFinite(hg) && Number.isFinite(ag)) finished.push([ev.id, String(h.id), String(a.id), hg, ag, ts]);
    } else upcoming.push([ev.id, String(h.id), String(a.id), ts, type.name || "STATUS_SCHEDULED"]);
  }
  return { teams, finished, upcoming };
}

// Remplit la saison par morceaux de 90 jours, puis se contente de mettre à jour les derniers jours
export async function fetchEspnIncremental(league, season, prev, now = Date.now()) {
  const start = Date.UTC(season, 6, 1);
  const end = Math.min(now, Date.UTC(season + 1, 6, 1));
  const state = prev || { teams: {}, finished: [], upcoming: [], cursor: start, complete: false };
  const fin = new Map(state.finished.map((f) => [String(f[0]), f]));
  let teams = { ...state.teams }, upcoming = state.upcoming, cursor = state.cursor ?? start, complete = state.complete;

  let from, to;
  if (!complete) { from = cursor; to = Math.min(cursor + 90 * DAY, end); }
  else { from = Math.max(start, end - 4 * DAY); to = end; }
  const w = await espnWindow(league, from, to);
  for (const f of w.finished) fin.set(String(f[0]), f);
  Object.assign(teams, w.teams);
  if (!complete) { cursor = to; complete = to >= end - 3 * DAY; }

  // Matchs à venir (saison en cours seulement)
  if (end === now) {
    const up = await espnWindow(league, now - DAY, now + 21 * DAY);
    Object.assign(teams, up.teams);
    for (const f of up.finished) fin.set(String(f[0]), f);
    upcoming = up.upcoming;
  } else upcoming = [];

  return { teams, finished: [...fin.values()].sort((a, b) => a[5] - b[5]), upcoming, complete, cursor };
}

export async function fetchSource(src, season, env, prev, now = Date.now()) {
  const [provider, code] = src.split(":");
  if (provider === "fd") return fetchFootballData(code, season, env.FOOTBALL_DATA_KEY);
  if (provider === "espn") return fetchEspnIncremental(code, season, prev, now);
  throw new Error(`Source inconnue ${src}`);
}

// Met à jour une source et l'enregistre. Renvoie { changed, data }
export async function refreshSource(env, src, season, now = Date.now()) {
  const key = srcKey(src, season);
  const prev = await kvGet(env, key);
  const fresh = await fetchSource(src, season, env, prev, now);
  const data = { src, season, updatedAt: now, ...fresh };
  const changed = await kvPutIfChanged(env, key, data, (o) => [o.finished, o.upcoming, o.complete, o.cursor]);
  return { changed, data };
}

// Conversion du format compact vers les objets du moteur
export const toFinished = (s) => (s?.finished || []).map(([id, homeId, awayId, hg, ag, ts]) => ({ id, homeId, awayId, hg, ag, ts, season: s.season }));
export const toUpcoming = (s, provider) => (s?.upcoming || []).map(([matchId, h, a, ts, status]) => ({
  matchId, teamDomId: h, teamExtId: a,
  domName: s.teams[h]?.[0] || "Domicile", extName: s.teams[a]?.[0] || "Extérieur",
  domLogo: s.teams[h]?.[1] || null, extLogo: s.teams[a]?.[1] || null,
  date: new Date(ts).toISOString(), ts, status, source: provider === "fd" ? "football-data" : "espn",
}));
