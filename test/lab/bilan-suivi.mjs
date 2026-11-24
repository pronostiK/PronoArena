// ============================================================
// BILAN DU SUIVI M0 / M7 (informatif) — applique test/lab/PROTOCOLE-SUIVI.md
// Entrées (lues en ligne, rien n'est modifié) :
//   - journal : https://api.duelprono.com/suivi/export (probabilités visibles 3 h après le coup d'envoi) ;
//   - sceaux : branche GitHub suivi-empreintes (heure du commit = heure d'ancrage) ;
//   - résultats : ceux du robot (/verdict, par championnat), contrôlés par l'historique football-data.co.uk si fourni.
//   - matchs non affichés (hors des 10 publiés) : leur score vient de l'historique football-data.co.uk (noms rapprochés).
// Usage : node test/lab/bilan-suivi.mjs <début ISO> <fin ISO> [history.json] [predictions.csv]
// ============================================================
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { rowText } from "../../src/suivi.js";

const [FROM, TO, HIST, CSV] = process.argv.slice(2);
const t0 = Date.parse(FROM), t1 = Date.parse(TO);
const API = "https://api.duelprono.com";
const get = async (p) => (await fetch(`${API}${p}${p.includes("?") ? "&" : "?"}n=${Date.now()}`)).json();
const sha = (t) => createHash("sha256").update(t).digest("hex");
const NAMES = { 61: "Ligue 1", 39: "Premier League", 140: "Liga", 135: "Serie A", 78: "Bundesliga", 94: "Portugal", 88: "Eredivisie", 40: "Championship", 62: "Ligue 2" };
const incidents = [];

// 1. Journal complet et vérification de la chaîne
const lignes = [];
for (let from = 0; ; ) { const e = await get(`/suivi/export?depuis=${from}`); lignes.push(...e.lignes); if (e.lignes.length < 5000) break; from = e.lignes.at(-1).seq; }
let prec = "0".repeat(64), rupture = null, contenuFaux = 0;
for (const r of lignes) {
  if (r.prec !== prec || sha(prec + "|" + r.contenu) !== r.empreinte) { rupture ||= r.seq; }
  if (!r.masque && sha(rowText(r)) !== r.contenu) contenuFaux++;
  prec = r.empreinte;
}
if (rupture) incidents.push(`Rupture de la chaîne d'empreintes à la ligne ${rupture}`);
if (contenuFaux) incidents.push(`${contenuFaux} ligne(s) dont le contenu ne correspond pas à son empreinte`);
const bySeq = new Map(lignes.map((r) => [r.seq, r]));

// 2. Sceaux GitHub : (seq, empreinte, heure du commit)
execSync("git fetch -q origin suivi-empreintes", { stdio: "ignore" });
const seals = [];
for (const l of execSync("git log FETCH_HEAD --reverse --format=%H%x20%ct").toString().trim().split("\n")) {
  const [h, ct] = l.split(" ");
  let last; try { last = execSync(`git show ${h}:suivi/empreintes.jsonl`).toString().trim().split("\n").at(-1); } catch { continue; }
  const s = JSON.parse(last);
  if (seals.length && seals.at(-1).empreinte === s.empreinte) continue;
  const r = bySeq.get(s.seq);
  if (!r || r.empreinte !== s.empreinte) { incidents.push(`Sceau du ${new Date(+ct * 1000).toISOString()} (ligne ${s.seq}) absent ou différent dans le journal`); continue; }
  seals.push({ seq: s.seq, empreinte: s.empreinte, at: +ct * 1000, commit: h });
}
const sealFor = (seq, limit) => seals.find((s) => s.seq >= seq && s.at < limit);
const anchoredBy = (seq, limit) => !!sealFor(seq, limit);

// 3. Résultats du robot (matchs publiés et terminés) + matchs attendus
const results = new Map(), attendus = new Map();
for (const id of Object.keys(NAMES)) {
  const v = await get(`/verdict?leagueId=${id}&days=10`);
  for (const m of v.matchs || []) { const ts = Date.parse(m.date); if (ts >= t0 && ts < t1) { results.set(`${id}:${m.matchId}`, [m.score.dom, m.score.ext]); attendus.set(`${id}:${m.matchId}`, `${m.domicile.nom} – ${m.exterieur.nom}`); } }
}

