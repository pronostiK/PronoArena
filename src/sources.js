// ============================================================
// DUEL PRONO — Sources de données (football-data.org et ESPN)
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

// ---------- ESPN (un jour par appel) ----------
const ESPN_SKIP = ["STATUS_CANCELED", "STATUS_POSTPONED", "STATUS_ABANDONED", "STATUS_FORFEIT"];
const ymd = (ts) => new Date(ts).toISOString().slice(0, 10).replace(/-/g, "");

// ESPN n'accepte qu'un seul jour par appel (vérifié en réel : toute période renvoie 400).
// Budget par passage du robot : Cloudflare gratuit limite à 50 appels sortants par exécution.
export const ESPN_BUDGET = 30; // rythme prudent : ESPN refuse (403) quand on l'appelle trop vite
// En-tête de navigateur neutre (sans nom de site) pour les appels ESPN
export const ESPN_HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Accept: "application/json" };
const espnBudget = { left: ESPN_BUDGET };
export const resetEspnBudget = () => { espnBudget.left = ESPN_BUDGET; };
export const espnBudgetLeft = () => espnBudget.left;

async function espnDay(league, ts) {
  if (espnBudget.left-- <= 0) throw new Error("ESPN : budget d'appels du passage épuisé");
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${ymd(ts)}`, { headers: ESPN_HEADERS });
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
    const t = Date.parse(ev.date);
    if (type.completed) {
      const hg = parseInt(h.score, 10), ag = parseInt(a.score, 10);
      if (Number.isFinite(hg) && Number.isFinite(ag)) finished.push([ev.id, String(h.id), String(a.id), hg, ag, t]);
    } else upcoming.push([ev.id, String(h.id), String(a.id), t, type.name || "STATUS_SCHEDULED"]);
  }
  return { teams, finished, upcoming };
}

// Coût d'une mise à jour ESPN (en appels)
export const ESPN_RECENT_DAYS = 4;   // J-2 à J+1 : résultats et matchs en direct, à chaque mise à jour
export const ESPN_EXTRA_DAYS = 10;   // remplissage de la saison ou calendrier à venir

export async function fetchEspnIncremental(league, season, prev, now = Date.now(), extra = ESPN_EXTRA_DAYS) {
  const start = Date.UTC(season, 6, 1);
  const end = Math.min(now, Date.UTC(season + 1, 6, 1));
  const current = end === now;
  const st = prev || { teams: {}, finished: [], upcoming: [], cursor: start, complete: false, dayAt: {} };
  const fin = new Map(st.finished.map((f) => [String(f[0]), f]));
  const up = new Map((st.upcoming || []).map((u) => [String(u[0]), u]));
  const teams = { ...st.teams }, dayAt = { ...(st.dayAt || {}) };
  let cursor = st.cursor ?? start, complete = !!st.complete;

  const days = [];
  if (current) for (let d = -2; d <= 1; d++) days.push(now + d * DAY);
  let budget = extra;
  // Remplissage de la saison, 10 jours par mise à jour
  while (!complete && budget > 0) {
    if (cursor >= end - 2 * DAY) { complete = true; break; }
    days.push(cursor); cursor += DAY; budget--;
  }
  if (cursor >= end - 2 * DAY) complete = true;
  // Calendrier des 2 semaines à venir : chaque jour revu toutes les 12 h
  if (current) for (let d = 2; d <= 14 && budget > 0; d++) {
    const t = now + d * DAY;
    if (now - (dayAt[ymd(t)] || 0) > 12 * 3600000) { days.push(t); budget--; }
  }

  for (const t of days) {
    const w = await espnDay(league, t);
    dayAt[ymd(t)] = now;
    Object.assign(teams, w.teams);
    for (const f of w.finished) { fin.set(String(f[0]), f); up.delete(String(f[0])); }
    for (const u of w.upcoming) up.set(String(u[0]), u);
  }
  for (const [id, u] of up) if (u[3] < now - 6 * 3600000 || fin.has(id)) up.delete(id);
  for (const k of Object.keys(dayAt)) if (dayAt[k] < now - 2 * DAY && k < ymd(now)) delete dayAt[k];

  return {
    teams, finished: [...fin.values()].sort((a, b) => a[5] - b[5]),
    upcoming: current ? [...up.values()] : [], complete, cursor, dayAt,
  };
}

// ---------- SportAPI (un jour par appel, mais toutes les compétitions du jour dans la même réponse) ----------
// Un appel par date alimente d'un coup toutes les compétitions SportAPI suivies : on met donc à jour
// toutes les sources "sp:" d'une même saison ensemble (refreshSportapi). Une source "sp:72+123"
// réunit plusieurs compétitions SportAPI (ex. CAN : qualifications + phase finale).
export const SP_BUDGET = 15; // appels par passage du robot (le plan gratuit limite à 50 appels sortants par exécution)
const spBudget = { left: SP_BUDGET };
const spMemo = new Map();
export const resetSpBudget = () => { spBudget.left = SP_BUDGET; spMemo.clear(); };
export const spBudgetLeft = () => spBudget.left;
const SP_FINISHED = ["FT", "AET", "PENS"];
const SP_SKIP = ["Postponed", "Cancelled", "Canceled", "Suspended", "Abandoned"];
export const SP_RECENT_DAYS = 2;     // aujourd'hui et hier, à chaque mise à jour
export const spLeagueIds = (src) => src.slice(3).split("+").map(Number);
const isoDay = (ts) => new Date(ts).toISOString().slice(0, 10);

async function spDay(env, date) {
  if (spMemo.has(date)) return spMemo.get(date);
  if (!env.SPORTAPI_KEY) throw new Error("SportAPI : clé SPORTAPI_KEY absente");
  if (spBudget.left-- <= 0) throw new Error("SportAPI : budget d'appels du passage épuisé");
  const p = (async () => {
    const res = await fetch(`https://sportapi.ai/api/fixtures/date/${date}`, { headers: { "X-Api-Key": env.SPORTAPI_KEY, Accept: "application/json" } });
    if (!res.ok) throw new Error(`SportAPI ${date} [${res.status}]`);
    const d = await res.json();
    if (!Array.isArray(d?.data)) throw new Error(`SportAPI ${date} : réponse inattendue`);
    return d.data;
  })();
  spMemo.set(date, p);
  p.catch(() => {}); // l'erreur est gérée par l'appelant
  return p;
}

