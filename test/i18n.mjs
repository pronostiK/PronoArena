// Vérifie que tout texte français du site a sa traduction anglaise (les textes à chiffres/noms sont vérifiés dans Chrome par preview.mjs)
import fs from "node:fs";
import vm from "node:vm";

const ctx = { localStorage: { getItem: () => "en", setItem() {} }, navigator: { language: "en" }, location: { reload() {} } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../site/public/i18n.js", import.meta.url), "utf8"), ctx);
const t = ctx.DP_I18N.t;

// Un texte « a l'air français » s'il contient un accent ou un petit mot courant
export const FRENCH = /[àâçéèêëîïôùûüœ]|(^|[\s'’(«])(le|la|les|des|du|une|un|et|ou|pour|avec|sur|dans|ton|ta|tes|mon|ma|mes|aux|est|pas|que|qui|ce|cette|au|de|tu|il|nous|vous|je)(?=[\s,.!?:;)»]|$)/i;

let app = fs.readFileSync(new URL("../site/public/app.js", import.meta.url), "utf8");
app = app.replace(/\/\/[^\n]*/g, ""); // commentaires
const a = app.indexOf("const DOCS_FR = {"), b = app.indexOf("const DOCS_EN = {");
app = app.slice(0, a) + app.slice(b); // les pages d'information ont leur propre version anglaise
const shell = fs.readFileSync(new URL("../site/public/index.html", import.meta.url), "utf8").replace(/<head>[\s\S]*<\/head>/, "");

const cands = new Set();
const clean = (x) => x.replace(/\s+/g, " ").trim();
for (const src of [app, shell]) {
  for (const m of src.matchAll(/>([^<>`${}]*[A-Za-zÀ-ÿ]{2}[^<>`${}]*)</g)) cands.add(clean(m[1]));
  for (const m of src.matchAll(/(?:aria-label|title|alt|placeholder)="([^"${}]+)"/g)) cands.add(clean(m[1]));
}
for (const m of app.matchAll(/"([^"\n${}<>=]{4,})"/g)) cands.add(clean(m[1]));
for (const f of ["arena.js", "index.js"]) {
  const src = fs.readFileSync(new URL("../src/" + f, import.meta.url), "utf8");
  for (const m of src.matchAll(/(?:HttpError\(\d+, |new Error\(|error: )"((?:[^"\\]|\\.)*)"/g)) cands.add(m[1]);
}
// Textes volontairement identiques dans les deux langues, ou qui ne sont pas affichés
const SAME = new Set(["Français", "English", "Duel Prono", ", ton pronostic", "la compétition", "Pas encore de match terminé sur la période."]); // les 3 derniers : morceaux de phrases, traduits avec la phrase entière
const missing = [...cands].filter((c) => c && FRENCH.test(c) && !SAME.has(c) && t(c) === c);
const engine = [...cands].filter((c) => /^(Trop d'essais|Pronostic invalide|Club introuvable|Route inconnue|Demande illisible)/.test(c));
console.log(`${missing.length ? "ÉCHEC" : "OK   "} Anglais : chaque texte français du site a sa traduction  → ${cands.size} textes examinés${missing.length ? "\n      sans traduction : " + missing.map((x) => JSON.stringify(x)).join("\n                        ") : ""}`);
const ok2 = engine.length >= 5 && engine.every((c) => t(c) !== c);
console.log(`${ok2 ? "OK   " : "ÉCHEC"} Anglais : messages d'erreur du moteur traduits`);
const samples = [["3 matchs", "3 matches"], ["1 match", "1 match"], ["Fiabilité élevée", "High reliability"], ["Du 9 au 15 November", "9 – 15 November"], ["2 justes sur 3 · 8 en attente", "2 correct out of 3 · 8 pending"], ["Victoire Paris FC, 34 %, ton pronostic", "Paris FC win, 34%, your pick"], ["· Ligue des champions", "· Champions League"], ["Paris FC", "Paris FC"]];
const bad = samples.filter(([fr, en]) => t(fr) !== en);
console.log(`${bad.length ? "ÉCHEC" : "OK   "} Anglais : textes avec chiffres et noms${bad.length ? "  → " + bad.map(([fr]) => `${fr} → ${t(fr)}`).join(" | ") : ""}`);
console.log(`${[1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ctx.DP_I18N.ord).join() === "1st,2nd,3rd,4th,11th,12th,13th,21st,22nd,23rd,101st,111th" ? "OK   " : "ÉCHEC"} Anglais : rangs (1st, 2nd, 3rd, 11th…)`);
// Français : les sélections nationales (données en anglais chez les fournisseurs) s'affichent en français
const fr = { localStorage: { getItem: () => "fr", setItem() {} }, navigator: { language: "fr" }, location: { reload() {} } };
fr.window = fr;
vm.createContext(fr);
vm.runInContext(fs.readFileSync(new URL("../site/public/i18n.js", import.meta.url), "utf8"), fr);
const { AFRICA_NAMES } = await import("../src/flags.js");
const SAME_FR = new Set(["angola", "botswana", "burkina faso", "burundi", "congo", "djibouti", "eswatini", "gabon", "ghana", "kenya", "lesotho", "liberia", "madagascar", "malawi", "mali", "mozambique", "niger", "nigeria", "rwanda", "seychelles", "sierra leone", "togo", "zimbabwe"]);
const cap = (x) => x.replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const noFr = AFRICA_NAMES.filter((n) => !SAME_FR.has(n) && fr.DP_I18N.team(cap(n)) === cap(n));
const natSamples = [["Comoros", "Comores"], ["Cape Verde", "Cap-Vert"], ["South Africa", "Afrique du Sud"], ["Egypt", "Égypte"], ["Côte d'Ivoire", "Côte d'Ivoire"], ["Congo DR", "RD Congo"], ["Türkiye", "Turquie"], ["Bosnia & Herzegovina", "Bosnie-Herzégovine"], ["Cyprus", "Chypre"], ["Paris FC", "Paris FC"], ["Galatasaray", "Galatasaray"]];
const natBad = natSamples.filter(([en, f]) => fr.DP_I18N.team(en) !== f);
const walked = fr.DP_I18N.names({ predictions: [{ teams: { domicile: { name: "Egypt", pseudo: "Egypt" }, exterieur: { name: "Malawi" } }, forme: [{ adversaire: "Tunisia" }] }], club: { nom: "Morocco" }, pays: "Egypt" });
const okWalk = walked.predictions[0].teams.domicile.name === "Égypte" && walked.predictions[0].teams.domicile.pseudo === "Egypt" && walked.predictions[0].forme[0].adversaire === "Tunisie" && walked.club.nom === "Maroc" && walked.pays === "Egypt";
const okEn = ctx.DP_I18N.team("Egypt") === "Egypt" && ctx.DP_I18N.names({ name: "Egypt" }).name === "Egypt";
const okNat = !noFr.length && !natBad.length && okWalk && okEn;
console.log(`${okNat ? "OK   " : "ÉCHEC"} Français : sélections nationales traduites (${AFRICA_NAMES.length} noms africains vérifiés, anglais inchangé)${noFr.length ? "  → sans traduction : " + noFr.join(", ") : ""}${natBad.length ? "  → " + natBad.map(([en]) => `${en} → ${fr.DP_I18N.team(en)}`).join(" | ") : ""}`);
process.exit(missing.length || !ok2 || bad.length || !okNat ? 1 : 0);
