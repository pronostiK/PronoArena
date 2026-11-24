// Tests de la liaison stricte (src/liaison.js) : chaque règle « rien n'est attribué si ambigu » est vérifiée.
import assert from "node:assert/strict";
import { linkStrict, buildTable } from "../../../src/liaison.js";
const D = (s) => Date.parse(s + "T00:00:00Z"), T = (s) => Date.parse(s + "T19:00:00Z");
const fin = [
  { id: "m1", ts: T("2026-09-01"), homeId: "1", awayId: "2", hg: 2, ag: 1 },
  { id: "m2", ts: T("2026-09-08"), homeId: "2", awayId: "1", hg: 0, ag: 0 },
  { id: "m3", ts: T("2026-09-15"), homeId: "1", awayId: "3", hg: 1, ag: 1 },
  { id: "m4", ts: T("2026-09-15"), homeId: "1", awayId: "3", hg: 1, ag: 1 }, // doublon chez le robot (même jour) → ambigu
  { id: "m5", ts: T("2026-09-22"), homeId: "3", awayId: "2", hg: 3, ag: 0 },
  { id: "m6", ts: T("2030-01-01"), homeId: "2", awayId: "3", hg: 1, ag: 0 }, // pas encore joué (now)
];
const table = { A: "1", B: "2", C: "3" };
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
// 1. Cas normal : date ± 1 jour, domicile/extérieur et score identiques
let r = linkStrict([[D("2026-09-02"), "A", "B", 2, 1, 5, 4]], fin, table);
ok(r.m.m1?.join() === "5,4" && r.rapport.relies === 1, "liaison normale à J+1");
// 2. Domicile et extérieur inversés : rien
r = linkStrict([[D("2026-09-01"), "B", "A", 2, 1, 5, 4]], fin, table);
ok(!Object.keys(r.m).length && r.rapport.absents === 1, "inversion domicile/extérieur refusée");
// 3. Date à plus d'un jour : rien
r = linkStrict([[D("2026-09-04"), "A", "B", 2, 1, 5, 4]], fin, table);
ok(!Object.keys(r.m).length && r.rapport.absents === 1, "date trop éloignée refusée");
// 4. Score différent : rien
r = linkStrict([[D("2026-09-01"), "A", "B", 1, 1, 5, 4]], fin, table);
ok(!Object.keys(r.m).length && r.rapport.scores === 1, "score différent refusé");
// 5. Deux matchs possibles chez le robot : rien
r = linkStrict([[D("2026-09-15"), "A", "C", 1, 1, 5, 4]], fin, table);
ok(!Object.keys(r.m).length && r.rapport.ambigus === 1, "ambiguïté refusée");
// 6. Équipe absente de la table : rien
r = linkStrict([[D("2026-09-01"), "A", "X", 2, 1, 5, 4]], fin, table);
ok(!Object.keys(r.m).length && r.rapport.inconnues.includes("X"), "équipe inconnue refusée");
// 7. Deux lignes pour le même match : aucune gardée
r = linkStrict([[D("2026-09-01"), "A", "B", 2, 1, 5, 4], [D("2026-09-02"), "A", "B", 2, 1, 6, 6]], fin, table);
ok(!Object.keys(r.m).length && r.rapport.doublons === 2, "doublon refusé");
// 8. Match pas encore terminé (données postérieures à la prédiction) : rien
r = linkStrict([[D("2030-01-01"), "B", "C", 1, 0, 5, 4]], fin, table, D("2026-12-01"));
ok(!Object.keys(r.m).length, "match futur refusé");
// 9. Garde-fou : une équipe dont moins de 90 % des lignes trouvent leur match est écartée en entier
const bad = { A: "1", B: "3", C: "2" }; // B et C échangés par erreur
r = linkStrict([[D("2026-09-01"), "A", "B", 2, 1, 5, 4], [D("2026-09-08"), "B", "A", 0, 0, 5, 4], [D("2026-09-22"), "C", "B", 3, 0, 5, 4], [D("2026-09-15"), "A", "C", 1, 1, 1, 1]], fin, bad);
ok(r.rapport.equipesDouteuses.length >= 1 && !Object.values(r.m).length, "table fausse : rien n'est attribué");
// 10. Table construite par le nom exact du robot ; nom introuvable ou en double = équipe ignorée
const t = buildTable({ "Club A": { csv: ["A"] }, "Club Z": { csv: ["Z"] }, "Club D": { csv: ["D"] } }, { 1: ["Club A"], 7: ["Club D"], 8: ["Club D"] }, "csv");
ok(t.table.A === "1" && !t.table.Z && !t.table.D && t.introuvables.length === 2, "table : nom exact seulement");
console.log(`liaison stricte : ${n}/10 tests OK`);
