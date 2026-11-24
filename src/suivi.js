// ============================================================
// DUEL PRONO — Suivi prospectif M0 / M7 (validation demandée par l'auditeur indépendant le 20/11/2026)
// À chaque recalcul d'un championnat par le robot, on enregistre, pour chaque match À VENIR, les probabilités 1-N-2
// réellement produites par le moteur en production (M7 : promus + Elo 25 % + corners 30 %) et celles de l'ancien
// moteur (M0), calculées au même moment avec les mêmes données. Aucune modification du moteur.
// Journal en AJOUT SEUL dans la base D1 (table suivi) : une ligne seulement quand les probabilités d'un match changent ;
// les modifications et suppressions sont refusées par la base (déclencheurs). Chaque ligne est chaînée à la précédente
// (empreinte SHA-256) ; l'empreinte de tête est publiée sur GitHub toutes les 30 min (.github/workflows/suivi-empreintes.yml),
// ce qui date de façon vérifiable tout ce qui a été enregistré avant. Protocole : test/lab/PROTOCOLE-SUIVI.md.
// Charge : aucun appel extérieur ; une lecture et au plus quelques écritures D1 par championnat recalculé.
// ============================================================
import { MODEL } from "./config.js";
import { CORNERS_LEAGUES, CORNERS_SHARE, LIAISON_STRICTE, LIAISON_VERSION } from "./corners.js";

