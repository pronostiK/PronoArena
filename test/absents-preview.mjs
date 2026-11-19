// Aperçu des absents connus dans l'onglet Compos, dans un vrai navigateur (monde simulé) : node test/absents-preview.mjs <dossier de sortie>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { NOW, SIM, installFetch, makeKV } from "./sim.mjs";
import worker from "../src/index.js";
import { runRobot } from "../src/robot.js";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");

installFetch(); Date.now = () => SIM.now;
const env = { FOOTBALL_DATA_KEY: "x", SPORTAPI_KEY: "sp_test", BZZOIRO_TOKEN: "bz_test", ...makeKV() };
let T = NOW;
for (let i = 0; i < 800; i++) { SIM.now = T; await runRobot(env, T); T += 600000; } SIM.now = T;
const api = async (p) => (await worker.fetch(new Request("http://x" + p), env, { waitUntil() {} })).json();
const L = await api("/league-predictions?leagueId=39");
let pick = null;
for (const m of L.predictions) {
  const d = await api(`/match-details?matchId=${encodeURIComponent(m.matchId)}&source=football-data&leagueId=39&teamDomId=${m.teams.domicile.id}&teamExtId=${m.teams.exterieur.id}`);
  if (d.absents?.domicile?.l.length && d.absents?.exterieur && d.compositions?.domicile && [d.absents.domicile, d.absents.exterieur].some((x) => x.l.some((p) => p[5] === 1))) { pick = m; break; }
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
}).listen(8790);

const OUT = process.argv[2] || "/tmp";
const browser = await chromium.launch();
const errors = []; let bad = 0;
const expect = (name, cond, info = "") => { if (!cond) bad++; console.log(`${cond ? "OK   " : "ÉCHEC"} ${name}${info ? "  → " + info : ""}`); };
for (const [lang, w, h, file] of [["fr", 390, 844, "telephone"], ["fr", 1280, 900, "pc"], ["en", 390, 844, "telephone-en"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: lang === "fr" ? "fr-FR" : "en-GB", timezoneId: "Europe/Paris" });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/flagcdn|espncdn|\.png$/, (r) => r.abort());
  await page.addInitScript((l) => localStorage.setItem("lang", l), lang);
  await page.goto(`http://localhost:8790/#/duel/39/${encodeURIComponent(pick.matchId)}`); await page.waitForSelector(".match-hero");
  await page.click('.tabs button[data-pane="c"]');
  await page.waitForSelector(".abs-title", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const txt = await page.$eval("#compos", (el) => el.innerText).catch(() => "");
  expect(`${lang} ${file} : bloc des absents affiché`, lang === "fr" ? /Absents connus/.test(txt) && /Blessé/.test(txt) && /retour prévu le/.test(txt) && /genou/.test(txt) : /Known absentees/.test(txt) && /Injured/.test(txt) && /expected back/.test(txt));
  expect(`${lang} ${file} : titulaire du dernier match et lignes`, lang === "fr" ? /Titulaire au dernier match/.test(txt) && /dont \d+ titulaire/.test(txt) && /(Défense|Milieu|Attaque|Gardien) \d/.test(txt) : /Started last match/.test(txt) && /who started the last match/.test(txt) && /(Defence|Midfield|Attack|Goalkeeper) \d/.test(txt));
  expect(`${lang} ${file} : mention « à titre indicatif »`, lang === "fr" ? /À titre indicatif/.test(txt) : /For information only/.test(txt));
  const el = await page.$(".abs-title");
  if (el) await el.scrollIntoViewIfNeeded();
  await page.evaluate(() => { const t = document.querySelector(".abs-title"); if (t) window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - 80); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${file}.png`) });
  await page.close();
}
expect("aucune erreur JavaScript", !errors.length, errors.join(" | "));
await browser.close(); server.close();
process.exit(bad ? 1 : 0);
