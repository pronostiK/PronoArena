// ============================================================
// DUEL PRONO — Historique des xG mesurés (Bzzoiro) pour le suivi expérimental M7X (autorisé par l'auditeur le 20/11/2026).
// Aucun effet sur le site ni sur M0 / M7 : ces xG ne servent qu'à la 3e prédiction non affichée du journal (src/suivi.js).
// Stockage : base D1 (tables xg_hist et xg_etat), jamais dans le cache KV, jamais renvoyé par une route publique, jamais dans le dépôt
// (licence Bzzoiro : stockage interne autorisé, pas de republication des données brutes).
// Budget : le robot l'appelle seulement dans un passage où les xG d'affichage (xgbz.js) n'ont rien fait, et au plus 10 appels
// Bzzoiro par passage (le même plafond que xgbz.js) ; 1 500 appels par jour au plus. Les xG déjà connus par xgbz.js sont recopiés sans appel.
// Saisons : la précédente (une seule fois) et la saison en cours (liste revue toutes les 3 h).
// ============================================================
import { kvGet } from "./sources.js";
import { currentSeason } from "./config.js";
import { XGB_KEY, XGB_LEAGUES, extractXg, passCalls } from "./xgbz.js";

const BASE = "https://sports.bzzoiro.com/api/v2";
const HOUR = 3600000, DAY = 24 * HOUR;
const PER_TICK = 10, DAILY = 1500, LIST_MS = 3 * HOUR, COMP_MS = 7 * DAY, PAGE = 200;
export const XGX_LEAGUES = XGB_LEAGUES; // les 5 grands championnats

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS xg_hist (id TEXT PRIMARY KEY, ligue INTEGER NOT NULL, saison INTEGER NOT NULL, ts INTEGER NOT NULL, dom TEXT, ext TEXT, bd INTEGER, be INTEGER, xgd REAL, xge REAL, statut TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS xg_hist_ligue ON xg_hist(ligue, saison)`,
  `CREATE TABLE IF NOT EXISTS xg_etat (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL)`,
];
const ready = new WeakSet();
async function ensure(env) {
  if (!env.DB) return false;
  if (ready.has(env.DB)) return true;
  for (const q of SCHEMA) await env.DB.prepare(q).run();
  ready.add(env.DB);
  return true;
}
async function getState(env) {
  const r = await env.DB.prepare("SELECT valeur FROM xg_etat WHERE cle = 'etat'").first();
  return r ? JSON.parse(r.valeur) : { comps: {}, listed: {}, lp: {}, day: "", used: 0 };
}
const putState = (env, st) => env.DB.prepare("INSERT INTO xg_etat (cle, valeur) VALUES ('etat', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").bind(JSON.stringify(st)).run();
const arr = (d, key) => (Array.isArray(d) ? d : Array.isArray(d?.[key]) ? d[key] : Array.isArray(d?.results) ? d.results : []);

// Un passage : au plus PER_TICK appels. Renvoie une ligne de rapport ou null.
export async function refreshXgHist(env, now = Date.now(), budget = PER_TICK) {
  if (!env.BZZOIRO_TOKEN || budget <= 0 || !(await ensure(env))) return null;
  const st = await getState(env);
  const today = new Date(now).toISOString().slice(0, 10);
  if (st.day !== today) { st.day = today; st.used = 0; }
  if ((st.pauseUntil || 0) > now || st.used >= DAILY) return null;
  const before = JSON.stringify(st);
  let n = 0;
  const call = async (path) => {
    n++; st.used++;
    const r = await fetch(BASE + path, { headers: { Authorization: "Token " + env.BZZOIRO_TOKEN, Accept: "application/json", "User-Agent": "DuelProno/1.0 (+https://duelprono.com)" } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Bzzoiro [${r.status}] ${path.split("?")[0]}`);
    return r.json();
  };
  let report = null;
  try {
    report = await step(env, st, now, call, Math.min(budget, PER_TICK));
  } catch (e) {
    st.pauseUntil = now + (/\[429\]/.test(String(e.message)) ? 3 * HOUR : 2 * HOUR);
    st.erreur = String(e.message).slice(0, 120);
    report = `xG historique : ERREUR ${e.message}`;
  }
  if (JSON.stringify(st) !== before) await putState(env, st);
  return report;
}

