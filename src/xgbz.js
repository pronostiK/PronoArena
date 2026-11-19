// ============================================================
// DUEL PRONO — xG réels (Bzzoiro / BSD) pour l'affichage, en parallèle de Soccer Data (xg.js) pendant la période de test.
// Affichage uniquement : le calcul des probabilités n'utilise PAS les xG (décision de l'utilisateur, piste 6 : gain non confirmé).
// Licence BSD (lue le 19/11/2026) : affichage dans le site autorisé, stockage interne autorisé, jamais de données brutes republiées
// (aucune route ne renvoie la liste des xG : seulement une moyenne sur 5 matchs, par équipe).
// Même forme d'état que xg.js (st.m : id → [compétition, horodatage, domicile, extérieur, xG dom., xG ext.]) pour réutiliser xgTeam / xgStatus.
// Seuls les xG « mesurés » sont gardés (jamais « estimés » par le fournisseur) : tout ou rien.
// Secret Cloudflare requis : BZZOIRO_TOKEN (sans lui, rien ne s'exécute et le site garde Soccer Data).
// ============================================================
import { kvGet } from "./sources.js";
import { currentSeason } from "./config.js";

export const XGB_KEY = "xgb:all";
const BASE = "https://sports.bzzoiro.com/api/v2";
const HOUR = 3600000, DAY = 24 * HOUR;
export const XGB_DAILY = 1000;       // appels par jour (quota gratuit : 7 500, partagé avec l'export GitHub)
const PER_TICK = 2;                  // appels max par passage du robot (les appels sortants d'un passage sont plafonnés à 50, tous fournisseurs confondus)
const LIST_MS = 3 * HOUR;            // liste des matchs terminés d'une compétition : toutes les 3 h
const COMP_MS = 7 * DAY;
const KEEP_MS = 90 * DAY;
const PAGE = 200;

// Compétition Duel Prono → pays et noms Bzzoiro (comme l'export test/lab/export_xg_bzzoiro.py)
export const XGB_LEAGUES = {
  39: { country: "England", names: ["premier league"] },
  140: { country: "Spain", names: ["la liga", "laliga", "primera division", "primera división"] },
  135: { country: "Italy", names: ["serie a"] },
  78: { country: "Germany", names: ["bundesliga"] },
  61: { country: "France", names: ["ligue 1"] },
};

const emptyState = () => ({ comps: {}, listed: {}, lp: {}, m: {}, day: "", used: 0 });
const arr = (d, key) => (Array.isArray(d) ? d : Array.isArray(d?.[key]) ? d[key] : Array.isArray(d?.results) ? d.results : []);

