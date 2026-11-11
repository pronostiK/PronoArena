// ============================================================
// DUEL PRONO — Arène (bloc 2)
// Comptes joueurs, pronostics des joueurs bloqués au coup d'envoi,
// notation par le robot, classement hebdomadaire. Base D1 (binding DB).
// ============================================================
import { LEAGUES, currentSeason } from "./config.js";
import { kvGet, srcKey } from "./sources.js";
import { predsKey } from "./build.js";

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const SESSION_MS = 90 * DAY;
const PBKDF2_TOURS = 100000; // maximum accepté par Cloudflare Workers
const LIVE = /IN_PLAY|PAUSED|LIVE|IN_PROGRESS|HALFTIME|FIRST_HALF|SECOND_HALF/;
const RESERVED = ["admin", "administrateur", "moteur", "duelprono", "duel_prono", "duel-prono", "pronoarena", "prono_arena", "prono-arena", "moderateur", "support"];

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const need = (env) => { if (!env.DB) throw new HttpError(503, "L'Arène n'est pas encore ouverte."); return env.DB; };

// ---------- Outils de sécurité ----------
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sameString = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

async function pbkdf2(password, saltHex, tours) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations: tours }, key, 256));
}
async function hashPassword(password) {
  const salt = randomHex(16);
  return `pbkdf2$${PBKDF2_TOURS}$${salt}$${await pbkdf2(password, salt, PBKDF2_TOURS)}`;
}
async function checkPassword(password, stored) {
  const [algo, tours, salt, hash] = String(stored).split("$");
  if (algo !== "pbkdf2" || !hash) return false;
  return sameString(await pbkdf2(password, salt, Number(tours)), hash);
}

// Anti-abus : au plus `max` essais par fenêtre de temps
async function throttle(db, cle, max, windowMs, now) {
  const row = await db.prepare("SELECT n, debut FROM limites WHERE cle = ?1").bind(cle).first();
  if (row && now - row.debut < windowMs) {
    if (row.n >= max) throw new HttpError(429, "Trop d'essais. Réessaie dans quelques minutes.");
    await db.prepare("UPDATE limites SET n = n + 1 WHERE cle = ?1").bind(cle).run();
  } else {
    await db.prepare("INSERT INTO limites (cle, n, debut) VALUES (?1, 1, ?2) ON CONFLICT (cle) DO UPDATE SET n = 1, debut = excluded.debut").bind(cle, now).run();
  }
}

export async function readBody(request) {
  const text = await request.text();
  if (text.length > 2000) throw new HttpError(413, "Demande trop longue.");
  try { const o = JSON.parse(text || "{}"); return o && typeof o === "object" ? o : {}; }
  catch { throw new HttpError(400, "Demande illisible."); }
}

// ---------- Comptes ----------
async function openSession(db, joueurId, now) {
  const token = randomHex(32);
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE joueur_id = ?1 AND expire_le < ?2").bind(joueurId, now),
    db.prepare("INSERT INTO sessions (jeton, joueur_id, expire_le) VALUES (?1, ?2, ?3)").bind(await sha256(token), joueurId, now + SESSION_MS),
  ]);
  return token;
}

