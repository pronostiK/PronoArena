// Aperçu des scores en direct dans un vrai navigateur (monde simulé) : node test/live-preview.mjs <dossier de sortie>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { NOW, SIM, installFetch, makeKV, DB as WORLD } from "./sim.mjs";
import worker from "../src/index.js";
import { runRobot } from "../src/robot.js";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");

installFetch(); Date.now = () => SIM.now;
const env = { FOOTBALL_DATA_KEY: "x", SPORTAPI_KEY: "sp_test", ...makeKV() }; // sans base de comptes : tout est visible
let T = NOW;
const robot = async (n) => { for (let i = 0; i < n; i++) { SIM.now = T; await runRobot(env, T); T += 600000; } SIM.now = T; };
await robot(190);
const KO = T + 245 * 60000;
const next = (k) => WORLD[k].filter((m) => m.ts > KO + 3600000).sort((a, b) => a.ts - b.ts)[0];
const l1 = next("fd:FL1@2026"), l1e = WORLD["espn:fra.1@2026"].find((m) => m.id === "E" + l1.id), l2 = next("espn:fra.2@2026"), be = next("sp:5@2026"), can = next("sp:72@2026");
Object.assign(l1, { ts: KO }); Object.assign(l1e, { ts: KO, lh: 2, la: 1, clock: "67'" });
Object.assign(l2, { ts: KO, lh: 0, la: 0, ht: true }); Object.assign(be, { ts: KO, lh: 1, la: 1, second: true }); Object.assign(can, { ts: KO, lh: 1, la: 0 });
await robot(31);

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
}).listen(8788);

const OUT = process.argv[2] || "/tmp";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const errors = [];
for (const [lang, w, h] of [["fr", 390, 844], ["en", 390, 844], ["fr", 1280, 800]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: lang === "fr" ? "fr-FR" : "en-GB", timezoneId: "Europe/Paris" });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.setFixedTime(new Date(SIM.now));
  await page.route(/flagcdn|espncdn|\.png$/, (r) => r.abort());
  const tag = `${lang}-${w}`;
  await page.goto("http://localhost:8788/#/"); await page.waitForSelector(".duel"); await page.waitForTimeout(600);
  const texts = await page.$$eval("[data-lv]", (els) => els.map((el) => [el.querySelector(".vs")?.textContent, el.querySelector(".st")?.textContent]));
  console.log(tag, "accueil :", JSON.stringify(texts));
  console.log(tag, "pied de page :", JSON.stringify(await page.$eval(".credit", (el) => [el.innerText, el.querySelector("a").href, el.querySelector("a").rel])));
  const cards = page.locator("article[data-lv]");
  for (let i = 0; i < Math.min(2, await cards.count()); i++) await cards.nth(i === 0 ? 1 : 0).screenshot({ path: `${OUT}/live-${tag}-carte${i}.png` });
  for (const [lid, m, nom] of [[61, l1, "l1"], [144, be, "be"], [6, can, "can"]]) {
    await page.goto(`http://localhost:8788/#/duel/${lid}/${encodeURIComponent(m.id)}`); await page.waitForSelector(".match-hero"); await page.waitForTimeout(500);
    console.log(tag, nom, ":", JSON.stringify(await page.$eval(".kickoff", (el) => el.innerText)));
    await page.screenshot({ path: `${OUT}/live-${tag}-${nom}.png`, clip: { x: 0, y: 0, width: w, height: 330 } });
  }
  await page.close();
}
console.log(errors.length ? "ERREURS " + errors.join(" | ") : "aucune erreur dans la page");
await browser.close(); server.close(); process.exit(errors.length ? 1 : 0);
