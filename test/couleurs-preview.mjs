// Aperçu des couleurs victoire / nul / défaite (forme, Verdict) dans un vrai navigateur, monde simulé :
// node test/couleurs-preview.mjs <dossier de sortie> [suffixe]
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
const L = await api("/league-predictions?leagueId=39");
const mix = (t) => new Set((t.stats?.formeDetail || []).map((f) => f.r)).size;
const m = [...L.predictions].sort((a, b) => mix(b.teams.domicile) + mix(b.teams.exterieur) - mix(a.teams.domicile) - mix(a.teams.exterieur))[0];

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
  if (f === "/index.html") body = String(body).replace(/<script src="app\.js\?v=\w+">/, (x) => '<script>window.PRONO_API="/api"</script>' + x);
  res.writeHead(200, { "content-type": { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" }[path.extname(f)] || "application/octet-stream" });
  res.end(body);
}).listen(8790);

const OUT = process.argv[2] || "/tmp", SUF = process.argv[3] || "";
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const errors = [];
for (const [lang, w, h, tag] of [["fr", 390, 844, "telephone"], ["en", 390, 844, "telephone-en"], ["fr", 1440, 900, "pc"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: lang === "fr" ? "fr-FR" : "en-GB", timezoneId: "Europe/Paris" });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/flagcdn|espncdn/, (r) => r.abort());
  await page.addInitScript((l) => localStorage.setItem("lang", l), lang);
  await page.goto(`http://localhost:8790/#/duel/39/${encodeURIComponent(m.matchId)}`); await page.waitForSelector(".match-hero");
  await page.click('.tabs button[data-pane="s"]'); await page.waitForTimeout(900);
  await page.addStyleTag({ content: ".tabbar { display: none !important; }" });
  const forme = page.locator(".panel", { has: page.locator(".fpill") }).first();
  await forme.screenshot({ path: `${OUT}/forme-${tag}${SUF}.png` });
  console.log(lang, tag, "forme :", JSON.stringify(await forme.innerText()).slice(0, 200));
  await page.goto(`http://localhost:8790/#/verdict`); await page.waitForSelector(".res", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  const res = page.locator(".list").first();
  if (await res.count()) await page.screenshot({ path: `${OUT}/verdict-${tag}${SUF}.png`, clip: await res.boundingBox().then((b) => ({ x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 520) })) });
  await page.close();
}
console.log(errors.length ? "ERREURS " + errors.join(" | ") : "aucune erreur dans la page");
await browser.close(); server.close(); process.exit(errors.length ? 1 : 0);
