// Résumé des données ESPN Ligue 2 (équipes : identifiant, nom ; matchs terminés) pour l'audit de liaison.
import fs from "node:fs";
const D = process.argv[2], teams = {}, fin = [];
for (const f of fs.readdirSync(D).filter((x) => x.startsWith("espn-fra2-"))) {
  let j; try { j = JSON.parse(fs.readFileSync(`${D}/${f}`, "utf8")); } catch { continue; }
  for (const ev of j.events || []) {
    const c = ev.competitions?.[0]; if (!c) continue;
    const h = c.competitors.find((x) => x.homeAway === "home"), a = c.competitors.find((x) => x.homeAway === "away");
    teams[h.id] = h.team?.displayName; teams[a.id] = a.team?.displayName;
    if (c.status?.type?.completed) fin.push([ev.id, ev.date, h.id, a.id, +h.score, +a.score]);
  }
}
console.log("EQUIPES " + JSON.stringify(teams));
console.log("MATCHS " + fin.length);
fs.writeFileSync("espn-fra2-resume.json", JSON.stringify({ teams, fin }));
