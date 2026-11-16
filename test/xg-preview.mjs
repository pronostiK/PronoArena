// Aperçu des xG dans l'onglet Stats, dans un vrai navigateur (monde simulé) : node test/xg-preview.mjs <dossier de sortie>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { NOW, SIM, installFetch, makeKV } from "./sim.mjs";
import worker from "../src/index.js";
import { runRobot } from "../src/robot.js";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");

installFetch(); Date.now = () => SIM.now;
const env = { FOOTBALL_DATA_KEY: "x", SPORTAPI_KEY: "sp_test", SOCCERDATA_KEY: "sd_test", ...makeKV() };
let T = NOW;
for (let i = 0; i < 800; i++) { SIM.now = T; await runRobot(env, T); T += 600000; } SIM.now = T;
const api = async (p) => (await worker.fetch(new Request("http://x" + p), env, { waitUntil() {} })).json();
// un match de Premier League dont les deux équipes ont des xG, et un dont l'une des deux n'en a pas
const L = await api("/league-predictions?leagueId=39");
let withX = null, without = null;
for (const m of L.predictions) {
  const d = await api(`/match-details?matchId=${encodeURIComponent(m.matchId)}&source=football-data&leagueId=39&teamDomId=${m.teams.domicile.id}&teamExtId=${m.teams.exterieur.id}`);
  const both = d.stats?.domicile?.xg && d.stats?.exterieur?.xg;
  if (both && !withX) withX = m; if (!both && !without) without = m;
  if (withX && without) break;
}
console.log("match avec xG :", withX?.matchId, "· sans :", without?.matchId);

const PUB = new URL("../site/public/", import.meta.url).pathname;
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    const r = await worker.fetch(new Request("http://x" + req.url.slice(4)), env, { waitUntil() {} });
    res.writeHead(r.status, { "content-type": "application/json" }); return res.end(await r.text());
  }
  let f = req.url.split("?")[0]; if (f === "/") f = "/index.html";
  const file = path.join(PUB, f);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  if (f === "/index.html") body = String(body).replace(/<script src="app\.js\?v=\w+">/, (m) => '<script>window.PRONO_API="/api"</script>' + m);
  res.writeHead(200, { "content-type": { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" }[path.extname(f)] || "application/octet-stream" });
  res.end(body);
}).listen(8789);

const OUT = process.argv[2] || "/tmp";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const errors = []; let bad = 0;
const expect = (name, cond, info = "") => { if (!cond) bad++; console.log(`${cond ? "OK   " : "ÉCHEC"} ${name}${info ? "  → " + info : ""}`); };
for (const lang of ["fr", "en"]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: lang === "fr" ? "fr-FR" : "en-GB", timezoneId: "Europe/Paris" });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/flagcdn|espncdn|\.png$/, (r) => r.abort());
  await page.addInitScript((l) => localStorage.setItem("lang", l), lang);
  for (const [nom, m] of [["avec", withX], ["sans", without]]) {
    if (!m) continue;
    await page.goto(`http://localhost:8789/#/duel/39/${encodeURIComponent(m.matchId)}`); await page.waitForSelector(".match-hero");
    await page.click('.tabs button[data-pane="s"]');
    await page.waitForTimeout(900);
    const box = await page.$eval("#xg-box", (el) => el.innerText).catch(() => null), note = await page.$eval("#xg-note", (el) => el.innerText).catch(() => null);
    console.log(lang, nom, "→", JSON.stringify(box), JSON.stringify(note));
    if (nom === "avec") {
      expect(`${lang} : les deux lignes xG sont affichées`, /xG (créés|for)/.test(box || "") && /xG (concédés|against)/.test(box || ""));
      expect(`${lang} : note avec la source`, /Soccer Data/.test(note || ""));
      expect(`${lang} : chiffres avec ${lang === "fr" ? "virgule" : "point"}`, lang === "fr" ? /\d,\d\d/.test(box) : /\d\.\d\d/.test(box));
    } else expect(`${lang} : rien d'affiché si une équipe manque de matchs`, !box && !note);
    await page.locator(".panel", { has: page.locator("#xg-box") }).screenshot({ path: `${OUT}/xg-${lang}-${nom}.png` }).catch(() => {});
  }
  await page.close();
}
console.log(errors.length ? "ERREURS " + errors.join(" | ") : "aucune erreur dans la page");
await browser.close(); server.close(); process.exit(errors.length || bad ? 1 : 0);
