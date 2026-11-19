// Aperçu de l'onglet Analyse (graphiques), téléphone et ordinateur, dans un vrai navigateur (monde simulé) : node test/analyse-preview.mjs <dossier de sortie>
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
// un match de Premier League avec xG et face-à-face si possible, sinon le premier non verrouillé
const L = await api("/league-predictions?leagueId=39");
let pick = null, best = -1;
for (const m of L.predictions) {
  if (m.verrouille) continue;
  const d = await api(`/match-details?matchId=${encodeURIComponent(m.matchId)}&source=football-data&leagueId=39&teamDomId=${m.teams.domicile.id}&teamExtId=${m.teams.exterieur.id}`);
  const score = (d.stats?.domicile?.xg && d.stats?.exterieur?.xg ? 1 : 0) + ((d.h2h || []).length ? 2 : 0);
  if (score > best) { best = score; pick = m; }
  if (score === 3) break;
}
console.log("match choisi :", pick?.matchId, "· score", best);

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
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const errors = []; let bad = 0;
const expect = (name, cond, info = "") => { if (!cond) bad++; console.log(`${cond ? "OK   " : "ÉCHEC"} ${name}${info ? "  → " + info : ""}`); };
for (const [dev, vp] of [["telephone", { width: 390, height: 844 }], ["pc", { width: 1280, height: 900 }]]) for (const lang of ["fr", "en"]) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, locale: lang === "fr" ? "fr-FR" : "en-GB", timezoneId: "Europe/Paris" });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/flagcdn|espncdn|\.png$/, (r) => r.abort());
  await page.addInitScript((l) => localStorage.setItem("lang", l), lang);
  await page.goto(`http://localhost:8789/#/duel/39/${encodeURIComponent(pick.matchId)}`); await page.waitForSelector(".match-hero");
  await page.waitForTimeout(1200);
  const sel = await page.$eval('.tabs button[aria-selected="true"]', (b) => b.dataset.pane);
  expect(`${dev} ${lang} : l'onglet Analyse s'ouvre en premier`, sel === "a");
  const n = await page.$$eval('[data-panel="a"] svg', (x) => x.length);
  expect(`${dev} ${lang} : graphiques dessinés`, n >= 5, n + " dessins");
  const tabsOk = await page.$eval(".tabs", (t) => t.scrollWidth <= t.clientWidth + 1);
  expect(`${dev} ${lang} : les 5 onglets tiennent sur la largeur`, tabsOk);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(`${dev} ${lang} : pas de défilement de côté`, !over);
  if (lang === "en") { const fr = await page.$eval('[data-panel="a"]', (el) => el.innerText); expect("en : pas de français dans l'Analyse", !/Qui gagne|Profil des|Marqués|Encaissés|Victoires/.test(fr)); }
  const kpN = await page.$$eval("#kp-list li", (x) => x.length);
  const kpTxt = await page.$eval("#kp-panel", (el) => el.innerText).catch(() => "");
  expect(`${dev} ${lang} : points clés affichés`, kpN >= 1, kpN + " phrases");
  if (lang === "en") expect("en : points clés en anglais", !/victoire|défaite|depuis|Force :|Faiblesse|championnat|Points clés/i.test(kpTxt), kpTxt.slice(0, 120));
  else expect("fr : points clés en français", /Points clés/i.test(kpTxt) && !/Key points|Strength|Weakness/.test(kpTxt));
  await page.screenshot({ path: `${OUT}/analyse-${dev}-${lang}-haut.png` });
  await page.addStyleTag({ content: "nav, .bottom-nav, header { display: none !important; }" }).catch(() => {});
  const kpEl = await page.$("#kp-panel"); if (kpEl) await kpEl.screenshot({ path: `${OUT}/points-cles-${dev}-${lang}.png` });
  const el = await page.$('[data-panel="a"]');
  await el.screenshot({ path: `${OUT}/analyse-${dev}-${lang}.png` });
  await page.close();
}
console.log(errors.length ? "ERREURS " + errors.join(" | ") : "aucune erreur dans la page");
await browser.close(); server.close(); process.exit(errors.length || bad ? 1 : 0);