async function call(env, st, path) {
  st.used++;
  const r = await fetch(BASE + path, { headers: { Authorization: "Token " + env.BZZOIRO_TOKEN, Accept: "application/json", "User-Agent": "DuelProno/1.0 (+https://duelprono.com)" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Bzzoiro [${r.status}] ${path.split("?")[0]}`);
  return r.json();
}

// xG d'un match à partir de /events/{id}/stats/ : { h, a } si MESURÉ sur tous les tirs, sinon null (même règle que l'export)
export function extractXg(s) {
  if (!s || typeof s !== "object") return null;
  const x = s.stats || {}, xd = x.home?.xg || {}, xe = x.away?.xg || {};
  if (!Number.isFinite(+xd.actual) || !Number.isFinite(+xe.actual) || xd.actual === null || xe.actual === null) return null;
  const shots = s.shotmap || [];
  if (s.xg_estimated || xd.estimated || xe.estimated || shots.some((t) => t.xg_estimated)) return null;
  return { h: +xd.actual, a: +xe.actual };
}

export async function refreshXgBz(env, now = Date.now()) {
  if (!env.BZZOIRO_TOKEN || !env.PRONO_CACHE) return null;
  const st = (await kvGet(env, XGB_KEY)) || emptyState();
  const today = new Date(now).toISOString().slice(0, 10);
  if (st.day !== today) { st.day = today; st.used = 0; }
  if ((st.pauseUntil || 0) > now) return null;
  if (st.used >= XGB_DAILY) return null;
  const before = JSON.stringify(st);
  let report = null;
  try {
    report = await step(env, st, now);
  } catch (e) {
    st.pauseUntil = now + (/\[429\]/.test(String(e.message)) ? 3 * HOUR : 2 * HOUR); // refus : on attend, sans insister
    st.erreur = String(e.message).slice(0, 120);
    report = `xG Bzzoiro : ERREUR ${e.message}`;
  }
  if (!report) delete st.erreur;
  for (const [id, e] of Object.entries(st.m)) if (now - e[1] > KEEP_MS) delete st.m[id];
  if (JSON.stringify(st) !== before) await env.PRONO_CACHE.put(XGB_KEY, JSON.stringify(st));
  return report;
}

async function step(env, st, now) {
  const year = currentSeason(new Date(now));
  // 1. Compétition et saison à (re)trouver : une compétition par passage (2 appels)
  const needComp = Object.entries(XGB_LEAGUES).find(([id]) => { const c = st.comps[id]; return !c || now - c.at > COMP_MS; });
  if (needComp) {
    const [id, lg] = needComp;
    const d = await call(env, st, `/leagues/?country=${encodeURIComponent(lg.country)}&limit=200`);
    const lgBz = arr(d).find((l) => !l.is_women && lg.names.includes(String(l.name || "").trim().toLowerCase()));
    if (!lgBz) { st.comps[id] = { err: "compétition introuvable", at: now - COMP_MS + 6 * HOUR }; return `xG Bzzoiro ${id} : compétition introuvable`; }
    const s = await call(env, st, `/leagues/${lgBz.id}/seasons/`);
    const season = arr(s, "seasons").find((x) => Number(x.year) === year);
    if (!season) { st.comps[id] = { err: "saison introuvable", at: now - COMP_MS + DAY }; return `xG Bzzoiro ${id} : saison ${year} introuvable`; }
    st.comps[id] = { cid: lgBz.id, sid: season.id, at: now };
    delete st.listed[id]; delete st.lp[id];
    return `xG Bzzoiro ${id} : ${lgBz.name} ${year}`;
  }
  // 2. Liste des matchs terminés (une page par appel) : les nouveaux matchs avec xG entrent « en attente »
  const needList = Object.keys(XGB_LEAGUES).find((id) => st.comps[id]?.cid && (st.lp[id] !== undefined || now - (st.listed[id] || 0) > LIST_MS));
  if (needList) {
    const c = st.comps[needList], offset = st.lp[needList] || 0;
    const d = await call(env, st, `/events/?league_id=${c.cid}&season_id=${c.sid}&status=finished&limit=${PAGE}&offset=${offset}`);
    const evs = arr(d);
    let added = 0;
    for (const e of evs) {
      const key = String(e.id);
      if (!e.has_xg || st.m[key]) continue;
      const ts = Date.parse(e.event_date);
      if (!ts || now - ts > KEEP_MS) continue;
      st.m[key] = [Number(needList), ts, e.home_team || "", e.away_team || "", null, null];
      added++;
    }
    if (d && d.next && evs.length) st.lp[needList] = offset + PAGE; // page suivante au prochain passage
    else { delete st.lp[needList]; st.listed[needList] = now; }
    return `xG Bzzoiro ${needList} : ${evs.length} matchs lus, ${added} nouveaux`;
  }
  // 3. xG match par match, les plus récents d'abord
  const todo = Object.entries(st.m).filter(([, e]) => e[4] === null).sort((a, b) => b[1][1] - a[1][1]).slice(0, PER_TICK);
  let got = 0;
  for (const [id, e] of todo) {
    if (st.used >= XGB_DAILY) break;
    const x = extractXg(await call(env, st, `/events/${id}/stats/`));
    if (x) { e[4] = x.h; e[5] = x.a; got++; }
    else { e[4] = -1; e[5] = -1; } // pas d'xG mesuré : on n'y revient pas
  }
  return todo.length ? `xG Bzzoiro : ${got}/${todo.length} matchs récupérés (${st.used}/${XGB_DAILY} appels aujourd'hui)` : null;
}