// Les 9 championnats de l'audit (football-data.co.uk) ; Portugal (94) suivi à part dans le bilan
export const SUIVI_LEAGUES = new Set([61, 39, 140, 135, 78, 94, 88, 40, 62]);
// M7C : même journal (chaîne d'empreintes conservée) ; la rupture se lit sur la version et sur l'empreinte des réglages
export const SUIVI_VERSION = LIAISON_STRICTE ? "M0/M7C : M7 + liaison stricte des corners (rupture documentée dans test/lab/liaison/RUPTURE-M7C.md)" : "M0/M7 figés le 20/11/2026 (moteur 8044a83)";
// Réglages figés : toute différence change l'empreinte des réglages enregistrée sur chaque ligne
export const SUIVI_PARAMS = JSON.stringify({
  windowMatches: MODEL.windowMatches, recentMatches: MODEL.recentMatches, recentWeight: MODEL.recentWeight, priorMatches: MODEL.priorMatches,
  specificWeight: MODEL.specificWeight, rho: MODEL.rho, promoted: MODEL.promoted, promotedMaxTeams: MODEL.promotedMaxTeams, eloMix: MODEL.eloMix,
  eloK: MODEL.eloK, eloHomeAdv: MODEL.eloHomeAdv, eloSeasonCarry: MODEL.eloSeasonCarry, cornersShare: CORNERS_SHARE, cornersLeagues: Object.keys(CORNERS_LEAGUES).sort(),
  ...(LIAISON_STRICTE ? { liaison: LIAISON_VERSION } : {}), // absent tant que l'interrupteur est éteint : empreinte M0/M7 inchangée
});

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Contenu d'une ligne, écrit toujours dans le même ordre (c'est ce texte qui est haché)
export const rowText = (r) => [r.cree_le, r.ligue, r.match, r.coup_envoi, r.dom, r.ext, r.m0, r.m7, r.infos, r.params].join("|");

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS suivi (seq INTEGER PRIMARY KEY AUTOINCREMENT, cree_le INTEGER NOT NULL, ligue INTEGER NOT NULL, match TEXT NOT NULL, coup_envoi INTEGER NOT NULL, dom TEXT, ext TEXT, m0 TEXT NOT NULL, m7 TEXT NOT NULL, infos TEXT, params TEXT NOT NULL, contenu TEXT NOT NULL, prec TEXT NOT NULL, empreinte TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS suivi_match ON suivi(match, seq)`,
  `CREATE TRIGGER IF NOT EXISTS suivi_sans_modif BEFORE UPDATE ON suivi BEGIN SELECT RAISE(ABORT, 'suivi : ajout seul'); END`,
  `CREATE TRIGGER IF NOT EXISTS suivi_sans_suppr BEFORE DELETE ON suivi BEGIN SELECT RAISE(ABORT, 'suivi : ajout seul'); END`,
];
const schemaOk = new WeakSet(); // table créée une fois par base et par instance du Worker
export async function ensureSuivi(env) {
  if (!env.DB) return false;
  if (schemaOk.has(env.DB)) return true;
  for (const q of SCHEMA) await env.DB.prepare(q).run();
  schemaOk.add(env.DB);
  return true;
}

// entries : [{ match, ts, dom, ext, m0: [p1, pN, p2], m7: [p1, pN, p2], infos }] ; seuls les matchs pas encore commencés
export async function logSuivi(env, leagueId, entries, now = Date.now()) {
  if (!SUIVI_LEAGUES.has(+leagueId) || !entries?.length || !(await ensureSuivi(env))) return 0;
  const todo = entries.filter((e) => e.ts > now);
  if (!todo.length) return 0;
  const keys = todo.map((e) => `${leagueId}:${e.match}`);
  const last = new Map();
  const ph = keys.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT match, coup_envoi, m0, m7 FROM suivi WHERE seq IN (SELECT MAX(seq) FROM suivi WHERE match IN (${ph}) GROUP BY match)`).bind(...keys).all();
  for (const r of results || []) last.set(r.match, r);
  const head = await env.DB.prepare("SELECT empreinte FROM suivi ORDER BY seq DESC LIMIT 1").first();
  let prec = head?.empreinte || "0".repeat(64);
  const params = await sha256(SUIVI_PARAMS);
  const stmts = [];
  for (let i = 0; i < todo.length; i++) {
    const e = todo[i], k = keys[i], m0 = JSON.stringify(e.m0), m7 = JSON.stringify(e.m7), old = last.get(k);
    if (old && old.m0 === m0 && old.m7 === m7 && old.coup_envoi === e.ts) continue; // rien de nouveau
    const r = { cree_le: now, ligue: +leagueId, match: k, coup_envoi: e.ts, dom: e.dom || "", ext: e.ext || "", m0, m7, infos: JSON.stringify(e.infos || {}), params };
    const contenu = await sha256(rowText(r)), empreinte = await sha256(prec + "|" + contenu);
    stmts.push(env.DB.prepare("INSERT INTO suivi (cree_le, ligue, match, coup_envoi, dom, ext, m0, m7, infos, params, contenu, prec, empreinte) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(r.cree_le, r.ligue, r.match, r.coup_envoi, r.dom, r.ext, r.m0, r.m7, r.infos, r.params, contenu, prec, empreinte));
    prec = empreinte;
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

// Empreinte de tête (publique : ne révèle aucune probabilité)
export async function suiviHead(env) {
  if (!(await ensureSuivi(env))) return { actif: false };
  const h = await env.DB.prepare("SELECT seq, cree_le, empreinte FROM suivi ORDER BY seq DESC LIMIT 1").first();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT match) AS m FROM suivi").first();
  return { actif: true, version: SUIVI_VERSION, reglages: await sha256(SUIVI_PARAMS), lignes: n?.n || 0, matchs: n?.m || 0, seq: h?.seq || 0, derniere: h ? new Date(h.cree_le).toISOString() : null, empreinte: h?.empreinte || null };
}

// Export pour le bilan : toutes les lignes, avec leur chaîne ; les probabilités ne sont montrées que pour les matchs
// commencés depuis plus de 3 h (les autres gardent seulement leur empreinte de contenu, la chaîne reste vérifiable)
export async function suiviExport(env, now = Date.now(), from = 0) {
  if (!(await ensureSuivi(env))) return { actif: false, lignes: [] };
  const { results } = await env.DB.prepare("SELECT * FROM suivi WHERE seq > ? ORDER BY seq LIMIT 5000").bind(from).all();
  const lignes = (results || []).map((r) => (r.coup_envoi < now - 3 * 3600000 ? r : { seq: r.seq, cree_le: r.cree_le, ligue: r.ligue, coup_envoi: r.coup_envoi, contenu: r.contenu, prec: r.prec, empreinte: r.empreinte, masque: true }));
  return { actif: true, version: SUIVI_VERSION, reglages: SUIVI_PARAMS, lignes };
}

// ============================================================
// SUIVI EXPÉRIMENTAL M7X (autorisé par l'auditeur le 20/11/2026, plan : test/lab/PLAN-M7X.md)
// M7X = M7, mais la part « buts » des forces (70 %) devient 50 % buts + 50 % xG mesurés (variante de test/lab/run-xg-m7.mjs).
// 5 grands championnats, non affiché. Journal séparé (table suivi_x, sa propre chaîne) : la table suivi, sa formule d'empreinte
// et ses sceaux ne changent pas. Calculé APRÈS M0 / M7 ; une erreur ici n'empêche jamais l'enregistrement de M0 / M7.
// ============================================================
export const SUIVI_X = true; // interrupteur : false coupe M7X sans rien changer d'autre
export const SUIVI_X_SHARE = 0.5;
export const SUIVI_X_MIN_COVERAGE = 0.8;
export const SUIVI_X_VERSION = "M7X figé le 20/11/2026 (M7 8044a83 + 50 % xG mesurés dans la part buts)";
export const SUIVI_X_PARAMS = JSON.stringify({ base: JSON.parse(SUIVI_PARAMS), xgShare: SUIVI_X_SHARE, xgMesuresSeulement: true });

// Matchs passés « M7X » : à partir des matchs de M7 (déjà mêlés aux corners), la part buts réels est remplacée par
// 50 % buts + 50 % xG. Poids de la part buts : 70 % si le match a des corners, 100 % sinon. Match sans xG mesuré : inchangé.
// (même calcul que withXg dans test/lab/run-xg-m7.mjs)
export function blendXg(real, m7Finished, xg) {
  return m7Finished.map((f, i) => {
    const o = real[i], x = xg[o.id];
    if (!x) return f;
    const w = (f !== o ? 1 - CORNERS_SHARE : 1) * SUIVI_X_SHARE;
    return { ...f, hg: f.hg + w * (x[0] - o.hg), ag: f.ag + w * (x[1] - o.ag) };
  });
}

const SCHEMA_X = [
  `CREATE TABLE IF NOT EXISTS suivi_x (seq INTEGER PRIMARY KEY AUTOINCREMENT, cree_le INTEGER NOT NULL, ligue INTEGER NOT NULL, match TEXT NOT NULL, coup_envoi INTEGER NOT NULL, dom TEXT, ext TEXT, m7x TEXT NOT NULL, infos TEXT, params TEXT NOT NULL, contenu TEXT NOT NULL, prec TEXT NOT NULL, empreinte TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS suivi_x_match ON suivi_x(match, seq)`,
  `CREATE TRIGGER IF NOT EXISTS suivi_x_sans_modif BEFORE UPDATE ON suivi_x BEGIN SELECT RAISE(ABORT, 'suivi_x : ajout seul'); END`,
  `CREATE TRIGGER IF NOT EXISTS suivi_x_sans_suppr BEFORE DELETE ON suivi_x BEGIN SELECT RAISE(ABORT, 'suivi_x : ajout seul'); END`,
];
const schemaX = new WeakSet();
async function ensureSuiviX(env) {
  if (!env.DB) return false;
  if (schemaX.has(env.DB)) return true;
  for (const q of SCHEMA_X) await env.DB.prepare(q).run();
  schemaX.add(env.DB);
  return true;
}
export const rowTextX = (r) => [r.cree_le, r.ligue, r.match, r.coup_envoi, r.dom, r.ext, r.m7x, r.infos, r.params].join("|");

// entries : [{ match, ts, dom, ext, m7x: [p1, pN, p2], infos }]
export async function logSuiviX(env, leagueId, entries, now = Date.now()) {
  if (!SUIVI_X || !entries?.length || !(await ensureSuiviX(env))) return 0;
  const todo = entries.filter((e) => e.ts > now);
  if (!todo.length) return 0;
  const keys = todo.map((e) => `${leagueId}:${e.match}`), last = new Map();
  const { results } = await env.DB.prepare(`SELECT match, coup_envoi, m7x FROM suivi_x WHERE seq IN (SELECT MAX(seq) FROM suivi_x WHERE match IN (${keys.map(() => "?").join(",")}) GROUP BY match)`).bind(...keys).all();
  for (const r of results || []) last.set(r.match, r);
  const head = await env.DB.prepare("SELECT empreinte FROM suivi_x ORDER BY seq DESC LIMIT 1").first();
  let prec = head?.empreinte || "0".repeat(64);
  const params = await sha256(SUIVI_X_PARAMS);
  const stmts = [];
  for (let i = 0; i < todo.length; i++) {
    const e = todo[i], k = keys[i], m7x = JSON.stringify(e.m7x), old = last.get(k);
    if (old && old.m7x === m7x && old.coup_envoi === e.ts) continue;
    const r = { cree_le: now, ligue: +leagueId, match: k, coup_envoi: e.ts, dom: e.dom || "", ext: e.ext || "", m7x, infos: JSON.stringify(e.infos || {}), params };
    const contenu = await sha256(rowTextX(r)), empreinte = await sha256(prec + "|" + contenu);
    stmts.push(env.DB.prepare("INSERT INTO suivi_x (cree_le, ligue, match, coup_envoi, dom, ext, m7x, infos, params, contenu, prec, empreinte) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(r.cree_le, r.ligue, r.match, r.coup_envoi, r.dom, r.ext, r.m7x, r.infos, r.params, contenu, prec, empreinte));
    prec = empreinte;
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

export async function suiviHeadX(env) {
  if (!SUIVI_X || !(await ensureSuiviX(env))) return { actif: false };
  const h = await env.DB.prepare("SELECT seq, cree_le, empreinte FROM suivi_x ORDER BY seq DESC LIMIT 1").first();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT match) AS m FROM suivi_x").first();
  return { actif: true, version: SUIVI_X_VERSION, reglages: await sha256(SUIVI_X_PARAMS), lignes: n?.n || 0, matchs: n?.m || 0, seq: h?.seq || 0, derniere: h ? new Date(h.cree_le).toISOString() : null, empreinte: h?.empreinte || null };
}

export async function suiviExportX(env, now = Date.now(), from = 0) {
  if (!SUIVI_X || !(await ensureSuiviX(env))) return { actif: false, lignes: [] };
  const { results } = await env.DB.prepare("SELECT * FROM suivi_x WHERE seq > ? ORDER BY seq LIMIT 5000").bind(from).all();
  const lignes = (results || []).map((r) => (r.coup_envoi < now - 3 * 3600000 ? r : { seq: r.seq, cree_le: r.cree_le, ligue: r.ligue, coup_envoi: r.coup_envoi, contenu: r.contenu, prec: r.prec, empreinte: r.empreinte, masque: true }));
  return { actif: true, version: SUIVI_X_VERSION, reglages: SUIVI_X_PARAMS, lignes };
}

// ============================================================
// SUIVI DES VARIANTES CACHÉES (choix de Kay le 21/11/2026, sous réserve de l'auditeur) — journal suivi_v, sa propre chaîne.
// M7-40 = M7 identique, mais forces calculées sur les 40 derniers matchs par équipe au lieu de 80. 9 championnats, non affiché.
// Rien ne change pour M0, M7, M7X, leurs tables ni leurs sceaux. Calculé après eux ; une erreur ici ne bloque rien.
// ============================================================
// M7-40 non retenue par l'auditeur (24/11/2026) : aucune variante active. Ajouter une entrée relance une variante.
export const SUIVI_V = {}; // ex. { "M7-40": { windowMatches: 40 } }
export const SUIVI_V_VERSION = "Variantes figées le 21/11/2026 : M7-40 (M7 8044a83, fenêtre 40 matchs)";
export const SUIVI_V_PARAMS = JSON.stringify({ base: JSON.parse(SUIVI_PARAMS), variantes: SUIVI_V });

// Forces d'une variante « fenêtre » : même calcul que M7 (computeTeamRatings), avec une autre fenêtre le temps du calcul.
// Le calcul est synchrone : la fenêtre de production est rétablie avant toute autre instruction (finally).
export function withWindow(n, fn) {
  const w = MODEL.windowMatches;
  MODEL.windowMatches = n;
  try { return fn(); } finally { MODEL.windowMatches = w; }
}

const SCHEMA_V = [
  `CREATE TABLE IF NOT EXISTS suivi_v (seq INTEGER PRIMARY KEY AUTOINCREMENT, cree_le INTEGER NOT NULL, variante TEXT NOT NULL, ligue INTEGER NOT NULL, match TEXT NOT NULL, coup_envoi INTEGER NOT NULL, dom TEXT, ext TEXT, p TEXT NOT NULL, infos TEXT, params TEXT NOT NULL, contenu TEXT NOT NULL, prec TEXT NOT NULL, empreinte TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS suivi_v_match ON suivi_v(variante, match, seq)`,
  `CREATE TRIGGER IF NOT EXISTS suivi_v_sans_modif BEFORE UPDATE ON suivi_v BEGIN SELECT RAISE(ABORT, 'suivi_v : ajout seul'); END`,
  `CREATE TRIGGER IF NOT EXISTS suivi_v_sans_suppr BEFORE DELETE ON suivi_v BEGIN SELECT RAISE(ABORT, 'suivi_v : ajout seul'); END`,
];
const schemaV = new WeakSet();
async function ensureSuiviV(env) {
  if (!env.DB) return false;
  if (schemaV.has(env.DB)) return true;
  for (const q of SCHEMA_V) await env.DB.prepare(q).run();
  schemaV.add(env.DB);
  return true;
}
export const rowTextV = (r) => [r.cree_le, r.variante, r.ligue, r.match, r.coup_envoi, r.dom, r.ext, r.p, r.infos, r.params].join("|");

// entries : [{ variante, match, ts, dom, ext, p: [p1, pN, p2], infos }]
export async function logSuiviV(env, leagueId, entries, now = Date.now()) {
  if (!entries?.length || !(await ensureSuiviV(env))) return 0;
  const todo = entries.filter((e) => e.ts > now && SUIVI_V[e.variante]);
  if (!todo.length) return 0;
  const keys = todo.map((e) => `${leagueId}:${e.match}`), last = new Map();
  const uniq = [...new Set(keys)];
  const { results } = await env.DB.prepare(`SELECT variante, match, coup_envoi, p FROM suivi_v WHERE seq IN (SELECT MAX(seq) FROM suivi_v WHERE match IN (${uniq.map(() => "?").join(",")}) GROUP BY variante, match)`).bind(...uniq).all();
  for (const r of results || []) last.set(`${r.variante}|${r.match}`, r);
  const head = await env.DB.prepare("SELECT empreinte FROM suivi_v ORDER BY seq DESC LIMIT 1").first();
  let prec = head?.empreinte || "0".repeat(64);
  const params = await sha256(SUIVI_V_PARAMS);
  const stmts = [];
  for (let i = 0; i < todo.length; i++) {
    const e = todo[i], k = keys[i], p = JSON.stringify(e.p), old = last.get(`${e.variante}|${k}`);
    if (old && old.p === p && old.coup_envoi === e.ts) continue;
    const r = { cree_le: now, variante: e.variante, ligue: +leagueId, match: k, coup_envoi: e.ts, dom: e.dom || "", ext: e.ext || "", p, infos: JSON.stringify(e.infos || {}), params };
    const contenu = await sha256(rowTextV(r)), empreinte = await sha256(prec + "|" + contenu);
    stmts.push(env.DB.prepare("INSERT INTO suivi_v (cree_le, variante, ligue, match, coup_envoi, dom, ext, p, infos, params, contenu, prec, empreinte) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(r.cree_le, r.variante, r.ligue, r.match, r.coup_envoi, r.dom, r.ext, r.p, r.infos, r.params, contenu, prec, empreinte));
    prec = empreinte;
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

export async function suiviHeadV(env) {
  if (!(await ensureSuiviV(env))) return { actif: false };
  const h = await env.DB.prepare("SELECT seq, cree_le, empreinte FROM suivi_v ORDER BY seq DESC LIMIT 1").first();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT variante || match) AS m FROM suivi_v").first();
  return { actif: true, version: SUIVI_V_VERSION, variantes: Object.keys(SUIVI_V), reglages: await sha256(SUIVI_V_PARAMS), lignes: n?.n || 0, matchs: n?.m || 0, seq: h?.seq || 0, derniere: h ? new Date(h.cree_le).toISOString() : null, empreinte: h?.empreinte || null };
}

export async function suiviExportV(env, now = Date.now(), from = 0) {
  if (!(await ensureSuiviV(env))) return { actif: false, lignes: [] };
  const { results } = await env.DB.prepare("SELECT * FROM suivi_v WHERE seq > ? ORDER BY seq LIMIT 5000").bind(from).all();
  const lignes = (results || []).map((r) => (r.coup_envoi < now - 3 * 3600000 ? r : { seq: r.seq, cree_le: r.cree_le, variante: r.variante, ligue: r.ligue, coup_envoi: r.coup_envoi, contenu: r.contenu, prec: r.prec, empreinte: r.empreinte, masque: true }));
  return { actif: true, version: SUIVI_V_VERSION, reglages: SUIVI_V_PARAMS, lignes };
}
