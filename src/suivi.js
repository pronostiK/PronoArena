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
import { CORNERS_LEAGUES, CORNERS_SHARE } from "./corners.js";

// Les 9 championnats de l'audit (football-data.co.uk) ; Portugal (94) suivi à part dans le bilan
export const SUIVI_LEAGUES = new Set([61, 39, 140, 135, 78, 94, 88, 40, 62]);
export const SUIVI_VERSION = "M0/M7 figés le 20/11/2026 (moteur 8044a83)";
// Réglages figés : toute différence change l'empreinte des réglages enregistrée sur chaque ligne
export const SUIVI_PARAMS = JSON.stringify({
  windowMatches: MODEL.windowMatches, recentMatches: MODEL.recentMatches, recentWeight: MODEL.recentWeight, priorMatches: MODEL.priorMatches,
  specificWeight: MODEL.specificWeight, rho: MODEL.rho, promoted: MODEL.promoted, promotedMaxTeams: MODEL.promotedMaxTeams, eloMix: MODEL.eloMix,
  eloK: MODEL.eloK, eloHomeAdv: MODEL.eloHomeAdv, eloSeasonCarry: MODEL.eloSeasonCarry, cornersShare: CORNERS_SHARE, cornersLeagues: Object.keys(CORNERS_LEAGUES).sort(),
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
