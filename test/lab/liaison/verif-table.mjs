// ============================================================
// VÉRIFICATION DE LA CORRESPONDANCE EXPLICITE DES ÉQUIPES (24/11/2026) — hors ligne, rien n'est modifié.
// Contrôles :
//   1. Structure : chaque nom du robot existe chez le robot (classements publics ; Ligue 2 : équipes ESPN des 2 saisons) ou est marqué « prec » ; chaque nom
//      football-data.co.uk des deux saisons est relié exactement une fois ; chaque nom xG est relié ou listé à part.
//   2. Saison en cours, fichier corners contre robot : bilan de chaque équipe (J, V, N, D, BP, BC) recalculé à partir du
//      fichier avec la table, comparé au classement du robot (même date d'arrêt).
//   3. Saison en cours, source xG contre robot : même comparaison (la source xG peut avoir un match de plus ou de moins
//      selon l'heure de mise à jour : écart signalé à part).
//   4. Saison précédente, fichier corners contre source xG : bilans par équipe, dont matchs et buts à domicile.
// Usage : node test/lab/liaison/verif-table.mjs <history.json>
// ============================================================
import fs from "node:fs";
import { EQUIPES } from "./correspondances.mjs";
const DIR = new URL(".", import.meta.url).pathname;
const H = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).filter((m) => (m.division || "L1") === "L1");
const LG = { 39: "PL", 40: "ELC", 61: "FL1", 62: "FL2", 78: "BL1", 88: "DED", 135: "SA", 140: "PD" };
const FDSPACE = [39, 40, 61, 78, 88, 135, 140];
const CL = Object.fromEntries(Object.keys(LG).map((id) => [id, JSON.parse(fs.readFileSync(`${DIR}robot/classement-${id}.json`, "utf8"))]));
const ESPN62 = JSON.parse(fs.readFileSync(`${DIR}robot/espn-fra2-equipes.json`, "utf8"));
const XG = {};
for (const x of fs.readFileSync(`${DIR}xg-bilans-equipes.txt`, "utf8").trim().split(";")) { const [l, s, eq, ...v] = x.split("|"); ((XG[l] ||= {})[s] ||= {})[eq] = v.map(Number); }
const seasonOf = (d) => (+d.slice(5, 7) >= 7 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const rec = (rows, keyOf) => { const o = {}; for (const r of rows) { const h = keyOf(r.home), a = keyOf(r.away); if (!h || !a) continue; for (const [t, bp, bc, d] of [[h, r.hg, r.ag, 1], [a, r.ag, r.hg, 0]]) { const x = (o[t] ||= [0, 0, 0, 0, 0, 0, 0, 0]); x[0]++; x[1] += bp > bc; x[2] += bp === bc; x[3] += bp < bc; x[4] += bp; x[5] += bc; x[6] += d; x[7] += d * bp; } } return o; };
let erreurs = 0;
const out = [], err = (s) => { erreurs++; out.push("  ✗ " + s); };
for (const [id, eqs] of Object.entries(EQUIPES)) {
  out.push(`\n== ${id} ${LG[id]} ==`);
  // 1. Structure
  const space = FDSPACE.includes(+id) ? FDSPACE : [+id];
  const idOf = {};
  for (const nom of Object.keys(eqs)) {
    const hits = space.flatMap((l) => CL[l].classement.filter((t) => t.nom === nom).map((t) => t.id));
    if (+id === 62) for (const [eid, n] of Object.entries(ESPN62)) if (n === nom) hits.push(eid); // équipes ESPN des deux saisons
    if (hits.length === 1) idOf[nom] = hits[0];
    else if (hits.length > 1 && new Set(hits).size === 1) idOf[nom] = hits[0];
    else if (!eqs[nom].prec) err(`nom robot introuvable : ${nom}`);
  }
  const csvTo = {}, xgTo = {};
  for (const [nom, e] of Object.entries(eqs)) { for (const c of e.csv || []) { if (csvTo[c]) err(`nom fichier relié deux fois : ${c}`); csvTo[c] = nom; } for (const c of e.xg || []) { if (xgTo[c]) err(`nom xG relié deux fois : ${c}`); xgTo[c] = nom; } }
  const rows = H.filter((m) => m.lg === LG[id] && m.date >= "2025-07-01");
  const csvNames = new Set(rows.flatMap((m) => [m.home, m.away]));
  for (const n of csvNames) if (!csvTo[n]) err(`nom du fichier non relié : ${n}`);
  const xgNames = new Set(Object.values(XG[id] || {}).flatMap((s) => Object.keys(s)));
  const xgHors = [...xgNames].filter((n) => !xgTo[n]);
  const prec = Object.entries(eqs).filter(([, e]) => e.prec).map(([n]) => n);
  out.push(`  1. ${Object.keys(eqs).length} équipes ; ${Object.keys(idOf).length} retrouvées chez le robot (identifiant), ${prec.length} « prec » non lisibles hors ligne${prec.length ? " : " + prec.join(", ") : ""} ; ${csvNames.size} noms du fichier tous reliés${XG[id] ? ` ; ${xgNames.size - xgHors.length} noms xG reliés` + (xgHors.length ? `, non reliés volontairement : ${xgHors.join(", ")}` : "") : ""}`);
  // 2. Saison en cours : fichier contre robot
  const maj = CL[id].maj.slice(0, 10);
  const cur = rows.filter((m) => seasonOf(m.date) === 2026 && m.date <= maj);
  const rc = rec(cur, (n) => csvTo[n]);
  let ok2 = 0, n2 = 0;
  for (const t of CL[id].classement) { n2++; const x = rc[t.nom]; const robot = [t.j, t.v, t.n, t.d, t.bp, t.bc]; if (x && robot.every((v, i) => v === x[i])) ok2++; else out.push(`  ? fichier ≠ robot : ${t.nom} robot ${robot.join("/")} fichier ${x ? x.slice(0, 6).join("/") : "absent"}`); }
  out.push(`  2. saison en cours, fichier corners / robot (arrêt au ${maj}) : ${ok2}/${n2} bilans identiques (J, V, N, D, BP, BC)`);
  // 3. Saison en cours : xG contre robot
  if (XG[id]) {
    let ok3 = 0, n3 = 0, dec = [];
    const xr = {}; for (const [n, v] of Object.entries(XG[id]["2026"] || {})) if (xgTo[n]) xr[xgTo[n]] = v;
    for (const t of CL[id].classement) { n3++; const x = xr[t.nom], robot = [t.j, t.v, t.n, t.d, t.bp, t.bc]; if (x && robot.every((v, i) => v === x[i])) ok3++; else dec.push(`${t.nom} robot ${robot.join("/")} xG ${x ? x.slice(0, 6).join("/") : "absent"}`); }
    out.push(`  3. saison en cours, source xG / robot : ${ok3}/${n3} bilans identiques` + (dec.length ? ` ; différents (heures de mise à jour différentes ?) : ${dec.join(" | ")}` : ""));
    // 4. Saison précédente : fichier contre xG
    const prev = rows.filter((m) => seasonOf(m.date) === 2025);
    const rp = rec(prev, (n) => csvTo[n]);
    const xp = {}; for (const [n, v] of Object.entries(XG[id]["2025"] || {})) if (xgTo[n]) { const k = xgTo[n]; xp[k] = xp[k] ? xp[k].map((a, i) => a + v[i]) : v; }
    let ok4 = 0, n4 = 0, d4 = [];
    for (const [nom, x] of Object.entries(rp)) { n4++; const y = xp[nom]; if (y && x.every((v, i) => v === y[i])) ok4++; else d4.push(`${nom} fichier ${x.join("/")} xG ${y ? y.join("/") : "absent"}`); }
    out.push(`  4. saison précédente, fichier corners / source xG : ${ok4}/${n4} bilans identiques (J, V, N, D, BP, BC, matchs et buts à domicile)` + (d4.length ? ` ; différents : ${d4.join(" | ")}` : ""));
  }
}
console.log(`Vérification de la table de correspondance — erreurs bloquantes : ${erreurs}` + out.join("\n"));