export async function signup(env, body, ip, now = Date.now()) {
  const db = need(env);
  const pseudo = String(body.pseudo || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const mdp = String(body.motDePasse || "");
  if (!/^[\p{L}\p{N}_-]{3,16}$/u.test(pseudo)) throw new HttpError(400, "Pseudo : 3 à 16 lettres ou chiffres, sans espace.");
  if (RESERVED.includes(pseudo.toLowerCase())) throw new HttpError(400, "Ce pseudo est réservé. Choisis-en un autre.");
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "Adresse e-mail invalide.");
  if (mdp.length < 8 || mdp.length > 72) throw new HttpError(400, "Mot de passe : 8 caractères minimum.");
  if (body.accepte !== true) throw new HttpError(400, "Coche la case : il faut avoir 18 ans ou plus et accepter les conditions d'utilisation.");
  await throttle(db, `inscription:${(await sha256(ip || "?")).slice(0, 24)}`, 5, HOUR, now);

  const taken = await db.prepare("SELECT pseudo, email FROM joueurs WHERE pseudo = ?1 OR email = ?2").bind(pseudo, email).first();
  if (taken) throw new HttpError(409, String(taken.pseudo).toLowerCase() === pseudo.toLowerCase() ? "Ce pseudo est déjà pris." : "Un compte existe déjà avec cet e-mail.");
  let id;
  try {
    const r = await db.prepare("INSERT INTO joueurs (pseudo, email, mdp, cree_le) VALUES (?1, ?2, ?3, ?4)").bind(pseudo, email, await hashPassword(mdp), now).run();
    id = r.meta.last_row_id;
  } catch { throw new HttpError(409, "Ce pseudo ou cet e-mail est déjà utilisé."); }
  return { success: true, pseudo, token: await openSession(db, id, now) };
}

export async function login(env, body, now = Date.now()) {
  const db = need(env);
  const ident = String(body.identifiant || "").trim().toLowerCase();
  const mdp = String(body.motDePasse || "");
  if (!ident || !mdp || ident.length > 120 || mdp.length > 72) throw new HttpError(400, "Identifiant et mot de passe requis.");
  const cle = `connexion:${(await sha256(ident)).slice(0, 24)}`;
  await throttle(db, cle, 10, 15 * MIN, now);
  const row = await db.prepare("SELECT id, pseudo, mdp FROM joueurs WHERE pseudo = ?1 OR email = ?1").bind(ident).first();
  // Même durée de calcul que le compte existe ou non (ne révèle rien)
  const ok = row ? await checkPassword(mdp, row.mdp) : (await pbkdf2(mdp, "00", PBKDF2_TOURS), false);
  if (!ok) throw new HttpError(401, "Identifiant ou mot de passe incorrect.");
  await db.prepare("DELETE FROM limites WHERE cle = ?1").bind(cle).run();
  return { success: true, pseudo: row.pseudo, token: await openSession(db, row.id, now) };
}

export async function auth(env, request, now = Date.now()) {
  const db = need(env);
  const m = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("Authorization") || "");
  if (!m) throw new HttpError(401, "Connecte-toi pour continuer.");
  const jeton = await sha256(m[1]);
  const row = await db.prepare("SELECT j.* FROM sessions s JOIN joueurs j ON j.id = s.joueur_id WHERE s.jeton = ?1 AND s.expire_le > ?2").bind(jeton, now).first();
  if (!row) throw new HttpError(401, "Session expirée : reconnecte-toi.");
  return { id: row.id, pseudo: row.pseudo, mdp: row.mdp, email: row.email, prenom: row.prenom, ville: row.ville, club: row.club, clubLogo: row.club_logo, jeton };
}

export async function logout(env, user) {
  await need(env).prepare("DELETE FROM sessions WHERE jeton = ?1").bind(user.jeton).run();
  return { success: true };
}

export async function deleteAccount(env, user, body) {
  const db = need(env);
  if (!(await checkPassword(String(body.motDePasse || "").slice(0, 72), user.mdp))) throw new HttpError(401, "Mot de passe incorrect.");
  await db.batch([
    db.prepare("DELETE FROM pronos WHERE joueur_id = ?1").bind(user.id),
    db.prepare("DELETE FROM sessions WHERE joueur_id = ?1").bind(user.id),
    db.prepare("DELETE FROM joueurs WHERE id = ?1").bind(user.id),
  ]);
  return { success: true };
}

// ---------- Espace personnel ----------
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