// Met à jour d'un coup toutes les sources "sp:" d'une saison. Renvoie { src: { changed, data } }
export async function refreshSportapi(env, srcs, season, now = Date.now(), extra = 40) {
  const start = Date.UTC(season, 6, 1), seasonEnd = Date.UTC(season + 1, 6, 1);
  const current = now >= start && now < seasonEnd;
  const end = Math.min(now, seasonEnd);
  const prevs = await Promise.all(srcs.map((s) => kvGet(env, srcKey(s, season))));
  const state = new Map(srcs.map((s, i) => {
    const pv = prevs[i];
    return [s, { ids: spLeagueIds(s), teams: { ...(pv?.teams || {}) }, fin: new Map((pv?.finished || []).map((f) => [String(f[0]), f])), up: new Map((pv?.upcoming || []).map((u) => [String(u[0]), u])) }];
  }));
  // Curseur commun : le plus en retard (une source ajoutée plus tard repart du début de saison)
  let cursor = Math.min(...prevs.map((pv) => pv?.cursor ?? start));
  const dayAt = {};
  for (const pv of prevs) for (const [k, v] of Object.entries(pv?.dayAt || {})) dayAt[k] = Math.max(dayAt[k] || 0, v);
  let complete = prevs.every((pv) => pv && pv.complete);

  const days = [];
  if (current) for (let d = SP_RECENT_DAYS - 1; d >= 0; d--) days.push(now - d * DAY);
  let budget = Math.max(0, Math.min(extra, spBudget.left) - days.length);
  while (!complete && budget > 0) {
    if (cursor >= end - (current ? DAY : 0)) { complete = true; break; }
    days.push(cursor); cursor += DAY; budget--;
  }
  if (cursor >= end - (current ? DAY : 0)) complete = true;
  // Calendrier des 2 semaines à venir : demain revu toutes les 3 h, les jours suivants toutes les 12 h
  if (current) for (let d = 1; d <= 14 && budget > 0; d++) {
    const t = now + d * DAY;
    if (t >= seasonEnd) break;
    if (now - (dayAt[isoDay(t)] || 0) > (d === 1 ? 3 : 12) * 3600000) { days.push(t); budget--; }
  }

  for (const t of days) {
    const rows = await spDay(env, isoDay(t));
    dayAt[isoDay(t)] = now;
    for (const m of rows) {
      const ts = Date.parse(m.kickoff_utc);
      if (!Number.isFinite(ts) || ts < start || ts >= seasonEnd || !m.home_id || !m.away_id) continue;
      const h = String(m.home_id), a = String(m.away_id), id = String(m.id), lid = Number(m.league_id);
      for (const st of state.values()) {
        if (!st.ids.includes(lid)) continue;
        if (SP_SKIP.includes(m.status)) { st.up.delete(id); continue; }
        st.teams[h] = [m.home_team || "Domicile", m.home_logo || null];
        st.teams[a] = [m.away_team || "Extérieur", m.away_logo || null];
        if (SP_FINISHED.includes(m.status)) {
          const hg = Number(m.home_score), ag = Number(m.away_score);
          if (m.home_score == null || m.away_score == null || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;
          st.fin.set(id, [id, h, a, hg, ag, ts]); st.up.delete(id);
        } else st.up.set(id, [id, h, a, ts, m.status || "Scheduled"]);
      }
    }
  }
  for (const k of Object.keys(dayAt)) if (dayAt[k] < now - 2 * DAY && k < isoDay(now)) delete dayAt[k];

  const out = {};
  for (const [src, st] of state) {
    for (const [id, u] of st.up) if (u[3] < now - 6 * 3600000 || st.fin.has(id)) st.up.delete(id);
    const data = { src, season, updatedAt: now, teams: st.teams, finished: [...st.fin.values()].sort((x, y) => x[5] - y[5]), upcoming: current ? [...st.up.values()] : [], complete, cursor, dayAt };
    const changed = await kvPutIfChanged(env, srcKey(src, season), data, (o) => [o.finished, o.upcoming, o.complete, o.cursor]);
    out[src] = { changed, data };
  }
  return out;
}

export async function fetchSource(src, season, env, prev, now = Date.now(), extra = ESPN_EXTRA_DAYS) {
  const [provider, code] = src.split(":");
  if (provider === "fd") return fetchFootballData(code, season, env.FOOTBALL_DATA_KEY);
  if (provider === "espn") return fetchEspnIncremental(code, season, prev, now, extra);
  if (provider === "sp") throw new Error("SportAPI : mise à jour groupée (refreshSportapi)");
  throw new Error(`Source inconnue ${src}`);
}

// Met à jour une source et l'enregistre. Renvoie { changed, data }
export async function refreshSource(env, src, season, now = Date.now(), extra = ESPN_EXTRA_DAYS) {
  const key = srcKey(src, season);
  const prev = await kvGet(env, key);
  const fresh = await fetchSource(src, season, env, prev, now, extra);
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
  date: new Date(ts).toISOString(), ts, status, source: provider === "fd" ? "football-data" : provider === "sp" ? "sportapi" : "espn",
}));
