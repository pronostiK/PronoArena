// Aperçu local : moteur + monde simulé + base + site, puis captures d'écran téléphone
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { NOW, SIM, installFetch, makeKV, makeD1 } from "./sim.mjs";
import worker from "../src/index.js";
import { runRobot } from "../src/robot.js";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");

installFetch(); Date.now = () => SIM.now;
const d1 = await makeD1();
const env = { FOOTBALL_DATA_KEY: "x", ...makeKV(), DB: d1.DB };
let T = NOW;
const robot = async (n) => { for (let i = 0; i < n; i++) { SIM.now = T; await runRobot(env, T); T += 600000; } SIM.now = T; };
const ask = async (p, { body, token, ip } = {}) => (await worker.fetch(new Request("http://x" + p, { method: body ? "POST" : "GET", headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "CF-Connecting-IP": ip || "9.9.9.9" }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} })).json();

// Remplissage, puis 6 joueurs pronostiquent, 2 jours passent (matchs notés), puis nouveaux pronos en attente
await robot(190);
const bots = [];
for (const [i, pseudo] of ["Zizou", "Platoche", "Titi", "LaPulga", "Kyky", "Rocheteau"].entries()) bots.push(await ask("/account/signup", { ip: "10.0.0." + i, body: { pseudo, email: `${pseudo}@exemple.fr`, motDePasse: "motdepasse" + i } }));
const play = async () => {
  for (const lid of [61, 39, 62]) {
    const L = await ask(`/league-predictions?leagueId=${lid}`);
    for (const [k, m] of L.predictions.entries()) for (const [i, b] of bots.entries()) {
      if ((k + i) % 3 === 2) continue;
      const P = m.poisson, fav = P.proba1 >= P.proba2 ? "1" : "2";
      await ask("/picks", { token: b.token, body: { leagueId: lid, matchId: m.matchId, choix: [fav, fav, "N", fav === "1" ? "2" : "1", fav, "N"][(i + k) % 6] } });
    }
  }
};
await play(); await robot(288); await play();

