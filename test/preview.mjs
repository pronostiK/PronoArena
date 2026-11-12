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
const env = { FOOTBALL_DATA_KEY: "x", RESEND_API_KEY: "re_test", ...makeKV(), DB: d1.DB };
let T = NOW;
const robot = async (n) => { for (let i = 0; i < n; i++) { SIM.now = T; await runRobot(env, T); T += 600000; } SIM.now = T; };
const ask = async (p, { body, token, ip } = {}) => (await worker.fetch(new Request("http://x" + p, { method: body ? "POST" : "GET", headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "CF-Connecting-IP": ip || "9.9.9.9" }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} })).json();

// Remplissage, puis 6 joueurs pronostiquent, 2 jours passent (matchs notés), puis nouveaux pronos en attente
await robot(190);
const bots = [];
for (const [i, pseudo] of ["Zizou", "Platoche", "Titi", "LaPulga", "Kyky", "Rocheteau"].entries()) bots.push(await ask("/account/signup", { ip: "10.0.0." + i, body: { pseudo, email: `${pseudo}@exemple.fr`, motDePasse: "motdepasse" + i, accepte: true } }));
const play = async () => {
  for (const lid of [61, 39, 62]) {
    const L = await ask(`/league-predictions?leagueId=${lid}`, { token: bots[0].token });
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
  if (f === "/index.html") body = String(body).replace('<script src="app.js?v=dp17">', '<script>window.PRONO_API="/api"</script><script src="app.js?v=dp17">');
  res.writeHead(200, { "content-type": { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" }[path.extname(f)] || "text/plain" });
  res.end(body);
}).listen(8787);

const OUT = process.argv[2];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "fr-FR", timezoneId: "Europe/Paris" });
await page.clock.setFixedTime(new Date(SIM.now)); // l'horloge du navigateur suit le monde simulé
// Relevé de tous les textes affichés pendant le parcours (HARVEST=fichier) : sert à vérifier les traductions
const seen = new Set(), seenEn = new Set(); let english = false;
await page.exposeFunction("__report", (x) => { (english ? seenEn : seen).add(x); });
await page.addInitScript(() => {
  const send = (x) => { x = (x || "").replace(/\s+/g, " ").trim(); if (x) window.__report(x); };
  const scan = (n) => {
    if (n.nodeType === 3) { if (!/^(SCRIPT|STYLE|TITLE)$/.test(n.parentNode?.nodeName || "TITLE")) send(n.nodeValue); }
    else if (n.nodeType === 1) { for (const a of ["aria-label", "title", "alt", "placeholder"]) if (n.hasAttribute(a)) send("@" + n.getAttribute(a)); for (const c of n.childNodes) scan(c); }
  };
  // On lit chaque texte un instant plus tard : c'est ce qui reste à l'écran une fois la traduction passée
  new MutationObserver((ms) => setTimeout(() => { for (const m of ms) { if (m.type === "characterData") send(m.target.nodeValue); else if (m.type === "attributes") scan(m.target); for (const n of m.addedNodes) scan(n); } }, 0))
    .observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "title", "alt", "placeholder"] });
  document.addEventListener("DOMContentLoaded", () => setTimeout(() => scan(document.body), 0));
});
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && !/404|ERR_|400|401|409/.test(m.text()) && errors.push(m.text()));
const outside = []; page.on("request", (r) => { const h = new URL(r.url()).hostname; if (h !== "localhost" && !outside.includes(h)) outside.push(h); });
// Logos des compétitions : remplacés ici par une pastille numérotée (pas d'accès à Internet pendant le test)
let logosDown = false;
await page.route(/espncdn\.com\/i\/leaguelogos/, (r) => logosDown ? r.abort() : r.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#1b3a6b"/><text x="20" y="25" font-size="12" text-anchor="middle" fill="#fff" font-family="sans-serif">${r.request().url().match(/(\d+)\.png/)[1]}</text></svg>` }));
const shot = (name, fullPage = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
const checks = [];
const check = (name, cond, info = "") => { checks.push(cond); console.log(`${cond ? "OK   " : "ÉCHEC"} ${name}${info ? "  → " + info : ""}`); };

// Visiteur non connecté
await page.goto("http://localhost:8787/"); await page.waitForSelector(".duel");
await shot("1-duels-visiteur");
{ const api = await (await page.request.get("http://localhost:8787/api/leagues")).json();
  const want = api.competitions.filter((c) => c.matchsAVenir > 0).sort((a, b) => Date.parse(a.prochain) - Date.parse(b.prochain)).map((c) => c.id);
  const got = await page.locator(".rail .chip-logo").evaluateAll((els) => els.map((e) => Number(e.dataset.league)));
  check("Accueil : onglet « Tout » en tête, sélectionné par défaut", (await page.locator(".rail .chip").first().textContent()) === "Tout" && (await page.locator(".rail .chip-all").getAttribute("aria-pressed")) === "true" && (await page.textContent(".kicker")) === "Toutes les compétitions");
  const nextOf = Object.fromEntries(api.competitions.map((c) => [c.id, Date.parse(c.prochain)]));
  check("Compétitions classées par prochain match", got.length === want.length && got.every((id, i) => i === 0 || nextOf[id] >= nextOf[got[i - 1]]), got.slice(0, 5).join(" → "));
  const tags = await page.locator(".duel .lg-tag").allTextContents();
  const openCards = page.locator(".duel:not(.is-locked)"), shut = page.locator(".duel.is-locked");
  check("Visiteur : 2 matchs offerts en tête, tous les autres réservés aux inscrits", (await openCards.count()) <= 2 && (await openCards.count()) >= 1 && (await shut.count()) >= 20 && (await page.locator(".day-free").count()) === 1 && (await page.locator(".duel").first().evaluate((e) => !e.classList.contains("is-locked"))) && (await shut.locator(".pick, .bar, .badges").count()) === 0, `${await openCards.count()} offert(s), ${await shut.count()} réservés`);
  check("Visiteur : aucun pourcentage dans une carte réservée", !/%/.test(await shut.first().textContent()) && /réservées aux inscrits/.test(await shut.first().textContent()));
  check("Accueil : matchs de plusieurs compétitions, chacun avec le nom de la sienne", (await page.locator(".duel").count()) >= 20 && tags.length === (await page.locator(".duel").count()) && new Set(tags).size >= 5, `${tags.length} matchs, ${new Set(tags).size} compétitions`); }
check("Compétitions affichées en logos", (await page.locator(".chip-logo img").count()) >= 10 && (await page.locator(".chip-name").count()) === 0, `${await page.locator(".chip-logo img").count()} logos`);
await page.click(".chip[data-league='39']"); await page.waitForSelector(".chip[data-league='39'][aria-pressed='true']"); await page.waitForSelector(".duel");
check("Changer de compétition en touchant un logo", (await page.textContent(".kicker")).includes("Premier League") && (await page.evaluate(() => location.hash)) === "#/ligue/39" && (await page.locator(".lg-tag").count()) === 0);
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
const wantedMatch = await page.locator(".duel.is-locked .lock-cta").first().getAttribute("data-after");
await page.locator(".duel.is-locked .lock-cta").first().click();
await page.waitForSelector("#f-signup");
await shot("3-inscription");
await page.fill("#f-signup [name=pseudo]", "Zizou"); await page.fill("#f-signup [name=email]", "moi@exemple.fr"); await page.fill("#f-signup [name=motDePasse]", "motdepasse9");
await page.click("#f-signup button[type=submit]"); await page.waitForSelector("#f-signup .form-err:not([hidden])");
check("Inscription : case « 18 ans et conditions » obligatoire", /18 ans/.test(await page.textContent("#f-signup .form-err")));
await page.check("#f-signup [name=accepte]");
await page.click("#f-signup button[type=submit]"); await page.waitForFunction(() => /déjà pris/.test(document.querySelector("#f-signup .form-err").textContent));
check("Pseudo déjà pris : message clair", (await page.textContent("#f-signup .form-err")) === "Ce pseudo est déjà pris.");
await page.fill("#f-signup [name=pseudo]", "Hitch"); await page.click("#f-signup button[type=submit]");
await page.waitForSelector(".match-hero"); await page.waitForSelector(".tabs button[data-pane='m']");
check("Après l'inscription : retour sur le match voulu, analyse ouverte", (await page.evaluate(() => location.hash)) === wantedMatch && (await page.locator(".lock-panel").count()) === 0 && /%/.test(await page.locator("[data-panel='m']").textContent()));
await page.click(".tabbar a[data-tab='duels']"); await page.waitForSelector(".duel");
check("Inscrit : plus aucun match réservé", (await page.locator(".duel.is-locked").count()) === 0 && (await page.locator(".day-free").count()) === 0 && (await page.locator(".duel").count()) >= 20);
await page.locator(".picks:not(.locked)").first().locator(".pick[data-pick='2']").click(); await page.waitForSelector(".pick[aria-pressed='true']");
const saved = page.locator(".pick[aria-pressed='true']").first();
check("Prono enregistré", (await saved.getAttribute("data-pick")) === "2" && /Mon prono/.test(await saved.textContent()), (await saved.locator("small").textContent()));
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
{ const back = await page.locator(".back a").getAttribute("href"); await page.click(".back a"); await page.waitForSelector(".duel");
  check("Retour depuis l'analyse : on revient à la compétition du match", /^#\/ligue\/\d+$/.test(back) && (await page.evaluate(() => location.hash)) === back && (await page.locator(".rail .chip-logo[aria-pressed='true']").count()) === 1);
  await page.click(".brand"); await page.waitForSelector(".lg-tag");
  check("Le logo du site ramène à l'accueil « Tout »", (await page.locator(".rail .chip-all").getAttribute("aria-pressed")) === "true");
  await page.goBack(); await page.waitForSelector(".duel"); await page.locator(".duel:has(.pick[aria-pressed='true']) .more").first().click(); await page.waitForSelector(".match-hero"); await page.waitForTimeout(300); }
check("Analyse : cotes, « Remboursé si nul » et onglet Marchés présents", /cote \d/.test(await page.locator("[data-panel='m']").textContent()) && /Remboursé si nul/.test(await page.locator("[data-panel='m']").textContent()) && (await page.locator(".tabs button").first().textContent()) === "Marchés");
await shot("5-analyse", false);
// Arène et compte
await page.click(".tabbar a[data-tab='arene']"); await page.waitForSelector(".podium"); await page.waitForSelector(".mp");
await shot("6-arene-connecte");
await page.click(".chip[data-week='precedente']"); await page.waitForSelector(".empty, .podium, .rks"); await shot("7-arene-semaine-derniere");
await page.click("#account"); await page.waitForSelector(".me-hero");
check("Mon espace : onglets « Mon jeu » et « Paramètres », réglages cachés au départ", (await page.locator("#espace-tabs button").allTextContents()).join("|") === "Mon jeu|Paramètres" && !(await page.locator("#f-profile").isVisible()) && !(await page.locator("#logout").isVisible()));
check("Mon espace : mes 2 pronos à venir et les points en jeu", (await page.locator("[data-plist='up'] .mp").count()) === 2 && /pts en jeu/.test(await page.textContent("[data-plist='up']")));
await page.click("#espace-tabs [data-go='general']"); await page.waitForSelector("#f-profile");
check("Paramètres : onglets Général et Sécurité, Général ouvert", (await page.locator("#param-tabs button").allTextContents()).join("|") === "Général|Sécurité" && (await page.evaluate(() => location.hash)) === "#/compte/general" && !(await page.locator("#logout").isVisible()) && !(await page.locator("[data-plist='up']").isVisible()));
await page.fill("#f-profile [name=prenom]", "Hicham"); await page.fill("#f-profile [name=ville]", "Paris");
await page.click("#club-open"); await page.waitForSelector(".club");
await page.locator("#club-picker .chip").nth(1).click(); await page.waitForSelector(".club"); await page.waitForTimeout(300);
await shot("8a-choix-club", false);
const clubName = await page.locator(".club small").nth(2).textContent();
await page.locator(".club").nth(2).click();
await page.click("#f-profile button[type=submit]"); await page.waitForFunction(() => document.getElementById("toast").textContent === "Infos enregistrées.");
const saved2 = d1.raw.prepare("SELECT prenom, ville, club, club_logo FROM joueurs WHERE pseudo = 'Hitch'").get();
check("Mes infos enregistrées en base (prénom, ville, club)", saved2.prenom === "Hicham" && saved2.ville === "Paris" && saved2.club === clubName && !!saved2.club_logo, `${saved2.club}`);
await page.reload(); await page.waitForSelector("#f-profile");
check("Mes infos toujours là après rechargement", (await page.inputValue("#f-profile [name=prenom]")) === "Hicham" && (await page.textContent("#club-now")).includes(clubName));
await page.waitForTimeout(300); await shot("8-parametres-general");
await page.click("#param-tabs [data-go='securite']"); await page.waitForSelector("#logout");
check("Sécurité : e-mail, mot de passe, déconnexion et suppression au même endroit", (await page.locator("#f-email").count()) === 1 && (await page.locator(".fold").first().isVisible()) && (await page.locator(".danger").isVisible()) && !(await page.locator("#f-profile").isVisible()));
await shot("8-parametres-securite");
await page.click(".fold >> nth=1 >> summary"); await page.fill("#f-password [name=ancien]", "motdepasse9"); await page.fill("#f-password [name=nouveau]", "motdepasse10"); await page.click("#f-password button[type=submit]");
await page.waitForFunction(() => document.getElementById("toast").textContent === "Mot de passe modifié.");
await page.click(".fold >> nth=0 >> summary"); await page.fill("#f-email [name=email]", "moi2@exemple.fr"); await page.fill("#f-email [name=motDePasse]", "motdepasse10"); await page.click("#f-email button[type=submit]");
await page.waitForFunction(() => document.getElementById("mail-now")?.textContent === "moi2@exemple.fr");
check("E-mail et mot de passe modifiés depuis l'espace", true);
SIM.now += 61000; // le classement est gardé 1 min en mémoire côté moteur
await page.click(".tabbar a[data-tab='arene']"); await page.waitForSelector(".rk.me .fan, .pod.me .fan");
check("Arène : mon blason à côté de mon pseudo", true);
await shot("8b-arene-blason", false);
await page.click("#account"); await page.waitForSelector(".me-hero"); await shot("8-compte");
// Rechargement : toujours connecté ; déconnexion puis reconnexion
await page.reload(); await page.waitForSelector(".me-hero");
check("Toujours connecté après rechargement", (await page.textContent("#account")).includes("Hitch"));
await page.goto("http://localhost:8787/#/compte/securite"); await page.waitForSelector("#logout");
await page.click("#logout"); await page.waitForSelector(".duel");
check("Déconnexion : les matchs redeviennent réservés", (await page.textContent("#account")).trim() === "Connexion" && (await page.locator(".pick[aria-pressed='true']").count()) === 0 && (await page.locator(".duel.is-locked").count()) >= 20);
{ const lockedHref = await page.locator(".duel.is-locked .lock-cta").first().getAttribute("data-after");
  await page.goto("http://localhost:8787/" + lockedHref); await page.waitForSelector(".lock-panel");
  check("Visiteur : l'adresse directe d'un match réservé n'affiche aucune probabilité", !/%/.test(await page.locator("#view").textContent()) && (await page.locator(".tabs").count()) === 0);
  await shot("12-analyse-reservee", false); await page.goto("http://localhost:8787/#/"); await page.waitForSelector(".duel"); }
await page.click("#account"); await page.click(".tabs button[data-mode='login']");
await page.fill("#f-login [name=identifiant]", "moi2@exemple.fr"); await page.fill("#f-login [name=motDePasse]", "mauvais"); await page.click("#f-login button[type=submit]");
await page.waitForSelector("#f-login .form-err:not([hidden])"); await shot("9-connexion-erreur", false);
await page.fill("#f-login [name=motDePasse]", "motdepasse10"); await page.click("#f-login button[type=submit]"); await page.waitForSelector(".mp");
check("Reconnexion par e-mail : mes pronos sont là", (await page.locator(".mp").count()) === 2);
// Mot de passe oublié : demande, e-mail, lien, nouveau mot de passe
{ await page.goto("http://localhost:8787/#/compte/securite"); await page.waitForSelector("#logout"); await page.click("#logout"); await page.waitForSelector(".duel");
  await page.click("#account"); await page.click(".tabs button[data-mode='login']"); await page.waitForSelector("#f-login .link-small");
  await page.click("#f-login .link-small"); await page.waitForSelector("#f-forgot");
  SIM.mails.length = 0; await page.fill("#f-forgot [name=email]", "moi2@exemple.fr"); await page.click("#f-forgot button[type=submit]"); await page.waitForSelector("#forgot-sent");
  await shot("14-oubli-envoye", false);
  const lk = /(#\/nouveau-mot-de-passe\/[a-f0-9]{64})/.exec(SIM.mails[0]?.text || "")?.[1];
  check("Mot de passe oublié : lien reçu par e-mail", !!lk && SIM.mails[0].to[0] === "moi2@exemple.fr");
  await page.goto("http://localhost:8787/" + lk); await page.waitForSelector("#f-reset"); await shot("15-nouveau-mdp", false);
  await page.fill("#f-reset [name=nouveau]", "motdepasse11"); await page.click("#f-reset button[type=submit]"); await page.waitForSelector(".me-hero");
  check("Nouveau mot de passe enregistré, connecté aussitôt", (await page.textContent("#account")).includes("Hitch") && (await page.evaluate(() => location.hash)) === "#/compte");
  await page.goto("http://localhost:8787/" + lk); await page.waitForSelector("#f-reset"); await page.fill("#f-reset [name=nouveau]", "motdepasse12"); await page.click("#f-reset button[type=submit]"); await page.waitForSelector("#f-reset .form-err:not([hidden])");
  check("Le même lien ne marche pas deux fois", /expiré/.test(await page.textContent("#f-reset .form-err"))); }
// Verdict inchangé
await page.click(".tabbar a[data-tab='verdict']"); await page.waitForSelector(".res, .empty"); await shot("10-verdict", false);
check("Verdict : même colonne, avec « Tout »", (await page.locator(".rail .chip-all").count()) === 1);
await page.waitForSelector(".bt");
check("Verdict : test sur les matchs passés, comparé aux bookmakers et au hasard", /Testé sur 7\s?091 matchs passés/.test(await page.textContent(".bt h2")) && (await page.locator(".bt-tiles .cell").count()) === 3 && (await page.locator(".cal").count()) >= 8 && /Brier/.test(await page.textContent("#verdict")));
await page.locator(".bt").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/13-verdict-test.png`, fullPage: true });
// Suppression du compte
await page.goto("http://localhost:8787/#/compte/securite"); await page.waitForSelector("#logout"); await page.click(".danger summary"); await page.fill("#f-delete [name=motDePasse]", "motdepasse11"); await page.click("#f-delete button[type=submit]"); await page.waitForSelector(".duel");
check("Suppression du compte : plus rien en base", d1.raw.prepare("SELECT COUNT(*) n FROM joueurs WHERE pseudo = 'Hitch'").get().n === 0);
// Débordement horizontal (téléphone étroit)
await page.setViewportSize({ width: 320, height: 640 });
await page.evaluate(() => 0);
for (const h of ["#/", "#/verdict", "#/arene", "#/compte"]) { await page.goto("http://localhost:8787/" + h); await page.waitForTimeout(500); const w = await page.evaluate(() => document.documentElement.scrollWidth); check(`Pas de débordement à 320 px (${h})`, w <= 320, `${w} px`); }
await page.setViewportSize({ width: 390, height: 844 });
await page.route("**/api/leagues", async (r) => { const j = await (await r.fetch()).json(); for (const c of j.competitions) if ([39, 62, 2].includes(c.id)) c.matchsAVenir = 0; await r.fulfill({ json: j }); });
await page.goto("http://localhost:8787/#/verdict"); await page.reload(); await page.goto("http://localhost:8787/#/"); await page.waitForSelector(".duel");
check("Championnats sans match retirés de la colonne", (await page.locator(".rail .chip-logo").count()) === 11 && (await page.locator(".rail .chip[data-league='39'], .rail .chip[data-league='62'], .rail .chip[data-league='2']").count()) === 0, `${await page.locator(".rail .chip-logo").count()} logos au lieu de 14`);
await page.setViewportSize({ width: 390, height: 844 });
for (const [h, t] of [["a-propos", "À propos"], ["conditions", "Conditions d'utilisation"], ["confidentialite", "Confidentialité"], ["mentions-legales", "Mentions légales"]]) {
  await page.goto("http://localhost:8787/#/" + h); await page.waitForSelector(".doc");
  check(`Page « ${t} »`, (await page.textContent(".hero h1")) === t && (await page.locator(".doc h2").count()) >= 4);
  await shot("11-" + h);
  await page.setViewportSize({ width: 320, height: 640 }); const w = await page.evaluate(() => document.documentElement.scrollWidth); await page.setViewportSize({ width: 390, height: 844 });
  if (w > 320) check(`Pas de débordement à 320 px (#/${h})`, false, `${w} px`);
}
check("Liens d'information en bas de chaque page", (await page.locator(".legal-links a").count()) === 4);
check("Polices hébergées sur le site (aucun appel à Google)", !outside.some((h) => /google|gstatic/.test(h)) && await page.evaluate(() => document.fonts.check("900 20px Archivo") && document.fonts.check("400 14px 'Space Grotesk'")), `serveurs extérieurs contactés : ${outside.join(", ") || "aucun"}`);
// ---- Version ordinateur ----
await page.unroute("**/api/leagues");
await page.setViewportSize({ width: 1440, height: 900 });
const pc = await ask("/account/signup", { ip: "10.0.1.1", body: { pseudo: "Hitch", email: "pc@exemple.fr", motDePasse: "motdepasse9", accepte: true } });
{ const L = await ask("/league-predictions?leagueId=61", { token: pc.token }); for (const m of L.predictions.slice(2, 6)) await ask("/picks", { token: pc.token, body: { leagueId: 61, matchId: m.matchId, choix: "1" } }); }
await page.goto("http://localhost:8787/#/"); await page.evaluate(([t, p]) => { localStorage.setItem("token", t); localStorage.setItem("pseudo", p); localStorage.setItem("league", "61"); }, [pc.token, pc.pseudo]);
const wide = async (name) => { const w = await page.evaluate(() => document.documentElement.scrollWidth); check(`Ordinateur : pas de débordement (${name})`, w <= 1440, `${w} px`); await page.screenshot({ path: `${OUT}/pc-${name}.png` }); };
await page.reload(); await page.waitForSelector(".duel");
{ const tb = await page.locator(".tabbar").boundingBox(), d = await page.locator(".duel").evaluateAll((els) => els.slice(0, 2).map((e) => e.getBoundingClientRect()).map((b) => [Math.round(b.left), Math.round(b.top), Math.round(b.width)]));
  check("Ordinateur : navigation en haut, plus de barre en bas", tb.y < 5 && tb.height < 90);
  check("Ordinateur : matchs sur deux colonnes", d[0][1] === d[1][1] && d[1][0] > d[0][0] + 300, `cartes de ${d[0][2]} px`);
  check("Ordinateur : pas de barre de défilement visible dans la colonne, qui défile quand même", await page.locator(".rail").evaluate((e) => e.offsetWidth === e.clientWidth && e.scrollHeight > e.clientHeight && (e.scrollTop = 200, e.scrollTop > 0)));
  check("Ordinateur : noms des compétitions à côté des logos", await page.locator(".rail .chip-logo").first().evaluate((e) => getComputedStyle(e, "::after").content.includes(e.getAttribute("aria-label")))); }
await wide("duels");
await page.locator(".duel .more").first().click(); await page.waitForSelector(".match-hero"); await page.waitForTimeout(400); await wide("analyse");
await page.click(".tabs button[data-pane='c']"); await page.waitForTimeout(400); await wide("compos");
await page.click(".tabbar a[data-tab='verdict']"); await page.waitForSelector(".res, .empty"); await wide("verdict");
SIM.now += 61000; await page.click(".tabbar a[data-tab='arene']"); await page.waitForSelector(".board"); await page.waitForSelector(".mp"); await wide("arene");
await page.click("#account"); await page.waitForSelector(".me-hero"); await wide("espace");
await page.click("#espace-tabs [data-go='general']"); await page.waitForSelector("#f-profile"); await wide("parametres-general");
await page.click("#param-tabs [data-go='securite']"); await page.waitForSelector("#logout"); await wide("parametres-securite");
await page.goto("http://localhost:8787/#/confidentialite"); await page.waitForSelector(".doc"); await wide("confidentialite");
await page.goto("http://localhost:8787/#/compte/securite"); await page.waitForSelector("#logout"); await page.click("#logout"); await page.waitForSelector(".duel"); await page.click("#account"); await page.waitForSelector("#f-login"); await wide("connexion");
// ---- Version anglaise : on refait un tour complet et on cherche le moindre mot français resté à l'écran ----
check("Langue : français par défaut, choix proposé en bas de page", (await page.evaluate(() => document.documentElement.lang)) === "fr" && (await page.locator(".lang-switch [data-lang='fr']").getAttribute("aria-pressed")) === "true");
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://localhost:8787/#/"); await page.waitForSelector(".duel");
english = true;
await page.click(".lang-switch [data-lang='en']"); await page.waitForFunction(() => document.documentElement.lang === "en"); await page.waitForSelector(".duel");
check("Anglais : le site bascule et s'en souvient", (await page.textContent(".hero h1")) === "Pick your side." && (await page.locator(".tabbar a").allTextContents()).map((x) => x.trim()).join("|") === "Duels|Verdict|Arena" && (await page.textContent("#account")).trim() === "Log in" && (await page.title()) === "Duel Prono · The football forecast arena");
await shot("en-1-home");
const go = async (hash, sel) => { await page.goto("http://localhost:8787/" + hash); await page.waitForSelector(sel); await page.waitForTimeout(250); };
await page.locator(".rail .chip-logo").first().click(); await page.waitForSelector(".duel"); await page.locator(".day-btn").nth(1).click().catch(() => {});
await go(await page.locator(".duel.is-locked .lock-cta").first().getAttribute("data-after"), ".lock-panel");
await go("#/verdict", ".res, .empty"); await page.locator(".rail .chip-logo").first().click(); await page.waitForSelector(".res, .empty"); await page.waitForTimeout(250);
await go("#/arene", ".board"); await page.click(".chip[data-week='precedente']"); await page.waitForSelector(".board"); await page.waitForTimeout(250);
for (const d of ["a-propos", "conditions", "confidentialite", "mentions-legales"]) await go("#/" + d, ".doc");
check("Anglais : pages d'information traduites", (await page.textContent(".hero h1")) === "Legal notice" && /published by a private individual/.test(await page.textContent(".doc")));
await go("#/compte", ".tabs button[data-mode='signup']");
await page.click(".tabs button[data-mode='signup']"); await page.waitForSelector("#f-signup:not([hidden])");
await page.fill("#f-signup [name=pseudo]", "x"); await page.click("#f-signup button[type=submit]"); await page.waitForSelector("#f-signup .form-err:not([hidden])");
check("Anglais : message d'erreur du moteur traduit", (await page.textContent("#f-signup .form-err")) === "Username: 3 to 16 letters or digits, no spaces.");
await shot("en-2-signup");
await page.click(".tabs button[data-mode='login']"); await page.waitForSelector("#f-login:not([hidden])");
await page.fill("#f-login [name=identifiant]", "nobody"); await page.fill("#f-login [name=motDePasse]", "wrong-password"); await page.click("#f-login button[type=submit]"); await page.waitForSelector("#f-login .form-err:not([hidden])");
await page.click(".tabs button[data-mode='signup']");
await page.fill("#f-signup [name=pseudo]", "Bobby"); await page.fill("#f-signup [name=email]", "bobby@example.com"); await page.fill("#f-signup [name=motDePasse]", "password99"); await page.check("#f-signup [name=accepte]");
await page.click("#f-signup button[type=submit]"); await page.waitForSelector(".board"); await page.waitForTimeout(400);
await go("#/", ".duel"); await page.locator(".picks:not(.locked)").first().locator(".pick[data-pick='1']").click(); await page.waitForSelector(".pick[aria-pressed='true']"); await page.waitForTimeout(400);
check("Anglais : prono enregistré, message traduit", /^Pick saved · \d+ pts at stake$/.test(await page.textContent("#toast")) && /My pick/.test(await page.locator(".pick[aria-pressed='true']").first().textContent()));
await page.locator(".duel:has(.pick[aria-pressed='true']) .more").first().click(); await page.waitForSelector(".match-hero"); await page.waitForTimeout(400);
await shot("en-3-analysis");
for (const k of ["s", "c", "h"]) { await page.click(`.tabs button[data-pane='${k}']`); await page.waitForTimeout(300); }
SIM.now += 61000; await go("#/arene", ".board"); await page.waitForSelector(".mp"); await shot("en-4-arena");
await go("#/compte", ".me-hero"); await shot("en-5-space");
await page.click("#espace-tabs [data-go='general']"); await page.waitForSelector("#f-profile"); await page.click("#club-open"); await page.waitForSelector(".club"); await page.locator(".club").first().click();
await page.click("#f-profile button[type=submit]"); await page.waitForFunction(() => document.getElementById("toast").textContent === "Details saved.");
check("Anglais : choix de la langue dans Paramètres → Général", (await page.locator(".lang-choice [data-lang='en']").getAttribute("aria-pressed")) === "true" && (await page.locator("#param-tabs button").allTextContents()).map((x) => x.trim()).join("|") === "General|Security");
await shot("en-6-settings");
await page.click("#param-tabs [data-go='securite']"); await page.waitForSelector("#logout"); await page.click(".fold >> nth=0 >> summary"); await page.click(".fold >> nth=1 >> summary"); await page.click(".danger summary");
await page.fill("#f-email [name=email]", "b2@example.com"); await page.fill("#f-email [name=motDePasse]", "not-my-password"); await page.click("#f-email button[type=submit]"); await page.waitForSelector("#f-email .form-err:not([hidden])");
await page.setViewportSize({ width: 1440, height: 900 }); await go("#/", ".duel"); await page.screenshot({ path: `${OUT}/en-7-pc.png` }); await page.setViewportSize({ width: 390, height: 844 });
await go("#/compte/securite", "#logout"); await page.click("#logout"); await page.waitForSelector(".duel"); await page.waitForTimeout(300);
{ const FR = /[àâçéèêëîïôùûüœ]|(^|[\s'’(«])(le|la|les|des|du|une|un|et|ou|pour|avec|sur|dans|ton|ta|tes|mon|ma|mes|aux|est|pas|que|qui|ce|cette|au|de|tu|il|nous|vous|je)(?=[\s,.!?:;)»]|$)/i;
  // Noms venus des données ou saisis par les joueurs : ils ne se traduisent pas
  const left = [...seenEn].map((x) => x.replace(/^@/, "")).filter((x) => x.length > 3).filter((x) => FR.test(x.replace(/Équipe \S+/g, "").replace(/\b(Brasileirão|Français|Platoche|LaPulga|Rocheteau)\b/g, "").replace(/\bMon(?= \d|$)/g, "")));
  check("Anglais : plus un seul mot français à l'écran sur tout le parcours", left.length === 0, `${seenEn.size} textes vérifiés${left.length ? " ; restés en français : " + left.slice(0, 40).map((x) => JSON.stringify(x)).join(" ") : ""}`); }
await page.click(".lang-switch [data-lang='fr']"); await page.waitForFunction(() => document.documentElement.lang === "fr"); await page.waitForSelector(".duel");
check("Retour au français en un clic", (await page.textContent(".hero h1")) === "Choisis ton camp." && (await page.textContent("#account")).trim() === "Connexion");
english = false;
check("Aucune erreur JavaScript", errors.length === 0, errors.join(" | "));
if (process.env.HARVEST) fs.writeFileSync(process.env.HARVEST, JSON.stringify([...seen], null, 0));
await browser.close(); server.close();
process.exit(checks.every(Boolean) ? 0 : 1);
