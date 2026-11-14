// ============================================================
// DUEL PRONO — xG réels (Soccer Data, plan gratuit : 50 appels/jour, 10/min, saison en cours seule)
// Affichage uniquement : le calcul des probabilités n'utilise PAS les xG.
// Le robot collecte, à chaque passage, au plus quelques appels : recherche de la compétition, liste des matchs terminés,
// puis les xG match par match (un appel par match), les plus récents d'abord. Tout est gardé dans une seule clé KV.
// ============================================================
import { nameSim } from "./live.js";
import { kvGet } from "./sources.js";

export const XG_KEY = "xg:all";
const BASE = "https://api.soccer-data.co/v1";
const HOUR = 3600000, DAY = 24 * HOUR;
export const XG_DAILY = 44;          // appels par jour (la limite gratuite est de 50)
const PER_TICK = 3;                  // appels max par passage du robot (limite : 10 par minute)
const LIST_MS = 24 * HOUR;           // liste des matchs d'une compétition : au plus une fois par jour (5 appels sur 44)
const COMP_MS = 7 * DAY;             // identifiants de compétition / saison revérifiés chaque semaine
const KEEP_MS = 90 * DAY;
export const XG_RECENT = 5;          // moyenne sur les 5 derniers matchs
export const XG_MIN = 3;             // moins de 3 matchs : on n'affiche rien (tout ou rien)

// Compétitions couvertes : identifiant Duel Prono → pays et noms Soccer Data
export const XG_LEAGUES = {
  39: { country: "England", names: ["premier league"] },
  140: { country: "Spain", names: ["la liga", "laliga"] },
  135: { country: "Italy", names: ["serie a"] },
  78: { country: "Germany", names: ["bundesliga"] },
  61: { country: "France", names: ["ligue 1"] },
};

// Noms qui ne se rapprochent pas tout seuls (ajouter ici les cas listés dans /status → xg.sansCorrespondance)
const ALIAS = {
  psg: "paris saint germain", wolves: "wolverhampton wanderers", spurs: "tottenham hotspur", inter: "internazionale",
  "man city": "manchester city", "man united": "manchester united", "man utd": "manchester united",
};
const canon = (n) => { const k = String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); return ALIAS[k] || n; };
export const sameTeam = (a, b) => nameSim(canon(a), canon(b)) >= 1;

// Un match a des xG quand ils sont écrits (pas null = en attente, pas -1 = indisponible)
const has = (e) => typeof e[4] === "number" && e[4] >= 0;

const emptyState = () => ({ comps: {}, listed: {}, m: {}, day: "", used: 0, unm: {} });

async function call(env, st, path) {
  st.used++;
  const r = await fetch(BASE + path, { headers: { "X-Api-Key": env.SOCCERDATA_KEY, Accept: "application/json" } });
  if (!r.ok) throw new Error(`Soccer Data [${r.status}] ${path.split("?")[0]}`);
  return r.json();
}

// Un passage du robot : renvoie une ligne de rapport, ou null s'il n'y a rien à faire
export async function refreshXg(env, now = Date.now()) {
  if (!env.SOCCERDATA_KEY || !env.PRONO_CACHE) return null;
  const st = (await kvGet(env, XG_KEY)) || emptyState();
  const today = new Date(now).toISOString().slice(0, 10);
  if (st.day !== today) { st.day = today; st.used = 0; }
  if ((st.pauseUntil || 0) > now) return null;
  if (st.used >= XG_DAILY) return null;
  const before = JSON.stringify(st);
  let report = null;
  try {
    report = await step(env, st, now);
  } catch (e) {
    // refus (429 / 401 / 403) : on attend avant de réessayer, sans insister
    st.pauseUntil = now + (/\[429\]/.test(String(e.message)) ? 15 * 60000 : 2 * HOUR);
    st.erreur = String(e.message).slice(0, 120);
    report = `xG : ERREUR ${e.message}`;
  }
  if (!report) { delete st.erreur; }
  for (const [id, e] of Object.entries(st.m)) if (now - e[1] > KEEP_MS) delete st.m[id];
  if (JSON.stringify(st) !== before) await env.PRONO_CACHE.put(XG_KEY, JSON.stringify(st));
  return report;
}

