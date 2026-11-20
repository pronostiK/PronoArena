// Aperçu des compo probable (Ligue 2) dans l onglet Compos, dans un vrai navigateur (monde simulé) : node test/probable-preview.mjs <dossier de sortie>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { NOW, SIM, installFetch, makeKV } from "./sim.mjs";
import worker from "../src/index.js";
import { runRobot } from "../src/robot.js";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");

installFetch(); Date.now = () => SIM.now; SIM.noRostersL2 = true;
const env = { FOOTBALL_DATA_KEY: "x", SPORTAPI_KEY: "sp_test", BZZOIRO_TOKEN: "bz_test", ...makeKV() };
let T = NOW;
for (let i = 0; i < 400; i++) { SIM.now = T; await runRobot(env, T); T += 600000; } SIM.now = T;
const api = async (p) => (await worker.fetch(new Request("http://x" + p), env, { waitUntil() {} })).json();
const L = await api("/league-predictions?leagueId=62");
let pick = null;
for (const m of L.predictions) {
  const d = await api(`/match-details?matchId=${encodeURIComponent(m.matchId)}&source=${encodeURIComponent(m.source || "espn")}&leagueId=62&teamDomId=${m.teams.domicile.id}&teamExtId=${m.teams.exterieur.id}`);
  if (d.compositions?.domicile?.probable) { pick = m; break; }
}
console.log("match :", pick?.matchId);

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
}).listen(8791);

const OUT = process.argv[2] || "/tmp";
const browser = await chromium.launch();
const errors = []; let bad = 0;
const expect = (name, cond, info = "") => { if (!cond) bad++; console.log(`${cond ? "OK   " : "ÉCHEC"} ${name}${info ? "  → " + info : ""}`); };
for (const [lang, w, h, file] of [["fr", 390, 844, "telephone"], ["fr", 1280, 900, "pc"], ["en", 390, 844, "telephone-en"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: lang === "fr" ? "fr-FR" : "en-GB", timezoneId: "Europe/Paris" });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/flagcdn|espncdn|\.png$/, (r) => r.abort());
  await page.addInitScript((l) => localStorage.setItem("lang", l), lang);
  await page.goto(`http://localhost:8791/#/duel/62/${encodeURIComponent(pick.matchId)}`); await page.waitForSelector(".match-hero");
  await page.click('.tabs button[data-pane="c"]');
  await page.waitForSelector(".pitch", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const txt = await page.$eval("#compos", (el) => el.innerText).catch(() => "");
  expect(`${lang} ${file} : compo probable affichée`, lang === "fr" ? /Compo probable · fiabilité estimée 6\d %/.test(txt) && /pas la composition officielle/.test(txt) : /Predicted line-up · estimated reliability 6\d%/.test(txt) && /not the official line-up/.test(txt), txt.slice(0, 200).replace(/\n/g, " | "));
  expect(`${lang} ${file} : 22 joueurs sur le terrain`, (await page.$$(".pitch .pl")).length === 22);
  await page.evaluate(() => { const t = document.querySelector("#compos"); if (t) window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - 70); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${file}.png`) });
  await page.close();
}
expect("aucune erreur JavaScript", !errors.length, errors.join(" | "));
await browser.close(); server.close();
process.exit(bad ? 1 : 0);
