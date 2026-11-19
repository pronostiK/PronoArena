"""Sonde TEMPORAIRE : pour les vrais matchs des 4 prochains jours, les absents arrivent-ils pour les DEUX équipes ?
Journaux publics : seulement des comptes et les noms des clubs, jamais de noms de joueurs."""
import json, os, time, urllib.parse, urllib.request
from datetime import date, timedelta
BASE = "https://sports.bzzoiro.com/api/v2"; TOK = os.environ["BZZOIRO_TOKEN"].strip(); N = 0
def get(p, q=None):
    global N; N += 1
    u = BASE + p + ("?" + urllib.parse.urlencode(q) if q else "")
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"Authorization": "Token " + TOK, "User-Agent": "DuelProno/1.0"}), timeout=30) as r: return json.loads(r.read())
    except Exception as e: print("  !", p, str(e)[:60]); return None
    finally: time.sleep(0.3)
L = lambda d: d if isinstance(d, list) else (d or {}).get("results", [])
LG = {"Premier League": 1, "LaLiga": 3, "Serie A": 4, "Bundesliga": 5, "Ligue 1": 6, "Championship": 12, "Ligue 2": 89, "Eredivisie": 10}
d0 = date.today(); d1 = d0 + timedelta(days=4)
tot = ok = 0
for nom, lid in LG.items():
    evs = L(get("/events/", {"league_id": lid, "date_from": d0.isoformat(), "date_to": d1.isoformat(), "limit": 50}))
    print(f"== {nom} : {len(evs)} matchs du {d0} au {d1}")
    for e in evs[:3]:
        r = []
        for side in ("home", "away"):
            sq = L(get(f"/teams/{e.get(side + '_team_id')}/squad/"))
            ab = [p for p in sq if p.get("availability") in ("injured", "doubtful", "suspended")]
            r.append((e.get(side + "_team"), len(sq), len(ab)))
        tot += 1; ok += all(x[1] > 0 for x in r)
        print(f"  {str(e.get('event_date'))[:16]} {r[0][0]} ({r[0][1]} joueurs, {r[0][2]} absents) – {r[1][0]} ({r[1][1]} joueurs, {r[1][2]} absents)")
print(f"\nMatchs avec effectif reçu pour les deux équipes : {ok}/{tot} · appels : {N}")
