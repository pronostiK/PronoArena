// ============================================================
// AUDIT DES CORNERS (24/11/2026, demande de l'auditeur) — hors ligne, rien n'est modifié en production.
// Rejoue la liaison corners ↔ matchs du robot (src/corners.js, matchCorners) avec les données football-data.co.uk
// (history.json), en rendant les noms d'équipes anonymes comme dans le robot (identifiants différents de ceux du fichier).
// Compte les matchs reliés (20 essais : l'ordre des équipes change le résultat en cas d'égalité) et les liaisons fausses,
// puis fait de même avec le prototype qui reconnaît les équipes par la date ET le score (corners-v2-prototype.mjs).
// Usage : node test/lab/audit-corners.mjs <history.json>
// ============================================================
import { matchCorners } from "../../src/corners.js";
import fs from "fs";
import { matchCornersV2 } from "./corners-v2-prototype.mjs";
const h = Object.values(JSON.parse(fs.readFileSync(process.argv[2])));
const LG = { PL: "E0", ELC: "E1", FL1: "F1", FL2: "F2", BL1: "D1", DED: "N1", SA: "I1", PD: "SP1" };
const out = [];
for (const lg of Object.keys(LG)) for (const [s, a, b] of [["2026", "2026-07-01", "2027-07-01"], ["2025", "2025-07-01", "2026-07-01"]]) {
  const rs = h.filter((r) => r.lg === lg && r.division === "L1" && r.date >= a && r.date < b);
  const teams = [...new Set(rs.flatMap((r) => [r.home, r.away]))].sort(() => 0.5 - Math.random());
  const id = Object.fromEntries(teams.map((t, i) => [t, "T" + (1000 + i)]));
  const finished = rs.map((r, i) => ({ id: "m" + i, ts: Date.parse(r.date + "T15:00:00Z"), homeId: id[r.home], awayId: id[r.away], hg: r.hg, ag: r.ag }));
  const rows = rs.filter((r) => r.hc != null && r.ac != null).map((r) => [Date.parse(r.date), r.home, r.away, r.hg, r.ag, r.hc, r.ac]);
  // essai répété (l'ordre des équipes du robot change le résultat en cas d'égalité)
  const ns = [];
  const truth = Object.fromEntries(rs.map((r, i) => ["m" + i, r.hc != null ? r.hc + "-" + r.ac : null]));
  for (let k = 0; k < 20; k++) { const sh = [...finished].sort(() => 0.5 - Math.random()); const m = matchCorners(rows, sh).m; const ks = Object.keys(m); const bad = ks.filter((x) => truth[x] !== m[x].join("-")).length; ns.push(ks.length + "(" + bad + " faux)"); }
  // reconnaissance correcte (référence) : équipes par leur vrai nom
  const v2=[];for(let k=0;k<20;k++){const sh=[...finished].sort(()=>0.5-Math.random());const m=matchCornersV2(rows,sh).m;const ks=Object.keys(m);v2.push(ks.length+"/"+ks.filter((x)=>truth[x]!==m[x].join("-")).length)}
  const ref = rs.filter((r) => r.hc != null).length;
  out.push(`${lg}@${s} matchs=${rs.length} avecCorners=${ref} actuel: min ${Math.min(...ns.map(parseFloat))} max ${Math.max(...ns.map(parseFloat))} faux max ${Math.max(...ns.map(x=>+x.match(/\((\d+)/)[1]))} | V2: ${[...new Set(v2)].join(" ")}`);
}
console.log(out.join("\n"));
