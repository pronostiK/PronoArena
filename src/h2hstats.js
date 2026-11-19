// ============================================================
// DUEL PRONO — Cartons, fautes, hors-jeu et corners des anciens face-à-face (source ESPN)
// Demande de l'utilisateur (19/11/2026). Affichage seulement : aucun effet sur les probabilités.
//
// Ce que donne ESPN (vérifié en réel le 19/11/2026) :
//   - summary?event=ID (1 appel par match) → boxscore.teams[].statistics : yellowCards, redCards, foulsCommitted, offsides, wonCorners
//   - scoreboard?dates=JOUR (1 appel par jour) → sert seulement à retrouver l'identifiant ESPN d'un match football-data / SportAPI
// Vu sur Premier League, Belgique, Écosse, Turquie, Ligue des Nations. CAN : pas d'équivalent ESPN → jamais de chiffres.
//
// Économie : le robot ne cherche QUE les anciens face-à-face des matchs des 7 prochains jours, quelques appels par passage
// (pris sur le budget ESPN du passage), et garde chaque match une fois pour toutes (clé KV « h2hs:all »).
// Tout ou rien : /match-details n'envoie les chiffres que si TOUS les face-à-face affichés les ont.
// ============================================================
import { LEAGUES } from "./config.js";
import { kvGet, ESPN_HEADERS, takeEspnCall } from "./sources.js";
import { allKey, h2hPool, meetings, h2hMatchKey } from "./build.js";
import { COMPOS_KEY } from "./compos.js";
import { pairMatches } from "./live.js";

export const H2HS_KEY = "h2hs:all";
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const H2HS_PER_TICK = 4;     // appels ESPN au plus par passage (≈ 576 par jour au maximum, beaucoup moins une fois le retard rattrapé)
const QUEUE_MS = 3 * HOUR;          // liste des matchs à chercher : refaite toutes les 3 h
const MAX_TRIES = 2;                // match introuvable ou sans chiffres après 2 essais : abandonné (le face-à-face reste sans chiffres)
const KEEP_MS = 800 * DAY;          // le face-à-face ne remonte qu'à la saison précédente
const FIELDS = ["yellowCards", "redCards", "foulsCommitted", "offsides", "wonCorners"];
export const H2HS_NAMES = ["jaunes", "rouges", "fautes", "horsJeu", "corners"];

// Compétition ESPN qui contient les matchs d'une source (« espn:eng.1 » → « eng.1 » ; « fd:PL » → sa source de secours ESPN)
export function espnSlugFor(src) {
  if (!src) return null;
  if (src.startsWith("espn:")) return src.slice(5);
  const lg = Object.values(LEAGUES).find((l) => l.src === src);
  for (const s of [lg?.backup, lg?.live, lg?.espn]) if (s && s.startsWith("espn:")) return s.slice(5);
  return null;
}

const ymd = (ts) => new Date(ts).toISOString().slice(0, 10).replace(/-/g, "");
const emptyState = () => ({ m: {}, tries: {}, q: [], qAt: 0, day: "", used: 0 });

// Chiffres d'un match à partir de la fiche ESPN : [jaunes, rouges, fautes, hors-jeu, corners] domicile puis extérieur, ou null
export function extractBox(summary, homeEspnId) {
  const teams = summary?.boxscore?.teams || [];
  if (teams.length !== 2) return null;
  const pick = (t) => {
    const by = Object.fromEntries((t.statistics || []).map((s) => [s.name, s.displayValue ?? s.value]));
    const v = FIELDS.map((f) => (by[f] === undefined || by[f] === null || by[f] === "" ? NaN : Number(by[f])));
    return v.every((x) => Number.isFinite(x) && x >= 0) ? v : null;
  };
  let home = teams.find((t) => homeEspnId && String(t.team?.id) === String(homeEspnId));
  if (!home) home = teams.find((t) => t.homeAway === "home");
  if (!home) return null;
  const away = teams.find((t) => t !== home);
  const h = pick(home), a = pick(away);
  return h && a ? [...h, ...a] : null;
}

