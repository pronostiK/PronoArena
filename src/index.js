// ============================================================
// DUEL PRONO — Point d'entrée du Worker (V7)
//   /league-predictions?leagueId=61[&season=2026]  pronostics + stats + classement
//   /match-details?matchId=..&source=..&teamDomId=..&teamExtId=..[&leagueId=..]
//   /verdict?leagueId=61|all[&days=30]             résultats vs pronostics figés + taux de réussite
//   /leagues                                        compétitions disponibles, nombre de matchs à venir, date du prochain
//   /upcoming                                       tous les matchs des 7 prochains jours (page d'accueil)
// Accès : un visiteur non inscrit ne reçoit les probabilités que des 2 matchs offerts du jour ; un inscrit reçoit tout.
//   /status                                         état du robot (transparence)
// Arène (bloc 2, base D1) :
//   POST /account/signup | /account/login | /account/logout | /account/delete
//   POST /account/profile | /account/email | /account/password   espace personnel
//   POST /account/forgot | /account/reset                         mot de passe oublié (lien par e-mail)
//   GET  /me            mon bilan de la semaine + mes pronostics
//   POST /picks         enregistrer mon pronostic (refusé après le coup d'envoi)
//   GET  /arena[?semaine=precedente]                classement hebdomadaire
// ============================================================
import { LEAGUES, currentSeason, VERSION } from "./config.js";
import { kvGet, refreshSource, srcKey, resetEspnBudget, ESPN_HEADERS } from "./sources.js";
import { predsKey, getH2H, buildVerdict, buildUpcoming, allKey, INDEX_KEY, freeKey, lockPrediction } from "./build.js";
import { runRobot, robotStatus, saveLeague } from "./robot.js";
import { COMPOS_KEY, composFor } from "./compos.js";
import { readBody, signup, login, logout, deleteAccount, saveProfile, changeEmail, changePassword, forgotPassword, resetPassword, resetAvailable, auth, me, savePick, leaderboard, arenaStatus } from "./arena.js";

const CORS = {
  "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "86400",
};
const PRIVATE = { "Cache-Control": "no-store" };
// Mémoire partagée entre visiteurs (5 min) pour les calculs lourds : économise le quota de lectures
const memo = new Map();
async function remember(key, ttl, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn();
  memo.set(key, { t: Date.now(), v });
  if (memo.size > 100) memo.delete(memo.keys().next().value);
  return v;
}

// ---------- Accès : inscrit = tout ; visiteur = les 2 matchs offerts du jour ----------
// (Tant que la base des comptes n'est pas branchée, personne ne peut s'inscrire : tout reste ouvert.)
async function viewer(env, request) {
  if (!env.DB) return "all";
  if (!request.headers.get("Authorization")) return "free";
  try { await auth(env, request); return "all"; } catch { return "free"; }
}
const freeIds = async (env) => new Set((await remember("free-ids", 60000, async () => ((await kvGet(env, INDEX_KEY)) || {})._free?.ids || [])));
// En-têtes de cache : la réponse dépend de la connexion
const cacheFor = (who, env, seconds) => ({ "Cache-Control": !env.DB ? `public, max-age=${seconds}` : who === "all" ? "private, max-age=60" : "public, max-age=60", Vary: "Authorization" });

const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { ...CORS, ...extra } });

async function getPredictions(env, leagueId, season) {
  const cached = env.PRONO_CACHE ? await env.PRONO_CACHE.get(predsKey(leagueId, season)) : null;
  if (cached) return cached;
  // Pas encore préparé par le robot : calcul immédiat (une seule fois, ensuite c'est le robot qui entretient)
  const lg = LEAGUES[leagueId];
  resetEspnBudget();
  try {
    if (!(await kvGet(env, srcKey(lg.src, season)))) await refreshSource(env, lg.src, season);
  } catch (e) {
    // Source indisponible pour l'instant : réponse vide propre, le robot réessaiera
    return JSON.stringify({ success: true, leagueId, season, count: 0, predictions: [], enPreparation: true, detail: e.message });
  }
  await saveLeague(env, leagueId, season, Date.now());
  return env.PRONO_CACHE.get(predsKey(leagueId, season));
}

