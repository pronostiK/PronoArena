// ============================================================
// PRONO ARENA — Site (Duels, Analyse, Verdict)
// Toutes les données viennent du moteur ; le site ne fait que lire.
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
    document.querySelectorAll(".tabbar a").forEach((a) => (a.dataset.tab === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
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
  const chips = (list, current, extra = "") => `<div class="chips" role="group" aria-label="Compétitions">${extra}${list.map((l) => `<button type="button" class="chip" data-league="${l.id}" aria-pressed="${l.id === current}">${esc(l.nom)}</button>`).join("")}</div>`;

  // ---------- Écran Duels ----------
  async function renderDuels() {
    setTab("duels");
    const list = await getLeagues();
    let current = Number(store.get("league")) || 61;
    if (!list.some((l) => l.id === current)) current = list[0]?.id || 61;
    const league = list.find((l) => l.id === current) || { nom: "Ligue 1" };

    view.innerHTML = `${chips(list, current)}
      <section class="hero">
        <p class="kicker">${esc(league.nom)}${league.pays ? " · " + esc(league.pays) : ""}</p>
        <h1>Choisis ton camp.</h1>
        <p>Le moteur analyse chaque duel. Qui sortira vainqueur de l'arène ?</p>
      </section>
      <div class="list" id="duels"><div class="skel"></div><div class="skel"></div></div>`;

    view.querySelectorAll(".chip").forEach((b) => (b.onclick = () => { store.set("league", b.dataset.league); renderDuels(); }));

    const box = document.getElementById("duels");
    try {
      const data = await api(`/league-predictions?leagueId=${current}`);
      const preds = (data.predictions || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
      if (!preds.length) {
        box.innerHTML = `<div class="empty">Aucun duel programmé pour le moment dans cette compétition.</div>`;
        return;
      }
      let lastDay = "";
      box.innerHTML = preds.map((p) => {
        const day = fmtDay(p.date);
        const head = day !== lastDay ? `<h2 class="day">${esc(day)}</h2>` : "";
        lastDay = day;
        const P = p.poisson, D = p.teams.domicile, E = p.teams.exterieur;
        const status = isLive(p.status) ? `<span class="live">En direct</span>` : `<span class="tag">Fiabilité ${esc(p.donnees?.fiabilite || "—")}</span>`;
        return `${head}
          <a class="duel" href="#/duel/${current}/${encodeURIComponent(p.matchId)}" aria-label="${esc(D.name)} contre ${esc(E.name)}, voir l'analyse">
            <div class="duel-top"><span class="time">${esc(fmtTime(p.date))}</span>${status}</div>
            <div class="teams">
              <div class="team">${crest(D)}<b>${esc(D.name)}</b></div>
              <span class="vs">VS</span>
              <div class="team">${crest(E)}<b>${esc(E.name)}</b></div>
            </div>
            <div class="probs">
              <div><b class="c1">${pct(P.proba1)}%</b><small>Victoire</small></div>
              <div><b class="cN">${pct(P.probaN)}%</b><small>Nul</small></div>
              <div><b class="c2">${pct(P.proba2)}%</b><small>Victoire</small></div>
            </div>
            <div class="bar" aria-hidden="true"><span style="width:${pct(P.proba1)}%"></span><span style="width:${pct(P.probaN)}%"></span><span style="width:${pct(P.proba2)}%"></span></div>
            <div class="badges">${badges(p)}</div>
            <span class="more">Voir l'analyse complète
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></span>
          </a>`;
      }).join("");
    } catch (e) {
      errorBox(e.message, renderDuels);
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
    let data;
    try { data = await api(`/league-predictions?leagueId=${leagueId}`); } catch (e) { return errorBox(e.message, () => renderDuel(leagueId, matchId)); }
    const p = (data.predictions || []).find((x) => String(x.matchId) === String(matchId));
    const list = await getLeagues();
    const lg = list.find((l) => l.id === Number(leagueId));
    if (!p) {
      view.innerHTML = `<div class="empty">Ce duel n'est plus à l'affiche (il est peut-être terminé : regarde le Verdict).<br><button type="button" onclick="location.hash='#/'">Retour aux duels</button></div>`;
      return;
    }
    const P = p.poisson, D = p.teams.domicile, E = p.teams.exterieur, C = p.cotesJustes || {};
    const isNat = Number(leagueId) === 5;

    const marches = `
      <section class="panel">
        <h2>${ico("trophy")}Résultat</h2>
        <div class="probs probs-lg">
          <div>${mini(D)}<b class="c1">${pct(P.proba1)}%</b><small>cote ${esc(C.cote1 ?? "—")}</small></div>
          <div><span class="nul-ico" aria-hidden="true">=</span><b class="cN">${pct(P.probaN)}%</b><small>cote ${esc(C.coteN ?? "—")}</small></div>
          <div>${mini(E)}<b class="c2">${pct(P.proba2)}%</b><small>cote ${esc(C.cote2 ?? "—")}</small></div>
        </div>
        <div class="bar" aria-hidden="true" style="height:8px"><span style="width:${pct(P.proba1)}%"></span><span style="width:${pct(P.probaN)}%"></span><span style="width:${pct(P.proba2)}%"></span></div>
        <div class="badges">${badges(p)}</div>
      </section>
      <section class="panel">
        <h2>${ico("split")}Double chance</h2>
        <div class="grid3">${tile("1X", pct(P.proba1X) + "%")}${tile("X2", pct(P.probaX2) + "%")}${tile("12", pct(P.proba12) + "%")}</div>
        <h3>${ico("shield")}Remboursé si nul</h3>${pair(P.rembourseSiNul?.dom, D, P.rembourseSiNul?.ext, E)}
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

    const tabsDef = [["m", "Marchés"], ["s", "Stats"], ...(isNat ? [] : [["c", "Compos"]]), ["h", "Face-à-face"]];
    view.innerHTML = `
      <div class="back"><a href="#/" aria-label="Retour aux duels"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></a><span>${esc(lg?.nom || "")}</span></div>
      <section class="match-hero">
        <div class="team">${crest(D, "crest crest-lg")}<b>${esc(D.name)}</b><small>${D.classement ? `${D.classement.rang}${D.classement.rang === 1 ? "er" : "e"} · ` : ""}Elo ${esc(D.elo)}</small></div>
        <div class="kickoff">${isLive(p.status) ? `<span class="live">En direct</span>` : `<strong>${esc(fmtTime(p.date))}</strong>`}<span>${esc(fmtDay(p.date))}</span></div>
        <div class="team">${crest(E, "crest crest-lg")}<b>${esc(E.name)}</b><small>${E.classement ? `${E.classement.rang}${E.classement.rang === 1 ? "er" : "e"} · ` : ""}Elo ${esc(E.elo)}</small></div>
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
    const all = `<button type="button" class="chip" data-league="all" aria-pressed="${sel === "all"}">Toutes</button>`;
    view.innerHTML = `
      <section class="hero">
        <p class="kicker">Transparence totale</p>
        <h1>Le Verdict</h1>
        <p>Les résultats tombent. Le moteur avait-il vu juste ?</p>
      </section>
      ${chips(list, Number(sel), all)}
      <div id="verdict"><div class="list"><div class="skel"></div></div></div>`;
    view.querySelectorAll(".chip").forEach((b) => (b.onclick = () => { store.set("verdictLeague", b.dataset.league); renderVerdict(); }));

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

  // ---------- Navigation ----------
  function route() {
    const h = location.hash.replace(/^#\/?/, "");
    const parts = h.split("/");
    window.scrollTo(0, 0);
    if (parts[0] === "duel" && parts[1] && parts[2]) return renderDuel(parts[1], decodeURIComponent(parts[2]));
    if (parts[0] === "verdict") return renderVerdict();
    return renderDuels();
  }
  window.addEventListener("hashchange", route);
  route();
})();
