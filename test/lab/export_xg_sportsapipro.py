"""Export des xG par match depuis SportsAPI Pro, avec reprise automatique (quota gratuit : 100 requêtes par jour).

Utilisation (Windows), dans le dossier xg :
    set SPORTS_API_KEY=VOTRE_CLE
    python export_xg_sportsapipro.py

Relancez la même commande chaque jour : le script reprend là où il s'est arrêté
et s'arrête seul quand le quota du jour est atteint (95 requêtes par défaut).
Il produit xg_sportsapipro_<championnat>_<saison>.csv (complet ou partiel) et un fichier d'état .etat.json.
La clé n'est jamais écrite dans un fichier. Aucune installation : bibliothèque standard de Python.

Options : --tournoi 17 (Premier League par défaut), --saison 23/24, --nom PL, --limite 95
"""
import argparse
import csv
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://api.sportsapipro.com/v2/football/api"


class Arret(Exception):
    """Arrêt propre : quota du jour atteint, clé refusée, erreur réseau répétée."""


def get(cle, chemin):
    """Une requête GET, deux essais en cas d'erreur réseau. Retourne le JSON décodé."""
    req = urllib.request.Request(BASE + chemin, headers={"x-api-key": cle, "User-Agent": "export-duelprono/1.0"})
    for essai in (1, 2):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            corps = e.read().decode("utf-8", "replace")[:200]
            if e.code in (401, 403):
                raise Arret(f"Clé refusée (HTTP {e.code}) : {corps}")
            if e.code == 429:
                raise Arret("Quota du jour atteint (HTTP 429). Relancez demain.")
            if essai == 2:
                raise Arret(f"Erreur HTTP {e.code} sur {chemin} : {corps}")
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            if essai == 2:
                raise Arret(f"Erreur réseau sur {chemin} : {type(e).__name__} {e}")
        time.sleep(2)


def lire_etat(chemin):
    if chemin.exists():
        return json.loads(chemin.read_text(encoding="utf-8"))
    return {"pages_lues": 0, "fin_pages": False, "matchs": {}, "xg": {}, "requetes": {}}


def ecrire_etat(chemin, etat):
    tmp = chemin.with_suffix(".tmp")
    tmp.write_text(json.dumps(etat, ensure_ascii=False), encoding="utf-8")
    tmp.replace(chemin)


def xg_du_match(reponse):
    """xG domicile et extérieur sur la période ALL (match entier). None si absent."""
    for periode in reponse.get("data", {}).get("statistics", []):
        if periode.get("period") != "ALL":
            continue
        for groupe in periode.get("groups", []):
            for item in groupe.get("statisticsItems", []):
                if item.get("key") == "expectedGoals":
                    h, a = item.get("homeValue"), item.get("awayValue")
                    if isinstance(h, (int, float)) and isinstance(a, (int, float)):
                        return float(h), float(a)
    return None


def ecrire_csv(chemin, etat, nom, saison):
    lignes = []
    for mid, m in etat["matchs"].items():
        x = etat["xg"].get(mid)
        if not x:
            continue
        lignes.append((m["date"], mid, nom, saison, m["domicile"], m["exterieur"], m["buts_dom"], m["buts_ext"], x[0], x[1]))
    lignes.sort()
    with chemin.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(("date", "match_id", "championnat", "saison", "domicile", "exterieur",
                    "buts_domicile", "buts_exterieur", "xg_domicile", "xg_exterieur"))
        w.writerows(lignes)
    return len(lignes)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tournoi", type=int, default=17)
    ap.add_argument("--saison", default="23/24", help="ex. 23/24")
    ap.add_argument("--nom", default="PL", help="nom court du championnat, pour le fichier")
    ap.add_argument("--limite", type=int, default=95, help="requêtes maximum par jour (UTC)")
    args = ap.parse_args()

    cle = os.environ.get("SPORTS_API_KEY", "").strip()
    if not cle and sys.stdin.isatty():
        cle = getpass.getpass("Clé API (invisible) : ").strip()
    if not cle:
        print("Aucune clé (variable SPORTS_API_KEY vide ou absente) : arrêt.")
        return 1

    base_nom = f"xg_sportsapipro_{args.nom}_{args.saison.replace('/', '-')}"
    f_etat = Path(base_nom + ".etat.json")
    f_csv = Path(base_nom + ".csv")
    etat = lire_etat(f_etat)
    jour = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    etat["requetes"].setdefault(jour, 0)

    def requete(chemin):
        if etat["requetes"][jour] >= args.limite:
            raise Arret(f"Limite du jour atteinte ({args.limite} requêtes). Relancez demain.")
        etat["requetes"][jour] += 1
        rep = get(cle, chemin)
        ecrire_etat(f_etat, etat)
        return rep

    try:
        # 1. Identifiant de la saison
        if "saison_id" not in etat:
            rep = requete(f"/tournaments/{args.tournoi}/seasons")
            sid = next((s["id"] for s in rep.get("seasons", []) if s.get("year") == args.saison), None)
            if sid is None:
                print(f"Saison {args.saison} introuvable pour le tournoi {args.tournoi}.")
                return 1
            etat["saison_id"] = sid
        sid = etat["saison_id"]

        # 2. Liste des matchs terminés, page par page (30 par page)
        while not etat["fin_pages"]:
            rep = requete(f"/tournament/{args.tournoi}/season/{sid}/events/last/{etat['pages_lues']}")
            data = rep.get("data", {})
            for e in data.get("events", []):
                if e.get("status", {}).get("type") != "finished":
                    continue
                etat["matchs"][str(e["id"])] = {
                    "date": datetime.fromtimestamp(e["startTimestamp"], timezone.utc).strftime("%Y-%m-%d"),
                    "domicile": e["homeTeam"]["name"], "exterieur": e["awayTeam"]["name"],
                    "buts_dom": e["homeScore"].get("current"), "buts_ext": e["awayScore"].get("current"),
                    "hasXg": bool(e.get("hasXg")),
                }
            etat["pages_lues"] += 1
            etat["fin_pages"] = not data.get("hasNextPage")
            ecrire_etat(f_etat, etat)
            print(f"Page {etat['pages_lues']} lue : {len(etat['matchs'])} matchs terminés.")

        # 3. xG de chaque match (une requête par match), les plus anciens d'abord
        a_faire = [mid for mid, m in sorted(etat["matchs"].items(), key=lambda kv: kv[1]["date"])
                   if mid not in etat["xg"] and m["hasXg"]]
        for mid in a_faire:
            rep = requete(f"/match/{mid}/statistics")
            x = xg_du_match(rep)
            etat["xg"][mid] = list(x) if x else None
            if len(etat["xg"]) % 20 == 0:
                print(f"{len(etat['xg'])} matchs avec xG récupérés...")
    except Arret as e:
        print("\nArrêt :", e)

    n = ecrire_csv(f_csv, etat, args.nom, args.saison)
    total = sum(1 for m in etat["matchs"].values() if m["hasXg"])
    restant = sum(1 for mid, m in etat["matchs"].items() if m["hasXg"] and mid not in etat["xg"])
    print(f"\n{f_csv} : {n} matchs avec xG sur {total} attendus ({restant} restants). "
          f"Requêtes aujourd'hui : {etat['requetes'][jour]}.")
    if etat["fin_pages"] and restant == 0:
        print("TERMINÉ : envoyez le fichier .csv à Claude.")
    else:
        print("Pas fini : relancez la même commande demain (il reprend où il s'est arrêté).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