// Liste des anciens face-à-face à chercher (matchs des 7 prochains jours), sans appel extérieur
export async function buildQueue(env, st, season) {
  const up = await kvGet(env, allKey(season));
  const memo = new Map(), pools = new Map(), queued = new Set(), q = [];
  const compos = await kvGet(env, COMPOS_KEY);
  const idmap = compos?.idmap || {};
  // Les matchs les plus proches d'abord : chaque face-à-face se complète d'un bloc et s'affiche dès que ses anciens matchs sont là
  const ups = [...(up?.matchs || [])].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  for (const m of ups) {
    const pk = `${m.leagueId}|${m.source}`;
    if (!pools.has(pk)) pools.set(pk, await h2hPool(env, { source: m.source, leagueId: m.leagueId }, season, memo));
    const { all, names } = pools.get(pk);
    for (const f of meetings(all, String(m.teams.domicile.id), String(m.teams.exterieur.id))) {
      const k = h2hMatchKey(f);
      if (st.m[k] || queued.has(k)) continue;
      const slug = espnSlugFor(f.src);
      if (!slug) continue; // pas d'équivalent ESPN (CAN) : jamais de chiffres pour ce match
      queued.add(k);
      const esp = f.src.startsWith("espn:");
      // [clé, compétition ESPN, id ESPN du match (connu pour les sources ESPN), id ESPN de l'équipe à domicile, horodatage, nom dom., nom ext., buts dom., buts ext., ids ESPN supposés (football-data)]
      q.push([k, slug, esp ? String(f.id) : null, esp ? String(f.homeId) : null, f.ts, names[f.homeId]?.[0] || "", names[f.awayId]?.[0] || "", f.hg, f.ag,
        f.src.startsWith("fd:") ? [idmap[f.homeId] || null, idmap[f.awayId] || null] : null]);
    }
  }
  return q; // ordre : match à venir le plus proche, puis ses anciens face-à-face
}

// Retrouve le match chez ESPN à partir du calendrier du jour (même équipes, même score)
function findEvent(events, item) {
  const [, , , , ts, dom, ext, hg, ag, ids] = item;
  const list = [];
  for (const ev of events || []) {
    const c = ev.competitions?.[0];
    const h = c?.competitors?.find((x) => x.homeAway === "home"), a = c?.competitors?.find((x) => x.homeAway === "away");
    if (!h || !a || !ev.status?.type?.completed) continue;
    list.push({ id: String(ev.id), ts: Date.parse(ev.date), home: h.team?.displayName || "", away: a.team?.displayName || "", hid: String(h.id), aid: String(a.id), hg: parseInt(h.score, 10), ag: parseInt(a.score, 10) });
  }
  const sameScore = (e) => e.hg === hg && e.ag === ag;
  if (ids && ids[0] && ids[1]) { const e = list.find((x) => x.hid === ids[0] && x.aid === ids[1]); if (e) return sameScore(e) ? e : null; }
  const e = pairMatches([{ key: "x", ts, dom, ext }], list).get("x");
  return e && sameScore(e) ? e : null;
}

async function espnJson(url) {
  if (!takeEspnCall()) return { budget: true };
  const res = await fetch(url, { headers: ESPN_HEADERS });
  if (!res.ok) throw new Error(`ESPN face-à-face [${res.status}]`);
  return { data: await res.json() };
}

