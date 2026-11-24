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

// ---------- xG (M7X) : lignes de la source xG reliées aux matchs football-data, via la table explicite ----------
// Les matchs football-data servent de référence : leurs bilans par équipe sont identiques à ceux du robot (verif-table.mjs).
const XGF = process.argv[4];
if (XGF && fs.existsSync(XGF)) {
  const BZ = { "Ligue 1": 61, "Premier League": 39, "La Liga": 140, "Serie A": 135, "Bundesliga": 78 };
  const FDC = { 61: "FL1", 39: "PL", 140: "PD", 135: "SA", 78: "BL1" };
  const lines = fs.readFileSync(XGF, "utf8").trim().split(/\r?\n/), head = lines[0].split(",");
  const xr = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((c, i) => [head[i], c]))).filter((r) => BZ[r.championnat]);
  const all = JSON.parse(fs.readFileSync(HIST, "utf8")).filter((m) => (m.division || "L1") === "L1");
  console.log(`\n== xG : ${xr.length} lignes de la source xG (dernière date ${xr.map((r) => r.date).sort().at(-1)}) ==`);
  for (const [lid, code] of Object.entries(FDC)) {
    const eq = EQUIPES[lid], csvT = {}, xgT = {};
    for (const [nom, e] of Object.entries(eq)) { for (const c of e.csv || []) csvT[c] = nom; for (const c of e.xg || []) xgT[c] = nom; }
    for (const S of [2025, 2026]) {
      const F = all.filter((m) => m.lg === code && seasonOf(Date.parse(m.date)) === S).map((m, i) => ({ id: `${code}${S}-${i}`, ts: Date.parse(m.date + "T15:00:00Z"), homeId: csvT[m.home], awayId: csvT[m.away], hg: m.hg, ag: m.ag }));
      // doublons de l'historique PronostiK (même affiche à un jour d'écart, fichier + résultat ajouté) : on garde la première
      const seen = new Set(), Fu = F.filter((f) => { const k = `${f.homeId}|${f.awayId}|${f.hg}-${f.ag}|${Math.floor(f.ts / 864e5 / 3)}`; if (seen.has(k)) return false; seen.add(k); return true; });
      const rows = xr.filter((r) => BZ[r.championnat] === +lid && seasonOf(Date.parse(r.date)) === S && r.buts_domicile !== "").map((r) => [Date.parse(r.date), r.domicile, r.exterieur, +r.buts_domicile, +r.buts_exterieur, r.xg_domicile, r.xg_exterieur]);
      const { m, rapport } = linkStrict(rows, Fu, xgT);
      const { problemes, ...r } = rapport;
      console.log(`  ${code} ${S}-${S + 1 - 2000} : ${Fu.length} matchs football-data ; liaison stricte ${JSON.stringify(r)}`);
      for (const p of problemes) console.log(`    non attribué : ${p.join(" | ")}`);
    }
  }
}
