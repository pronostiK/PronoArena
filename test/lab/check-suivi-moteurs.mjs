// Suivi M0 / M7 — preuve que le journal reproduit EXACTEMENT les fonctions des deux moteurs (condition 4 de l'auditeur).
// M0 = code du commit 02509e8 (dernier moteur avant le 20/11) ; M7 = code du commit 8044a83 (moteur en production).
// On extrait ces deux versions du dépôt (git archive), on les fait tourner sur les MÊMES données simulées que le code
// actuel, et on compare chiffre par chiffre les probabilités 1-N-2 avec celles que le journal enregistre.
// Lancer : node test/lab/check-suivi-moteurs.mjs   (aucun appel extérieur : tout est simulé)
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { NOW, SIM, installFetch, makeKV, makeD1 } from "../sim.mjs";

const repo = new URL("../..", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "suivi-"));
const extract = (commit) => { const d = join(tmp, commit); mkdirSync(d); execSync(`git -C "${repo}" archive ${commit} src | tar -x -C "${d}"`); return pathToFileURL(join(d, "src/build.js")).href; };
const OLD = "02509e8", PROD = "8044a83";
const [old, prod] = [await import(extract(OLD)), await import(extract(PROD))];
const cur = await import("../../src/build.js");
const { runRobot } = await import("../../src/robot.js");
const { SUIVI_LEAGUES } = await import("../../src/suivi.js");

installFetch();
Date.now = () => SIM.now;
const env = { FOOTBALL_DATA_KEY: "x", SPORTAPI_KEY: "sp_test", ...makeKV() };
let t = NOW;
for (let i = 0; i < 260; i++) { SIM.now = t; await runRobot(env, t); t += 600000; } // remplissage + fichiers de corners
const d1 = await makeD1();
const E = { ...env, DB: d1.DB };
const p3 = (p) => JSON.stringify([p.poisson.proba1, p.poisson.probaN, p.poisson.proba2]);
let n = 0, ok0 = 0, ok7 = 0, diff = 0;
const ecarts = [], infos = [];
const { LEAGUES } = await import("../../src/config.js");
const { srcKey } = await import("../../src/sources.js");
// 4e passage : 2 équipes « promues » par championnat (retirées de la saison précédente) pour faire jouer la correction des promus
async function promote() {
  for (const id of SUIVI_LEAGUES) {
    const k = srcKey(LEAGUES[id].src, 2025), s = JSON.parse(env.store.get(k) || "null");
    if (!s) continue;
    const cur = JSON.parse(env.store.get(srcKey(LEAGUES[id].src, 2026)));
    const ids = [...new Set(cur.finished.map((r) => String(r[1])))].slice(0, 2);
    s.finished = s.finished.filter((r) => !ids.includes(String(r[1])) && !ids.includes(String(r[2])));
    env.store.set(k, JSON.stringify(s));
  }
}
for (const at of [t, t + 2 * 86400000, t + 5 * 86400000, "promus"]) {
  if (at === "promus") await promote();
  const when = at === "promus" ? t : at;
  SIM.now = when;
  for (const id of SUIVI_LEAGUES) {
    const c = await cur.buildLeague(E, id, 2026, when), o = await old.buildLeague(env, id, 2026, when), p = await prod.buildLeague(env, id, 2026, when);
    if (at === t || at === "promus") infos.push(`${at === "promus" ? "promus " : ""}${id} : ${c?._suivi?.[0] ? JSON.stringify(c._suivi[0].infos) : "?"}`);
    if (!c?._suivi) { ecarts.push(`${id} : pas de journal`); continue; }
    const mo = Object.fromEntries(o.predictions.map((x) => [x.matchId, p3(x)])), mp = Object.fromEntries(p.predictions.map((x) => [x.matchId, p3(x)]));
    for (const s of c._suivi) {
      n++;
      if (JSON.stringify(s.m0) === mo[s.match]) ok0++; else ecarts.push(`${id}:${s.match} M0 ${JSON.stringify(s.m0)} ≠ ${OLD} ${mo[s.match]}`);
      if (JSON.stringify(s.m7) === mp[s.match]) ok7++; else ecarts.push(`${id}:${s.match} M7 ${JSON.stringify(s.m7)} ≠ ${PROD} ${mp[s.match]}`);
      if (JSON.stringify(s.m0) !== JSON.stringify(s.m7)) diff++;
    }
  }
}
console.log(`Matchs comparés : ${n} (9 championnats × 3 dates + 1 passage avec promus)`);
console.log(`M0 du journal identique au moteur ${OLD} : ${ok0}/${n}`);
console.log(`M7 du journal identique au moteur ${PROD} : ${ok7}/${n}`);
console.log(`Matchs où M0 et M7 diffèrent : ${diff}/${n}`);
console.log("Données utilisées (1re date, puis passage avec promus) :\n" + infos.join("\n"));
if (ecarts.length) console.log("Écarts :\n" + ecarts.slice(0, 20).join("\n"));
process.exit(ok0 === n && ok7 === n && n > 0 ? 0 : 1);