// 4. Contrôle par football-data.co.uk (scores par championnat et par jour)
let controle = null;
if (HIST) {
  const FD = { 61: "FL1", 39: "PL", 140: "PD", 135: "SA", 78: "BL1", 94: "PPL", 88: "DED", 40: "ELC", 62: "FL2" };
  const h = JSON.parse(fs.readFileSync(HIST, "utf8"));
  controle = { compares: 0, desaccords: 0 };
  // comparé plus bas, match par match, par (championnat, jour, score) en multiensemble
  controle.fd = h; controle.FD = FD;
}

// Score d'un match non affiché : même championnat, même jour, noms rapprochés (mots de 4 lettres ou plus en commun)
const norm = (t) => String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(fc|afc|cf|sc|ac|as|ss|us|rc|sv|vfb|vfl|tsg|1\.)\b/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
const proche = (a, b) => { const A = norm(a), B = norm(b); return A.some((x) => B.some((y) => x.slice(0, 4) === y.slice(0, 4))); };
function scoreFd(pick, ke) {
  const d = new Date(ke).toISOString().slice(0, 10);
  const c = controle.fd.filter((m) => m.lg === controle.FD[pick.ligue] && m.date === d && proche(m.home, pick.dom) && proche(m.away, pick.ext));
  return c.length === 1 ? [c[0].hg, c[0].ag] : null;
}

// 5. Prédiction retenue pour chaque match (règle 3)
const parMatch = new Map();
for (const r of lignes) if (r.coup_envoi >= t0 && r.coup_envoi < t1) (parMatch.get(r.ligue + "|" + (r.match || r.seq)) || parMatch.set(r.ligue + "|" + (r.match || r.seq), []).get(r.ligue + "|" + (r.match || r.seq))).push(r);
const retenus = [], exclus = [];
for (const [, rows] of parMatch) {
  const k = rows[0].match, ke = rows.at(-1).coup_envoi;
  const avant = rows.filter((r) => r.cree_le < ke);
  if (!avant.length) { exclus.push({ k, raison: "aucune ligne avant le coup d'envoi" }); continue; }
  let pick = [...avant].reverse().find((r) => anchoredBy(r.seq, ke)), tardif = false;
  if (!pick) { pick = [...avant].reverse().find((r) => anchoredBy(r.seq, ke + 3600000)); tardif = !!pick; }
  if (!pick) { exclus.push({ k, raison: "aucune ligne scellée à temps" }); continue; }
  if (pick.masque) { exclus.push({ k, raison: "probabilités encore masquées" }); continue; }
  let sc = results.get(k), source = "robot (match affiché)";
  if (!sc && controle) { sc = scoreFd(pick, ke); source = "football-data.co.uk (match non affiché)"; }
  if (!sc) { exclus.push({ k, raison: "pas de résultat (reporté, annulé ou pas encore connu)" }); continue; }
  const infos = JSON.parse(pick.infos || "{}");
  retenus.push({ k, ligue: pick.ligue, date: new Date(ke).toISOString().slice(0, 10), m0: JSON.parse(pick.m0), m7: JSON.parse(pick.m7), res: sc[0] > sc[1] ? 0 : sc[0] === sc[1] ? 1 : 2, sc, tardif, publie: infos.publie !== false, corners: infos.cornersMatchs, nom: `${pick.dom} – ${pick.ext}`, pick, ke, source, sceau: sealFor(pick.seq, tardif ? ke + 3600000 : ke) });
}
for (const [k, nom] of attendus) if (!parMatch.has(k.split(":")[0] + "|" + k)) exclus.push({ k, raison: `match publié sans aucune ligne au journal (${nom})` });
const manquants = exclus.filter((e) => /sans aucune ligne/.test(e.raison));
if (manquants.length) incidents.push(`${manquants.length} match(s) publié(s) sans prédiction au journal`);