async function step(env, st, now) {
  // 1. Compétitions et saisons à (re)trouver : une compétition par passage (2 appels)
  const needComp = Object.entries(XG_LEAGUES).find(([id]) => { const c = st.comps[id]; return !c || now - c.at > COMP_MS; });
  if (needComp) {
    const [id, lg] = needComp;
    const s = await call(env, st, `/competitions?search=${encodeURIComponent(lg.names[0])}&country=${encodeURIComponent(lg.country)}&per_page=10`);
    const comp = (s.data || []).find((c) => c.type === "league" && c.xg_available && lg.names.includes(String(c.name).toLowerCase()));
    if (!comp) { st.comps[id] = { err: "compétition introuvable", at: now - COMP_MS + DAY }; return `xG ${id} : compétition introuvable`; }
    const d = await call(env, st, `/competitions/${comp.id}`);
    const sid = d.data?.current_season_id;
    if (!sid) { st.comps[id] = { err: "saison introuvable", at: now - COMP_MS + DAY }; return `xG ${id} : saison introuvable`; }
    st.comps[id] = { cid: comp.id, sid, at: now };
    return `xG ${id} : ${comp.name} ${sid}`;
  }
  // 2. Liste des matchs terminés (un appel) : les nouveaux matchs avec xG entrent « en attente »
  const needList = Object.keys(XG_LEAGUES).find((id) => st.comps[id]?.cid && now - (st.listed[id] || 0) > LIST_MS);
  if (needList) {
    const c = st.comps[needList];
    const r = await call(env, st, `/matches?competition_id=${c.cid}&season_id=${c.sid}&status=finished&sort=-utc_date&per_page=100`);
    let added = 0;
    for (const m of r.data || []) {
      if (!m.xg_available || st.m[m.id]) continue;
      const ts = Date.parse(m.utc_date);
      if (!ts || now - ts > KEEP_MS) continue;
      st.m[m.id] = [Number(needList), ts, m.home_team?.name || "", m.away_team?.name || "", null, null];
      added++;
    }
    st.listed[needList] = now;
    return `xG ${needList} : ${(r.data || []).length} matchs terminés, ${added} nouveaux`;
  }
  // 3. xG match par match, les plus récents d'abord
  const todo = Object.entries(st.m).filter(([, e]) => e[4] === null).sort((a, b) => b[1][1] - a[1][1]).slice(0, PER_TICK);
  let got = 0;
  for (const [id, e] of todo) {
    if (st.used >= XG_DAILY) break;
    const r = await call(env, st, `/matches/${id}/stats`);
    const x = r.data?.overview?.expected_goals?.all;
    if (x && Number.isFinite(+x.home) && Number.isFinite(+x.away)) { e[4] = +x.home; e[5] = +x.away; got++; }
    else { e[4] = -1; e[5] = -1; } // pas d'xG pour ce match : on n'y revient pas
  }
  return todo.length ? `xG : ${got}/${todo.length} matchs récupérés (${st.used}/${XG_DAILY} appels aujourd'hui)` : null;
}

// Moyenne des xG d'une équipe sur ses derniers matchs (null si moins de XG_MIN matchs)
export function xgTeam(st, leagueId, teamName) {
  if (!st?.m) return null;
  const rows = [];
  for (const [, e] of Object.entries(st.m)) {
    if (e[0] !== Number(leagueId) || !has(e)) continue;
    if (sameTeam(teamName, e[2])) rows.push([e[1], e[4], e[5]]);
    else if (sameTeam(teamName, e[3])) rows.push([e[1], e[5], e[4]]);
  }
  rows.sort((a, b) => b[0] - a[0]);
  const last = rows.slice(0, XG_RECENT);
  if (last.length < XG_MIN) return null;
  const avg = (i) => Math.round((last.reduce((s, r) => s + r[i], 0) / last.length) * 100) / 100;
  return { pour: avg(1), contre: avg(2), n: last.length };
}

// Pour /status : avancement par compétition
export function xgStatus(st, ourNames = {}) {
  if (!st) return null;
  const out = { appelsAujourdhui: st.used, jour: st.day, erreur: st.erreur || null, pause: st.pauseUntil && st.pauseUntil > Date.now() ? new Date(st.pauseUntil).toISOString() : null, competitions: {} };
  for (const id of Object.keys(XG_LEAGUES)) {
    const ms = Object.values(st.m).filter((e) => e[0] === Number(id));
    const sd = [...new Set(ms.flatMap((e) => [e[2], e[3]]))];
    const ours = ourNames[id] || [];
    out.competitions[id] = {
      matchs: ms.length, avecXg: ms.filter(has).length, enAttente: ms.filter((e) => e[4] === null).length,
      sansCorrespondance: ours.length ? sd.filter((n) => !ours.some((o) => sameTeam(o, n))) : undefined,
    };
  }
  return out;
}
