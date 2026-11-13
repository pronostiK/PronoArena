// Monde simulé : championnats, coupes, deux saisons, fausses API football-data et ESPN, faux cache KV.
export const NOW = Date.UTC(2026, 10, 10, 17, 0); // 10 nov. 2026
export const SIM = { spDown: false, scDown: false, spAuth: null, now: NOW, fdDown: new Set(), espnBlocked: false, mails: [], mailDown: false };
const isDone = (x) => x.ts + 2 * 3600000 < SIM.now;
const isLive = (x) => x.ts <= SIM.now && !isDone(x);
const DAY = 86400000;

let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pois = (l) => { let k = 0, p = Math.exp(-l), s = p, u = rnd(); while (u > s) { k++; p *= l / k; s += p; } return k; };

// Équipes : id -> force réelle ; même id dans le championnat et en coupe (comme les vraies API)
export const STRENGTH = {};
function teams(prefix, n, top, coef) {
  const ids = [];
  for (let i = 0; i < n; i++) { const id = `${prefix}${i}`; STRENGTH[id] = (top - (top - 0.6) * (i / (n - 1))) * coef; ids.push(id); }
  return ids;
}
export const LEAGUE_TEAMS = {
  "fd:FL1": teams("1", 18, 2.2, 0.88), "fd:PL": teams("2", 20, 2.0, 1.0), "fd:PD": teams("3", 20, 2.1, 0.96),
  "fd:SA": teams("4", 20, 1.9, 0.94), "fd:BL1": teams("5", 18, 2.1, 0.94), "fd:PPL": teams("6", 18, 2.0, 0.84),
  "fd:DED": teams("7", 18, 2.0, 0.82), "fd:ELC": teams("8", 24, 1.6, 0.7), "fd:BSA": teams("9", 20, 1.7, 0.75),
  "espn:fra.2": teams("e1", 18, 1.6, 0.7),
};
// SportAPI : Turquie (16), Belgique (5), Écosse (88) — identifiants d'équipes propres à ce fournisseur
for (const [id, n] of [[16, 18], [5, 16], [88, 12]]) LEAGUE_TEAMS[`sp:${id}`] = teams(`s${id}_`, n, 1.8, 0.75);
// ESPN domestiques : on réutilise d'autres ids (fournisseur différent)
for (const k of ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "por.1", "ned.1", "bel.1", "tur.1", "sco.1", "eng.2", "bra.1"]) LEAGUE_TEAMS[`espn:${k}`] = teams(`x${k.replace(".", "")}_`, 18, 1.9, 0.85);

const expected = (h, a) => [1.45 * STRENGTH[h] / STRENGTH[a] ** 0.8, 1.15 * STRENGTH[a] / STRENGTH[h] ** 0.8];

function roundRobin(ids, start, end, rounds) {
  const out = []; let id = 0;
  const pairs = []; for (const h of ids) for (const a of ids) if (h !== a) pairs.push([h, a]);
  pairs.sort(() => rnd() - 0.5);
  const use = pairs.slice(0, Math.floor(pairs.length * rounds));
  use.forEach(([h, a], i) => { out.push({ h, a, ts: start + Math.floor((i / use.length) * (end - start)) }); });
  return out;
}

function playSeason(ids, start, end, rounds, cutoff) {
  return roundRobin(ids, start, end, rounds).map((m, i) => {
    const [lh, la] = expected(m.h, m.a);
    return { id: `${m.h}-${m.a}-${start}-${i}`, ...m, hg: pois(lh), ag: pois(la) };
  });
}

