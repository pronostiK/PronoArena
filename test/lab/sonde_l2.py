"""Sonde TEMPORAIRE Ligue 2 : compos et absents disponibles ? (Bzzoiro + ESPN)
Journaux publics : seulement des comptes, des clés et des noms de clubs, jamais de noms de joueurs."""
import json, os, time, urllib.parse, urllib.request
from datetime import date, timedelta
BASE = "https://sports.bzzoiro.com/api/v2"; TOK = os.environ.get("BZZOIRO_TOKEN", "").strip(); N = 0
def fetch(u, h):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=30) as r: return json.loads(r.read())
    except Exception as e: print("  !", u.split("?")[0][-60:], str(e)[:80]); return None
    finally: time.sleep(0.4)
def bz(p, q=None):
    global N; N += 1
    return fetch(BASE + p + ("?" + urllib.parse.urlencode(q) if q else ""), {"Authorization": "Token " + TOK, "User-Agent": "DuelProno/1.0"})
def espn(slug, p):
    return fetch(f"https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/{p}", {"User-Agent": "Mozilla/5.0"})
L = lambda d: d if isinstance(d, list) else (d or {}).get("results", (d or {}).get("players", []))
def shape(x, depth=0):
    if isinstance(x, dict): return "{" + ", ".join(f"{k}:{shape(v, depth+1) if depth < 2 else type(v).__name__}" for k, v in list(x.items())[:25]) + "}"
    if isinstance(x, list): return f"[{len(x)}×{shape(x[0], depth+1) if x and depth < 2 else ''}]"
    return type(x).__name__
d0 = date.today(); d1 = d0 + timedelta(days=3); dm = d0 - timedelta(days=7)
for nom, lid in {"Ligue 2": 89, "Ligue 1": 6}.items():
    print(f"\n######## BZZOIRO {nom} (id {lid})")
    evs = L(bz("/events/", {"league_id": lid, "date_from": d0.isoformat(), "date_to": d1.isoformat(), "limit": 50}))
    past = L(bz("/events/", {"league_id": lid, "date_from": dm.isoformat(), "date_to": (d0 - timedelta(days=1)).isoformat(), "limit": 50}))
    print(f"matchs à venir : {len(evs)} · matchs passés (7 j) : {len(past)}")
    for e in evs[:2] + past[:1]:
        print(f"-- {str(e.get('event_date'))[:16]} {e.get('home_team')} – {e.get('away_team')} (statut {e.get('status')})")
        for side in ("home", "away"):
            sq = L(bz(f"/teams/{e.get(side + '_team_id')}/squad/"))
            av = {}
            for p in sq: av[p.get("availability")] = av.get(p.get("availability"), 0) + 1
            print(f"   effectif {side} : {len(sq)} joueurs, disponibilité {av}")
        lu = bz(f"/events/{e.get('id')}/lineups/")
        print("   lineups forme :", shape(lu)[:700])
print(f"\nappels Bzzoiro : {N}")
for slug in ("fra.2", "fra.1"):
    print(f"\n######## ESPN {slug}")
    sb = espn(slug, f"scoreboard?dates={dm.strftime('%Y%m%d')}-{d1.strftime('%Y%m%d')}")
    evs = (sb or {}).get("events", [])
    fin = [e for e in evs if e.get("status", {}).get("type", {}).get("completed")]
    print(f"matchs : {len(evs)}, terminés : {len(fin)}")
    for e in fin[:2] + [x for x in evs if x not in fin][:1]:
        s = espn(slug, f"summary?event={e['id']}") or {}
        r = s.get("rosters", [])
        print(f"-- {e.get('name')} : clés {list(s.keys())}")
        print(f"   rosters : {len(r)} ; titulaires par équipe {[sum(1 for p in x.get('roster', []) if p.get('starter')) for x in r]} ; formation {[x.get('formation') for x in r]}")
        print(f"   injuries : {shape(s.get('injuries'))[:300]}")
