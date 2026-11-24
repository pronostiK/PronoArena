// PROTOTYPE HORS PRODUCTION (audit des corners, 24/11/2026) : non branché dans le robot, en attente de décision de l'auditeur.
// Prototype hors production : reconnaissance des équipes par date ET score (vote), puis même liaison qu'aujourd'hui.
export function matchCornersV2(rows, finished) {
  const DAY = 86400000, day = (ts) => Math.floor(ts / DAY);
  const byDay = new Map();
  for (const f of finished) { const d = day(f.ts); (byDay.get(d) || byDay.set(d, []).get(d)).push(f); }
  const votes = {};
  const vote = (n, id, w) => { const v = (votes[n] ||= {}); v[id] = (v[id] || 0) + w; };
  for (const r of rows) {
    const d = day(r[0]), c = [];
    for (const dd of [d - 1, d, d + 1]) for (const f of byDay.get(dd) || []) if (f.hg === r[3] && f.ag === r[4]) c.push(f);
    for (const f of c) { vote(r[1], f.homeId, 1 / c.length); vote(r[2], f.awayId, 1 / c.length); }
  }
  const cand = [];
  for (const [n, v] of Object.entries(votes)) for (const [id, w] of Object.entries(v)) cand.push([w, n, id]);
  cand.sort((a, b) => b[0] - a[0]);
  const map = {}, taken = new Set(), games = {};
  for (const r of rows) for (const n of [r[1], r[2]]) games[n] = (games[n] || 0) + 1;
  for (const [w, n, id] of cand) { if (map[n] || taken.has(id)) continue; if (w < Math.min(2, games[n] / 2)) continue; map[n] = id; taken.add(id); }
  const byPair = new Map();
  for (const f of finished) { const k = `${f.homeId}|${f.awayId}`; (byPair.get(k) || byPair.set(k, []).get(k)).push(f); }
  const m = {};
  for (const r of rows) {
    const h = map[r[1]], a = map[r[2]]; if (!h || !a) continue;
    const f = (byPair.get(`${h}|${a}`) || []).find((x) => Math.abs(day(x.ts) - day(r[0])) <= 1 && x.hg === r[3] && x.ag === r[4]);
    if (f) m[f.id] = [r[5], r[6]];
  }
  return { m, inconnues: Object.keys(games).filter((n) => !map[n]) };
}
