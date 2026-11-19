// ============================================================
// DUEL PRONO — Absents connus (blessés, incertains, suspendus) pour l'onglet Compos. Source : Bzzoiro (BSD).
// À TITRE INFORMATIF : le calcul des probabilités n'utilise PAS les absents (décision du 12/11/2026, confirmée le 19/11).
// Bzzoiro ne donne que l'état ACTUEL de l'effectif (GET /teams/{id}/squad/ : availability, injury_type, injury_expected_return),
// pas d'historique : on ne garde que les joueurs non disponibles des équipes qui jouent dans les 48 h.
// Licence BSD (lue le 19/11/2026) : affichage autorisé, jamais de données brutes republiées (aucune route ne renvoie l'effectif).
// Économie (le robot est à sa limite sur l'offre gratuite Cloudflare) :
//   - une seule « rafale » par heure au plus : 12 appels, puis UNE écriture KV (≤ 24 écritures/jour) ;
//   - pendant ce passage-là, la collecte des xG Bzzoiro est sautée (le nombre d'appels sortants du passage ne bouge pas) ;
//   - aucun appel quand un visiteur ouvre un match (le site lit seulement la clé KV).
// Secret Cloudflare requis : BZZOIRO_TOKEN (sans lui, rien ne s'exécute et l'onglet Compos reste comme avant).
// ============================================================
import { kvGet } from "./sources.js";
import { sameTeam } from "./xg.js";

export const ABS_KEY = "abs:all";
const BASE = "https://sports.bzzoiro.com/api/v2";
const HOUR = 3600000, DAY = 24 * HOUR;
export const ABS_EVERY = HOUR;       // une rafale par heure au plus
export const ABS_PER_RUN = 12;       // appels par rafale (≈ xG Bzzoiro sautés pendant ce passage : 10)
export const ABS_DAILY = 300;        // plafond d'appels par jour (quota gratuit Bzzoiro : 7 500, partagé avec les xG)
export const ABS_AHEAD = 48 * HOUR;  // matchs des 48 prochaines heures
export const ABS_TEAM_MS = 6 * HOUR; // effectif d'une équipe revu toutes les 6 h
export const ABS_LIST_MS = 6 * HOUR; // liste des matchs d'une compétition revue toutes les 6 h
export const ABS_SHOW_MS = 36 * HOUR; // au-delà, l'info est trop vieille : on n'affiche rien
const COMP_MS = 7 * DAY;

// Compétition Duel Prono → pays et noms Bzzoiro (vérifiés le 19/11/2026). Coupes : pays non utilisé, recherche par nom.
// Pas de sélections nationales : l'onglet Compos n'existe pas pour elles.
export const ABS_LEAGUES = {
  39: { country: "England", names: ["premier league"] },
  40: { country: "England", names: ["championship"] },
  140: { country: "Spain", names: ["la liga", "laliga"] },
  135: { country: "Italy", names: ["serie a"] },
  136: { country: "Italy", names: ["serie b"] },
  78: { country: "Germany", names: ["bundesliga"] },
  61: { country: "France", names: ["ligue 1"] },
  62: { country: "France", names: ["ligue 2"] },
  94: { country: "Portugal", names: ["liga portugal betclic", "liga portugal", "primeira liga"] },
  88: { country: "Netherlands", names: ["eredivisie"] },
  71: { country: "Brazil", names: ["brasileirao serie a", "brasileirao"] },
  307: { country: "Saudi Arabia", names: ["saudi pro league"] },
  203: { country: "Turkey", names: ["trendyol super lig", "super lig"] },
  144: { country: "Belgium", names: ["pro league", "jupiler pro league"] },
  179: { country: "Scotland", names: ["scottish premiership", "premiership"] },
  2: { cup: true, names: ["champions league", "uefa champions league"] },
  3: { cup: true, names: ["europa league", "uefa europa league"] },
  848: { cup: true, names: ["conference league", "uefa conference league", "uefa europa conference league"] },
};

const STATUS = { injured: "B", doubtful: "I", suspended: "S" }; // B = blessé, I = incertain, S = suspendu
const low = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const arr = (d, key) => (Array.isArray(d) ? d : Array.isArray(d?.[key]) ? d[key] : Array.isArray(d?.results) ? d.results : []);
const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const emptyState = () => ({ comps: {}, ev: {}, teams: {}, day: "", used: 0, at: 0 });

