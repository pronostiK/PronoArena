"""Sonde TEMPORAIRE (19/11/2026) : Bzzoiro donne-t-il les absents (avec les noms) pour les matchs à venir ?
Le dépôt et les journaux GitHub sont PUBLICS : on n'affiche que des clés, des comptes et des noms de championnats,
jamais de noms de joueurs ni de données brutes (licence Bzzoiro). À supprimer après le test."""
import json, os, sys, time, urllib.parse, urllib.request
from collections import Counter

BASE = "https://sports.bzzoiro.com/api/v2"
TOK = os.environ.get("BZZOIRO_TOKEN", "").strip() or sys.exit("BZZOIRO_TOKEN absent")
N = 0

def get(path, params=None):
    global N
    N += 1
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"Authorization": "Token " + TOK, "Accept": "application/json", "User-Agent": "DuelProno/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  ! {path} : {str(e)[:80]}")
        return None
    finally:
        time.sleep(0.4)

def liste(d):
    if isinstance(d, list): return d
    if isinstance(d, dict):
        for k in ("results", "data", "players", "squad", "items"):
            if isinstance(d.get(k), list): return d[k]
    return []

# Nos championnats : (pays Bzzoiro, noms possibles)
NOS = {
    "Premier League": ("England", {"premier league"}), "Championship": ("England", {"championship"}),
    "LaLiga": ("Spain", {"la liga", "laliga"}), "Serie A": ("Italy", {"serie a"}), "Serie B": ("Italy", {"serie b"}),
    "Bundesliga": ("Germany", {"bundesliga"}), "Ligue 1": ("France", {"ligue 1"}), "Ligue 2": ("France", {"ligue 2"}),
    "Liga Portugal": ("Portugal", {"liga portugal", "primeira liga", "liga portugal betclic"}),
    "Eredivisie": ("Netherlands", {"eredivisie"}), "Brasileirao": ("Brazil", {"brasileirão", "brasileirao", "serie a", "brasileiro serie a"}),
    "Saudi Pro League": ("Saudi Arabia", {"saudi pro league", "pro league", "roshn saudi league"}),
    "Super Lig": ("Turkey", {"süper lig", "super lig", "trendyol süper lig"}),
    "Pro League BE": ("Belgium", {"pro league", "jupiler pro league", "first division a"}),
    "Scottish Premiership": ("Scotland", {"premiership", "scottish premiership"}),
}

def main():
    print("== Couverture : championnats trouvés chez Bzzoiro ==")
    trouves = {}
    for nom, (pays, noms) in NOS.items():
        d = get("/leagues/", {"country": pays, "limit": 200})
        ls = [l for l in liste(d) if not l.get("is_women")]
        lid = next((l["id"] for l in ls if str(l.get("name", "")).strip().lower() in noms), None)
        print(f"{nom:22} {'OUI id=' + str(lid) if lid else 'non'}   (noms dispo : {', '.join(sorted({str(l.get('name')) for l in ls}))[:160]})")
        if lid: trouves[nom] = lid
    d = get("/leagues/", {"limit": 500})
    eur = [str(l.get("name")) for l in liste(d) if any(k in str(l.get("name", "")).lower() for k in ("champions", "europa", "conference", "nations"))]
    print("Coupes d'Europe / Nations :", ", ".join(sorted(set(eur)))[:300])

    print("\n== Absents par équipe (/teams/{id}/squad/) sur un match à venir par championnat ==")
    premier = True
    for nom, lid in trouves.items():
        ev = None
        for params in ({"league_id": lid, "status": "notstarted", "limit": 5}, {"league_id": lid, "limit": 5, "ordering": "date"}):
            evs = [e for e in liste(get("/events/", params)) if str(e.get("status", "")).lower() in ("notstarted", "not_started", "scheduled", "")]
            if evs: ev = evs[0]; break
        if not ev:
            print(f"{nom:22} aucun match à venir trouvé"); continue
        if premier: print("  clés d'un match :", sorted(ev.keys()))
        ids = []
        for cote in ("home_team", "away_team"):
            t = ev.get(cote)
            ids.append(t.get("id") if isinstance(t, dict) else ev.get(cote + "_id") or t)
        res = []
        for tid in ids:
            if not tid: res.append("équipe ?"); continue
            sq = liste(get(f"/teams/{tid}/squad/"))
            if premier and sq:
                print("  clés d'un joueur :", sorted(sq[0].keys()))
                if isinstance(sq[0].get("player"), dict): print("  clés de player :", sorted(sq[0]["player"].keys()))
            def nom_j(p):
                q = p.get("player") if isinstance(p.get("player"), dict) else p
                return q.get("name") or q.get("short_name") or q.get("full_name")
            dispo = Counter(str(p.get("availability")) for p in sq)
            abs_ = [p for p in sq if p.get("availability") not in (None, "available")]
            res.append(f"{len(sq)} joueurs, statuts {dict(dispo)}, noms présents {sum(1 for p in sq if nom_j(p))}/{len(sq)}, "
                       f"absents avec motif {sum(1 for p in abs_ if p.get('injury_type'))}/{len(abs_)}, avec date de retour {sum(1 for p in abs_ if p.get('injury_expected_return'))}/{len(abs_)}")
        print(f"{nom:22} match {ev.get('id')} ({str(ev.get('event_date') or ev.get('date') or '')[:10]})")
        for r in res: print("   -", r)
        if premier:
            lu = get(f"/events/{ev.get('id')}/lineups/")
            if isinstance(lu, dict):
                print("  lineups : clés", sorted(lu.keys()), "| statut", lu.get("lineup_status"))
                up = lu.get("unavailable_players")
                print("  unavailable_players :", type(up).__name__, (len(up) if hasattr(up, "__len__") else ""),
                      (sorted(up[0].keys()) if isinstance(up, list) and up and isinstance(up[0], dict) else
                       {k: (len(v) if hasattr(v, '__len__') else v) for k, v in up.items()} if isinstance(up, dict) else ""))
        premier = False
    print(f"\nAppels utilisés : {N}")

main()
