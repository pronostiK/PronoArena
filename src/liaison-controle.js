// ============================================================
// DUEL PRONO — CONTRÔLE EN LECTURE SEULE de la liaison stricte (M7C) sur les vraies données du robot (24/11/2026).
// Demandé par l'auditeur avant activation. AUCUNE ÉCRITURE (ni KV, ni D1) ; n'influence aucun pronostic.
// Pour un championnat : lit les données du robot (saison en cours et précédente), relit le fichier corners de
// football-data.co.uk, applique la liaison stricte (table explicite) ET l'ancienne méthode, et compare ;
// pour les 5 championnats xG : relit l'historique xG (D1, lecture seule) et applique la liaison stricte.
// Route : GET /liaison-controle?ligue=<id>
// ============================================================
import { kvGet, srcKey, toFinished } from "./sources.js";
import { LEAGUES, currentSeason } from "./config.js";
import { CORNERS_LEAGUES, csvUrl, parseCornersCsv, matchCorners, cornersKey, LIAISON_STRICTE } from "./corners.js";
import { linkStrict, buildTable } from "./liaison.js";
import { EQUIPES } from "./liaison-table.js";
import { XGX_LEAGUES } from "./xghist.js";

const DAY = 86400000;
const iso = (ts) => new Date(ts).toISOString().slice(0, 10);

export async function controleLiaison(env, leagueId, now = Date.now()) {
  const id = +leagueId, lg = LEAGUES[id], eq = EQUIPES[id];
  if (!lg || !CORNERS_LEAGUES[id] || !eq) return { erreur: "championnat sans corners ou sans table" };
  const season = currentSeason(new Date(now));
  const out = { ligue: id, nom: lg.name, source: lg.src, interrupteurM7C: LIAISON_STRICTE, lectureSeule: true, saisons: {} };
  const teamsAll = {}, finAll = [];
  for (const s of [season - 1, season]) {
    const src = await kvGet(env, srcKey(lg.src, s));
    if (!src) { out.saisons[s] = { erreur: "données du robot absentes" }; continue; }
    const fin = toFinished(src);
    Object.assign(teamsAll, src.teams || {}); finAll.push(...fin);
    const { table, introuvables } = buildTable(eq, src.teams || {}, "csv");
    // équipes du robot cette saison sans correspondance dans la table
    const mapped = new Set(Object.values(table));
    const sansTable = Object.entries(src.teams || {}).filter(([tid]) => fin.some((f) => String(f.homeId) === tid || String(f.awayId) === tid) && !mapped.has(tid)).map(([, v]) => (Array.isArray(v) ? v[0] : v));
    const r = await fetch(csvUrl(CORNERS_LEAGUES[id], s), { headers: { "User-Agent": "DuelProno/1.0 (+https://duelprono.com)" } });
    if (!r.ok) { out.saisons[s] = { erreur: `fichier corners indisponible [${r.status}]` }; continue; }
    const rows = parseCornersCsv(await r.text());
    const strict = linkStrict(rows, fin, table, now);
    const ancien = matchCorners(rows, fin).m;
    const prod = await kvGet(env, cornersKey(id, s)); // ce qu'utilise le robot aujourd'hui
    // désaccords : matchs reliés par les deux méthodes avec des corners différents ; liens de l'ancienne méthode refusés par la stricte
    let differents = 0, refuses = 0; const exemples = [];
    for (const [mid, v] of Object.entries(ancien)) {
      if (!strict.m[mid]) { refuses++; if (exemples.length < 10) { const f = fin.find((x) => String(x.id) === String(mid)); exemples.push(`ancienne méthode seulement : ${f ? `${iso(f.ts)} ${src.teams?.[f.homeId]?.[0]} – ${src.teams?.[f.awayId]?.[0]}` : mid}`); } }
      else if (strict.m[mid].join("-") !== v.join("-")) { differents++; if (exemples.length < 10) exemples.push(`corners différents : match ${mid}`); }
    }
    const futurs = Object.keys(strict.m).filter((mid) => { const f = fin.find((x) => String(x.id) === String(mid)); return !f || !(f.ts < now); }).length;
    const { problemes, ...rep } = strict.rapport;
    out.saisons[s] = {
      matchsTerminesRobot: fin.length, lignesFichierAvecCorners: rows.length,
      stricte: { ...rep, couverture: fin.length ? Math.round((1000 * rep.relies) / fin.length) / 10 : null, nomsTableIntrouvablesChezRobot: introuvables, equipesRobotSansTable: sansTable, problemes: problemes.slice(0, 30), matchsNonTerminesRecevantDesDonnees: futurs },
      ancienneMethodeRejouee: { relies: Object.keys(ancien).length, deLaStricteDifferents: differents, refusesParLaStricte: refuses, exemples },
      enProductionAujourdhui: prod ? Object.keys(prod.m || {}).length : 0,
    };
  }
  // xG (M7X) : lecture seule de l'historique, liaison stricte sur les deux saisons réunies (comme dans le moteur)
  if (XGX_LEAGUES[id] && env.DB) {
    try {
      const { results } = await env.DB.prepare("SELECT ts, dom, ext, bd, be, xgd, xge, statut FROM xg_hist WHERE ligue = ? AND saison >= ? AND bd IS NOT NULL AND be IS NOT NULL").bind(id, season - 1).all();
      const rows = (results || []).map((r) => [Math.floor(r.ts / DAY) * DAY, r.dom, r.ext, r.bd, r.be, r.statut === "mesure" ? r.xgd : null, r.statut === "mesure" ? r.xge : null]);
      const { table, introuvables } = buildTable(eq, teamsAll, "xg");
      const st = linkStrict(rows, finAll, table, now), anc = matchCorners(rows, finAll).m;
      const avecXg = Object.values(st.m).filter((v) => v[0] !== null && v[1] !== null).length;
      const { problemes, ...rep } = st.rapport;
      let differents = 0; for (const [mid, v] of Object.entries(anc)) if (st.m[mid] && String(st.m[mid]) !== String(v)) differents++;
      out.xg = { lignesHistorique: rows.length, matchsTerminesRobot: finAll.length, stricte: { ...rep, matchsAvecXgMesures: avecXg, couvertureXg: finAll.length ? Math.round((1000 * avecXg) / finAll.length) / 10 : null, nomsTableIntrouvablesChezRobot: introuvables, problemes: problemes.slice(0, 30) }, ancienneMethodeRejouee: { relies: Object.keys(anc).length, deLaStricteDifferents: differents } };
    } catch (e) { out.xg = { erreur: String(e.message).slice(0, 160) }; }
  }
  return out;
}