// Un passage : quelques appels au plus. Renvoie une ligne pour le rapport, ou null s'il n'y avait rien à faire.
export async function refreshH2HStats(env, season, now = Date.now(), perTick = H2HS_PER_TICK) {
  if (!env.PRONO_CACHE) return null;
  const st = (await kvGet(env, H2HS_KEY)) || emptyState();
  const before = JSON.stringify(st);
  const today = new Date(now).toISOString().slice(0, 10);
  if (st.day !== today) { st.day = today; st.used = 0; }
  if (now - (st.qAt || 0) > QUEUE_MS) { st.q = await buildQueue(env, st, season); st.qAt = now; }
  let calls = 0, got = 0, lost = 0, error = null;
  const days = new Map(); // calendrier ESPN déjà lu pendant ce passage
  try {
    while (st.q.length && calls < perTick) {
      const item = st.q[0];
      const [k, slug] = item;
      if (st.m[k]) { st.q.shift(); continue; }
      let evId = item[2], homeId = item[3];
      if (!evId) {
        // Le jour UTC, puis la veille (ESPN range les matchs tardifs, ex. Brésil, au jour américain)
        let short = false;
        for (const d of [...new Set([ymd(item[4]), ymd(item[4] - 6 * HOUR)])]) {
          const dk = `${slug}|${d}`;
          if (!days.has(dk)) {
            if (calls >= perTick) { short = true; break; }
            const r = await espnJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${d}`);
            if (r.budget) { short = true; calls = perTick; break; }
            calls++; st.used++; days.set(dk, r.data.events || []);
          }
          const e = findEvent(days.get(dk), item);
          if (e) { evId = e.id; homeId = e.hid; break; }
        }
        if (!evId && short) break; // budget du passage épuisé avant la fin des recherches : on reprendra au prochain passage
      }
      let box = null;
      if (evId) {
        if (calls >= perTick) { item[2] = evId; item[3] = homeId; break; } // id trouvé, chiffres au prochain passage
        const r = await espnJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${encodeURIComponent(evId)}`);
        if (r.budget) { item[2] = evId; item[3] = homeId; break; }
        calls++; st.used++;
        box = extractBox(r.data, homeId);
      }
      st.q.shift();
      if (box) { st.m[k] = [item[4], ...box]; delete st.tries[k]; got++; }
      else {
        st.tries[k] = (st.tries[k] || 0) + 1;
        if (st.tries[k] >= MAX_TRIES) { st.m[k] = [item[4]]; delete st.tries[k]; lost++; } // abandonné : ce face-à-face restera sans chiffres
      }
    }
  } catch (e) { error = e; }
  for (const [k, v] of Object.entries(st.m)) if (now - v[0] > KEEP_MS) delete st.m[k];
  if (JSON.stringify(st) !== before) await env.PRONO_CACHE.put(H2HS_KEY, JSON.stringify(st));
  if (error) throw error; // refus ESPN (403/429) : le robot met ESPN en pause
  return calls ? `face-à-face (cartons, fautes…) : ${got} match(s) récupéré(s)${lost ? `, ${lost} introuvable(s)` : ""}, ${st.q.length} en attente (${st.used} appels aujourd'hui)` : null;
}

// Ajoute les chiffres au face-à-face envoyé au site. Tout ou rien : si un seul match n'a pas ses chiffres, aucun n'est envoyé.
// Chaque ligne reçoit stats.domicile / stats.exterieur (équipes du match passé, comme butsDomicile / butsExterieur) ;
// resume = moyenne par match pour les deux équipes du match affiché (domicile = teamDomId).
export function attachH2HStats(h2h, st) {
  const rows = h2h || [];
  const vals = rows.map((r) => st?.m?.[r.cle]);
  for (const r of rows) delete r.cle;
  if (!rows.length || !vals.every((v) => Array.isArray(v) && v.length === 11)) return { h2h: rows, resume: null };
  const obj = (a) => Object.fromEntries(H2HS_NAMES.map((n, i) => [n, a[i]]));
  const sum = { domicile: [0, 0, 0, 0, 0], exterieur: [0, 0, 0, 0, 0] };
  rows.forEach((r, i) => {
    const v = vals[i], h = v.slice(1, 6), a = v.slice(6, 11);
    r.stats = { domicile: obj(h), exterieur: obj(a) };
    const [mine, theirs] = r.lieu === "domicile" ? [h, a] : [a, h]; // « domicile » du match affiché
    for (let j = 0; j < 5; j++) { sum.domicile[j] += mine[j]; sum.exterieur[j] += theirs[j]; }
  });
  const avg = (a) => obj(a.map((x) => Math.round((10 * x) / rows.length) / 10));
  return { h2h: rows, resume: { matchs: rows.length, domicile: avg(sum.domicile), exterieur: avg(sum.exterieur) } };
}

// Pour /status
export async function h2hStatsStatus(env) {
  const st = await kvGet(env, H2HS_KEY);
  if (!st) return { etat: "pas commencé" };
  const vals = Object.values(st.m || {});
  return { matchsAvecChiffres: vals.filter((v) => v.length === 11).length, introuvables: vals.filter((v) => v.length === 1).length, enAttente: (st.q || []).length, appelsAujourdhui: st.used || 0, listeRefaite: st.qAt ? new Date(st.qAt).toISOString() : null };
}