export async function saveProfile(env, user, body, now = Date.now()) {
  const db = need(env);
  const prenom = clean(body.prenom, 30) || null, ville = clean(body.ville, 40) || null;
  let club = user.club, logo = user.clubLogo;
  if ("club" in body) {
    if (!body.club) { club = null; logo = null; }
    else {
      // Le club est relu dans les données du moteur : impossible d'enregistrer un nom ou une image inventés
      const leagueId = parseInt(body.club.leagueId);
      const raw = LEAGUES[leagueId] ? await env.PRONO_CACHE.get(predsKey(leagueId, currentSeason(new Date(now)))) : null;
      const t = raw ? (JSON.parse(raw).classement || []).find((x) => String(x.id) === String(body.club.teamId)) : null;
      if (!t) throw new HttpError(400, "Club introuvable.");
      club = t.nom; logo = t.logo || null;
    }
  }
  await db.prepare("UPDATE joueurs SET prenom = ?1, ville = ?2, club = ?3, club_logo = ?4 WHERE id = ?5").bind(prenom, ville, club, logo, user.id).run();
  return { success: true, profil: { email: user.email, prenom, ville, club: club ? { nom: club, logo } : null } };
}

export async function changeEmail(env, user, body) {
  const db = need(env);
  const email = String(body.email || "").trim().toLowerCase();
  if (email.length > 120 || !EMAIL.test(email)) throw new HttpError(400, "Adresse e-mail invalide.");
  if (!(await checkPassword(String(body.motDePasse || "").slice(0, 72), user.mdp))) throw new HttpError(401, "Mot de passe incorrect.");
  const taken = await db.prepare("SELECT id FROM joueurs WHERE email = ?1 AND id <> ?2").bind(email, user.id).first();
  if (taken) throw new HttpError(409, "Un compte existe déjà avec cet e-mail.");
  await db.prepare("UPDATE joueurs SET email = ?1 WHERE id = ?2").bind(email, user.id).run();
  return { success: true, email };
}

export async function changePassword(env, user, body) {
  const db = need(env);
  const neuf = String(body.nouveau || "");
  if (!(await checkPassword(String(body.ancien || "").slice(0, 72), user.mdp))) throw new HttpError(401, "Mot de passe actuel incorrect.");
  if (neuf.length < 8 || neuf.length > 72) throw new HttpError(400, "Nouveau mot de passe : 8 caractères minimum.");
  // Les autres appareils sont déconnectés ; celui-ci reste connecté
  await db.batch([
    db.prepare("UPDATE joueurs SET mdp = ?1 WHERE id = ?2").bind(await hashPassword(neuf), user.id),
    db.prepare("DELETE FROM sessions WHERE joueur_id = ?1 AND jeton <> ?2").bind(user.id, user.jeton),
  ]);
  return { success: true };
}

// ---------- Semaine (du lundi au dimanche, heure de Paris) ----------
const parisFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
export function weekOf(ts) {
  const parts = Object.fromEntries(parisFmt.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  const d = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
  d.setUTCDate(d.getUTCDate() - ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday));
  return d.toISOString().slice(0, 10);
}
const shiftWeek = (week, n) => { const d = new Date(week + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 7 * n); return d.toISOString().slice(0, 10); };

// ---------- Points selon le risque ----------
// 10 points divisés par la probabilité du moteur : un favori à 70 % rapporte 14 points, une surprise à 20 % en rapporte 50.
// (Même formule dans site/public/app.js pour l'affichage ; ici elle fait foi.)
export const pointsFor = (proba) => Math.max(10, Math.min(100, Math.round(10 / Math.max(Number(proba) || 0, 0.01))));

