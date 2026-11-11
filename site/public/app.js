// ============================================================
// DUEL PRONO — Site (Duels, Analyse, Verdict, Arène, Compte)
// Toutes les données viennent du moteur. Seuls le compte et les pronostics du joueur sont envoyés.
// ============================================================
(() => {
  "use strict";

  const API = window.PRONO_API || "https://prono-arena-worker.hitch-legende.workers.dev";
  const view = document.getElementById("view");

  // Ordre d'affichage des compétitions
  const ORDER = [61, 2, 39, 140, 135, 78, 3, 848, 62, 94, 88, 40, 71, 5, 15, 4];

  // ---------- Outils ----------
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => Math.round((x || 0) * 100);
  const dec = (x) => (x == null ? "—" : Number(x).toFixed(1).replace(".", ","));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* navigation privée */ } },
  };
  const cache = new Map();
  async function api(path, ttl = 60000) {
    const hit = cache.get(path);
    if (hit && Date.now() - hit.t < ttl) return hit.data;
    const res = await fetch(API + path);
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.error || `Erreur ${res.status}`);
    cache.set(path, { t: Date.now(), data });
    return data;
  }

  // ---------- Compte joueur ----------
  const session = { token: store.get("token"), pseudo: store.get("pseudo") };
  let meCache = null, meDirty = false, pendingPick = null;
  async function call(path, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (session.token) headers.Authorization = "Bearer " + session.token;
    const res = await fetch(API + path, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
    let data = {};
    try { data = await res.json(); } catch { /* réponse vide */ }
    if (!res.ok || data.success === false) { const e = new Error(data.error || `Erreur ${res.status}`); e.status = res.status; throw e; }
    return data;
  }
  function paintAccount() {
    const a = document.getElementById("account");
    a.innerHTML = session.token ? `<span class="avatar" aria-hidden="true">${esc(String(session.pseudo || "?")[0].toUpperCase())}</span><span class="account-name">${esc(session.pseudo)}</span>` : "Connexion";
    a.setAttribute("aria-label", session.token ? `Mon compte : ${session.pseudo}` : "Connexion ou création de compte");
  }
  function setSession(token, pseudo) {
    session.token = token || null; session.pseudo = pseudo || null; meCache = null; meDirty = false;
    if (token) { store.set("token", token); store.set("pseudo", pseudo); } else { store.del("token"); store.del("pseudo"); }
    paintAccount();
  }
  // Mon bilan de la semaine et mes pronostics (gardés 30 s)
  async function getMe() {
    if (!session.token) return null;
    if (meCache && !meDirty && Date.now() - meCache.t < 30000) return meCache.data;
    try { const d = await call("/me"); meCache = { t: Date.now(), data: d }; meDirty = false; return d; }
    catch (e) { if (e.status === 401) setSession(null); return meCache?.data || null; }
  }
  const myPick = (me, leagueId, matchId) => me?.pronos.find((x) => x.leagueId === Number(leagueId) && String(x.matchId) === String(matchId)) || null;
  let toastTimer;
  function toast(msg, bad) {
    const el = document.getElementById("toast");
    el.textContent = msg; el.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.className = "toast"), 2800);
  }

  // ---------- Pronostic du joueur : 3 boutons (1, N, 2) ----------
  // Les points ne sont pas affichés sur les duels (on y vient d'abord pour les probabilités) :
  // ils apparaissent après le choix, dans l'Arène et dans « Mon espace ».
  const duelIndex = new Map();
  function picks(p, leagueId, mine) {
    duelIndex.set(`${leagueId}/${p.matchId}`, p);
    const P = p.poisson, D = p.teams.domicile, E = p.teams.exterieur;
    const locked = isLive(p.status) || Date.parse(p.date) <= Date.now();
    const opt = (k, proba, cls, label, aria) => {
      const sel = mine?.choix === k;
      return `<button type="button" class="pick" data-pick="${k}" aria-pressed="${sel}"${locked ? " disabled" : ""} aria-label="${esc(aria)}, ${pct(proba)} %${sel ? ", ton pronostic" : ""}">
          <b class="${cls}">${pct(proba)}%</b><small>${sel ? (locked ? "🔒 Mon prono" : "✓ Mon prono") : label}</small></button>`;
    };
    return `<div class="picks${locked ? " locked" : ""}" data-league="${esc(leagueId)}" data-match="${esc(p.matchId)}" role="group" aria-label="Ton pronostic">${opt("1", P.proba1, "c1", "Victoire", `Victoire ${D.name}`)}${opt("N", P.probaN, "cN", "Nul", "Match nul")}${opt("2", P.proba2, "c2", "Victoire", `Victoire ${E.name}`)}</div>`;
  }
  async function sendPick(pick) {
    const box = [...view.querySelectorAll(".picks")].find((x) => x.dataset.league === String(pick.leagueId) && x.dataset.match === String(pick.matchId));
    if (box) box.classList.add("busy");
    try {
      const r = await call("/picks", pick);
      if (meCache) { meCache.data.pronos = meCache.data.pronos.filter((x) => !(x.leagueId === r.prono.leagueId && String(x.matchId) === String(r.prono.matchId))); meCache.data.pronos.push(r.prono); }
      meDirty = true; cache.delete("/arena");
      const p = duelIndex.get(`${pick.leagueId}/${pick.matchId}`);
      if (box && p) box.outerHTML = picks(p, pick.leagueId, r.prono);
      toast(`Prono enregistré · ${r.prono.mise} pts en jeu`);
      return true;
    } catch (e) {
      if (box) box.classList.remove("busy");
      if (e.status === 401) { setSession(null); pendingPick = pick; location.hash = "#/compte"; return false; }
      toast(e.message, true);
      if (e.status === 409 || e.status === 404) { cache.clear(); route(); }
      return false;
    }
  }
  view.addEventListener("click", (e) => {
    const b = e.target.closest(".pick");
    if (!b || b.disabled) return;
    const box = b.closest(".picks");
    if (box.classList.contains("busy") || b.getAttribute("aria-pressed") === "true") return;
    const pick = { leagueId: Number(box.dataset.league), matchId: box.dataset.match, choix: b.dataset.pick };
    if (!session.token) { pendingPick = pick; location.hash = "#/compte"; return; }
    sendPick(pick);
  });

  const fmtDay = (d) => { const s = new Date(d).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long" }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const fmtTime = (d) => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const fmtShort = (d) => new Date(d).toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
  const isLive = (s) => /IN_PLAY|PAUSED|LIVE|IN_PROGRESS|HALFTIME|FIRST_HALF|SECOND_HALF/.test(s || "");

  function initials(name) {
    const words = String(name || "?").replace(/\b(FC|AC|SC|AS|CF|OGC|RC|SCO|AFC|CD|SL|SV|VfB|VfL|1\.)\b/g, "").trim().split(/\s+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 3)).toUpperCase();
  }
  function hue(name) { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function crest(team, cls = "crest") {
    const fallback = `<span class="${cls} initials" style="background:hsl(${hue(team.name)} 45% 32%)" aria-hidden="true">${esc(initials(team.name))}</span>`;
    if (!team.logo) return fallback;
    return `<img class="${cls}" src="${esc(team.logo)}" alt="" loading="lazy" width="44" height="44" data-fallback="${esc(fallback)}">`;
  }
  // Logo cassé : on affiche les initiales à la place
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName === "IMG" && img.dataset.fallback) img.outerHTML = img.dataset.fallback;
  }, true);

  // Phrase "avis du moteur"
  function avis(p) {
    const P = p.poisson, d = p.teams.domicile.name, e = p.teams.exterieur.name;
    const best = Math.max(P.proba1, P.probaN, P.proba2);
    let t;
    if (best === P.probaN && P.probaN >= 0.3) t = "match très équilibré, le nul est l'issue la plus probable.";
    else if (P.proba1 >= 0.6) t = `${d} largement favori à domicile.`;
    else if (P.proba2 >= 0.55) t = `${e} largement favori, même à l'extérieur.`;
    else if (P.proba1 >= 0.45) t = `${d} favori, mais ${e} peut accrocher le nul.`;
    else if (P.proba2 >= 0.42) t = `${e} favori, mais ${d} peut accrocher le nul.`;
    else t = `duel serré, léger avantage ${P.proba1 >= P.proba2 ? d : e}.`;
    if (P.probaOver25 >= 0.62) t += ` Match ouvert attendu (+2,5 buts : ${pct(P.probaOver25)} %).`;
    else if (P.probaUnder25 >= 0.62) t += ` Match fermé attendu (moins de 2,5 buts : ${pct(P.probaUnder25)} %).`;
    return t;
  }

  // Badges visuels (remplacent les phrases)
  function badges(p) {
    const P = p.poisson, D = p.teams.domicile, E = p.teams.exterieur;
    const best = Math.max(P.proba1, P.probaN, P.proba2);
    let main;
    if (best === P.probaN && P.probaN >= 0.3) main = `<span class="badge">⚖ Duel équilibré</span>`;
    else if (Math.abs(P.proba1 - P.proba2) < 0.08) main = `<span class="badge">⚖ Duel serré</span>`;
    else { const fav = P.proba1 > P.proba2 ? D : E, strong = Math.max(P.proba1, P.proba2) >= 0.55; main = `<span class="badge ${P.proba1 > P.proba2 ? "b1" : "b2"}">${crest(fav, "crest crest-xxs")}${strong ? "Grand favori" : "Favori"}</span>`; }
    let goals = "";
    if (P.probaOver25 >= 0.6) goals = `<span class="badge">⚽ Match ouvert · +2,5 ${pct(P.probaOver25)}%</span>`;
    else if (P.probaUnder25 >= 0.6) goals = `<span class="badge">🔒 Match fermé · −2,5 ${pct(P.probaUnder25)}%</span>`;
    else if (P.probaBTTS >= 0.6) goals = `<span class="badge">⚽ Les deux marquent ${pct(P.probaBTTS)}%</span>`;
    return main + goals;
  }

  function setTab(name) {
    document.querySelectorAll("[data-tab]").forEach((a) => (a.dataset.tab === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  }

  function errorBox(msg, retry) {
    view.innerHTML = `<div class="error" role="alert">Impossible de charger les données pour le moment.<br><small>${esc(msg)}</small><br><button type="button" id="retry">Réessayer</button></div>`;
    document.getElementById("retry").onclick = retry;
  }

  // ---------- Compétitions ----------
  let leagues = null;
  async function getLeagues() {
    if (leagues) return leagues;
    try {
      const d = await api("/leagues", 300000);
      leagues = d.competitions.filter((c) => c.matchsAVenir === null || c.matchsAVenir > 0);
    } catch {
      leagues = [{ id: 61, nom: "Ligue 1", pays: "France" }];
    }
    leagues.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    return leagues;
  }
  // Puces compétitions : le logo officiel ; le nom s'affiche seulement si l'image ne charge pas
  const chip = (l, current) => {
    const name = `<span class="chip-name">${esc(l.nom)}</span>`;
    return `<button type="button" class="chip${l.logo ? " chip-logo" : ""}" data-league="${l.id}" aria-pressed="${l.id === current}" aria-label="${esc(l.nom)}" title="${esc(l.nom)}">${l.logo ? `<img src="${esc(l.logo)}" alt="" width="40" height="40" data-fallback="${esc(name)}">` : name}</button>`;
  };
  const chips = (list, current, extra = "", cls = "") => `<div class="chips${cls}" role="group" aria-label="Compétitions">${extra}${list.map((l) => chip(l, current)).join("")}</div>`;
  // Colonne des compétitions à gauche (défile de haut en bas, reste visible pendant la lecture)
  let railScroll = 0;
  const rail = (list, current, extra, main) => `<div class="with-rail">${chips(list, current, extra, " rail")}<div class="rail-main">${main}</div></div>`;
  function bindRail(onPick) {
    const el = view.querySelector(".rail");
    el.scrollTop = railScroll;
    const on = el.querySelector('[aria-pressed="true"]');
    if (on && (on.offsetTop < el.scrollTop || on.offsetTop + on.offsetHeight > el.scrollTop + el.clientHeight)) el.scrollTop = on.offsetTop - el.clientHeight / 2;
    el.querySelectorAll(".chip").forEach((b) => (b.onclick = () => { railScroll = el.scrollTop; onPick(b.dataset.league); }));
  }

  // ---------- Écran Duels ----------
  let duelDay = "all"; // jour choisi dans le calendrier
  async function renderDuels() {
    setTab("duels");
    // Colonne de gauche : seulement les compétitions qui ont au moins un match à venir
    const every = await getLeagues();
    const withMatch = every.filter((l) => l.matchsAVenir > 0);
    const list = withMatch.length ? withMatch : every;
    let current = Number(store.get("league")) || 61;
    if (!list.some((l) => l.id === current)) current = list[0]?.id || 61;
    const league = list.find((l) => l.id === current) || { nom: "Ligue 1" };

    view.innerHTML = rail(list, current, "", `
      <section class="hero hero-logo">
        <div>
          <p class="kicker">${esc(league.nom)}${league.pays ? " · " + esc(league.pays) : ""}</p>
          <h1>Choisis ton camp.</h1>
          <p>Les probabilités de chaque match. Touche ton camp pour jouer dans l'Arène.</p>
        </div>
        <img src="duelprono-logo.webp" alt="" width="112" height="112">
      </section>
      <div class="days" id="days" role="group" aria-label="Choisir un jour" hidden></div>
      <div class="list" id="duels"><div class="skel"></div><div class="skel"></div></div>`);

    bindRail((id) => { store.set("league", id); duelDay = "all"; renderDuels(); });

    const box = document.getElementById("duels");
    try {
      const [data, mine] = await Promise.all([api(`/league-predictions?leagueId=${current}`), getMe()]);
      const preds = (data.predictions || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
      if (!preds.length) {
        box.innerHTML = data.enPreparation
          ? `<div class="empty">Les données de cette compétition sont en cours de préparation. Reviens dans quelques minutes.</div>`
          : `<div class="empty">Aucun duel programmé pour le moment dans cette compétition.</div>`;
        return;
      }
      // Calendrier : un bouton par jour de match (affiché dès qu'il y a au moins deux jours)
      const keyOf = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
      const counts = new Map();
      for (const p of preds) counts.set(keyOf(p.date), (counts.get(keyOf(p.date)) || 0) + 1);
      if (!counts.has(duelDay)) duelDay = "all";
      const today = keyOf(Date.now());
      const strip = document.getElementById("days");
      const paint = () => {
        strip.hidden = counts.size < 2;
        strip.innerHTML = `<button type="button" class="day-btn" data-day="all" aria-pressed="${duelDay === "all"}"><span>À venir</span><b>${preds.length}</b><i>matchs</i></button>` + [...counts].map(([k, n]) => {
          const d = new Date(k + "T12:00:00");
          return `<button type="button" class="day-btn" data-day="${k}" aria-pressed="${duelDay === k}" aria-label="${esc(fmtDay(d))}, ${n} match${n > 1 ? "s" : ""}"><span>${k === today ? "Auj." : esc(d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", ""))}</span><b>${d.getDate()}</b><i>${n} match${n > 1 ? "s" : ""}</i></button>`;
        }).join("");
        strip.querySelectorAll(".day-btn").forEach((b) => (b.onclick = () => { duelDay = b.dataset.day; paint(); }));
        const on = strip.querySelector('[aria-pressed="true"]');
        if (on) strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + on.offsetWidth / 2;
        let lastDay = "";
        box.innerHTML = preds.filter((p) => duelDay === "all" || keyOf(p.date) === duelDay).map((p) => {
        const day = fmtDay(p.date);
        const head = day !== lastDay ? `<h2 class="day">${esc(day)}</h2>` : "";
        lastDay = day;
        const P = p.poisson, D = p.teams.domicile, E = p.teams.exterieur;
        const status = isLive(p.status) ? `<span class="live">En direct</span>` : `<span class="tag">Fiabilité ${esc(p.donnees?.fiabilite || "—")}</span>`;
        const href = `#/duel/${current}/${encodeURIComponent(p.matchId)}`;
        return `${head}
          <article class="duel">
            <a class="duel-link" href="${href}" aria-label="${esc(D.name)} contre ${esc(E.name)}, voir l'analyse">
              <div class="duel-top"><span class="time">${esc(fmtTime(p.date))}</span>${status}</div>
              <div class="teams">
                <div class="team">${crest(D)}<b>${esc(D.name)}</b></div>
                <span class="vs">VS</span>
                <div class="team">${crest(E)}<b>${esc(E.name)}</b></div>
              </div>
            </a>
            ${picks(p, current, myPick(mine, current, p.matchId))}
            <div class="bar" aria-hidden="true"><span style="width:${pct(P.proba1)}%"></span><span style="width:${pct(P.probaN)}%"></span><span style="width:${pct(P.proba2)}%"></span></div>
            <div class="badges">${badges(p)}</div>
            <a class="more" href="${href}">Voir l'analyse complète
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a>
          </article>`;
        }).join("");
      };
      paint();
    } catch (e) {
      box.innerHTML = `<div class="error" role="alert">Cette compétition est momentanément indisponible.<br><small>Choisis-en une autre ci-dessus, ou réessaie dans quelques minutes.</small><br><button type="button" id="retry">Réessayer</button></div>`;
      document.getElementById("retry").onclick = () => { cache.clear(); renderDuels(); };
    }
  }

  // ---------- Écran Analyse ----------
  const ICON = {
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4"/>',
    split: '<path d="M12 3v18M3 12h6M15 12h6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  };
  const ico = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  const mini = (t) => crest(t, "crest crest-xs");
  // Paire de pourcentages avec logos : barre partagée en deux
  const pair = (a, ta, b, tb) => `<div class="pair"><span class="pair-side">${mini(ta)}<b class="c1">${pct(a)}%</b></span>
      <div class="pair-bar" aria-hidden="true"><span style="width:${pct(a)}%"></span><span style="width:${pct(b)}%"></span></div>
      <span class="pair-side"><b class="c2">${pct(b)}%</b>${mini(tb)}</span></div>`;
  // Barre de comparaison de statistiques
  const cmp = (label, a, b, fmt = (x) => x, lowerIsBetter = false) => {
    // Barre : la plus longue revient toujours à la meilleure équipe (pour le classement, le plus petit chiffre)
    const va = lowerIsBetter ? 1 / Math.max(0.5, Number(a) || 0.5) : Number(a) || 0;
    const vb = lowerIsBetter ? 1 / Math.max(0.5, Number(b) || 0.5) : Number(b) || 0;
    const wa = Math.round((100 * va) / (va + vb || 1));
    const better = lowerIsBetter ? (a < b ? "a" : a > b ? "b" : "") : (a > b ? "a" : a < b ? "b" : "");
    return `<div class="cmp"><div class="cmp-h"><b class="${better === "a" ? "c1" : ""}">${esc(fmt(a))}</b><span>${esc(label)}</span><b class="${better === "b" ? "c2" : ""}">${esc(fmt(b))}</b></div>
      <div class="cmp-bar" aria-hidden="true"><span style="width:${wa}%"></span><span style="width:${100 - wa}%"></span></div></div>`;
  };
  const tile = (label, value, icon) => `<div class="cell">${icon ? ico(icon) : ""}<small>${esc(label)}</small><b>${value}</b></div>`;

  function scoreGrid(P, D, E) {
    const M = P.matrix || [];
    const max = Math.max(...M.slice(0, 5).flatMap((r) => r.slice(0, 5)));
    let html = `<div class="sgrid" role="table" aria-label="Probabilité de chaque score"><span class="sg-corner">${mini(D)}${mini(E)}</span>`;
    for (let j = 0; j < 5; j++) html += `<span class="sg-h">${j}</span>`;
    for (let i = 0; i < 5; i++) {
      html += `<span class="sg-h">${i}</span>`;
      for (let j = 0; j < 5; j++) {
        const v = M[i]?.[j] || 0, a = max ? v / max : 0;
        const col = i > j ? "255,107,0" : i < j ? "33,150,243" : "255,193,7";
        html += `<span class="sg-c" style="background:rgba(${col},${(0.08 + 0.82 * a).toFixed(2)});color:${a > 0.55 ? "#121212" : "var(--text)"}" title="${i}-${j}">${pct(v)}%</span>`;
      }
    }
    return html + `</div>`;
  }

  // Terrain : profondeur et côté déduits du poste ESPN (méthode PronostiK)
  function pitch(cD, cE) {
    const depth = (q) => { const x = String(q || "").toUpperCase(); if (x === "G" || x === "GK") return 0; if (/WB$/.test(x)) return 1.5; if (/^(CD|SW)|B$|^CB/.test(x)) return 1; if (/^DM|^CDM/.test(x)) return 2; if (/^AM|^CAM/.test(x)) return 4; if (/M/.test(x)) return 3; if (/W$/.test(x)) return 4.5; return 5; };
    const lat = (q) => { const x = String(q || "").toUpperCase(); if (/-L$/.test(x)) return -1; if (/-R$/.test(x)) return 1; if (/^L/.test(x)) return -2; if (/^R/.test(x)) return 2; return 0; };
    const last = (n) => String(n).replace(/^[A-ZÀ-Ý]\.\s*/, "");
    const half = (c, top, cls) => {
      if (!c) return "";
      const pl = c.xi.map(([n, nom, q], i) => ({ n, nom, d: depth(q), s: lat(q), i })).sort((a, b) => a.d - b.d || a.i - b.i);
      const gk = pl.filter((x) => x.d === 0).slice(0, 1), rest = pl.filter((x) => !gk.includes(x));
      let counts = String(c.f || "").split("-").map(Number).filter((v) => v > 0);
      if (counts.reduce((a, b) => a + b, 0) !== rest.length) { const g = {}; rest.forEach((x) => (g[x.d] = (g[x.d] || 0) + 1)); counts = Object.keys(g).sort((a, b) => a - b).map((k) => g[k]); }
      const lines = [gk]; let k = 0; for (const n of counts) { lines.push(rest.slice(k, k + n)); k += n; }
      const L = lines.length;
      return lines.map((line, li) => {
        const dy = li === 0 ? 4.5 : 14 + (li - 1) * (29 / Math.max(1, L - 2)), y = top ? dy : 100 - dy;
        return line.sort((a, b) => (top ? b.s - a.s : a.s - b.s)).map((x, j) => `<span class="pl ${cls}" style="left:${((100 * (j + 1)) / (line.length + 1)).toFixed(1)}%;top:${y.toFixed(1)}%"><span class="pl-n">${esc(x.n)}</span><span class="pl-name">${esc(last(x.nom))}</span></span>`).join("");
      }).join("");
    };
    return `<div class="pitch"><div class="pt-box t"></div><div class="pt-box b"></div><div class="pt-mid"></div><div class="pt-circle"></div>${half(cD, true, "home")}${half(cE, false, "away")}</div>`;
  }

  async function renderDuel(leagueId, matchId) {
    setTab("duels");
    view.innerHTML = `<div class="list"><div class="skel"></div><div class="skel"></div></div>`;
    let data, mine;
    try { [data, mine] = await Promise.all([api(`/league-predictions?leagueId=${leagueId}`), getMe()]); } catch (e) { return errorBox(e.message, () => renderDuel(leagueId, matchId)); }
    const p = (data.predictions || []).find((x) => String(x.matchId) === String(matchId));
    const list = await getLeagues();
    const lg = list.find((l) => l.id === Number(leagueId));
    if (!p) {
      view.innerHTML = `<div class="empty">Ce duel n'est plus à l'affiche (il est peut-être terminé : regarde le Verdict).<br><button type="button" onclick="location.hash='#/'">Retour aux duels</button></div>`;
      return;
    }
    const P = p.poisson, D = p.teams.domicile, E = p.teams.exterieur;
    const isNat = Number(leagueId) === 5;

    const marches = `
      <section class="panel">
        <h2>${ico("trophy")}Résultat</h2>
        <div class="probs probs-lg">
          <div>${mini(D)}<b class="c1">${pct(P.proba1)}%</b></div>
          <div><span class="nul-ico" aria-hidden="true">=</span><b class="cN">${pct(P.probaN)}%</b></div>
          <div>${mini(E)}<b class="c2">${pct(P.proba2)}%</b></div>
        </div>
        <div class="bar" aria-hidden="true" style="height:8px"><span style="width:${pct(P.proba1)}%"></span><span style="width:${pct(P.probaN)}%"></span><span style="width:${pct(P.proba2)}%"></span></div>
        <div class="badges">${badges(p)}</div>
      </section>
      <section class="panel">
        <h2>${ico("split")}Double chance</h2>
        <div class="grid3">${tile("1X", pct(P.proba1X) + "%")}${tile("X2", pct(P.probaX2) + "%")}${tile("12", pct(P.proba12) + "%")}</div>
        <h3>${ico("shield")}Vainqueur, hors match nul</h3>${pair(P.rembourseSiNul?.dom, D, P.rembourseSiNul?.ext, E)}
        <h3>${ico("clock")}Mi-temps</h3>
        <div class="probs">
          <div>${mini(D)}<b class="c1">${pct(P.miTemps?.proba1)}%</b></div>
          <div><span class="nul-ico" aria-hidden="true">=</span><b class="cN">${pct(P.miTemps?.probaN)}%</b></div>
          <div>${mini(E)}<b class="c2">${pct(P.miTemps?.proba2)}%</b></div>
        </div>
      </section>
      <section class="panel">
        <h2>${ico("ball")}Buts</h2>
        <div class="grid2">${tile("Buts attendus", `${dec(p.lambdas.lambdaDom)} – ${dec(p.lambdas.lambdaExt)}`, "target")}${tile("Total attendu", dec(p.lambdas.lambdaDom + p.lambdas.lambdaExt), "ball")}</div>
        <div class="grid3">${tile("+1,5", pct(P.probaOver15) + "%")}${tile("+2,5", pct(P.probaOver25) + "%")}${tile("+3,5", pct(P.probaOver35) + "%")}</div>
        <h3>Les deux équipes marquent</h3>
        <div class="pair"><span class="pair-side"><b class="c1">Oui ${pct(P.probaBTTS)}%</b></span><div class="pair-bar" aria-hidden="true"><span style="width:${pct(P.probaBTTS)}%"></span><span style="width:${pct(P.probaNoBTTS)}%"></span></div><span class="pair-side"><b class="c2">Non ${pct(P.probaNoBTTS)}%</b></span></div>
        <h3>Buts par équipe</h3>
        <div class="teamgoals">
          <div>${mini(D)}<span><small>+0,5</small><b>${pct(P.butsDomicile?.plus05)}%</b></span><span><small>+1,5</small><b>${pct(P.butsDomicile?.plus15)}%</b></span></div>
          <div>${mini(E)}<span><small>+0,5</small><b>${pct(P.butsExterieur?.plus05)}%</b></span><span><small>+1,5</small><b>${pct(P.butsExterieur?.plus15)}%</b></span></div>
        </div>
      </section>
      <section class="panel">
        <h2>${ico("bolt")}Victoire et plus</h2>
        <div class="vrows">
          <div class="vrow"><span>Victoire sans encaisser</span>${mini(D)}<b class="c1">${pct(P.victoireSansEncaisser?.dom)}%</b>${mini(E)}<b class="c2">${pct(P.victoireSansEncaisser?.ext)}%</b></div>
          <div class="vrow"><span>Victoire + les deux marquent</span>${mini(D)}<b class="c1">${pct(P.victoireEtBTTS?.dom)}%</b>${mini(E)}<b class="c2">${pct(P.victoireEtBTTS?.ext)}%</b></div>
          <div class="vrow"><span>Victoire par 2 buts ou +</span>${mini(D)}<b class="c1">${pct(P.victoireDe2ButsOuPlus?.dom)}%</b>${mini(E)}<b class="c2">${pct(P.victoireDe2ButsOuPlus?.ext)}%</b></div>
        </div>
      </section>
      <section class="panel">
        <h2>${ico("grid")}Scores exacts</h2>
        <div class="topscores">${(P.scoresExacts || []).slice(0, 3).map((x, i) => `<span class="ts${i === 0 ? " best" : ""}"><b>${x.dom} – ${x.ext}</b><small>${pct(x.proba)}%</small></span>`).join("")}</div>
        ${scoreGrid(P, D, E)}
        <p class="note">Fiabilité ${esc(p.donnees?.fiabilite || "—")} · ${esc(p.donnees?.matchsDomicile ?? "—")} et ${esc(p.donnees?.matchsExterieur ?? "—")} matchs analysés</p>
      </section>`;

    const formRow = (t) => {
      const s = t.stats;
      if (!s) return `<div class="form-team"><div class="form-head">${mini(t)}<b>${esc(t.name)}</b></div><p class="note">Pas encore de match joué cette saison.</p></div>`;
      return `<div class="form-team"><div class="form-head">${mini(t)}<b>${esc(t.name)}</b>${t.classement ? `<span class="rank">${t.classement.rang}<sup>${t.classement.rang === 1 ? "er" : "e"}</sup> · ${t.classement.points} pts</span>` : ""}</div>
        <div class="pills">${s.formeDetail.map((f) => `<span class="fpill ${f.r}" title="${esc(f.domicile ? "Contre " : "À ")}${esc(f.adversaire)} : ${esc(f.score)}">${crest({ name: f.adversaire, logo: f.logo }, "crest crest-xs")}<em>${esc(f.score.replace("-", "–"))}</em></span>`).join("")}</div></div>`;
    };
    const SD = D.stats, SE = E.stats;
    const stats = `
      <section class="panel">
        <h2>${ico("bolt")}Forme · 5 derniers matchs</h2>
        ${formRow(D)}${formRow(E)}
        <div class="legend"><span class="lg V"></span>Victoire<span class="lg N"></span>Nul<span class="lg D"></span>Défaite</div>
      </section>
      ${SD && SE ? `<section class="panel">
        <h2>${ico("target")}Face à face des stats</h2>
        <div class="cmp-teams">${mini(D)}<span>Saison</span>${mini(E)}</div>
        ${D.classement && E.classement ? cmp("Classement", D.classement.rang, E.classement.rang, (x) => x + (x === 1 ? "er" : "e"), true) : ""}
        ${cmp("Elo", D.elo, E.elo)}
        ${cmp("Buts marqués / match", SD.butsMarquesParMatch, SE.butsMarquesParMatch, dec)}
        ${cmp("Buts encaissés / match", SD.butsEncaissesParMatch, SE.butsEncaissesParMatch, dec, true)}
        ${cmp("Plus de 2,5 buts", SD.pctOver25, SE.pctOver25, (x) => x + "%")}
        ${cmp("Les deux marquent", SD.pctBTTS, SE.pctBTTS, (x) => x + "%")}
        ${cmp("Sans encaisser", SD.pctCleanSheet, SE.pctCleanSheet, (x) => x + "%")}
        ${SD.domicile && SE.exterieur ? cmp(`Buts marqués (dom. / ext.)`, SD.domicile.butsMarques, SE.exterieur.butsMarques, dec) : ""}
      </section>` : ""}`;

    const tabsDef = [["m", "Probas"], ["s", "Stats"], ...(isNat ? [] : [["c", "Compos"]]), ["h", "Face-à-face"]];
    view.innerHTML = `
      <div class="back"><a href="#/" aria-label="Retour aux duels"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></a><span>${esc(lg?.nom || "")}</span></div>
      <section class="match-hero">
        <div class="team">${crest(D, "crest crest-lg")}<b>${esc(D.name)}</b><small>${D.classement ? `${D.classement.rang}${D.classement.rang === 1 ? "er" : "e"} · ` : ""}Elo ${esc(D.elo)}</small></div>
        <div class="kickoff">${isLive(p.status) ? `<span class="live">En direct</span>` : `<strong>${esc(fmtTime(p.date))}</strong>`}<span>${esc(fmtDay(p.date))}</span></div>
        <div class="team">${crest(E, "crest crest-lg")}<b>${esc(E.name)}</b><small>${E.classement ? `${E.classement.rang}${E.classement.rang === 1 ? "er" : "e"} · ` : ""}Elo ${esc(E.elo)}</small></div>
      </section>
      <section class="panel">
        <h2>${ico("target")}Ton prono</h2>
        ${picks(p, Number(leagueId), myPick(mine, leagueId, p.matchId))}
        <p class="note">${isLive(p.status) || Date.parse(p.date) <= Date.now() ? "Coup d'envoi donné : les pronos sont bloqués." : "Modifiable jusqu'au coup d'envoi. Ton prono compte pour le classement de l'Arène."}</p>
      </section>
      <div class="tabs" role="tablist" aria-label="Sections de l'analyse" style="grid-template-columns:repeat(${tabsDef.length},minmax(0,1fr))">
        ${tabsDef.map(([k, l], i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-pane="${k}">${l}</button>`).join("")}
      </div>
      <div data-panel="m">${marches}</div>
      <div data-panel="s" hidden>${stats}</div>
      <div data-panel="c" hidden><section class="panel"><h2>${ico("grid")}Compositions</h2><div id="compos"><p class="note">Chargement…</p></div></section></div>
      <div data-panel="h" hidden><section class="panel"><h2>${ico("trophy")}Derniers duels</h2><div id="h2h"><p class="note">Chargement…</p></div></section></div>`;

    view.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
      view.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      view.querySelectorAll("[data-panel]").forEach((s) => (s.hidden = s.dataset.panel !== b.dataset.pane));
    }));

    try {
      const md = await api(`/match-details?matchId=${encodeURIComponent(p.matchId)}&source=${encodeURIComponent(p.source)}&teamDomId=${encodeURIComponent(D.id)}&teamExtId=${encodeURIComponent(E.id)}&leagueId=${leagueId}`, 300000);
      const h = md.h2h || [];
      document.getElementById("h2h").innerHTML = h.length
        ? h.map((m) => {
            const homeT = m.lieu === "domicile" ? D : E, awayT = m.lieu === "domicile" ? E : D;
            const cls = m.vainqueur === "domicile" ? "c1" : m.vainqueur === "exterieur" ? "c2" : "cN";
            return `<div class="h2h"><small>${esc(fmtShort(m.date))}</small><span class="h2h-t">${mini(homeT)}<b class="${cls}">${esc(m.butsDomicile)} – ${esc(m.butsExterieur)}</b>${mini(awayT)}</span><em class="${cls}">${m.vainqueur === "nul" ? "Nul" : esc((m.vainqueur === "domicile" ? D : E).name)}</em></div>`;
          }).join("")
        : `<p class="note">Aucune confrontation récente entre ces deux équipes.</p>`;
      const cp = md.compositions || {};
      const fmtLast = (c) => (c ? `${esc(new Date(c.ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }))} · ${c.side === "D" ? "contre" : "à"} ${esc(c.opp || "—")} · ${esc(String(c.score).replace("-", " – "))}` : "Composition non disponible");
      document.getElementById("compos").innerHTML = cp.domicile || cp.exterieur
        ? `<div class="xi-h">${mini(D)}<b>${esc(D.name)}</b>${cp.domicile?.f ? `<span class="xi-f home">${esc(cp.domicile.f)}</span>` : ""}</div><small class="xi-last">${fmtLast(cp.domicile)}</small>
           ${pitch(cp.domicile, cp.exterieur)}
           <div class="xi-h">${mini(E)}<b>${esc(E.name)}</b>${cp.exterieur?.f ? `<span class="xi-f away">${esc(cp.exterieur.f)}</span>` : ""}</div><small class="xi-last">${fmtLast(cp.exterieur)}</small>
           <p class="note">Onze aligné au dernier match. La composition officielle est publiée environ 1 h avant le coup d'envoi.</p>`
        : `<p class="note">Compositions bientôt disponibles pour ce match.</p>`;
    } catch {
      document.getElementById("h2h").innerHTML = `<p class="note">Face-à-face indisponible pour le moment.</p>`;
      document.getElementById("compos").innerHTML = `<p class="note">Compositions indisponibles pour le moment.</p>`;
    }
  }

  // ---------- Écran Verdict ----------
  async function renderVerdict() {
    setTab("verdict");
    const list = await getLeagues();
    const sel = store.get("verdictLeague") || "all";
    const all = `<button type="button" class="chip chip-all" data-league="all" aria-pressed="${sel === "all"}" aria-label="Toutes les compétitions">Tout</button>`;
    view.innerHTML = rail(list, Number(sel), all, `
      <section class="hero">
        <p class="kicker">Transparence totale</p>
        <h1>Le Verdict</h1>
        <p>Les résultats tombent. Le moteur avait-il vu juste ?</p>
      </section>
      <div id="verdict"><div class="list"><div class="skel"></div></div></div>`);
    bindRail((id) => { store.set("verdictLeague", id); renderVerdict(); });

    const box = document.getElementById("verdict");
    try {
      const v = await api(`/verdict?leagueId=${sel}&days=30`, 120000);
      const B = v.bilan;
      const bilan = `<section class="panel">
          <h2>Bilan du moteur · 30 derniers jours</h2>
          ${B.matchs ? `<div class="probs probs-lg">
            <div><b class="c1">${B["1N2"]}%</b><small>1N2 justes</small></div>
            <div><b>${B.doubleChance}%</b><small>doubles chances</small></div>
            <div><b>${B.plusMoins25}%</b><small>+/- 2,5 buts</small></div>
          </div>` : ""}
          <p class="note">${B.matchs ? `Calculé sur ${B.matchs} match${B.matchs > 1 ? "s" : ""}.` : "Pas encore de match terminé sur la période."} Chaque pronostic est figé avant le coup d'envoi : rien n'est modifié après coup.</p>
        </section>`;
      if (!v.matchs.length) {
        box.innerHTML = bilan + `<div class="empty">Le Verdict se remplit au fil des matchs : chaque pronostic est enregistré avant le coup d'envoi, puis comparé au score final.</div>`;
        return;
      }
      let lastDay = "";
      const items = v.matchs.map((m) => {
        const day = fmtDay(m.date);
        const head = day !== lastDay ? `<h2 class="day">${esc(day)}</h2>` : "";
        lastDay = day;
        const name = m.moteur.prono === "1" ? m.domicile.nom : m.moteur.prono === "2" ? m.exterieur.nom : "Nul";
        const ok = m.juste["1N2"];
        return `${head}<article class="res">
          <div class="teams">
            <div class="team">${crest({ name: m.domicile.nom, logo: m.domicile.logo })}<b>${esc(m.domicile.nom)}</b></div>
            <span class="score-big">${m.score.dom} – ${m.score.ext}</span>
            <div class="team">${crest({ name: m.exterieur.nom, logo: m.exterieur.logo })}<b>${esc(m.exterieur.nom)}</b></div>
          </div>
          <div class="res-line">
            <span>Moteur : <b>${esc(name)}</b> <span class="muted">(${pct(m.moteur.proba)} %)</span>${sel === "all" ? ` <span class="muted">· ${esc(m.competition)}</span>` : ""}</span>
            ${ok ? `<span class="ok"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>Vu juste</span>` : `<span class="ko"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>Raté</span>`}
          </div>
        </article>`;
      }).join("");
      box.innerHTML = bilan + `<div class="list">${items}</div>`;
    } catch (e) {
      box.innerHTML = `<div class="error" role="alert">Verdict indisponible pour le moment.<br><small>${esc(e.message)}</small></div>`;
    }
  }

  // ---------- Écran Arène (classement de la semaine) ----------
  const avatar = (pseudo, cls = "") => `<span class="avatar ${cls}" style="background:hsl(${hue(pseudo)} 55% 38%)" aria-hidden="true">${esc(String(pseudo || "?")[0].toUpperCase())}</span>`;
  const dMonth = (iso, withMonth) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", withMonth ? { day: "numeric", month: "long" } : { day: "numeric" });
  const weekLabel = (w) => `Du ${dMonth(w.debut, w.debut.slice(5, 7) !== w.fin.slice(5, 7))} au ${dMonth(w.fin, true)}`;

  function pickLine(x) {
    const label = x.choix === "N" ? "Nul" : x.choix === "1" ? x.domicile.nom : x.exterieur.nom;
    const state = x.points == null ? `<span class="wait">${x.coupEnvoi > Date.now() ? x.mise + " pts en jeu" : "En attente"}</span>`
      : x.points > 0 ? `<span class="ok"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>+${x.points}</span>`
      : `<span class="ko"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>0</span>`;
    return `<div class="mp"><span class="mp-teams">${crest({ name: x.domicile.nom, logo: x.domicile.logo }, "crest crest-xs")}${x.score ? `<b>${esc(String(x.score).replace("-", " – "))}</b>` : `<small>${esc(fmtTime(x.coupEnvoi))}</small>`}${crest({ name: x.exterieur.nom, logo: x.exterieur.logo }, "crest crest-xs")}</span>
      <span class="mp-pick"><small>${esc(fmtDay(x.coupEnvoi))}</small><b>${esc(label)}</b></span>${state}</div>`;
  }
  const fan = (r) => (r.club ? crest({ name: r.club.nom, logo: r.club.logo }, "crest crest-xxs fan") : "");
  let arenaWeek = "courante";
  async function renderArena() {
    setTab("arene");
    const which = arenaWeek;
    view.innerHTML = `
      <section class="hero">
        <p class="kicker">Classement de la semaine</p>
        <h1>L'Arène</h1>
        <p>Chaque bon prono rapporte des points. Remise à zéro tous les lundis.</p>
      </section>
      <div class="chips" role="group" aria-label="Semaine">
        <button type="button" class="chip" data-week="courante" aria-pressed="${which === "courante"}">Cette semaine</button>
        <button type="button" class="chip" data-week="precedente" aria-pressed="${which === "precedente"}">Semaine dernière</button>
      </div>
      <div id="arena"><div class="list"><div class="skel"></div></div></div>`;
    view.querySelectorAll(".chip").forEach((b) => (b.onclick = () => { arenaWeek = b.dataset.week === "precedente" ? "precedente" : "courante"; renderArena(); }));

    const box = document.getElementById("arena");
    try {
      const [board, me] = await Promise.all([api(`/arena${which === "precedente" ? "?semaine=precedente" : ""}`, 30000), getMe()]);
      const rows = board.classement;
      const inBoard = session.token ? rows.find((r) => r.pseudo === session.pseudo) : null;
      const mine = which === "courante" && me ? { ...me.semaine } : inBoard ? { points: inBoard.points, justes: inBoard.justes, joues: inBoard.joues, attente: inBoard.attente, rang: inBoard.rang } : null;

      let top;
      if (!session.token) {
        top = `<section class="panel cta-panel">
            <h2>${ico("trophy")}Entre dans l'arène</h2>
            <p class="note">Gratuit, pour le fun. Un pseudo suffit pour figurer au classement.</p>
            <a class="cta" href="#/compte">Créer mon compte</a>
          </section>`;
      } else if (mine && mine.joues) {
        top = `<section class="panel">
            <h2>${ico("target")}${which === "courante" ? "Ma semaine" : "Ma semaine dernière"}</h2>
            <div class="grid3">${tile("Rang", mine.rang ? `${mine.rang}<sup>${mine.rang === 1 ? "er" : "e"}</sup>` : "—")}${tile("Points", mine.points)}${tile("Pronos justes", `${mine.justes}/${mine.joues - mine.attente}`)}</div>
            ${mine.attente ? `<p class="note">${mine.attente} prono${mine.attente > 1 ? "s" : ""} en attente du résultat.</p>` : ""}
          </section>`;
      } else {
        top = which === "courante"
          ? (me && me.pronos.some((x) => x.points == null)
            ? `<section class="panel cta-panel"><h2>${ico("target")}Ma semaine</h2><p class="note">Aucun de tes pronos ne porte sur un match de cette semaine. Chaque prono compte pour la semaine où le match se joue.</p><a class="cta" href="#/compte">Voir mes pronos</a></section>`
            : `<section class="panel cta-panel"><h2>${ico("target")}Ma semaine</h2><p class="note">Tu n'as pas encore pronostiqué cette semaine.</p><a class="cta" href="#/">Voir les duels</a></section>`)
          : "";
      }

      const place = (r, cls) => `<div class="pod ${cls}${inBoard === r ? " me" : ""}">${avatar(r.pseudo, "avatar-lg")}<b>${esc(r.pseudo)}${fan(r)}</b><span class="pod-pts">${r.points} pts</span><span class="pod-step">${r.rang}</span></div>`;
      const line = (r) => `<div class="rk${inBoard === r ? " me" : ""}"><span class="rk-n">${r.rang}</span>${avatar(r.pseudo)}<span class="rk-name"><b>${esc(r.pseudo)}${fan(r)}</b><small>${r.justes} juste${r.justes > 1 ? "s" : ""} sur ${r.joues - r.attente}${r.attente ? ` · ${r.attente} en attente` : ""}</small></span><b class="rk-pts">${r.points}<small> pts</small></b></div>`;
      let ranking;
      if (!rows.length) {
        ranking = `<div class="empty board">${which === "courante" ? "Personne n'a encore pronostiqué cette semaine. Prends la première place !" : "Aucun pronostic la semaine dernière."}</div>`;
      } else {
        const podium = rows.length >= 3 ? `<div class="podium">${place(rows[1], "p2")}${place(rows[0], "p1")}${place(rows[2], "p3")}</div>` : "";
        const rest = rows.length >= 3 ? rows.slice(3) : rows;
        ranking = `<section class="panel board">
            <h2>${ico("trophy")}${esc(weekLabel(board.semaine))}</h2>
            ${podium}
            ${rest.length ? `<div class="rks">${rest.map(line).join("")}</div>` : ""}
            <p class="note">${board.joueurs} joueur${board.joueurs > 1 ? "s" : ""} dans l'arène${board.joueurs > rows.length ? ` · ${rows.length} premiers affichés` : ""}.</p>
          </section>`;
      }

      const rules = `<section class="panel">
          <h2>${ico("bolt")}Comment ça marche</h2>
          <div class="grid2">
            <div class="cell">${ico("target")}<small>1 · Choisis</small><b class="rule">Victoire, nul ou victoire</b></div>
            <div class="cell">${ico("clock")}<small>2 · Avant le match</small><b class="rule">Bloqué au coup d'envoi</b></div>
            <div class="cell">${ico("bolt")}<small>3 · Le risque paie</small><b class="rule">Favori 10 pts, surprise jusqu'à 100</b></div>
            <div class="cell">${ico("trophy")}<small>4 · Chaque lundi</small><b class="rule">Nouveau classement</b></div>
          </div>
        </section>`;

      let myList = "";
      const weekPicks = me ? me.pronos.filter((x) => x.semaine === board.semaine.cle).sort((a, b) => a.coupEnvoi - b.coupEnvoi) : [];
      if (weekPicks.length) {
        myList = `<section class="panel">
            <h2>${ico("grid")}Mes pronos</h2>
            <div class="rks">${weekPicks.map(pickLine).join("")}</div>
          </section>`;
      }
      box.innerHTML = top + ranking + myList + rules;
    } catch (e) {
      box.innerHTML = `<div class="error" role="alert">L'Arène est indisponible pour le moment.<br><small>${esc(e.message)}</small><br><button type="button" id="retry">Réessayer</button></div>`;
      document.getElementById("retry").onclick = () => { cache.clear(); renderArena(); };
    }
  }

  // ---------- Écran Compte ----------
  async function afterAuth(d) {
    setSession(d.token, d.pseudo);
    const pick = pendingPick; pendingPick = null;
    if (pick) { location.hash = "#/"; await sendPick(pick); cache.clear(); route(); }
    else { toast(`Bienvenue dans l'arène, ${d.pseudo} !`); location.hash = "#/arene"; }
  }
  function bindForm(id, path, fields, done) {
    const f = document.getElementById(id);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const err = f.querySelector(".form-err"), btn = f.querySelector("button[type=submit]");
      err.hidden = true; btn.disabled = true;
      try { await done(await call(path, Object.fromEntries(fields.map((k) => [k, f.elements[k].type === "checkbox" ? f.elements[k].checked : f.elements[k].value])))); }
      catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; }
    };
  }
  async function renderCompte() {
    setTab("compte");
    view.dataset.page = session.token ? "espace" : "compte";
    if (!session.token) {
      const mode = store.get("compteMode") === "login" ? "login" : "signup";
      view.innerHTML = `
        <img class="big-logo" src="duelprono-logo.webp" alt="Duel Prono" width="200" height="200">
        <section class="hero">
          <p class="kicker">Gratuit · pour le fun</p>
          <h1>Entre dans l'arène.</h1>
          <p>${pendingPick ? "Ton prono sera enregistré dès que tu es connecté." : "Un compte, et tes pronos comptent au classement."}</p>
        </section>
        <div class="tabs" role="tablist" aria-label="Compte" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <button type="button" role="tab" aria-selected="${mode === "signup"}" data-mode="signup">Créer un compte</button>
          <button type="button" role="tab" aria-selected="${mode === "login"}" data-mode="login">Se connecter</button>
        </div>
        <form class="panel form" id="f-signup" ${mode === "signup" ? "" : "hidden"} novalidate>
          <label>Pseudo<input name="pseudo" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="16" required><small>3 à 16 lettres ou chiffres. Visible au classement.</small></label>
          <label>E-mail<input name="email" type="email" autocomplete="email" inputmode="email" maxlength="120" required><small>Jamais affiché, jamais partagé.</small></label>
          <label>Mot de passe<input name="motDePasse" type="password" autocomplete="new-password" minlength="8" maxlength="72" required><small>8 caractères minimum.</small></label>
          <label class="check"><input name="accepte" type="checkbox" required><span>J'ai 18 ans ou plus et j'accepte les <a href="#/conditions">conditions d'utilisation</a> et la <a href="#/confidentialite">politique de confidentialité</a>.</span></label>
          <p class="form-err" role="alert" hidden></p>
          <button type="submit" class="cta">Créer mon compte</button>
          <p class="note">Jeu gratuit, sans mise ni gain d'argent. Tes données servent uniquement au jeu et tu peux supprimer ton compte à tout moment.</p>
        </form>
        <form class="panel form" id="f-login" ${mode === "login" ? "" : "hidden"} novalidate>
          <label>Pseudo ou e-mail<input name="identifiant" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="120" required></label>
          <label>Mot de passe<input name="motDePasse" type="password" autocomplete="current-password" maxlength="72" required></label>
          <p class="form-err" role="alert" hidden></p>
          <button type="submit" class="cta">Me connecter</button>
        </form>`;
      view.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { store.set("compteMode", b.dataset.mode); renderCompte(); }));
      bindForm("f-signup", "/account/signup", ["pseudo", "email", "motDePasse", "accepte"], afterAuth);
      bindForm("f-login", "/account/login", ["identifiant", "motDePasse"], afterAuth);
      return;
    }
    view.innerHTML = `<div class="list"><div class="skel"></div></div>`;
    const me = await getMe();
    if (!session.token) return renderCompte(); // session expirée entre-temps
    if (!me) return errorBox("Espace personnel indisponible pour le moment.", renderCompte);
    const w = me.semaine, g = me.total, pf = me.profil;
    const upcoming = me.pronos.filter((x) => x.points == null).sort((a, b) => a.coupEnvoi - b.coupEnvoi);
    const done = me.pronos.filter((x) => x.points != null);
    const pending = upcoming.reduce((a, x) => a + x.mise, 0);
    let club = pf.club ? { ...pf.club } : null, clubChoice; // clubChoice : undefined = inchangé, null = retiré, objet = nouveau club
    const rank = (n) => (n ? `${n}<sup>${n === 1 ? "er" : "e"}</sup>` : "—");
    view.innerHTML = `
      <section class="hero me-hero">
        ${avatar(session.pseudo, "avatar-xl")}
        <div><p class="kicker">Mon espace</p><h1>${esc(session.pseudo)}</h1><p id="me-sub"></p></div>
      </section>
      <section class="panel">
        <h2>${ico("target")}Mon bilan</h2>
        <div class="grid3">${tile("Rang semaine", rank(w.rang))}${tile("Points semaine", w.points)}${tile("Points en jeu", pending)}</div>
        <div class="grid3">${tile("Total points", g.points)}${tile("Pronos justes", `${g.justes}/${g.notes}`)}${tile("Réussite", g.notes ? Math.round((100 * g.justes) / g.notes) + "%" : "—")}</div>
        <a class="cta" href="#/arene">Voir le classement</a>
      </section>
      <section class="panel">
        <h2>${ico("grid")}Mes pronos</h2>
        <div class="tabs seg" role="tablist" aria-label="Mes pronos" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <button type="button" role="tab" aria-selected="true" data-list="up">À venir (${upcoming.length})</button>
          <button type="button" role="tab" aria-selected="false" data-list="done">Terminés (${done.length})</button>
        </div>
        <div class="rks" data-plist="up">${upcoming.length ? upcoming.map(pickLine).join("") : `<p class="note">Aucun prono en cours. Choisis ton camp dans les duels.</p>`}</div>
        <div class="rks" data-plist="done" hidden>${done.length ? done.map(pickLine).join("") : `<p class="note">Aucun match terminé pour l'instant.</p>`}</div>
      </section>
      <form class="panel form" id="f-profile" novalidate>
        <h2>${ico("shield")}Mes infos</h2>
        <label>Prénom<input name="prenom" autocomplete="given-name" maxlength="30" value="${esc(pf.prenom || "")}"></label>
        <label>Ville<input name="ville" autocomplete="address-level2" maxlength="40" value="${esc(pf.ville || "")}"></label>
        <div class="field"><span>Club favori</span>
          <div class="club-row"><span id="club-now"></span><button type="button" class="btn btn-sm" id="club-open">Choisir</button><button type="button" class="btn btn-sm" id="club-none">Aucun</button></div>
          <div id="club-picker" hidden></div>
        </div>
        <p class="form-err" role="alert" hidden></p>
        <button type="submit" class="cta">Enregistrer</button>
        <p class="note">Ton prénom et ta ville restent privés. Seul le blason de ton club apparaît au classement.</p>
      </form>
      <section class="panel">
        <h2>${ico("clock")}Mes identifiants</h2>
        <details class="fold"><summary><span>E-mail</span><b id="mail-now">${esc(pf.email)}</b></summary>
          <form class="form" id="f-email" novalidate>
            <label>Nouvel e-mail<input name="email" type="email" autocomplete="email" inputmode="email" maxlength="120" required></label>
            <label>Mot de passe<input name="motDePasse" type="password" autocomplete="current-password" maxlength="72" required></label>
            <p class="form-err" role="alert" hidden></p>
            <button type="submit" class="btn">Changer mon e-mail</button>
          </form>
        </details>
        <details class="fold"><summary><span>Mot de passe</span><b>••••••••</b></summary>
          <form class="form" id="f-password" novalidate>
            <label>Mot de passe actuel<input name="ancien" type="password" autocomplete="current-password" maxlength="72" required></label>
            <label>Nouveau mot de passe<input name="nouveau" type="password" autocomplete="new-password" minlength="8" maxlength="72" required><small>8 caractères minimum.</small></label>
            <p class="form-err" role="alert" hidden></p>
            <button type="submit" class="btn">Changer mon mot de passe</button>
          </form>
        </details>
      </section>
      <section class="panel">
        <button type="button" class="btn" id="logout">Me déconnecter</button>
        <details class="danger">
          <summary>Supprimer mon compte</summary>
          <form class="form" id="f-delete" novalidate>
            <p class="note">Ton compte et tous tes pronostics seront effacés définitivement.</p>
            <label>Mot de passe<input name="motDePasse" type="password" autocomplete="current-password" maxlength="72" required></label>
            <p class="form-err" role="alert" hidden></p>
            <button type="submit" class="btn btn-danger">Supprimer définitivement</button>
          </form>
        </details>
      </section>`;

    const paintClub = () => {
      document.getElementById("club-now").innerHTML = club ? `${crest({ name: club.nom, logo: club.logo }, "crest crest-xs")}<b>${esc(club.nom)}</b>` : `<span class="muted">Aucun club choisi</span>`;
      document.getElementById("club-none").hidden = !club;
      document.getElementById("me-sub").innerHTML = club ? `${crest({ name: club.nom, logo: club.logo }, "crest crest-xxs")}${esc(club.nom)}` : "";
    };
    paintClub();
    view.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => {
      view.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      view.querySelectorAll("[data-plist]").forEach((x) => (x.hidden = x.dataset.plist !== b.dataset.list));
    }));

    // Choix du club : un championnat (logo), puis un blason
    const picker = document.getElementById("club-picker");
    async function showClubs(leagueId) {
      const list = (await getLeagues()).filter((l) => !l.coupe);
      picker.hidden = false;
      picker.innerHTML = `${chips(list, leagueId)}<div class="club-grid" id="club-grid"><p class="note">Chargement…</p></div>`;
      picker.querySelectorAll(".chip").forEach((b) => (b.onclick = () => showClubs(Number(b.dataset.league))));
      const grid = document.getElementById("club-grid");
      try {
        const d = await api(`/league-predictions?leagueId=${leagueId}`);
        const teams = (d.classement || []).slice().sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
        grid.innerHTML = teams.length ? teams.map((t) => `<button type="button" class="club" data-id="${esc(t.id)}" aria-label="${esc(t.nom)}">${crest({ name: t.nom, logo: t.logo })}<small>${esc(t.nom)}</small></button>`).join("") : `<p class="note">Clubs indisponibles pour ce championnat.</p>`;
        grid.querySelectorAll(".club").forEach((b) => (b.onclick = () => {
          const t = teams.find((x) => String(x.id) === b.dataset.id);
          club = { nom: t.nom, logo: t.logo }; clubChoice = { leagueId, teamId: t.id };
          picker.hidden = true; paintClub();
        }));
      } catch { grid.innerHTML = `<p class="note">Clubs indisponibles pour le moment.</p>`; }
    }
    document.getElementById("club-open").onclick = () => (picker.hidden ? showClubs(Number(store.get("league")) || 61) : (picker.hidden = true));
    document.getElementById("club-none").onclick = () => { club = null; clubChoice = null; picker.hidden = true; paintClub(); };

    const pform = document.getElementById("f-profile");
    pform.onsubmit = async (e) => {
      e.preventDefault();
      const err = pform.querySelector(".form-err"), btn = pform.querySelector("button[type=submit]");
      err.hidden = true; btn.disabled = true;
      const body = { prenom: pform.elements.prenom.value, ville: pform.elements.ville.value };
      if (clubChoice !== undefined) body.club = clubChoice;
      try { await call("/account/profile", body); meDirty = true; clubChoice = undefined; cache.delete("/arena"); toast("Infos enregistrées."); }
      catch (x) { err.textContent = x.message; err.hidden = false; }
      btn.disabled = false;
    };
    bindForm("f-email", "/account/email", ["email", "motDePasse"], (d) => { meDirty = true; toast("E-mail modifié."); renderCompte(); });
    bindForm("f-password", "/account/password", ["ancien", "nouveau"], () => { toast("Mot de passe modifié."); renderCompte(); });
    document.getElementById("logout").onclick = async () => {
      try { await call("/account/logout", {}); } catch { /* déjà déconnecté */ }
      setSession(null); cache.clear(); toast("À bientôt !"); location.hash = "#/";
    };
    bindForm("f-delete", "/account/delete", ["motDePasse"], () => { setSession(null); cache.clear(); toast("Compte supprimé."); location.hash = "#/"; });
  }

  // ---------- Pages d'information ----------
  const MAIL = "contact@duelprono.com";
  const mailto = `<a href="mailto:${MAIL}">${MAIL}</a>`;
  const DOCS = {
    "a-propos": { kicker: "Qui sommes-nous", titre: "À propos", html: `
      <h2>Le principe</h2>
      <p>Duel Prono présente chaque match de football comme un duel et affiche ses probabilités : victoire, nul, nombre de buts, scores les plus probables.</p>
      <p>Le site est aussi un jeu gratuit. Tu choisis ton camp avant le coup d'envoi, tu marques des points quand tu as vu juste, et un classement repart de zéro chaque lundi.</p>
      <h2>Comment les probabilités sont calculées</h2>
      <ul>
        <li>Les 40 derniers matchs de chaque équipe sont pris en compte ; les 5 plus récents comptent double.</li>
        <li>Le niveau de chaque équipe est suivi d'une saison à l'autre, en attaque comme en défense, à domicile comme à l'extérieur.</li>
        <li>Un modèle statistique en déduit les buts attendus, puis la probabilité de chaque résultat.</li>
      </ul>
      <p>Aucun avis humain, aucun « tuyau » : uniquement des calculs, refaits automatiquement tout au long de la journée.</p>
      <h2>La transparence</h2>
      <p>Chaque probabilité est figée au coup d'envoi et ne peut plus être modifiée. L'onglet <a href="#/verdict">Verdict</a> compare ensuite nos calculs aux vrais résultats et affiche le taux de réussite réel, bon ou mauvais.</p>
      <h2>Ce que Duel Prono n'est pas</h2>
      <p>Duel Prono n'est pas un site de paris. On n'y mise pas d'argent et on n'y gagne ni argent ni lot. Une probabilité n'est jamais une certitude : même un résultat annoncé à 80 % échoue une fois sur cinq.</p>
      <h2>Nous écrire</h2>
      <p>${mailto}</p>` },
    "conditions": { kicker: "Règles du site", titre: "Conditions d'utilisation", html: `
      <p class="maj">Dernière mise à jour : 11 novembre 2026</p>
      <h2>1. Objet</h2>
      <p>Ces conditions fixent les règles d'utilisation du site Duel Prono. En créant un compte, tu les acceptes.</p>
      <h2>2. Le service</h2>
      <p>Duel Prono affiche des probabilités sur des matchs de football, calculées par un modèle statistique, et propose un jeu de pronostics gratuit avec un classement hebdomadaire.</p>
      <h2>3. Un jeu gratuit, sans argent</h2>
      <ul>
        <li>Jouer est gratuit. Aucune mise n'est demandée.</li>
        <li>Les points et le classement n'ont aucune valeur : ils ne donnent droit à aucun gain, aucun lot, aucune récompense.</li>
        <li>Duel Prono n'est pas un opérateur de jeux d'argent, ne prend aucun pari et ne renvoie vers aucun site de paris.</li>
      </ul>
      <h2>4. Les probabilités</h2>
      <p>Les probabilités sont des estimations statistiques fournies à titre d'information, sans aucune garantie de résultat. Elles ne constituent pas un conseil. L'usage que tu en fais relève de ta seule responsabilité, et Duel Prono ne peut être tenu responsable d'une perte, quelle qu'elle soit.</p>
      <h2>5. Ton compte</h2>
      <ul>
        <li>Le site est réservé aux personnes âgées de 18 ans ou plus.</li>
        <li>Un seul compte par personne, avec une adresse e-mail valable.</li>
        <li>Ton pseudo est public. Il ne doit être ni injurieux, ni trompeur, ni celui de quelqu'un d'autre.</li>
        <li>Tu es responsable de ton mot de passe.</li>
        <li>Tu peux supprimer ton compte à tout moment depuis « Mon espace ».</li>
      </ul>
      <h2>6. Règles du jeu</h2>
      <ul>
        <li>Un pronostic par match : victoire à domicile, nul ou victoire à l'extérieur.</li>
        <li>Il peut être modifié jusqu'au coup d'envoi, plus après.</li>
        <li>Un pronostic juste rapporte des points, d'autant plus nombreux que le résultat était jugé peu probable (de 10 à 100). Un pronostic faux rapporte 0 point.</li>
        <li>Le classement va du lundi au dimanche (heure de Paris) et repart de zéro chaque lundi.</li>
        <li>Toute triche (comptes multiples, automatisation, exploitation d'une erreur) peut entraîner la suppression du compte.</li>
      </ul>
      <h2>7. Disponibilité</h2>
      <p>Le site dépend de sources de données extérieures et peut être interrompu, incomplet ou en retard. Il est fourni tel quel, sans garantie de disponibilité.</p>
      <h2>8. Propriété</h2>
      <p>Le nom Duel Prono, son logo, ses textes et ses calculs appartiennent à l'éditeur du site. Les noms et emblèmes des clubs et des compétitions appartiennent à leurs propriétaires respectifs ; ils sont affichés uniquement pour identifier les matchs, sans lien de partenariat.</p>
      <h2>9. Évolution</h2>
      <p>Ces conditions peuvent évoluer. La date de mise à jour figure en haut de la page. Si une formule payante est proposée un jour, elle fera l'objet de conditions de vente séparées.</p>
      <h2>10. Droit applicable</h2>
      <p>Ces conditions sont soumises au droit français. Pour toute question : ${mailto}</p>` },
    "confidentialite": { kicker: "Tes données", titre: "Confidentialité", html: `
      <p class="maj">Dernière mise à jour : 11 novembre 2026</p>
      <h2>En bref</h2>
      <p>Duel Prono garde le strict minimum pour faire fonctionner ton compte. Pas de publicité, pas de revente, pas de pistage.</p>
      <h2>Les données enregistrées</h2>
      <ul>
        <li><b>À l'inscription</b> : ton pseudo, ton adresse e-mail et ton mot de passe. Le mot de passe est transformé de façon irréversible : personne ne peut le lire, pas même nous.</li>
        <li><b>Si tu les renseignes</b> : ton prénom, ta ville et ton club favori.</li>
        <li><b>Quand tu joues</b> : tes pronostics et tes points.</li>
        <li><b>Pour la sécurité</b> : une empreinte anonymisée de ton adresse IP, gardée 24 heures au plus, pour bloquer les inscriptions et connexions abusives.</li>
      </ul>
      <h2>Ce qui est public</h2>
      <p>Seuls ton pseudo, le blason de ton club favori, tes points et ton nombre de pronostics apparaissent au classement. Ton e-mail, ton prénom et ta ville ne sont jamais affichés.</p>
      <h2>À quoi servent ces données</h2>
      <p>Uniquement à faire fonctionner ton compte et le jeu (exécution du service que tu as demandé) et à protéger le site contre les abus. Ton e-mail sert à te connecter et à te contacter au sujet de ton compte. Il ne reçoit aucune publicité.</p>
      <h2>Cookies et stockage</h2>
      <p>Le site n'utilise aucun cookie publicitaire ni outil de mesure d'audience. Il range dans ton navigateur ta connexion (valable 90 jours) et tes réglages d'affichage. Ce stockage est indispensable au fonctionnement du compte.</p>
      <h2>Qui a accès aux données</h2>
      <ul>
        <li><b>L'hébergeur</b>, Cloudflare, qui stocke les données en Europe de l'Ouest pour notre compte. Cloudflare est une société américaine : des traitements techniques peuvent avoir lieu hors de l'Union européenne, dans le cadre des garanties prévues par la réglementation.</li>
        <li><b>Les images des clubs et des compétitions</b> sont chargées depuis les serveurs de nos fournisseurs de données sportives (football-data.org et ESPN), qui voient donc l'adresse IP de ton appareil, comme tout site que tu visites.</li>
      </ul>
      <p>Aucune donnée n'est vendue ni transmise à des fins commerciales.</p>
      <h2>Durée de conservation</h2>
      <p>Tes données sont gardées tant que ton compte existe. Quand tu le supprimes, ton compte, tes informations et tous tes pronostics sont effacés immédiatement et définitivement.</p>
      <h2>Tes droits</h2>
      <p>Tu peux consulter et modifier tes informations, ou supprimer ton compte, depuis « Mon espace ». Pour toute autre demande (copie de tes données, opposition, question), écris à ${mailto}. Tu peux aussi adresser une réclamation à la CNIL (cnil.fr).</p>
      <h2>Mineurs</h2>
      <p>Le site est réservé aux personnes de 18 ans ou plus. Un compte créé par un mineur sera supprimé.</p>` },
    "mentions-legales": { kicker: "Informations légales", titre: "Mentions légales", html: `
      <h2>Éditeur</h2>
      <p>Le site Duel Prono est édité par un particulier, à titre non professionnel. Comme la loi le permet (article 6, III de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique), l'éditeur a choisi de préserver son anonymat ; ses coordonnées ont été communiquées à l'hébergeur.</p>
      <h2>Contact</h2>
      <p>${mailto}</p>
      <h2>Hébergeur</h2>
      <p>Cloudflare, Inc.<br>101 Townsend Street, San Francisco, CA 94107, États-Unis<br>www.cloudflare.com</p>
      <h2>Données personnelles</h2>
      <p>Voir la page <a href="#/confidentialite">Confidentialité</a>.</p>
      <h2>Avertissement</h2>
      <p>Duel Prono n'est pas un opérateur de jeux d'argent et ne prend aucun pari. Les probabilités affichées sont des estimations statistiques, sans garantie de résultat. Le jeu est gratuit, sans mise ni gain.</p>
      <h2>Propriété intellectuelle</h2>
      <p>Le nom, le logo, les textes et les calculs de Duel Prono ne peuvent pas être reproduits sans autorisation. Les noms et emblèmes des clubs et des compétitions appartiennent à leurs propriétaires respectifs.</p>` },
  };
  function renderDoc(key) {
    setTab("");
    const d = DOCS[key];
    view.innerHTML = `
      <div class="back"><a href="#/" aria-label="Retour aux duels"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></a><span>Duel Prono</span></div>
      <section class="hero"><p class="kicker">${d.kicker}</p><h1>${d.titre}</h1></section>
      <section class="panel doc">${d.html}</section>`;
  }

  // ---------- Navigation ----------
  function route() {
    const h = location.hash.replace(/^#\/?/, "");
    const parts = h.split("/");
    window.scrollTo(0, 0);
    // Type de page, pour la mise en page ordinateur (voir la fin de app.css)
    view.dataset.page = DOCS[parts[0]] ? "doc" : ["duel", "verdict", "arene", "compte"].includes(parts[0]) ? parts[0] : "duels";
    if (parts[0] === "duel" && parts[1] && parts[2]) return renderDuel(parts[1], decodeURIComponent(parts[2]));
    if (parts[0] === "verdict") return renderVerdict();
    if (parts[0] === "arene") { arenaWeek = "courante"; return renderArena(); }
    if (parts[0] === "compte") return renderCompte();
    if (DOCS[parts[0]]) return renderDoc(parts[0]);
    return renderDuels();
  }
  window.addEventListener("hashchange", route);
  paintAccount();
  route();
})();
