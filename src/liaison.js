// ============================================================
// DUEL PRONO — Liaison STRICTE des données externes (corners, xG) aux matchs du robot.  ⚠ NON BRANCHÉ (24/11/2026)
// Correctif proposé à l'auditeur (référence future : M7C). Tant qu'il n'est pas validé, rien n'appelle ce fichier.
// Principe : correspondance EXPLICITE des équipes (table écrite à la main et vérifiée), puis pour chaque ligne externe :
//   1. les deux équipes doivent être dans la table, sinon « équipe inconnue » : rien n'est attribué ;
//   2. il doit exister EXACTEMENT UN match terminé du robot avec ce domicile, cet extérieur et une date à ± 1 jour,
//      sinon « absent » ou « ambigu » : rien n'est attribué ;
//   3. le score doit être identique, sinon « score différent » : rien n'est attribué ;
//   4. un match du robot ne reçoit qu'une seule ligne : si deux lignes visent le même match, aucune n'est gardée ;
//   5. garde-fou par équipe : si moins de 90 % des lignes d'une équipe (au moins 3 lignes) trouvent leur match,
//      la correspondance de cette équipe est jugée douteuse et AUCUNE de ses lignes n'est attribuée.
// Seuls les matchs terminés du robot peuvent recevoir une donnée (les données d'un match n'existent qu'après lui).
// table : { nom externe: identifiant de l'équipe chez le robot }
// Retour : { m: { idMatch: [valeur dom., valeur ext.] }, rapport }
// ============================================================
const DAY = 86400000;
const day = (ts) => Math.floor(ts / DAY);
export const SEUIL_EQUIPE = 0.9;

// rows : [date (ms), nom domicile, nom extérieur, buts dom., buts ext., valeur dom., valeur ext.]
// finished : matchs terminés du robot { id, ts, homeId, awayId, hg, ag }
export function linkStrict(rows, finished, table, now = Infinity) {
  const byPair = new Map();
  for (const f of finished) { if (!(f.ts < now)) continue; const k = `${f.homeId}|${f.awayId}`; (byPair.get(k) || byPair.set(k, []).get(k)).push(f); }
  const inconnues = new Set(), out = [];
  for (const r of rows) {
    const h = table[r[1]], a = table[r[2]];
    if (h === undefined || a === undefined) { if (h === undefined) inconnues.add(r[1]); if (a === undefined) inconnues.add(r[2]); continue; }
    const c = (byPair.get(`${h}|${a}`) || []).filter((f) => Math.abs(day(f.ts) - day(r[0])) <= 1);
    const etat = !c.length ? "absent" : c.length > 1 ? "ambigu" : c[0].hg !== r[3] || c[0].ag !== r[4] ? "score différent" : "ok";
    out.push({ r, h, a, f: etat === "ok" ? c[0] : null, etat, robot: c.length === 1 ? [c[0].hg, c[0].ag] : null });
  }
  // Garde-fou par équipe
  const t = {};
  for (const o of out) for (const id of [o.h, o.a]) { const x = (t[id] ||= [0, 0]); x[0]++; if (o.etat === "ok") x[1]++; }
  const douteuses = new Set(Object.entries(t).filter(([, [n, ok]]) => n >= 3 && ok / n < SEUIL_EQUIPE).map(([id]) => id));
  // Un match ne reçoit qu'une ligne
  const vise = new Map();
  for (const o of out) if (o.etat === "ok" && !douteuses.has(o.h) && !douteuses.has(o.a)) vise.set(o.f.id, (vise.get(o.f.id) || 0) + 1);
  const m = {}, rapport = { lignes: rows.length, relies: 0, inconnues: [...inconnues], absents: 0, ambigus: 0, scores: 0, doublons: 0, equipesDouteuses: [...douteuses], ecartees: 0, problemes: [] };
  for (const o of out) {
    if (o.etat === "absent") rapport.absents++; else if (o.etat === "ambigu") rapport.ambigus++; else if (o.etat === "score différent") rapport.scores++;
    if (o.etat !== "ok") { rapport.problemes.push([o.etat, new Date(o.r[0]).toISOString().slice(0, 10), o.r[1], o.r[2], `${o.r[3]}-${o.r[4]}`, o.robot ? o.robot.join("-") : ""]); continue; }
    if (douteuses.has(o.h) || douteuses.has(o.a)) { rapport.ecartees++; continue; }
    if (vise.get(o.f.id) > 1) { rapport.doublons++; continue; }
    m[o.f.id] = [o.r[5], o.r[6]]; rapport.relies++;
  }
  return { m, rapport };
}

// Table « nom externe → identifiant robot » à partir de la correspondance explicite (nom exact chez le robot → noms externes)
// et des équipes connues du robot (src.teams : { id: [nom, logo] }). Un nom robot introuvable : l'équipe est ignorée.
export function buildTable(equipes, robotTeams, cle) {
  const parNom = {};
  for (const [id, v] of Object.entries(robotTeams)) { const n = Array.isArray(v) ? v[0] : v; (parNom[n] ||= []).push(id); }
  const table = {}, introuvables = [];
  for (const [nom, e] of Object.entries(equipes)) {
    const ids = parNom[nom];
    if (!ids || ids.length !== 1) { introuvables.push(nom); continue; }
    for (const ext of e[cle] || []) table[ext] = ids[0];
  }
  return { table, introuvables };
}
