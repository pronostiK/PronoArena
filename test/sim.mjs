// Monde simulé : championnats, coupes, deux saisons, fausses API football-data et ESPN, faux cache KV.
export const NOW = Date.UTC(2026, 10, 10, 17, 0); // 10 nov. 2026
export const SIM = { now: NOW, fdDown: new Set() };
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
// Un match en cours pour tester le "direct"
DB["fd:FL1@2026"].find((m) => m.ts > NOW).ts = NOW - 30 * 60000;

export const calls = { fd: 0, espn: 0, h2h: 0 };
export function installFetch() {
  globalThis.fetch = async (url) => {
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
      if (t - f > 7 * DAY) return { ok: false, status: 400 }; // comme le vrai ESPN : longues périodes refusées
      const list = [...(DB[`espn:${m[1]}@2025`] || []), ...(DB[`espn:${m[1]}@2026`] || [])].filter((x) => x.ts >= f && x.ts < t + DAY);
      return { ok: true, json: async () => ({ events: list.map((x) => ({ id: x.id, date: new Date(x.ts).toISOString(), status: { type: { name: isDone(x) ? "STATUS_FULL_TIME" : isLive(x) ? "STATUS_IN_PROGRESS" : "STATUS_SCHEDULED", completed: isDone(x) } }, competitions: [{ competitors: [{ id: x.h, homeAway: "home", score: isDone(x) ? String(x.hg) : "0", team: { displayName: `Équipe ${x.h}`, logo: `${x.h}.png` } }, { id: x.a, homeAway: "away", score: isDone(x) ? String(x.ag) : "0", team: { displayName: `Équipe ${x.a}`, logo: `${x.a}.png` } }] }] })) }) };
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