const PUB = new URL("../site/public/", import.meta.url).pathname;
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request("http://x" + req.url.slice(4), { method: req.method, headers: { ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}), "CF-Connecting-IP": "7.7.7.7" }, body: chunks.length ? Buffer.concat(chunks) : undefined }), env, { waitUntil() {} });
    res.writeHead(r.status, { "content-type": "application/json" }); return res.end(await r.text());
  }
  let f = req.url.split("?")[0]; if (f === "/") f = "/index.html";
  const file = path.join(PUB, f);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  if (f === "/index.html") body = String(body).replace('<script src="app.js">', '<script>window.PRONO_API="/api"</script><script src="app.js">');
  res.writeHead(200, { "content-type": { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png" }[path.extname(f)] || "text/plain" });
  res.end(body);
}).listen(8787);

const OUT = process.argv[2];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "fr-FR", timezoneId: "Europe/Paris" });
await page.clock.setFixedTime(new Date(SIM.now)); // l'horloge du navigateur suit le monde simulé
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && !/404|ERR_|401|409/.test(m.text()) && errors.push(m.text()));
await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
// Logos des compétitions : remplacés ici par une pastille numérotée (pas d'accès à Internet pendant le test)
let logosDown = false;
await page.route(/espncdn\.com\/i\/leaguelogos/, (r) => logosDown ? r.abort() : r.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#1b3a6b"/><text x="20" y="25" font-size="12" text-anchor="middle" fill="#fff" font-family="sans-serif">${r.request().url().match(/(\d+)\.png/)[1]}</text></svg>` }));
const shot = (name, fullPage = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
const checks = [];
const check = (name, cond, info = "") => { checks.push(cond); console.log(`${cond ? "OK   " : "ÉCHEC"} ${name}${info ? "  → " + info : ""}`); };

// Visiteur non connecté
await page.goto("http://localhost:8787/"); await page.waitForSelector(".duel");
await shot("1-duels-visiteur");
check("Compétitions affichées en logos", (await page.locator(".chip-logo img").count()) >= 10 && (await page.locator(".chip-name").count()) === 0, `${await page.locator(".chip-logo img").count()} logos`);
await page.click(".chip[data-league='39']"); await page.waitForSelector(".chip[data-league='39'][aria-pressed='true']"); await page.waitForSelector(".duel");
check("Changer de compétition en touchant un logo", (await page.textContent(".kicker")).includes("Premier League"));
{ const total = await page.locator(".duel").count(), btns = page.locator(".day-btn");
  const n = Number(await btns.nth(1).locator("i").textContent().then((t) => t.replace(/\D/g, "")));
  check("Calendrier : « À venir » + un bouton par jour de match", (await btns.count()) >= 3 && Number(await btns.first().locator("b").textContent()) === total, `${await btns.count() - 1} jours, ${total} matchs`);
  let sum = 0; for (let i = 1; i < await btns.count(); i++) sum += Number((await btns.nth(i).locator("i").textContent()).replace(/\D/g, ""));
  check("Calendrier : aucun jour sans match, total cohérent", sum === total);
  await btns.nth(1).click();
  check("Toucher un jour n'affiche que ses matchs", (await page.locator(".duel").count()) === n && (await page.locator("h2.day").count()) === 1 && (await btns.nth(1).getAttribute("aria-pressed")) === "true", `${n} match(s)`);
  await shot("1d-calendrier", false);
  await btns.first().click();
  check("« À venir » réaffiche tout", (await page.locator(".duel").count()) === total); }
await shot("1b-logos", false);
{ const r = await page.locator(".rail").boundingBox(), c = await page.locator(".rail .chip").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((b) => [Math.round(b.left), Math.round(b.top)]));
  check("Compétitions en colonne à gauche (les unes sous les autres)", r.x === 0 && r.width < 80 && c.every((p, i) => i === 0 || (p[0] === c[0][0] && p[1] > c[i - 1][1])), `colonne de ${Math.round(r.width)} px`);
  await page.evaluate(() => window.scrollTo(0, 1500)); await page.waitForTimeout(200);
  const r2 = await page.locator(".rail").boundingBox();
  check("La colonne reste visible quand on descend dans les matchs", r2.y >= 0 && r2.y < 20, `position ${Math.round(r2.y)} px`);
  await shot("1c-colonne-en-descendant", false);
  const before = await page.evaluate(() => window.scrollY); await page.locator(".rail").evaluate((e) => (e.scrollTop = 9999));
  check("La colonne défile de haut en bas jusqu'à la dernière compétition", await page.locator(".rail .chip").last().isVisible() && (await page.evaluate(() => window.scrollY)) === before);
  await page.evaluate(() => window.scrollTo(0, 0)); }
logosDown = true; await page.reload(); await page.waitForSelector(".duel"); await page.waitForTimeout(400);
check("Logo indisponible : le nom s'affiche à la place", (await page.locator(".chip-name").count()) >= 10 && (await page.locator(".chip-logo img").count()) === 0);
logosDown = false; await page.click(".chip[data-league='61']"); await page.waitForSelector(".duel"); await page.reload(); await page.waitForSelector(".duel");
await page.click(".tabbar a[data-tab='arene']"); await page.waitForSelector(".podium");
await shot("2-arene-visiteur");
// Il touche un prono : on lui demande de créer un compte, puis le prono est enregistré tout seul
await page.click(".tabbar a[data-tab='duels']"); await page.waitForSelector(".duel");
const target = page.locator(".picks:not(.locked)").first();
const wanted = await target.locator(".pick[data-pick='2'] .pts").textContent();
await target.locator(".pick[data-pick='2']").click();
await page.waitForSelector("#f-signup");
await shot("3-inscription");
await page.fill("#f-signup [name=pseudo]", "Zizou"); await page.fill("#f-signup [name=email]", "moi@exemple.fr"); await page.fill("#f-signup [name=motDePasse]", "motdepasse9");
await page.click("#f-signup button[type=submit]"); await page.waitForSelector("#f-signup .form-err:not([hidden])");
check("Pseudo déjà pris : message clair", (await page.textContent("#f-signup .form-err")) === "Ce pseudo est déjà pris.");
await page.fill("#f-signup [name=pseudo]", "Hitch"); await page.click("#f-signup button[type=submit]");
await page.waitForSelector(".pick[aria-pressed='true']");
const saved = await page.locator(".pick[aria-pressed='true'] .pts").first().textContent();
check("Prono enregistré après création du compte", saved.replace(/\D/g, "") === wanted.replace(/\D/g, ""), `affiché « ${wanted} » → enregistré « ${saved} »`);
check("Compte affiché en haut", (await page.textContent("#account")).includes("Hitch"));
await page.waitForTimeout(3200);
// Deux autres pronos, changement d'avis sur le premier
const open = page.locator(".picks:not(.locked)");
await open.nth(1).locator(".pick[data-pick='1']").click(); await page.waitForSelector(".picks >> nth=1 >> .pick[data-pick='1'][aria-pressed='true']").catch(() => {});
await page.waitForTimeout(400);
await open.nth(0).locator(".pick[data-pick='N']").click(); await page.waitForTimeout(600);
check("Changer d'avis : un seul choix actif par duel", (await open.nth(0).locator(".pick[aria-pressed='true']").count()) === 1 && (await open.nth(0).locator(".pick[data-pick='N']").getAttribute("aria-pressed")) === "true");
await page.waitForTimeout(3000);
await shot("4-duels-connecte");
check("Base : 2 pronos pour Hitch", d1.raw.prepare("SELECT COUNT(*) n FROM pronos p JOIN joueurs j ON j.id = p.joueur_id WHERE j.pseudo = 'Hitch'").get().n === 2);
// Analyse : le prono se retrouve dans la fiche du match
await page.locator(".duel:has(.pick[aria-pressed='true']) .more").first().click(); await page.waitForSelector(".match-hero"); await page.waitForTimeout(300);
check("Analyse : mon prono affiché", (await page.locator(".pick[aria-pressed='true']").count()) === 1);
await shot("5-analyse", false);
// Arène et compte
await page.click(".tabbar a[data-tab='arene']"); await page.waitForSelector(".podium"); await page.waitForSelector(".mp");
await shot("6-arene-connecte");
await page.click(".chip[data-week='precedente']"); await page.waitForSelector(".empty, .podium, .rks"); await shot("7-arene-semaine-derniere");
await page.click("#account"); await page.waitForSelector("#logout");
check("Mon espace : mes 2 pronos à venir et les points en jeu", (await page.locator("[data-plist='up'] .mp").count()) === 2 && /pts en jeu/.test(await page.textContent("[data-plist='up']")));
await page.fill("#f-profile [name=prenom]", "Hicham"); await page.fill("#f-profile [name=ville]", "Paris");
await page.click("#club-open"); await page.waitForSelector(".club");
await page.locator("#club-picker .chip").nth(1).click(); await page.waitForSelector(".club"); await page.waitForTimeout(300);
await shot("8a-choix-club", false);
const clubName = await page.locator(".club small").nth(2).textContent();
await page.locator(".club").nth(2).click();
await page.click("#f-profile button[type=submit]"); await page.waitForFunction(() => document.getElementById("toast").textContent === "Infos enregistrées.");
const saved2 = d1.raw.prepare("SELECT prenom, ville, club, club_logo FROM joueurs WHERE pseudo = 'Hitch'").get();
check("Mes infos enregistrées en base (prénom, ville, club)", saved2.prenom === "Hicham" && saved2.ville === "Paris" && saved2.club === clubName && !!saved2.club_logo, `${saved2.club}`);
await page.reload(); await page.waitForSelector("#logout");
check("Mes infos toujours là après rechargement", (await page.inputValue("#f-profile [name=prenom]")) === "Hicham" && (await page.textContent("#club-now")).includes(clubName));
await page.waitForTimeout(300); await shot("8-compte");
await page.click(".fold >> nth=1 >> summary"); await page.fill("#f-password [name=ancien]", "motdepasse9"); await page.fill("#f-password [name=nouveau]", "motdepasse10"); await page.click("#f-password button[type=submit]");
await page.waitForFunction(() => document.getElementById("toast").textContent === "Mot de passe modifié.");
await page.click(".fold >> nth=0 >> summary"); await page.fill("#f-email [name=email]", "moi2@exemple.fr"); await page.fill("#f-email [name=motDePasse]", "motdepasse10"); await page.click("#f-email button[type=submit]");
await page.waitForFunction(() => document.getElementById("mail-now")?.textContent === "moi2@exemple.fr");
check("E-mail et mot de passe modifiés depuis l'espace", true);
SIM.now += 61000; // le classement est gardé 1 min en mémoire côté moteur
await page.click(".tabbar a[data-tab='arene']"); await page.waitForSelector(".rk.me .fan, .pod.me .fan");
check("Arène : mon blason à côté de mon pseudo", true);
await shot("8b-arene-blason", false);
await page.click("#account"); await page.waitForSelector("#logout");
// Rechargement : toujours connecté ; déconnexion puis reconnexion
await page.reload(); await page.waitForSelector("#logout");
check("Toujours connecté après rechargement", (await page.textContent("#account")).includes("Hitch"));
await page.click("#logout"); await page.waitForSelector(".duel");
check("Déconnexion", (await page.textContent("#account")).trim() === "Connexion" && (await page.locator(".pick[aria-pressed='true']").count()) === 0);
await page.click("#account"); await page.click(".tabs button[data-mode='login']");
await page.fill("#f-login [name=identifiant]", "moi2@exemple.fr"); await page.fill("#f-login [name=motDePasse]", "mauvais"); await page.click("#f-login button[type=submit]");
await page.waitForSelector("#f-login .form-err:not([hidden])"); await shot("9-connexion-erreur", false);
await page.fill("#f-login [name=motDePasse]", "motdepasse10"); await page.click("#f-login button[type=submit]"); await page.waitForSelector(".mp");
check("Reconnexion par e-mail : mes pronos sont là", (await page.locator(".mp").count()) === 2);
// Verdict inchangé
await page.click(".tabbar a[data-tab='verdict']"); await page.waitForSelector(".res, .empty"); await shot("10-verdict", false);
check("Verdict : même colonne, avec « Tout »", (await page.locator(".rail .chip-all").count()) === 1);
// Suppression du compte
await page.click("#account"); await page.click(".danger summary"); await page.fill("#f-delete [name=motDePasse]", "motdepasse10"); await page.click("#f-delete button[type=submit]"); await page.waitForSelector(".duel");
check("Suppression du compte : plus rien en base", d1.raw.prepare("SELECT COUNT(*) n FROM joueurs WHERE pseudo = 'Hitch'").get().n === 0);
// Débordement horizontal (téléphone étroit)
await page.setViewportSize({ width: 320, height: 640 });
await page.evaluate(() => 0);
for (const h of ["#/", "#/verdict", "#/arene", "#/compte"]) { await page.goto("http://localhost:8787/" + h); await page.waitForTimeout(500); const w = await page.evaluate(() => document.documentElement.scrollWidth); check(`Pas de débordement à 320 px (${h})`, w <= 320, `${w} px`); }
await page.setViewportSize({ width: 390, height: 844 });
await page.route("**/api/leagues", async (r) => { const j = await (await r.fetch()).json(); for (const c of j.competitions) if ([39, 62, 2].includes(c.id)) c.matchsAVenir = 0; await r.fulfill({ json: j }); });
await page.goto("http://localhost:8787/#/verdict"); await page.reload(); await page.goto("http://localhost:8787/#/"); await page.waitForSelector(".duel");
check("Championnats sans match retirés de la colonne", (await page.locator(".rail .chip").count()) === 11 && (await page.locator(".rail .chip[data-league='39'], .rail .chip[data-league='62'], .rail .chip[data-league='2']").count()) === 0, `${await page.locator(".rail .chip").count()} logos au lieu de 14`);
check("Aucune erreur JavaScript", errors.length === 0, errors.join(" | "));
await browser.close(); server.close();
process.exit(checks.every(Boolean) ? 0 : 1);