// Contrôle des scores avec football-data.co.uk (multiensemble des scores par championnat et par jour)
if (controle) {
  for (const id of Object.keys(NAMES)) {
    const days = [...new Set(retenus.filter((r) => r.ligue === +id).map((r) => r.date))];
    for (const d of days) {
      const a = retenus.filter((r) => r.ligue === +id && r.date === d && r.publie).map((r) => r.sc.join("-")).sort();
      const b = controle.fd.filter((m) => m.lg === controle.FD[id] && m.date === d).map((m) => `${m.hg}-${m.ag}`).sort();
      if (!b.length) continue;
      controle.compares += a.length;
      const bb = [...b]; for (const x of a) { const i = bb.indexOf(x); if (i >= 0) bb.splice(i, 1); else controle.desaccords++; }
    }
  }
  delete controle.fd; delete controle.FD;
  if (controle.desaccords) incidents.push(`${controle.desaccords} score(s) du robot sans équivalent chez football-data.co.uk (à vérifier)`);
}

// 6. Mesures
const brier = (p, k) => p.reduce((s, v, i) => s + (v - (i === k ? 1 : 0)) ** 2, 0), logl = (p, k) => -Math.log(Math.max(1e-15, p[k]));
function bloc(l) {
  if (!l.length) return null;
  const m = (c, f) => l.reduce((s, r) => s + f(r[c], r.res), 0) / l.length;
  const byD = new Map(); for (const r of l) { const x = byD.get(r.date) || [0, 0]; x[0] += brier(r.m7, r.res) - brier(r.m0, r.res); x[1]++; byD.set(r.date, x); }
  const G = [...byD.values()]; let seed = 20261120; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); const sims = [];
  for (let t = 0; t < 10000; t++) { let s = 0, n = 0; for (let i = 0; i < G.length; i++) { const g = G[(rnd() * G.length) | 0]; s += g[0]; n += g[1]; } sims.push(s / n); }
  sims.sort((a, b) => a - b);
  return { n: l.length, brierM0: m("m0", brier), brierM7: m("m7", brier), ecartBrier: m("m7", brier) - m("m0", brier), ic: [sims[250], sims[9749]], loglossM0: m("m0", logl), loglossM7: m("m7", logl), ecartLogloss: m("m7", logl) - m("m0", logl), m7Mieux: l.filter((r) => brier(r.m7, r.res) < brier(r.m0, r.res)).length };
}
const out = {
  periode: [FROM, TO], journal: { lignes: lignes.length, sceaux: seals.length, chaine: rupture ? `rupture ligne ${rupture}` : "intacte" },
  matchs: { avecLigne: parMatch.size, retenus: retenus.length, ancrageTardif: retenus.filter((r) => r.tardif).length, nonAffiches: retenus.filter((r) => !r.publie).length, exclus: exclus.length },
  principal: bloc(retenus.filter((r) => !r.tardif)), avecTardifs: bloc(retenus), sansNonAffiches: bloc(retenus.filter((r) => r.publie && !r.tardif)),
  parChampionnat: Object.fromEntries(Object.entries(NAMES).map(([id, n]) => [n, bloc(retenus.filter((r) => r.ligue === +id))])),
  exclus, incidents, controleFootballData: controle,
};
console.log(JSON.stringify(out, null, 1));

// CSV des prédictions retenues (une ligne par match)
if (CSV) {
  const iso = (t) => new Date(t).toISOString().replace(".000", "");
  const f3 = (x) => x.toFixed(4);
  const head = ["championnat", "match", "domicile", "exterieur", "coup_envoi_utc", "ligne_journal", "enregistree_utc", "empreinte", "sceau_commit", "sceau_utc", "affiche", "ancrage_tardif", "score", "resultat", "source_score", "m0_dom", "m0_nul", "m0_ext", "m7_dom", "m7_nul", "m7_ext", "brier_m0", "brier_m7", "logloss_m0", "logloss_m7"];
  const q = (v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const lines = [head.join(",")];
  for (const r of [...retenus].sort((a, b) => a.ke - b.ke || a.ligue - b.ligue)) lines.push([NAMES[r.ligue], r.k, r.pick.dom, r.pick.ext, iso(r.ke), r.pick.seq, iso(r.pick.cree_le), r.pick.empreinte, r.sceau.commit, iso(r.sceau.at), r.publie ? "oui" : "non", r.tardif ? "oui" : "non", r.sc.join("-"), ["1", "N", "2"][r.res], r.source, ...r.m0, ...r.m7, f3(brier(r.m0, r.res)), f3(brier(r.m7, r.res)), f3(logl(r.m0, r.res)), f3(logl(r.m7, r.res))].map(q).join(","));
  fs.writeFileSync(CSV, lines.join("\n") + "\n");
}
