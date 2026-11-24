// ============================================================
// AUDIT DE LIAISON — LIGUE 2 (hors ligne, GitHub Actions). Le robot lit la Ligue 2 chez ESPN : ici on relit ESPN
// (mêmes identifiants d'équipes, mêmes matchs, deux saisons) et on relie le fichier corners de football-data.co.uk
// (via l'historique public PronostiK) avec la liaison stricte et la table explicite, puis avec la méthode actuelle.
// Usage : node test/lab/liaison/run.mjs <dossier ESPN> <history.json>
// ============================================================
import fs from "node:fs";
import { EQUIPES } from "./correspondances.mjs";
import { linkStrict, buildTable } from "../../../src/liaison.js";
import { matchCorners } from "../../../src/corners.js";
const [D, HIST] = process.argv.slice(2);
const teams = {}, fin = new Map();
for (const f of fs.readdirSync(D).filter((x) => x.startsWith("espn-fra2-"))) {
  let j; try { j = JSON.parse(fs.readFileSync(`${D}/${f}`, "utf8")); } catch { continue; }
  for (const ev of j.events || []) {
    const c = ev.competitions?.[0]; if (!c) continue;
    const h = c.competitors.find((x) => x.homeAway === "home"), a = c.competitors.find((x) => x.homeAway === "away");
    teams[h.id] = [h.team?.displayName]; teams[a.id] = [a.team?.displayName];
    if (c.status?.type?.completed) fin.set(ev.id, { id: ev.id, ts: Date.parse(ev.date), homeId: String(h.id), awayId: String(a.id), hg: +h.score, ag: +a.score });
  }
}
const seasonOf = (ts) => { const d = new Date(ts); return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; };
const { table, introuvables } = buildTable(EQUIPES[62], teams, "csv");
console.log(`ESPN Ligue 2 : ${Object.keys(teams).length} équipes, ${fin.size} matchs terminés ; noms de la table introuvables chez ESPN : ${introuvables.length ? introuvables.join(", ") : "aucun"}`);
const H = JSON.parse(fs.readFileSync(HIST, "utf8")).filter((m) => m.lg === "FL2" && (m.division || "L1") === "L1" && m.hc != null && m.ac != null);
for (const S of [2025, 2026]) {
  const finS = [...fin.values()].filter((f) => seasonOf(f.ts) === S);
  const rows = H.filter((m) => seasonOf(Date.parse(m.date)) === S).map((m) => [Date.parse(m.date), m.home, m.away, m.hg, m.ag, m.hc, m.ac]);
  const { m, rapport } = linkStrict(rows, finS, table);
  const old = matchCorners(rows, finS).m;
  const desaccord = Object.keys(old).filter((k) => m[k] && old[k].join("-") !== m[k].join("-")).length;
  const { problemes, ...r } = rapport;
  console.log(`\nSaison ${S}-${S + 1 - 2000} : ${finS.length} matchs ESPN, ${rows.length} lignes avec corners`);
  console.log(`  liaison stricte : ${JSON.stringify(r)}`);
  for (const p of problemes) console.log(`    non attribué : ${p.join(" | ")}`);
  console.log(`  méthode actuelle (dates seulement) : ${Object.keys(old).length} matchs reliés ; désaccords avec la liaison stricte : ${desaccord}`);
}