async function step(env, st, now, call, budget) {
  const year = currentSeason(new Date(now)), years = [year - 1, year];
  // 1. Compétition et identifiants de saison (2 appels, une compétition par passage)
  if (budget < 2) return null;
  const needComp = Object.entries(XGX_LEAGUES).find(([id]) => { const c = st.comps[id]; return !c || now - c.at > COMP_MS; });
  if (needComp) {
    const [id, lg] = needComp;
    const d = await call(`/leagues/?country=${encodeURIComponent(lg.country)}&limit=200`);
    const l = arr(d).find((x) => !x.is_women && lg.names.includes(String(x.name || "").trim().toLowerCase()));
    if (!l) { st.comps[id] = { err: "compétition introuvable", at: now - COMP_MS + 6 * HOUR }; return `xG historique ${id} : compétition introuvable`; }
    const s = arr(await call(`/leagues/${l.id}/seasons/`), "seasons");
    const sids = {}; for (const y of years) { const x = s.find((z) => Number(z.year) === y); if (x) sids[y] = x.id; }
    st.comps[id] = { cid: l.id, sids, at: now };
    return `xG historique ${id} : saisons ${Object.keys(sids).join(", ")}`;
  }
  // 2. Listes des matchs terminés : saison précédente une fois, saison en cours toutes les 3 h (une page par appel)
  for (const [id, c] of Object.entries(st.comps)) {
    if (!c.cid) continue;
    for (const y of years) {
      const sid = c.sids?.[y]; if (!sid) continue;
      const k = `${id}@${y}`, page = st.lp[k];
      const due = page !== undefined || (y < year ? !st.listed[k] : now - (st.listed[k] || 0) > LIST_MS);
      if (!due) continue;
      const off = page || 0;
      const d = await call(`/events/?league_id=${c.cid}&season_id=${sid}&status=finished&limit=${PAGE}&offset=${off}`);
      const evs = arr(d);
      const stmts = evs.filter((e) => Date.parse(e.event_date) < now).map((e) => env.DB.prepare("INSERT OR IGNORE INTO xg_hist (id, ligue, saison, ts, dom, ext, bd, be, xgd, xge, statut) VALUES (?,?,?,?,?,?,?,?,NULL,NULL,?)")
        .bind(String(e.id), +id, y, Date.parse(e.event_date), e.home_team || "", e.away_team || "", Number.isFinite(+e.home_score) ? +e.home_score : null, Number.isFinite(+e.away_score) ? +e.away_score : null, e.has_xg ? "attente" : "sans"));
      if (stmts.length) await env.DB.batch(stmts);
      if (d?.next && evs.length) st.lp[k] = off + PAGE; else { delete st.lp[k]; st.listed[k] = now; }
      return `xG historique ${k} : ${evs.length} matchs lus`;
    }
  }
  // 3. xG match par match, les plus récents d'abord ; recopiés sans appel quand l'affichage (xgbz.js) les connaît déjà
  const { results: todo } = await env.DB.prepare("SELECT id FROM xg_hist WHERE statut = 'attente' ORDER BY ts DESC LIMIT ?").bind(PER_TICK * 3).all();
  if (!todo?.length) { if (!st.complet && Object.keys(st.comps).length === Object.keys(XGX_LEAGUES).length && !Object.keys(st.lp).length && Object.keys(st.listed).length >= 2 * Object.keys(XGX_LEAGUES).length) { st.complet = now; return "xG historique : remplissage terminé"; } return null; }
  const shown = (await kvGet(env, XGB_KEY))?.m || {};
  const up = [];
  let calls = 0, got = 0;
  for (const { id } of todo) {
    const e = shown[id];
    let x;
    if (e && e[4] !== null) x = e[4] >= 0 ? { h: e[4], a: e[5] } : null;
    else { if (calls >= budget || st.used >= DAILY) break; calls++; x = extractXg(await call(`/events/${id}/stats/`)); }
    up.push(env.DB.prepare("UPDATE xg_hist SET xgd = ?, xge = ?, statut = ? WHERE id = ?").bind(x ? x.h : null, x ? x.a : null, x ? "mesure" : "non", id));
    if (x) got++;
  }
  if (up.length) await env.DB.batch(up);
  return `xG historique : ${got}/${up.length} xG mesurés (${st.used}/${DAILY} appels aujourd'hui)`;
}

// xG mesurés d'un championnat (saison en cours et précédente), au format attendu par matchCorners :
// [date (minuit UTC), domicile, extérieur, buts dom., buts ext., xG dom., xG ext.] ; les matchs sans xG servent à reconnaître les équipes
export async function xgRows(env, leagueId, season) {
  if (!(await ensure(env))) return { rows: [], complet: false };
  const st = await getState(env);
  const { results } = await env.DB.prepare("SELECT ts, dom, ext, bd, be, xgd, xge, statut FROM xg_hist WHERE ligue = ? AND saison >= ? AND bd IS NOT NULL AND be IS NOT NULL").bind(+leagueId, season - 1).all();
  const day = (ts) => Math.floor(ts / DAY) * DAY;
  return { rows: (results || []).map((r) => [day(r.ts), r.dom, r.ext, r.bd, r.be, r.statut === "mesure" ? r.xgd : null, r.statut === "mesure" ? r.xge : null]), complet: !!st.complet };
}

export async function xgHistStatus(env) {
  if (!env.DB || !env.BZZOIRO_TOKEN) return { actif: false };
  if (!(await ensure(env))) return { actif: false };
  const st = await getState(env);
  const { results } = await env.DB.prepare("SELECT ligue, saison, statut, COUNT(*) AS n FROM xg_hist GROUP BY ligue, saison, statut").all();
  const par = {};
  for (const r of results || []) ((par[`${r.ligue}@${r.saison}`] ||= {})[r.statut] = r.n);
  return { actif: true, remplissageTermine: st.complet ? new Date(st.complet).toISOString() : null, appelsAujourdhui: st.used, ...(st.erreur ? { erreur: st.erreur } : {}), parSaison: par };
}