// ---------- Pronostics des joueurs ----------
export async function savePick(env, user, body, now = Date.now()) {
  const db = need(env);
  const leagueId = parseInt(body.leagueId), matchId = String(body.matchId ?? "").slice(0, 64), choix = String(body.choix || "");
  if (!LEAGUES[leagueId] || !matchId || !["1", "N", "2"].includes(choix)) throw new HttpError(400, "Pronostic invalide.");
  const season = currentSeason(new Date(now));
  const raw = await env.PRONO_CACHE.get(predsKey(leagueId, season));
  const p = raw ? JSON.parse(raw).predictions.find((x) => String(x.matchId) === matchId) : null;
  if (!p) throw new HttpError(404, "Ce duel n'est plus à l'affiche.");
  const ts = Date.parse(p.date);
  if (!(ts > now) || LIVE.test(p.status || "")) throw new HttpError(409, "Trop tard : le coup d'envoi a été donné.");
  const proba = choix === "1" ? p.poisson.proba1 : choix === "N" ? p.poisson.probaN : p.poisson.proba2;
  const mise = pointsFor(proba);
  const D = p.teams.domicile, E = p.teams.exterieur;
  // La condition « points IS NULL » interdit de toucher à un pronostic déjà noté
  await db.prepare(`INSERT INTO pronos (joueur_id, ligue_id, match_id, saison, coup_envoi, semaine, choix, mise_pts, dom, dom_logo, ext, ext_logo, maj_le)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
      ON CONFLICT (joueur_id, ligue_id, match_id) DO UPDATE SET choix = excluded.choix, mise_pts = excluded.mise_pts, coup_envoi = excluded.coup_envoi, semaine = excluded.semaine, maj_le = excluded.maj_le
      WHERE pronos.points IS NULL`)
    .bind(user.id, leagueId, matchId, season, ts, weekOf(ts), choix, mise, D.name, D.logo || null, E.name, E.logo || null, now).run();
  return { success: true, prono: { leagueId, matchId, choix, mise, coupEnvoi: ts } };
}

const pickRow = (r) => ({
  leagueId: r.ligue_id, matchId: r.match_id, competition: LEAGUES[r.ligue_id]?.name || "", choix: r.choix, mise: r.mise_pts, coupEnvoi: r.coup_envoi, semaine: r.semaine,
  domicile: { nom: r.dom, logo: r.dom_logo }, exterieur: { nom: r.ext, logo: r.ext_logo },
  resultat: r.resultat, score: r.score, points: r.points,
});

const TOTALS = `SELECT j.pseudo AS pseudo, j.club AS club, j.club_logo AS club_logo, SUM(COALESCE(p.points, 0)) AS pts, SUM(CASE WHEN p.points > 0 THEN 1 ELSE 0 END) AS justes,
    SUM(CASE WHEN p.points IS NULL THEN 1 ELSE 0 END) AS attente, COUNT(*) AS joues
  FROM pronos p JOIN joueurs j ON j.id = p.joueur_id WHERE p.semaine = ?1 GROUP BY p.joueur_id`;

export async function me(env, user, now = Date.now()) {
  const db = need(env);
  const week = weekOf(now);
  const [picks, mine, all] = await db.batch([
    db.prepare("SELECT * FROM pronos WHERE joueur_id = ?1 AND coup_envoi > ?2 ORDER BY coup_envoi DESC LIMIT 200").bind(user.id, now - 60 * DAY),
    db.prepare(`SELECT * FROM (${TOTALS}) WHERE pseudo = ?2`).bind(week, user.pseudo),
    db.prepare("SELECT COALESCE(SUM(points), 0) AS pts, COALESCE(SUM(CASE WHEN points > 0 THEN 1 ELSE 0 END), 0) AS justes, COALESCE(SUM(CASE WHEN points IS NOT NULL THEN 1 ELSE 0 END), 0) AS notes, COUNT(*) AS joues FROM pronos WHERE joueur_id = ?1").bind(user.id),
  ]);
  const g = all.results[0];
  const t = mine.results[0] || null;
  let rang = null;
  if (t) {
    // Même ordre que le classement : points, puis pronos justes, puis moins de pronos joués, puis pseudo
    const r = await db.prepare(`SELECT COUNT(*) AS devant FROM (${TOTALS}) WHERE pts > ?2 OR (pts = ?2 AND (justes > ?3 OR (justes = ?3 AND (joues < ?4 OR (joues = ?4 AND pseudo < ?5 COLLATE NOCASE)))))`)
      .bind(week, t.pts, t.justes, t.joues, user.pseudo).first();
    rang = r.devant + 1;
  }
  return {
    success: true, pseudo: user.pseudo,
    profil: { email: user.email, prenom: user.prenom || null, ville: user.ville || null, club: user.club ? { nom: user.club, logo: user.clubLogo || null } : null },
    semaine: { cle: week, points: t?.pts || 0, justes: t?.justes || 0, joues: t?.joues || 0, attente: t?.attente || 0, rang },
    total: { points: g.pts, justes: g.justes, notes: g.notes, joues: g.joues },
    pronos: picks.results.map(pickRow),
  };
}