// Joueurs non disponibles d'un effectif Bzzoiro : [nom, B|I|S, motif, retour prévu AAAA-MM-JJ]
export function squadAbsents(squad) {
  return arr(squad, "squad")
    .filter((p) => STATUS[p?.availability])
    .map((p) => [String(p.short_name || p.name || "").slice(0, 40), STATUS[p.availability], String(p.injury_type || "").slice(0, 40), p.injury_expected_return ? String(p.injury_expected_return).slice(0, 10) : ""])
    .filter((p) => p[0]);
}

// Le robot appelle cette fonction à chaque passage. Renvoie une ligne de rapport si une rafale a eu lieu
// (le robot saute alors les xG Bzzoiro de ce passage), sinon null (aucun appel, aucune écriture).
export async function refreshAbsents(env, index, now = Date.now()) {
  if (!env.BZZOIRO_TOKEN || !env.PRONO_CACHE) return null;
  const st = (await kvGet(env, ABS_KEY)) || emptyState();
  if (now - (st.at || 0) < ABS_EVERY || (st.pauseUntil || 0) > now) return null;
  if (st.day !== day(now)) { st.day = day(now); st.used = 0; }
  if (st.used >= ABS_DAILY) return null;
  const plan = planWork(st, index, now);
  if (!plan.length) return null;

  let calls = 0, comps = 0, lists = 0, squads = 0;
  const call = async (path) => {
    calls++; st.used++;
    const r = await fetch(BASE + path, { headers: { Authorization: "Token " + env.BZZOIRO_TOKEN, Accept: "application/json", "User-Agent": "DuelProno/1.0 (+https://duelprono.com)" } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Bzzoiro [${r.status}] ${path.split("?")[0]}`);
    return r.json();
  };
  const budget = () => calls < ABS_PER_RUN && st.used < ABS_DAILY;
  try {
    // 1. Compétitions à (re)trouver chez Bzzoiro (une fois par semaine)
    for (const id of plan.filter((x) => x.kind === "comp").map((x) => x.id)) {
      if (!budget()) break;
      st.comps[id] = await findComp(call, ABS_LEAGUES[id], now);
      comps++;
    }
    // 2. Matchs des 48 h des compétitions qui jouent bientôt
    for (const id of planWork(st, index, now).filter((x) => x.kind === "list").map((x) => x.id)) {
      if (!budget()) break;
      const d = await call(`/events/?league_id=${st.comps[id].cid}&date_from=${day(now)}&date_to=${day(now + ABS_AHEAD)}&limit=200`);
      st.ev[id] = { at: now, m: arr(d).map((e) => [Date.parse(e.event_date) || 0, String(e.home_team || ""), String(e.away_team || ""), e.home_team_id, e.away_team_id])
        .filter((e) => e[0] > now - 3 * HOUR && e[0] < now + ABS_AHEAD && e[3] && e[4]) };
      lists++;
    }
    // 3. Effectifs des équipes, celles qui jouent le plus tôt d'abord
    for (const t of planWork(st, index, now).filter((x) => x.kind === "team")) {
      if (!budget()) break;
      st.teams[t.id] = { n: t.n, lg: t.lg, at: now, l: squadAbsents(await call(`/teams/${t.id}/squad/`)) };
      squads++;
    }
    delete st.erreur;
  } catch (e) {
    st.pauseUntil = now + (/\[429\]/.test(String(e.message)) ? 3 * HOUR : 2 * HOUR); // refus : on attend, sans insister
    st.erreur = String(e.message).slice(0, 120);
  }
  // Ménage : équipes et listes qui ne servent plus
  const playing = new Set(Object.values(st.ev).flatMap((v) => v.m.flatMap((e) => [String(e[3]), String(e[4])])));
  for (const [id, t] of Object.entries(st.teams)) if (!playing.has(id) && now - t.at > 3 * DAY) delete st.teams[id];
  for (const [id, v] of Object.entries(st.ev)) if (!v.m.length && now - v.at > 3 * DAY) delete st.ev[id];
  st.at = now;
  await env.PRONO_CACHE.put(ABS_KEY, JSON.stringify(st)); // une seule écriture par rafale
  return st.erreur
    ? `absents : ERREUR ${st.erreur}`
    : `absents : ${calls} appels (${comps} compétitions, ${lists} listes, ${squads} effectifs), ${st.used}/${ABS_DAILY} aujourd'hui`;
}

// Travail à faire, dans l'ordre : compétitions, listes de matchs, effectifs
export function planWork(st, index, now) {
  const soon = (id) => { const t = index?.[`next:${id}`]; return t && t < now + ABS_AHEAD; };
  const out = [];
  for (const id of Object.keys(ABS_LEAGUES)) {
    if (!soon(id)) continue;
    const c = st.comps[id];
    if (!c || now - c.at > COMP_MS) { out.push({ kind: "comp", id }); continue; }
    if (c.cid && (!st.ev[id] || now - st.ev[id].at > ABS_LIST_MS)) out.push({ kind: "list", id });
  }
  const teams = new Map();
  for (const [lg, v] of Object.entries(st.ev)) for (const e of v.m) {
    for (const [tid, n] of [[e[3], e[1]], [e[4], e[2]]]) {
      const k = String(tid), prev = teams.get(k);
      if (!prev || e[0] < prev.ts) teams.set(k, { kind: "team", id: k, n, lg: Number(lg), ts: e[0] });
    }
  }
  for (const t of [...teams.values()].sort((a, b) => a.ts - b.ts)) {
    if (t.ts < now - HOUR) continue; // match commencé : plus la peine
    const have = st.teams[t.id];
    if (!have || now - have.at > ABS_TEAM_MS) out.push(t);
  }
  return out;
}

// Identifiant Bzzoiro d'une compétition. Championnats : recherche par pays. Coupes : liste complète, page par page (2 pages au plus).
async function findComp(call, lg, now) {
  const ok = (l) => !l.is_women && lg.names.includes(low(l.name));
  if (!lg.cup) {
    const l = arr(await call(`/leagues/?country=${encodeURIComponent(lg.country)}&limit=200`)).find(ok);
    return l ? { cid: l.id, at: now } : { cid: null, at: now - COMP_MS + DAY, err: "introuvable" };
  }
  for (let off = 0; off < 400; off += 200) {
    const d = await call(`/leagues/?limit=200&offset=${off}`);
    const l = arr(d).find(ok);
    if (l) return { cid: l.id, at: now };
    if (!d?.next) break;
  }
  return { cid: null, at: now - COMP_MS + DAY, err: "introuvable" };
}

// Bzzoiro a refusé un appel (absents ou xG) : tout ce qui passe par Bzzoiro attend la fin de la pause
export async function bzPaused(env, now = Date.now()) {
  if (!env.BZZOIRO_TOKEN || !env.PRONO_CACHE) return false;
  const [a, x] = await Promise.all([kvGet(env, ABS_KEY), kvGet(env, "xgb:all")]);
  return (a?.pauseUntil || 0) > now || (x?.pauseUntil || 0) > now;
}

// Absents d'une équipe pour l'affichage : { at, l } ou null (pas d'info, ou info trop vieille). Tout ou rien par équipe.
export function absentsFor(st, leagueId, teamName, now = Date.now()) {
  if (!st?.teams || !teamName) return null;
  const all = Object.values(st.teams).filter((t) => now - t.at < ABS_SHOW_MS && sameTeam(t.n, teamName));
  // Plusieurs équipes possibles (ex. « Sporting » / « Sporting Braga ») : seulement le nom identique, sinon rien
  const pick = (l) => (l.length === 1 ? l[0] : l.find((x) => low(x.n) === low(teamName)) || null);
  const same = all.filter((x) => x.lg === Number(leagueId));
  const t = same.length ? pick(same) : pick(all);
  return t ? { at: t.at, l: t.l } : null;
}

// Pour /status
export function absentsStatus(st, now = Date.now()) {
  if (!st) return { etat: "pas commencé (secret BZZOIRO_TOKEN absent ou aucun match dans les 48 h)" };
  const comps = {};
  for (const [id, c] of Object.entries(st.comps || {})) {
    const ev = st.ev?.[id], ids = new Set((ev?.m || []).flatMap((e) => [String(e[3]), String(e[4])]));
    comps[id] = { bzzoiro: c.cid ? `id ${c.cid}` : c.err || "?", matchs48h: ev?.m.length ?? null, equipesAJour: [...ids].filter((i) => st.teams?.[i] && now - st.teams[i].at < ABS_TEAM_MS + HOUR).length };
  }
  return {
    derniereRafale: st.at ? new Date(st.at).toISOString() : null, appelsAujourdhui: `${st.used || 0}/${ABS_DAILY}`,
    pause: (st.pauseUntil || 0) > now ? new Date(st.pauseUntil).toISOString() : null, erreur: st.erreur || null,
    equipes: Object.keys(st.teams || {}).length, competitions: comps,
  };
}
