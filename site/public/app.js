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
            <p class="avis"><b>Avis du moteur :</b> ${esc(avis(p))}</p>
            <span class="more">Voir l'analyse complète
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></span>
          </a>`;
      }).join("");
    } catch (e) {
      errorBox(e.message, renderDuels);
    }
  }

  // ---------- Écran Analyse ----------
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
    const rank = (t) => (t.classement ? `${t.classement.rang}${t.classement.rang === 1 ? "er" : "e"} · ${t.classement.points} pts` : "");

    view.innerHTML = `
      <div class="back"><a href="#/" aria-label="Retour aux duels"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></a><span>${esc(lg?.nom || "")}</span></div>
      <section class="match-hero">
        <div class="team">${crest(D, "crest crest-lg")}<b>${esc(D.name)}</b><small>Elo ${esc(D.elo)}</small></div>
        <div class="kickoff">${isLive(p.status) ? `<span class="live">En direct</span>` : `<strong>${esc(fmtTime(p.date))}</strong>`}<span>${esc(fmtDay(p.date))}</span></div>
        <div class="team">${crest(E, "crest crest-lg")}<b>${esc(E.name)}</b><small>Elo ${esc(E.elo)}</small></div>
      </section>
      <div class="tabs" role="tablist" aria-label="Sections de l'analyse">
        <button type="button" role="tab" aria-selected="true" data-pane="m">Marchés</button>
        <button type="button" role="tab" aria-selected="false" data-pane="f">Forme</button>
        <button type="button" role="tab" aria-selected="false" data-pane="h">Face-à-face</button>
      </div>

      <section class="panel" data-panel="m" role="tabpanel">
        <h2>Avis du moteur</h2>
        <div class="probs probs-lg">
          <div><b class="c1">${pct(P.proba1)}%</b><small>${esc(D.name)}</small><small>cote juste ${esc(C.cote1 ?? "—")}</small></div>
          <div><b class="cN">${pct(P.probaN)}%</b><small>Nul</small><small>cote juste ${esc(C.coteN ?? "—")}</small></div>
          <div><b class="c2">${pct(P.proba2)}%</b><small>${esc(E.name)}</small><small>cote juste ${esc(C.cote2 ?? "—")}</small></div>
        </div>
        <div class="bar" aria-hidden="true" style="height:8px"><span style="width:${pct(P.proba1)}%"></span><span style="width:${pct(P.probaN)}%"></span><span style="width:${pct(P.proba2)}%"></span></div>
        <p class="avis">${esc(avis(p))}</p>
        <div class="grid2">
          <div class="cell"><small>Buts attendus</small><b>${esc(p.lambdas.lambdaDom.toFixed(1).replace(".", ","))} – ${esc(p.lambdas.lambdaExt.toFixed(1).replace(".", ","))}</b></div>
          <div class="cell"><small>Score le plus probable</small><b>${P.scoreProbable ? `${P.scoreProbable.dom} – ${P.scoreProbable.ext} <small style="display:inline;color:var(--muted)">(${pct(P.scoreProbable.proba)} %)</small>` : "—"}</b></div>
        </div>
        <div class="grid3">
          <div class="cell"><small>1X</small><b>${pct(P.proba1X)}%</b></div>
          <div class="cell"><small>X2</small><b>${pct(P.probaX2)}%</b></div>
          <div class="cell"><small>12</small><b>${pct(P.proba12)}%</b></div>
          <div class="cell"><small>+1,5 buts</small><b>${pct(P.probaOver15)}%</b></div>
          <div class="cell"><small>+2,5 buts</small><b>${pct(P.probaOver25)}%</b></div>
          <div class="cell"><small>+3,5 buts</small><b>${pct(P.probaOver35)}%</b></div>
        </div>
        <div class="row"><span>Les deux équipes marquent</span><b>${pct(P.probaBTTS)}%</b></div>
        <p class="note">Fiabilité ${esc(p.donnees?.fiabilite || "—")} · ${esc(p.donnees?.matchsDomicile ?? "—")} et ${esc(p.donnees?.matchsExterieur ?? "—")} matchs analysés</p>
      </section>

      <section class="panel" data-panel="f" role="tabpanel" hidden>
        <h2>Forme du moment</h2>
        ${[D, E].map((t) => {
          const s = t.stats;
          if (!s) return `<div class="form-team"><div class="form-head"><b>${esc(t.name)}</b></div><p class="note">Pas encore de match joué cette saison.</p></div>`;
          return `<div class="form-team">
            <div class="form-head"><b>${esc(t.name)}</b><span>${esc(rank(t))}</span></div>
            <div class="pills">${s.formeDetail.map((f) => `<span class="pill ${f.r}" title="${esc(f.domicile ? "vs " : "à ")}${esc(f.adversaire)} ${esc(f.score)}">${f.r}</span>`).join("")}</div>
          </div>`;
        }).join("")}
        ${D.stats && E.stats ? `<div class="stats-table">
          <span></span><span class="h">${esc(initials(D.name))}</span><span class="h">${esc(initials(E.name))}</span>
          <span>Buts marqués / match</span><b>${dec(D.stats.butsMarquesParMatch)}</b><b>${dec(E.stats.butsMarquesParMatch)}</b>
          <span>Buts encaissés / match</span><b>${dec(D.stats.butsEncaissesParMatch)}</b><b>${dec(E.stats.butsEncaissesParMatch)}</b>
          <span>Plus de 2,5 buts</span><b>${D.stats.pctOver25}%</b><b>${E.stats.pctOver25}%</b>
          <span>Les deux marquent</span><b>${D.stats.pctBTTS}%</b><b>${E.stats.pctBTTS}%</b>
          <span>Sans encaisser</span><b>${D.stats.pctCleanSheet}%</b><b>${E.stats.pctCleanSheet}%</b>
        </div>` : ""}
      </section>

      <section class="panel" data-panel="h" role="tabpanel" hidden>
        <h2>Derniers duels</h2>
        <div id="h2h"><p class="note">Chargement…</p></div>
      </section>`;

    view.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
      view.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      view.querySelectorAll("[data-panel]").forEach((s) => (s.hidden = s.dataset.panel !== b.dataset.pane));
    }));

    try {
      const md = await api(`/match-details?matchId=${encodeURIComponent(p.matchId)}&source=${encodeURIComponent(p.source)}&teamDomId=${encodeURIComponent(D.id)}&teamExtId=${encodeURIComponent(E.id)}&leagueId=${leagueId}`, 300000);
      const h = md.h2h || [];
      document.getElementById("h2h").innerHTML = h.length
        ? h.map((m) => {
            const left = m.equipeDomicile || (m.lieu === "domicile" ? D.name : E.name), right = m.equipeExterieur || (m.lieu === "domicile" ? E.name : D.name);
            const win = m.vainqueur === "domicile" ? [D.name, "c1"] : m.vainqueur === "exterieur" ? [E.name, "c2"] : ["Nul", "cN"];
            return `<div class="h2h"><small>${esc(fmtShort(m.date))}</small><b>${esc(left)} ${esc(m.butsDomicile ?? m.scoreDom)} – ${esc(m.butsExterieur ?? m.scoreExt)} ${esc(right)}</b><em class="${win[1]}">${esc(win[0])}</em></div>`;
          }).join("")
        : `<p class="note">Aucune confrontation récente entre ces deux équipes.</p>`;
    } catch {
      document.getElementById("h2h").innerHTML = `<p class="note">Face-à-face indisponible pour le moment.</p>`;
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