async function findPrediction(env, matchId, leagueId, season) {
  const ids = leagueId ? [leagueId] : Object.keys(LEAGUES).map(Number);
  for (const id of ids) {
    const raw = await env.PRONO_CACHE.get(predsKey(id, season));
    if (!raw) continue;
    const p = JSON.parse(raw).predictions.find((x) => String(x.matchId) === String(matchId));
    if (p) return p;
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const q = (k) => url.searchParams.get(k);

    try {
      if (path === "/league-predictions") {
        const leagueId = parseInt(q("leagueId"));
        if (!leagueId) throw new Error("LeagueId manquant.");
        if (!LEAGUES[leagueId]) return json({ success: true, leagueId, predictions: [], count: 0 });
        const season = parseInt(q("season")) || currentSeason();
        const body = await getPredictions(env, leagueId, season);
        if (!body) return json({ success: true, leagueId, season, count: 0, predictions: [] });
        const who = await viewer(env, request);
        if (who === "all") return new Response(body, { headers: { ...CORS, ...cacheFor(who, env, 120) } });
        // Visiteur non inscrit : probabilités des 2 matchs offerts seulement
        const locked = await remember(`anon:${leagueId}:${season}`, 60000, async () => {
          const free = await freeIds(env), o = JSON.parse(body);
          o.predictions = o.predictions.map((p) => (free.has(freeKey(leagueId, p.matchId)) ? { ...p, gratuit: true } : lockPrediction(p, leagueId)));
          return JSON.stringify({ ...o, acces: "visiteur" });
        });
        return new Response(locked, { headers: { ...CORS, ...cacheFor(who, env, 120) } });
      }

      if (path === "/upcoming") {
        // Préparé par le robot ; calculé à la volée seulement s'il n'existe pas encore
        const season = currentSeason();
        const body = (env.PRONO_CACHE && (await env.PRONO_CACHE.get(allKey(season)))) || JSON.stringify(await remember(`upcoming:${season}`, 60000, async () => buildUpcoming(env, season, Date.now(), ((await kvGet(env, INDEX_KEY)) || {})._free)));
        const who = await viewer(env, request);
        if (who === "all") return new Response(body, { headers: { ...CORS, ...cacheFor(who, env, 120) } });
        const locked = await remember(`anon:all:${season}`, 60000, async () => {
          const o = JSON.parse(body);
          return JSON.stringify({ ...o, acces: "visiteur", matchs: o.matchs.map((m) => (m.gratuit ? m : lockPrediction(m))) });
        });
        return new Response(locked, { headers: { ...CORS, ...cacheFor(who, env, 120) } });
      }

      if (path === "/match-details") {
        const matchId = q("matchId"), source = q("source");
        if (!matchId || !source) throw new Error("Paramètres manquants");
        const season = parseInt(q("season")) || currentSeason();
        const leagueId = parseInt(q("leagueId")) || null;
        const who = await viewer(env, request);
        if (who !== "all" && !(leagueId && (await freeIds(env)).has(freeKey(leagueId, matchId)))) return json({ success: false, verrouille: true, error: "Inscris-toi gratuitement pour voir cette analyse." }, 401, PRIVATE);
        const [pred, h, compos] = await Promise.all([
          findPrediction(env, matchId, leagueId, season),
          getH2H(env, { source, teamDomId: q("teamDomId"), teamExtId: q("teamExtId"), leagueId }, season),
          kvGet(env, COMPOS_KEY),
        ]);
        const stats = pred
          ? { domicile: { ...(pred.teams.domicile.stats || {}), classement: pred.teams.domicile.classement }, exterieur: { ...(pred.teams.exterieur.stats || {}), classement: pred.teams.exterieur.classement } }
          : { domicile: {}, exterieur: {} };
        const lineups = { domicile: composFor(compos, source, q("teamDomId")), exterieur: composFor(compos, source, q("teamExtId")) };
        return json({ success: true, stats, h2h: h.h2h, compositions: lineups }, 200, cacheFor(who, env, 1800));
      }

      if (path === "/verdict") {
        const season = parseInt(q("season")) || currentSeason();
        const lid = q("leagueId") || "all";
        const ids = lid === "all" ? Object.keys(LEAGUES).map(Number) : [parseInt(lid)];
        const days = Math.min(120, Math.max(1, parseInt(q("days")) || 30));
        const v = await remember(`verdict:${lid}:${season}:${days}`, 300000, () => buildVerdict(env, ids, season, Date.now(), days));
        return json(v, 200, { "Cache-Control": "public, max-age=300" });
      }

      if (path === "/leagues") {
        const season = currentSeason();
        const index = (await kvGet(env, "robot:index")) || {};
        const list = Object.entries(LEAGUES).map(([id, lg]) => ({ id: Number(id), nom: lg.name, logo: lg.logo, pays: lg.country, coupe: !!lg.cup, prochain: index[`next:${id}`] ? new Date(index[`next:${id}`]).toISOString() : null, matchsAVenir: index[`count:${id}`] ?? (lg.robot === false || lg.src.startsWith("sp:") ? 0 : null) })); // SportAPI : masquée tant que ses données ne sont pas complètes (« tout ou rien »)
        return json({ success: true, saison: season, options: { motDePasseOublie: resetAvailable(env) }, competitions: list }, 200, { "Cache-Control": "public, max-age=300" });
      }

      if (path === "/diag/espn") {
        // Diagnostic : ce qu'ESPN accepte réellement (formats de période)
        const lg = q("league") || "uefa.europa";
        const d = new Date(), f = (x) => x.toISOString().slice(0, 10).replace(/-/g, "");
        const minus = (n) => f(new Date(d.getTime() - n * 86400000));
        const tests = { jour: f(d), "7 jours": `${minus(7)}-${f(d)}`, "30 jours": `${minus(30)}-${f(d)}`, "90 jours": `${minus(90)}-${f(d)}` };
        const out = {};
        for (const [k, range] of Object.entries(tests)) for (const lim of ["", "&limit=500", "&limit=1000"]) {
          const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/scoreboard?dates=${range}${lim}`, { headers: ESPN_HEADERS });
          out[`${k}${lim}`] = r.ok ? `${r.status} · ${((await r.json()).events || []).length} matchs` : `${r.status}`;
        }
        return json({ success: true, competition: lg, resultats: out });
      }

      // TEMPORAIRE (12/11/2026) : copie des matchs SportAPI déjà enregistrés, pour le test sur matchs passés (à supprimer ensuite).
      if (path === "/test-sp-dump") {
        const out = {};
        for (const s of ["sp:16", "sp:5", "sp:88", "sp:72+123"]) for (const y of [2025, 2026]) {
          const d = await kvGet(env, srcKey(s, y));
          if (d) out[`${s}@${y}`] = { complete: d.complete, equipes: Object.fromEntries(Object.entries(d.teams).map(([k, v]) => [k, v[0]])), termines: d.finished };
        }
        return json(out);
      }

      // TEMPORAIRE (12/11/2026) : sonde Soccer Data (couverture 5 grands championnats, xG, blessures). ~20 appels, résultat gardé 6 h. À supprimer ensuite.
      if (path === "/test-soccerdata") {
        const cached = await env.PRONO_CACHE.get("tmp:soccerdata");
        if (cached) return new Response(cached, { headers: { "content-type": "application/json" } });
        if (!env.SOCCERDATA_KEY) return json({ erreur: "SOCCERDATA_KEY absente" });
        const B = "https://api.soccer-data.co/v1";
        const call = async (p) => { try { const r = await fetch(B + p, { headers: { "X-Api-Key": env.SOCCERDATA_KEY } }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 200); } return { status: r.status, j }; } catch (e) { return { status: 0, j: String(e) }; } };
        const out = {};
        for (const [nom, q, cc] of [["PL", "Premier League", "ENG"], ["Liga", "La Liga", "ESP"], ["SerieA", "Serie A", "ITA"], ["Bundes", "Bundesliga", "GER"], ["L1", "Ligue 1", "FRA"]]) {
          const o = out[nom] = {};
          const c = await call(`/competitions?search=${encodeURIComponent(q)}&per_page=3`);
          o.recherche = c.status === 200 ? (c.j.data || []).map(x => ({ id: x.id, name: x.name, country: x.country, type: x.type })) : c;
          const comp = c.status === 200 && (c.j.data || [])[0];
          if (!comp) continue;
          const d = await call(`/competitions/${comp.id}`);
          const sid = d.status === 200 && (d.j.data?.[0]?.current_season_id ?? d.j.data?.current_season_id);
          o.saison = sid;
          if (!sid) { o.detail = d; continue; }
          const m = await call(`/matches?competition_id=${comp.id}&season_id=${sid}&status=finished&sort=-utc_date&per_page=3`);
          const ms = m.status === 200 ? (m.j.data || []) : [];
          o.matchs = m.status === 200 ? { total: m.j.meta?.total, exemple: ms[0] } : m;
          if (ms[0]) {
            const st = await call(`/matches/${ms[0].id}/stats`);
            o.stats = st.status === 200 ? JSON.stringify(st.j).slice(0, 700) : st;
            if (nom === "PL" && (ms[0].home_team_id || ms[0].home?.id)) {
              const tid = ms[0].home_team_id || ms[0].home?.id;
              const inj = await call(`/teams/${tid}/injuries`);
              o.blessures = inj.status === 200 ? JSON.stringify(inj.j).slice(0, 900) : inj;
            }
          }
        }
        const txt = JSON.stringify(out);
        await env.PRONO_CACHE.put("tmp:soccerdata", txt, { expirationTtl: 21600 });
        return new Response(txt, { headers: { "content-type": "application/json" } });
      }

      // TEMPORAIRE (12/11/2026) : sonde Soccer Data n°2 (lente, 10 appels/min). À supprimer ensuite.
      if (path === "/test-soccerdata2") {
        const cached = await env.PRONO_CACHE.get("tmp:soccerdata2");
        if (cached) return new Response(cached, { headers: { "content-type": "application/json" } });
        if (!env.SOCCERDATA_KEY) return json({ erreur: "SOCCERDATA_KEY absente" });
        const B = "https://api.soccer-data.co/v1";
        const call = async (p) => { await new Promise(r => setTimeout(r, 6500)); try { const r = await fetch(B + p, { headers: { "X-Api-Key": env.SOCCERDATA_KEY } }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 200); } return { status: r.status, j }; } catch (e) { return { status: 0, j: String(e) }; } };
        const out = {};
        for (const [nom, q] of [["Liga", "LaLiga"], ["Bundes", "Bundesliga"], ["L1", "Ligue 1"]]) {
          const o = out[nom] = {};
          const c = await call(`/competitions?search=${encodeURIComponent(q)}&country=${nom === "Liga" ? "Spain" : nom === "Bundes" ? "Germany" : "France"}&per_page=4`);
          o.recherche = c.status === 200 ? (c.j.data || []).map(x => ({ id: x.id, name: x.name, country: x.country })) : c;
          const comp = c.status === 200 && (c.j.data || [])[0];
          if (!comp) continue;
          const d = await call(`/competitions/${comp.id}`);
          const sid = d.status === 200 && (d.j.data?.[0]?.current_season_id ?? d.j.data?.current_season_id);
          o.saison = sid;
          if (!sid) { o.detail = d; continue; }
          const m = await call(`/matches?competition_id=${comp.id}&season_id=${sid}&status=finished&sort=-utc_date&per_page=2`);
          const ms = m.status === 200 ? (m.j.data || []) : [];
          o.total = m.j?.meta?.total; o.xg = ms[0] && { xg_available: ms[0].xg_available, q: ms[0].xg_quality, match: ms[0].home_team?.name + "-" + ms[0].away_team?.name };
          if (ms[0]) { const st = await call(`/matches/${ms[0].id}/stats`); o.stats = st.status === 200 ? JSON.stringify(st.j?.data?.overview?.expected_goals?.all) : st; }
          if (nom === "Bundes" && ms[0]) {
            const inj = await call(`/teams/${ms[0].home_team.id}/injuries`);
            o.blessures = inj.status === 200 ? JSON.stringify(inj.j).slice(0, 1200) : inj;
          }
        }
        const txt = JSON.stringify(out);
        await env.PRONO_CACHE.put("tmp:soccerdata2", txt, { expirationTtl: 21600 });
        return new Response(txt, { headers: { "content-type": "application/json" } });
      }

      // TEMPORAIRE (12/11/2026) : sonde Soccer Data n°3 (Ligue 1 + blessures). À supprimer ensuite.
      if (path === "/test-soccerdata3") {
        const cached = await env.PRONO_CACHE.get("tmp:soccerdata3");
        if (cached) return new Response(cached, { headers: { "content-type": "application/json" } });
        if (!env.SOCCERDATA_KEY) return json({ erreur: "SOCCERDATA_KEY absente" });
        const B = "https://api.soccer-data.co/v1";
        const call = async (p) => { await new Promise(r => setTimeout(r, 12000)); try { const r = await fetch(B + p, { headers: { "X-Api-Key": env.SOCCERDATA_KEY } }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 200); } return { status: r.status, j }; } catch (e) { return { status: 0, j: String(e) }; } };
        const out = {};
        const c = await call(`/competitions?search=Ligue%201&country=France&per_page=4`);
        out.recherche = c.status === 200 ? (c.j.data || []).map(x => ({ id: x.id, name: x.name })) : c;
        const comp = c.status === 200 && (c.j.data || [])[0];
        if (comp) {
          const d = await call(`/competitions/${comp.id}`);
          const sid = d.status === 200 && (d.j.data?.[0]?.current_season_id ?? d.j.data?.current_season_id);
          out.saison = sid;
          if (sid) {
            const m = await call(`/matches?competition_id=${comp.id}&season_id=${sid}&status=finished&sort=-utc_date&per_page=1`);
            const m0 = m.status === 200 ? (m.j.data || [])[0] : null;
            out.total = m.j?.meta?.total;
            if (m0) {
              out.match = m0.home_team?.name + "-" + m0.away_team?.name; out.xg = m0.xg_available + "/" + m0.xg_quality;
              const st = await call(`/matches/${m0.id}/stats`);
              out.stats = st.status === 200 ? JSON.stringify(st.j?.data?.overview?.expected_goals?.all) : st;
              const inj = await call(`/teams/${m0.home_team.id}/injuries`);
              out.blessures = inj.status === 200 ? JSON.stringify(inj.j).slice(0, 1500) : inj;
            }
          }
        }
        const txt = JSON.stringify(out);
        await env.PRONO_CACHE.put("tmp:soccerdata3", txt, { expirationTtl: 21600 });
        return new Response(txt, { headers: { "content-type": "application/json" } });
      }

      if (path === "/status") return json({ success: true, version: VERSION, ...(await robotStatus(env)), arene: await arenaStatus(env) });

      // ---------- Arène ----------
      const post = request.method === "POST";
      if (path === "/account/signup" && post) return json(await signup(env, await readBody(request), request.headers.get("CF-Connecting-IP")), 200, PRIVATE);
      if (path === "/account/login" && post) return json(await login(env, await readBody(request)), 200, PRIVATE);
      if (path === "/account/logout" && post) return json(await logout(env, await auth(env, request)), 200, PRIVATE);
      if (path === "/account/delete" && post) return json(await deleteAccount(env, await auth(env, request), await readBody(request)), 200, PRIVATE);
      if (path === "/account/forgot" && post) return json(await forgotPassword(env, await readBody(request), request.headers.get("CF-Connecting-IP")), 200, PRIVATE);
      if (path === "/account/reset" && post) return json(await resetPassword(env, await readBody(request)), 200, PRIVATE);
      if (path === "/account/profile" && post) return json(await saveProfile(env, await auth(env, request), await readBody(request)), 200, PRIVATE);
      if (path === "/account/email" && post) return json(await changeEmail(env, await auth(env, request), await readBody(request)), 200, PRIVATE);
      if (path === "/account/password" && post) return json(await changePassword(env, await auth(env, request), await readBody(request)), 200, PRIVATE);
      if (path === "/me") return json(await me(env, await auth(env, request)), 200, PRIVATE);
      if (path === "/picks" && post) return json(await savePick(env, await auth(env, request), await readBody(request)), 200, PRIVATE);
      if (path === "/arena") {
        const which = q("semaine") === "precedente" ? "precedente" : "courante";
        const board = await remember(`arena:${which}`, 60000, () => leaderboard(env, which));
        return json(board, 200, { "Cache-Control": "public, max-age=60" });
      }

      return json({ success: false, error: "Route inconnue" }, 404);
    } catch (err) {
      return json({ success: false, error: err.message }, err.status || 400, PRIVATE);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRobot(env));
  },
};
