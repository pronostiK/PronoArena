// ============================================================
// DUEL PRONO — Points clés et Force / Faiblesse d'un match
// Faits calculés uniquement à partir des matchs déjà en mémoire (aucun appel, aucune IA).
// Chaque fait est vrai et vérifiable : il porte ses chiffres, le site écrit la phrase (FR / EN).
// Un fait n'est retenu que s'il est marquant (seuils ci-dessous) ; sinon rien n'est affiché.
// ============================================================

const MAX_POINTS = 4, MAX_PER_TEAM = 3;
const r1 = (x) => Math.round(x * 10) / 10;
const res = (m, id) => {
  const home = String(m.homeId) === id, gf = home ? m.hg : m.ag, ga = home ? m.ag : m.hg;
  return { home, gf, ga, r: gf > ga ? "V" : gf === ga ? "N" : "D" };
};
const runLen = (list, ok) => { let n = 0; for (const x of list) { if (!ok(x)) break; n++; } return n; };
// Rang « 1 + nombre d'équipes strictement meilleures » ; unique = personne d'autre à égalité
function rankOf(rows, id, val, better) {
  const me = rows.find((r) => String(r.id) === id);
  if (!me) return null;
  const v = val(me);
  return { rank: 1 + rows.filter((r) => better(val(r), v)).length, unique: rows.filter((r) => val(r) === v).length === 1, v, size: rows.length };
}

// Faits d'une équipe. side : "D" (domicile) ou "E" (extérieur)
function teamFacts(id, side, all, league, table) {
  const out = [];
  const add = (k, w, v) => out.push({ k, s: side, w, v });
  const mine = all.filter((m) => String(m.homeId) === id || String(m.awayId) === id).sort((a, b) => b.ts - a.ts).map((m) => res(m, id));
  if (mine.length < 3) return out;

  // Séries en cours (tous les matchs connus de la saison)
  const win = runLen(mine, (x) => x.r === "V"), unb = runLen(mine, (x) => x.r !== "D");
  const loss = runLen(mine, (x) => x.r === "D"), winless = runLen(mine, (x) => x.r !== "V");
  let streak = false;
  if (unb >= 5 && unb >= win + 2) { add("s_unbeaten", 40 + 6 * unb, { n: unb }); streak = true; }
  else if (win >= 3) { add("s_win", 50 + 10 * win, { n: win }); streak = true; }
  if (winless >= 4 && winless >= loss + 2) { add("s_winless", 40 + 6 * winless, { n: winless }); streak = true; }
  else if (loss >= 3) { add("s_loss", 50 + 10 * loss, { n: loss }); streak = true; }

  // 5 derniers matchs
  const l5 = mine.slice(0, 5);
  if (l5.length === 5) {
    const w5 = l5.filter((x) => x.r === "V").length, d5 = l5.filter((x) => x.r === "D").length;
    if (!streak && w5 >= 4) add("l5_win", 55, { n: w5 });
    if (!streak && d5 >= 4) add("l5_loss", 55, { n: d5 });
    const ns = l5.filter((x) => x.gf === 0).length, cs = l5.filter((x) => x.ga === 0).length;
    if (ns >= 3) add("l5_noscore", 45 + 5 * ns, { n: ns });
    if (cs >= 3) add("l5_cs", 45 + 5 * cs, { n: cs });
  }
  const sc = runLen(mine, (x) => x.gf > 0);
  if (sc >= 6) add("s_scored", 35 + 3 * sc, { n: sc });

  if (!league) return out;
  // Championnat : classement, attaque, défense, domicile / extérieur (saison en cours)
  const row = table.find((r) => String(r.id) === id);
  if (row && row.j >= 5 && table.length >= 6) {
    const N = table.length;
    if (row.rang === 1) add("rk_first", 60, { pts: row.pts });
    if (row.rang === N) add("rk_last", 60, { pts: row.pts });
    if (row.v === 0 && table.filter((r) => r.v === 0).length === 1) add("rk_nowin", 75, { j: row.j });
    if (row.d === 0) add(table.filter((r) => r.d === 0).length === 1 ? "rk_unbeaten_only" : "rk_unbeaten", 70, { v: row.v, n: row.n });
    const att = rankOf(table, id, (r) => r.bp / r.j, (a, b) => a > b), def = rankOf(table, id, (r) => r.bc / r.j, (a, b) => a < b);
    if (att.rank <= 3 && att.unique) add("att_best", 70 - 10 * (att.rank - 1), { r: att.rank, b: row.bp, j: row.j });
    if (att.rank === N && att.unique) add("att_worst", 60, { b: row.bp, j: row.j });
    if (def.rank <= 3 && def.unique) add("def_best", 70 - 10 * (def.rank - 1), { r: def.rank, b: row.bc, j: row.j });
    if (def.rank === N && def.unique) add("def_worst", 60, { b: row.bc, j: row.j });
  }
  {
    // Domicile pour l'équipe qui reçoit, extérieur pour l'autre : matchs de championnat de la saison en cours
    const cur = league.cur.filter((m) => String(side === "D" ? m.homeId : m.awayId) === id).map((m) => res(m, id));
    if (cur.length >= 3) {
      const v = cur.filter((x) => x.r === "V").length, n = cur.filter((x) => x.r === "N").length, d = cur.length - v - n;
      const p = side === "D" ? "h" : "a";
      if (v === cur.length) add(`${p}_allwin`, 60, { j: cur.length });
      else if (d === 0) add(`${p}_unbeaten`, 45 + 3 * cur.length, { j: cur.length, v, n });
      else if (v === 0) add(`${p}_nowin`, 50, { j: cur.length, n, d });
    }
  }
  // Pas deux fois la même information : « aucune victoire cette saison » couvre « sans victoire depuis N matchs » (idem invaincu)
  const has = (k) => out.some((f) => f.k === k);
  return out.filter((f) => !((f.k === "s_winless" && has("rk_nowin")) || (f.k === "s_unbeaten" && (has("rk_unbeaten") || has("rk_unbeaten_only")))));
}