export const DB = {}; // "src@season" -> matches
for (const [src, ids] of Object.entries(LEAGUE_TEAMS)) {
  DB[`${src}@2025`] = playSeason(ids, Date.UTC(2025, 7, 10), Date.UTC(2026, 4, 25), 1, NOW);
  DB[`${src}@2026`] = playSeason(ids, Date.UTC(2026, 7, 10), Date.UTC(2027, 4, 25), 1, NOW);
}
// Coupes : 36 équipes tirées des championnats, phase de ligue (8 matchs chacune, 4 joués)
function cup(fromLeagues, n) {
  const ids = fromLeagues.flatMap((l) => LEAGUE_TEAMS[l].slice(0, Math.ceil(n / fromLeagues.length))).slice(0, n);
  return playSeason(ids, Date.UTC(2026, 8, 15), Date.UTC(2027, 0, 30), 8 / (n - 1), NOW);
}
// Sources de secours ESPN : exactement les mêmes matchs que football-data, avec des identifiants ESPN
const MIRROR = { "fd:FL1": "espn:fra.1", "fd:PL": "espn:eng.1", "fd:PD": "espn:esp.1", "fd:SA": "espn:ita.1", "fd:BL1": "espn:ger.1", "fd:PPL": "espn:por.1", "fd:DED": "espn:ned.1", "fd:ELC": "espn:eng.2", "fd:BSA": "espn:bra.1" };
for (const [fd, es] of Object.entries(MIRROR)) {
  LEAGUE_TEAMS[es] = LEAGUE_TEAMS[fd].map((id) => { STRENGTH["e" + id] = STRENGTH[id]; return "e" + id; });
  for (const y of [2025, 2026]) DB[`${es}@${y}`] = DB[`${fd}@${y}`].map((m) => ({ ...m, id: "E" + m.id, h: "e" + m.h, a: "e" + m.a }));
}
DB["fd:CL@2026"] = cup(["fd:PL", "fd:PD", "fd:SA", "fd:BL1", "fd:FL1", "fd:PPL", "fd:DED"], 36);
DB["espn:uefa.champions@2026"] = cup(["espn:eng.1", "espn:esp.1", "espn:ita.1", "espn:ger.1", "espn:fra.1"], 36);
DB["espn:uefa.europa@2026"] = cup(["espn:eng.1", "espn:esp.1", "espn:ita.1", "espn:ger.1", "espn:fra.1", "espn:por.1", "espn:ned.1", "espn:bel.1", "espn:tur.1"], 36);
DB["espn:uefa.europa.conf@2026"] = cup(["espn:bel.1", "espn:sco.1", "espn:tur.1", "espn:ned.1"], 36);
DB["espn:uefa.nations@2026"] = playSeason(Array.from({ length: 16 }, (_, i) => { STRENGTH[`n${i}`] = 2 - i * 0.08; return `n${i}`; }), Date.UTC(2026, 8, 5), Date.UTC(2027, 2, 30), 0.4, NOW);
// CAN (SportAPI, compétition 72) : deux groupes de 4 sélections africaines, matchs aller-retour
const AFRICA = ["Egypt", "Morocco", "Senegal", "Nigeria", "Cameroon", "Ghana", "Tunisia", "Mali"];
AFRICA.forEach((_, i) => { STRENGTH[`c${i}`] = 2 - i * 0.12; });
DB["sp:72@2026"] = [["c0", "c2", "c4", "c6"], ["c1", "c3", "c5", "c7"]].flatMap((g, gi) => playSeason(g, Date.UTC(2026, 8, 3), Date.UTC(2026, 11, 20), 1, NOW).map((m) => ({ ...m, id: `can${gi}${m.id}` })));
// Un match en cours pour tester le "direct"
DB["fd:FL1@2026"].find((m) => m.ts > NOW).ts = NOW - 30 * 60000;