// ---------- Classement hebdomadaire ----------
export async function leaderboard(env, which, now = Date.now()) {
  const db = need(env);
  const week = which === "precedente" ? shiftWeek(weekOf(now), -1) : weekOf(now);
  const [top, count] = await db.batch([
    db.prepare(`${TOTALS} ORDER BY pts DESC, justes DESC, joues ASC, j.pseudo LIMIT 50`).bind(week),
    db.prepare("SELECT COUNT(DISTINCT joueur_id) AS n FROM pronos WHERE semaine = ?1").bind(week),
  ]);
  return {
    success: true,
    semaine: { cle: week, debut: week, fin: new Date(Date.parse(week + "T00:00:00Z") + 6 * DAY).toISOString().slice(0, 10), enCours: which !== "precedente" },
    joueurs: count.results[0]?.n || 0,
    classement: top.results.map((r, i) => ({ rang: i + 1, pseudo: r.pseudo, club: r.club ? { nom: r.club, logo: r.club_logo } : null, points: r.pts, justes: r.justes, joues: r.joues, attente: r.attente })),
  };
}

// ---------- Notation par le robot ----------
// Un seul petit appel à la base par passage quand il n'y a rien à noter.
export async function gradePicks(env, now = Date.now()) {
  if (!env.DB) return null;
  const db = env.DB;
  const { results: groups } = await db.prepare("SELECT ligue_id, saison, COUNT(*) AS n FROM pronos WHERE points IS NULL AND coup_envoi < ?1 AND coup_envoi > ?2 GROUP BY ligue_id, saison")
    .bind(now - 100 * MIN, now - 10 * DAY).all();
  let matchs = 0;
  for (const g of groups) {
    const lg = LEAGUES[g.ligue_id];
    if (!lg) continue;
    const scores = new Map();
    for (const s of [lg.src, lg.backup].filter(Boolean)) {
      const data = await kvGet(env, srcKey(s, g.saison));
      for (const f of data?.finished || []) scores.set(String(f[0]), [f[3], f[4]]);
    }
    const { results: pending } = await db.prepare("SELECT DISTINCT match_id FROM pronos WHERE points IS NULL AND ligue_id = ?1 AND saison = ?2 AND coup_envoi < ?3")
      .bind(g.ligue_id, g.saison, now - 100 * MIN).all();
    const stmts = [];
    for (const { match_id } of pending) {
      const sc = scores.get(String(match_id));
      if (!sc) continue;
      const res = sc[0] > sc[1] ? "1" : sc[0] < sc[1] ? "2" : "N";
      stmts.push(db.prepare("UPDATE pronos SET resultat = ?1, score = ?2, points = CASE WHEN choix = ?1 THEN mise_pts ELSE 0 END WHERE ligue_id = ?3 AND match_id = ?4 AND points IS NULL")
        .bind(res, `${sc[0]}-${sc[1]}`, g.ligue_id, match_id));
    }
    if (stmts.length) { await db.batch(stmts); matchs += stmts.length; }
  }
  return matchs;
}

// Ménage quotidien : sessions expirées et compteurs anti-abus périmés
export async function cleanArena(env, now = Date.now()) {
  if (!env.DB) return;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expire_le < ?1").bind(now),
    env.DB.prepare("DELETE FROM limites WHERE debut < ?1").bind(now - DAY),
  ]);
}

export async function arenaStatus(env) {
  if (!env.DB) return { ouverte: false };
  const r = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM joueurs) AS joueurs, (SELECT COUNT(*) FROM pronos) AS pronos, (SELECT COUNT(*) FROM pronos WHERE points IS NULL) AS enAttente").first();
  return { ouverte: true, joueurs: r.joueurs, pronostics: r.pronos, enAttenteDeResultat: r.enAttente };
}