// Force et faiblesse d'une équipe : l'aspect le plus marquant de chaque côté, avec ses chiffres
function strengths(id, side, stats, league, table) {
  const cand = [];
  const row = league && table.find((r) => String(r.id) === id);
  if (row && row.j >= 5 && table.length >= 6) {
    const N = table.length, cut = Math.max(3, Math.round(N / 4));
    const att = rankOf(table, id, (r) => r.bp / r.j, (a, b) => a > b), def = rankOf(table, id, (r) => r.bc / r.j, (a, b) => a < b);
    const put = (k, rk, avg) => {
      if (!rk.unique) return; // ex aequo : pas de rang à annoncer
      if (rk.rank <= cut) cand.push({ t: "f", k, sc: 1 - (rk.rank - 1) / (N - 1), v: { r: rk.rank, m: r1(avg) } });
      if (rk.rank > N - cut) cand.push({ t: "w", k, sc: (rk.rank - 1) / (N - 1), v: { r: rk.rank, m: r1(avg) } });
    };
    put("att", att, row.bp / row.j);
    put("def", def, row.bc / row.j);
    const cur = league.cur.filter((m) => String(side === "D" ? m.homeId : m.awayId) === id).map((m) => res(m, id));
    if (cur.length >= 3) {
      const v = cur.filter((x) => x.r === "V").length, n = cur.filter((x) => x.r === "N").length, ppg = (3 * v + n) / cur.length;
      const k = side === "D" ? "home" : "away", hi = side === "D" ? 2.2 : 2, lo = side === "D" ? 0.8 : 0.6;
      const v1 = { j: cur.length, v, n, d: cur.length - v - n };
      if (ppg >= hi) cand.push({ t: "f", k, sc: ppg / 3, v: v1 });
      if (ppg <= lo) cand.push({ t: "w", k, sc: 1 - ppg / 3, v: v1 });
    }
  }
  if (stats && (stats.forme || []).length === 5) {
    const p = stats.pointsForme;
    if (p >= 11) cand.push({ t: "f", k: "form", sc: p / 15, v: { p } });
    if (p <= 3) cand.push({ t: "w", k: "form", sc: 1 - p / 15, v: { p } });
  }
  const best = (t) => { const c = cand.filter((x) => x.t === t).sort((a, b) => b.sc - a.sc)[0]; return c ? { k: c.k, v: c.v } : null; };
  const f = best("f"), w = best("w");
  return f || w ? { ...(f ? { f } : {}), ...(w ? { w } : {}) } : null;
}

// all : matchs terminés connus (saison + championnat national pour les coupes) ; cur : matchs de la compétition, saison en cours
// isLeague : vrai championnat (pas une coupe, pas des sélections) → faits de classement et domicile / extérieur
export function keyPoints({ domId, extId, all, cur, table, isLeague, statsD, statsE }) {
  domId = String(domId); extId = String(extId);
  const league = isLeague ? { cur } : null;
  const facts = [...teamFacts(domId, "D", all, league, table || []), ...teamFacts(extId, "E", all, league, table || [])].sort((a, b) => b.w - a.w);
  const points = [], per = { D: 0, E: 0 };
  for (const f of facts) {
    if (points.length >= MAX_POINTS) break;
    if (per[f.s] >= MAX_PER_TEAM) continue;
    per[f.s]++;
    points.push({ k: f.k, s: f.s, v: f.v });
  }
  const fD = strengths(domId, "D", statsD, league, table || []), fE = strengths(extId, "E", statsE, league, table || []);
  if (!points.length && !fD && !fE) return null;
  return { points, ...(fD || fE ? { forces: { ...(fD ? { D: fD } : {}), ...(fE ? { E: fE } : {}) } } : {}) };
}