export const calls = { fd: 0, espn: 0, h2h: 0, sp: 0 };
// Ligue des Nations simulée : de vraies sélections (les notes Elo se retrouvent par le nom)
export const NATIONS = ["Spain", "France", "England", "Portugal", "Netherlands", "Belgium", "Italy", "Germany", "Croatia", "Denmark", "Turkey", "Switzerland", "Czechia", "Bosnia-Herzegovina", "Norway", "San Marino"];
const AFRICA_NAMES = AFRICA;
// Sources de secours ESPN (ids « e… ») : même club que chez football-data, écrit autrement (comme en vrai : « Équipe 12 » / « Equipe 12 FC »)
const teamName = (id) => (/^n\d+$/.test(id) ? NATIONS[+id.slice(1)] : /^c\d+$/.test(id) ? AFRICA_NAMES[+id.slice(1)] : /^e\d+$/.test(id) ? `Equipe ${id.slice(1)} FC` : `Équipe ${id}`);
export function installFetch() {
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url);
    let m;
    if ((m = u.pathname.match(/\/v4\/matches\/(.+)\/head2head/))) {
      calls.h2h++;
      const [h, a] = m[1].split("-");
      const all = Object.values(DB).flat().filter((x) => isDone(x) && ((x.h === h && x.a === a) || (x.h === a && x.a === h)));
      return { ok: true, json: async () => ({ matches: all.map((x) => ({ status: "FINISHED", utcDate: new Date(x.ts).toISOString(), homeTeam: { id: x.h, name: `Équipe ${x.h}` }, awayTeam: { id: x.a, name: `Équipe ${x.a}` }, score: { fullTime: { home: x.hg, away: x.ag } } })) }) };
    }
    if ((m = u.pathname.match(/\/v4\/competitions\/(\w+)\/matches/))) {
      calls.fd++;
      if (SIM.fdDown.has(m[1])) return { ok: false, status: 503 };
      const list = DB[`fd:${m[1]}@${u.searchParams.get("season")}`];
      if (!list) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({ matches: list.map((x) => ({ id: x.id, utcDate: new Date(x.ts).toISOString(), status: isDone(x) ? "FINISHED" : isLive(x) ? "IN_PLAY" : "TIMED", homeTeam: { id: x.h, name: `Équipe ${x.h}`, crest: `${x.h}.png` }, awayTeam: { id: x.a, name: `Équipe ${x.a}`, crest: `${x.a}.png` }, score: { fullTime: { home: isDone(x) ? x.hg : null, away: isDone(x) ? x.ag : null } } })) }) };
    }
    if ((m = u.pathname.match(/^\/api\/fixtures\/date\/(\d{4}-\d{2}-\d{2})$/)) && u.hostname === "sportapi.ai") {
      calls.sp++; SIM.spAuth = opts?.headers?.["X-Api-Key"];
      if (SIM.spDown) return { ok: false, status: 429 };
      // Comme le vrai SportAPI : toutes les compétitions du jour dans la même réponse (+ des compétitions qu'on ne suit pas)
      const rows = [];
      for (const [k, list] of Object.entries(DB)) {
        if (!k.startsWith("sp:")) continue;
        const lid = Number(k.slice(3).split("@")[0]);
        for (const x of list) if (new Date(x.ts).toISOString().slice(0, 10) === m[1]) rows.push({ id: x.id, league_id: lid, status: isDone(x) ? "FT" : isLive(x) && !(x.lateUntil && SIM.now < x.lateUntil) ? "LIVE" : "Scheduled", kickoff_utc: new Date(x.ts).toISOString(), home_id: x.h, away_id: x.a, home_team: teamName(x.h), away_team: teamName(x.a), home_logo: `${x.h}.png`, away_logo: `${x.a}.png`, home_score: isDone(x) ? x.hg : isLive(x) && !(x.lateUntil && SIM.now < x.lateUntil) ? x.lh ?? 0 : null, away_score: isDone(x) ? x.ag : isLive(x) && !(x.lateUntil && SIM.now < x.lateUntil) ? x.la ?? 0 : null, minute: isLive(x) ? (x.ht ? "HT" : 30) : null });
      }
      rows.push({ id: "z" + m[1], league_id: 999, status: "FT", kickoff_utc: m[1] + "T12:00:00Z", home_id: "q1", away_id: "q2", home_team: "Autre A", away_team: "Autre B", home_score: 1, away_score: 0 });
      return { ok: true, json: async () => ({ success: true, date: m[1], data: rows }) };
    }
    if (u.hostname === "sportscore.com" && (m = u.pathname.match(/^\/api\/v1\/fixtures\/$/))) {
      // SportScore : une compétition et un jour par appel ; noms d'équipes écrits autrement que chez SportAPI (suffixe « KV »)
      calls.sc = (calls.sc || 0) + 1; SIM.scAuth = opts?.headers?.["X-Api-Key"] ?? null;
      if (SIM.scDown) return { ok: false, status: 503 };
      const lid = { "belgian-pro-league": 5, "scottish-premiership": 88, "caf-africa-cup-of-nations": 72 }[u.searchParams.get("competition")], day = u.searchParams.get("date");
      const rows = (DB[`sp:${lid}@2026`] || []).filter((x) => new Date(x.ts).toISOString().slice(0, 10) === day).map((x) => {
        const late = x.lateUntil && SIM.now < x.lateUntil, live = isLive(x) && !late;
        return { home: teamName(x.h) + (lid === 5 ? " KV" : ""), away: teamName(x.a) + (lid === 5 ? " KV" : ""), home_score: isDone(x) ? String(x.hg) : live ? String(x.lh ?? 0) : null, away_score: isDone(x) ? String(x.ag) : live ? String(x.la ?? 0) : null,
          status: isDone(x) ? "finished" : live ? "live" : "upcoming", status_text: isDone(x) ? "Ended" : live ? (x.ht ? "Half time" : x.second ? "2nd half" : "1st half") : "Not started", time: new Date(x.ts).toISOString().replace("Z", "+00:00"), competition: "x" };
      });
      return { ok: true, json: async () => ({ sport: "football", date: day, count: rows.length, matches: rows }) };
    }
    if (u.hostname === "api.resend.com") { const b = JSON.parse(opts?.body || "{}"); SIM.mails.push({ ...b, auth: opts?.headers?.Authorization }); return { ok: !SIM.mailDown, status: SIM.mailDown ? 500 : 200, json: async () => ({ id: "m" + SIM.mails.length }) }; }
    if (u.hostname === "raw.githubusercontent.com") { calls.seed = (calls.seed || 0) + 1; return { ok: false, status: 404 }; }
    if (SIM.espnBlocked && u.hostname.includes("espn")) { calls.espnRefus = (calls.espnRefus || 0) + 1; return { ok: false, status: 403 }; }
    if ((m = u.pathname.match(/\/soccer\/([\w.]+)\/summary/))) {
      calls.compos = (calls.compos || 0) + 1;
      const ev = Object.values(DB).flat().find((x) => x.id === u.searchParams.get("event"));
      if (!ev) return { ok: false, status: 404 };
      const POS = ["G", "RB", "CD-R", "CD-L", "LB", "DM", "CM-R", "CM-L", "RW", "LW", "F"];
      const roster = (id, side) => ({ homeAway: side, formation: "4-3-3", team: { id }, roster: POS.map((q, i) => ({ starter: true, jersey: String(i + 1), formationPlace: i + 1, position: { abbreviation: q }, athlete: { shortName: `J. Joueur${i + 1}`, displayName: `Jean Joueur${i + 1}` } })).concat([{ starter: false, jersey: "12", athlete: { shortName: "Remplaçant" } }]) });
      return { ok: true, json: async () => ({ rosters: [roster(ev.h, "home"), roster(ev.a, "away")] }) };
    }
    if ((m = u.pathname.match(/\/soccer\/([\w.]+)\/scoreboard/))) {
      calls.espn++;
      const parts = u.searchParams.get("dates").split("-").map((d) => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)));
      const [f, t] = [parts[0], parts[1] ?? parts[0]];
      if (parts.length > 1) return { ok: false, status: 400 }; // comme le vrai ESPN : un seul jour par appel
      const list = [...(DB[`espn:${m[1]}@2025`] || []), ...(DB[`espn:${m[1]}@2026`] || [])].filter((x) => x.ts >= f && x.ts < t + DAY);
      return { ok: true, json: async () => ({ events: list.map((x) => ({ id: x.id, date: new Date(x.ts).toISOString(), status: { displayClock: isLive(x) ? x.clock || "30'" : "0'", type: { name: isDone(x) ? "STATUS_FULL_TIME" : isLive(x) ? (x.ht ? "STATUS_HALFTIME" : "STATUS_IN_PROGRESS") : "STATUS_SCHEDULED", state: isDone(x) ? "post" : isLive(x) ? "in" : "pre", completed: isDone(x) } }, competitions: [{ competitors: [{ id: x.h, homeAway: "home", score: isDone(x) ? String(x.hg) : String((isLive(x) && x.lh) || 0), team: { displayName: x.hn || teamName(x.h), logo: `${x.h}.png` } }, { id: x.a, homeAway: "away", score: isDone(x) ? String(x.ag) : String((isLive(x) && x.la) || 0), team: { displayName: x.an || teamName(x.a), logo: `${x.a}.png` } }] }] })) }) };
    }
    throw new Error("URL inattendue " + url);
  };
}

export function makeKV() {
  const store = new Map(); const stats = { reads: 0, writes: 0 };
  return { store, stats, PRONO_CACHE: {
    get: async (k) => { stats.reads++; return store.get(k) ?? null; },
    put: async (k, v) => { stats.writes++; store.set(k, v); },
  } };
}

// Fausse base D1 : un vrai SQLite en mémoire (le même moteur que D1), avec le schéma du dépôt
export async function makeD1() {
  const { DatabaseSync } = await import("node:sqlite");
  const fs = await import("node:fs");
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const stats = { queries: 0 };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    _run() {
      stats.queries++;
      const s = db.prepare(sql);
      if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: s.all(...args), meta: {} };
      const r = s.run(...args);
      return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    async all() { return this._run(); },
    async run() { return this._run(); },
    async first() { return this._run().results[0] ?? null; },
  });
  return { stats, raw: db, DB: { prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => s._run()) } };
}
