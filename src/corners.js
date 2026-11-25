// ============================================================
// DUEL PRONO — Corners des matchs passés (football-data.co.uk), utilisés dans le calcul des forces.
// Décision de Kay (20/11/2026) : forces calculées sur 70 % buts + 30 % corners (convertis en « buts » avec le rapport
// buts / corners du championnat). Test : test/lab/run-pistes-15-18.mjs, Brier −0,0011 / −0,0015 / −0,0010 sur 3 saisons.
// Portugal exclu (moins bon sur 2025-26 et 2026-27). L'Elo, le classement, la forme et les stats restent sur les vrais buts.
// Coût : un fichier CSV (quelques dizaines de Ko) par passage au plus ; saison en cours toutes les 6 h par championnat,
// saison précédente une seule fois. Une écriture KV seulement quand des corners nouveaux sont trouvés.
// Les matchs sont reliés à ceux du robot par la date (± 1 jour) ET le score, après avoir reconnu chaque équipe du fichier
// par les dates où elle a joué (aucune liste de noms à tenir).
// ============================================================
import { kvGet, srcKey, toFinished } from "./sources.js";
import { LEAGUES } from "./config.js";
import { linkStrict, buildTable } from "./liaison.js";
import { EQUIPES } from "./liaison-table.js";

// M7C (24/11/2026, validé sous conditions par l'auditeur) : liaison STRICTE par la table explicite des équipes
// (src/liaison.js) au lieu de la reconnaissance par les dates. INTERRUPTEUR : false = comportement M7 inchangé.
// Retour arrière : remettre false et publier ; les fichiers sont alors relus avec l'ancienne méthode (clés d'état distinctes).
export let LIAISON_STRICTE = true; // M7C allumée le 25/11/2026 avec l'accord du chef de projet (retour arrière : false, voir test/lab/liaison/RUPTURE-M7C.md)
export const LIAISON_VERSION = "stricte-v1";
export function _setLiaisonStricte(v) { LIAISON_STRICTE = !!v; } // tests seulement
const methode = () => (LIAISON_STRICTE ? LIAISON_VERSION : "dates");

// leagueId → code du fichier football-data.co.uk
export const CORNERS_LEAGUES = { 61: "F1", 39: "E0", 140: "SP1", 135: "I1", 78: "D1", 88: "N1", 40: "E1", 62: "F2" };
export const CORNERS_SHARE = 0.3;
const HOUR = 3600000, DAY = 24 * HOUR;
const CUR_MS = 6 * HOUR;
export const cornersKey = (id, season) => `corners:${id}@${season}`;
export const csvUrl = (code, season) => `https://www.football-data.co.uk/mmz4281/${String(season).slice(2)}${String(season + 1).slice(2)}/${code}.csv`;

