// Aperçu local : moteur + monde simulé + site, puis captures d'écran téléphone
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { NOW, SIM, installFetch, makeKV } from "./sim.mjs";
import worker from "../src/index.js";
import { runRobot } from "../src/robot.js";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");

installFetch(); Date.now = () => SIM.now;
const env = { FOOTBALL_DATA_KEY: "x", ...makeKV() };
let T = NOW; for (let i = 0; i < 40 + 288; i++) { SIM.now = T; await runRobot(env, T); T += 600000; } // remplissage + 2 jours
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
  if (f === "/index.html") body = String(body).replace('<script src="app.js">', '<script>window.PRONO_API="/api"</script><script src="app.js">');
  res.writeHead(200, { "content-type": { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" }[path.extname(f)] || "text/plain" });
  res.end(body);
}).listen(8787);

const OUT = process.argv[2];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "fr-FR", timezoneId: "Europe/Paris" });
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && !/404|ERR_/.test(m.text()) && errors.push(m.text()));
await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
await page.goto("http://localhost:8787/"); await page.waitForSelector(".duel");
await page.screenshot({ path: `${OUT}/1-duels.png`, fullPage: true });
await page.click(".chip[data-league='2']"); await page.waitForSelector(".duel");
await page.screenshot({ path: `${OUT}/2-ldc.png` });
await page.click(".chip[data-league='62']"); await page.waitForSelector(".duel");
await page.click(".duel"); await page.waitForSelector(".match-hero"); await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/3-analyse.png`, fullPage: true });
await page.click(".tabs button[data-pane='s']"); await page.screenshot({ path: `${OUT}/4-stats.png`, fullPage: true });
await page.click(".tabs button[data-pane='c']"); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/5-compos.png`, fullPage: true });
await page.click(".tabbar a[data-tab='verdict']"); await page.waitForSelector(".res, .empty"); await page.screenshot({ path: `${OUT}/6-verdict.png`, fullPage: true });
console.log("chips:", await page.$$eval(".chip", (c) => c.map((x) => x.textContent).join(", ")));
console.log("erreurs JS:", errors.length ? errors : "aucune");
await browser.close(); server.close();