function parseDate(s) {
  const p = String(s || "").trim().split(/[\/.-]/);
  if (p.length !== 3) return null;
  let [d, m, y] = p.map(Number);
  if (p[0].length === 4) [y, m, d] = p.map(Number);
  if (y < 100) y += 2000;
  const t = Date.UTC(y, m - 1, d);
  return Number.isFinite(t) ? t : null;
}
// Lignes utiles du CSV : [date (ms, minuit UTC), domicile, extérieur, buts dom., buts ext., corners dom., corners ext.]
export function parseCornersCsv(text) {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines.shift().split(",").map((h) => h.trim()), ix = (k) => head.indexOf(k);
  const [iD, iH, iA, iHG, iAG, iHC, iAC] = ["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "HC", "AC"].map(ix);
  if ([iD, iH, iA, iHG, iAG, iHC, iAC].some((i) => i < 0)) return [];
  const out = [];
  for (const l of lines) {
    const c = l.split(","), n = (i) => (c[i] !== undefined && c[i].trim() !== "" && Number.isFinite(+c[i]) ? +c[i] : null);
    const t = parseDate(c[iD]), hg = n(iHG), ag = n(iAG), hc = n(iHC), ac = n(iAC);
    if (t === null || hg === null || ag === null || hc === null || ac === null) continue;
    out.push([t, c[iH].trim(), c[iA].trim(), hg, ag, hc, ac]);
  }
  return out;
}

// Relie les lignes du CSV aux matchs du robot. Retourne { m: { idMatch: [corners dom., corners ext.] }, inconnues: [noms] }
export function matchCorners(rows, finished) {
  const day = (ts) => Math.floor(ts / DAY);
  const playedOn = {}; // équipe du robot → jours joués
  for (const f of finished) for (const id of [f.homeId, f.awayId]) (playedOn[id] ||= new Set()).add(day(f.ts));
  const csvDays = {};
  for (const r of rows) for (const n of [r[1], r[2]]) (csvDays[n] ||= []).push(day(r[0]));
  const map = {}, taken = new Set();
  // Équipes les plus présentes d'abord ; chaque équipe du robot n'est prise qu'une fois
  for (const [name, ds] of Object.entries(csvDays).sort((a, b) => b[1].length - a[1].length)) {
    let best = null, bs = 0;
    for (const [id, set] of Object.entries(playedOn)) {
      if (taken.has(id)) continue;
      let c = 0; for (const d of ds) if (set.has(d) || set.has(d - 1) || set.has(d + 1)) c++;
      if (c > bs) { bs = c; best = id; }
    }
    if (best && bs >= Math.min(3, ds.length) && bs >= 0.6 * ds.length) { map[name] = best; taken.add(best); }
  }
  const byPair = new Map();
  for (const f of finished) { const k = `${f.homeId}|${f.awayId}`; (byPair.get(k) || byPair.set(k, []).get(k)).push(f); }
  const m = {};
  for (const r of rows) {
    const h = map[r[1]], a = map[r[2]];
    if (!h || !a) continue;
    const f = (byPair.get(`${h}|${a}`) || []).find((x) => Math.abs(day(x.ts) - day(r[0])) <= 1 && x.hg === r[3] && x.ag === r[4]);
    if (f) m[f.id] = [r[5], r[6]];
  }
  return { m, inconnues: Object.keys(csvDays).filter((n) => !map[n]) };
}

// Tous les fichiers de corners (2 saisons) ont-ils été relus avec la méthode en vigueur ?
export function liaisonComplete(index, season) {
  const st = index?._corners || {};
  return Object.keys(CORNERS_LEAGUES).every((id) => LEAGUES[id]?.robot === false || [season - 1, season].every((s) => (st[`${id}@${s}:v`] || "dates") === methode()));
}

// Un fichier par passage au plus : la saison précédente manquante d'abord, sinon la saison en cours la plus ancienne (6 h)
export async function refreshCorners(env, index, season, now = Date.now()) {
  if (!env.PRONO_CACHE) return null;
  const st = (index._corners ||= {});
  let pick = null;
  for (const [id, code] of Object.entries(CORNERS_LEAGUES)) {
    const lg = LEAGUES[id]; if (!lg || lg.robot === false) continue;
    for (const s of [season - 1, season]) {
      const k = `${id}@${s}`, at = st[k] || 0;
      // Changement de méthode (passage à M7C ou retour arrière) : chaque fichier est relu une fois avec la méthode en vigueur
      const autreMethode = (st[k + ":v"] || "dates") !== methode();
      const due = autreMethode || (s < season ? !at || (st[k + ":n"] === 0 && now - at > DAY) : now - at > CUR_MS);
      // relectures d'abord, la moins récemment essayée en tête (un fichier indisponible ne bloque pas les autres)
      const prio = autreMethode ? at - 1e15 : at;
      if (due && (!pick || prio < pick.at)) pick = { id: +id, code, s, k, at: prio };
    }
  }
  if (!pick) return null;
  st[pick.k] = now;
  const src = await kvGet(env, srcKey(LEAGUES[pick.id].src, pick.s));
  if (!src) return null; // données du robot pas encore là : on réessaiera
  const r = await fetch(csvUrl(pick.code, pick.s), { headers: { "User-Agent": "DuelProno/1.0 (+https://duelprono.com)" } });
  if (!r.ok) return `corners ${pick.id}@${pick.s} : fichier indisponible [${r.status}]`;
  const rows = parseCornersCsv(await r.text());
  let m, inconnues, liaison = null;
  if (LIAISON_STRICTE) {
    const { table, introuvables } = buildTable(EQUIPES[pick.id] || {}, src.teams || {}, "csv");
    const r = linkStrict(rows, toFinished(src), table, now);
    m = r.m; inconnues = r.rapport.inconnues;
    const { problemes, ...rep } = r.rapport;
    liaison = { version: LIAISON_VERSION, ...rep, introuvables, matchsRobot: toFinished(src).length, problemes: problemes.slice(0, 20) };
  } else ({ m, inconnues } = matchCorners(rows, toFinished(src)));
  const n = Object.keys(m).length;
  st[pick.k + ":n"] = n;
  st[pick.k + ":v"] = methode();
  const old = await kvGet(env, cornersKey(pick.id, pick.s));
  const changed = !old || Object.keys(old.m || {}).length !== n || (old.liaison?.version || null) !== (liaison?.version || null);
  if (changed) await env.PRONO_CACHE.put(cornersKey(pick.id, pick.s), JSON.stringify({ at: now, m, lignes: rows.length, inconnues, ...(liaison ? { liaison } : {}) }));
  return { report: `corners ${pick.id}@${pick.s} : ${n}/${rows.length} matchs reliés${inconnues.length ? `, équipes non reconnues : ${inconnues.join(", ")}` : ""}${changed ? ", mis à jour" : ""}`, changed, leagueId: pick.id };
}

// Matchs « mélangés » pour le calcul des forces : 70 % buts + 30 % corners × (buts / corners du championnat)
export function blendCorners(finished, maps) {
  const cm = Object.assign({}, ...maps.filter(Boolean).map((x) => x.m || {}));
  let g = 0, c = 0;
  for (const f of finished) { const x = cm[f.id]; if (x) { g += f.hg + f.ag; c += x[0] + x[1]; } }
  if (!c) return { finished, n: 0 };
  const ratio = g / c, w = CORNERS_SHARE;
  let n = 0;
  const out = finished.map((f) => { const x = cm[f.id]; if (!x) return f; n++; return { ...f, hg: (1 - w) * f.hg + w * x[0] * ratio, ag: (1 - w) * f.ag + w * x[1] * ratio }; });
  return { finished: out, n };
}

export async function cornersStatus(env, season) {
  const out = {};
  for (const id of Object.keys(CORNERS_LEAGUES)) {
    const [cur, prev] = await Promise.all([kvGet(env, cornersKey(id, season)), kvGet(env, cornersKey(id, season - 1))]);
    const lien = (x) => (x?.liaison ? (({ problemes, ...r }) => ({ ...r, couverture: r.matchsRobot ? Math.round((1000 * r.relies) / r.matchsRobot) / 10 : null, problemes }))(x.liaison) : undefined);
    out[id] = { saison: cur ? Object.keys(cur.m).length : 0, precedente: prev ? Object.keys(prev.m).length : 0, ...(cur?.inconnues?.length ? { inconnues: cur.inconnues } : {}),
      ...(LIAISON_STRICTE ? { liaison: { methode: LIAISON_VERSION, saison: lien(cur) || "en attente de relecture", precedente: lien(prev) || "en attente de relecture" } } : {}) };
  }
  return out;
}
