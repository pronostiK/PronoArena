"""Export des xG par match depuis Bzzoiro (BSD) : 5 grands championnats, saisons 2023/24 à 2025/26.

Quota gratuit : 7 500 requêtes par jour. L'export complet en demande environ 6 000 : il tient en 1 à 2 jours.
Le script reprend là où il s'est arrêté (fichier d'état) et s'arrête seul avant la limite du jour.

Clé lue dans la variable d'environnement BZZOIRO_TOKEN (jamais écrite dans un fichier).
Aucune installation : bibliothèque standard de Python.

Sortie :
  xg_bzzoiro.csv     une ligne par match terminé, avec la colonne « statut » :
                     mesure  = xG mesuré sur tous les tirs (à utiliser)
                     estime  = au moins un tir estimé par BSD (à écarter du test)
                     sans_xg = pas d'xG pour ce match
  xg_bzzoiro_resume.txt   décompte par championnat et saison
  xg_bzzoiro.etat.json    état de reprise

Utilisation locale (Windows) :
    set BZZOIRO_TOKEN=VOTRE_CLE
    python export_xg_bzzoiro.py
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://sports.bzzoiro.com/api/v2"

# pays -> noms de ligue acceptés (comparés en minuscules, ligues féminines exclues)
LIGUES = {
    "England": ("Premier League", {"premier league"}),
    "Spain": ("La Liga", {"la liga", "laliga", "primera division", "primera división"}),
    "Italy": ("Serie A", {"serie a"}),
    "Germany": ("Bundesliga", {"bundesliga"}),
    "France": ("Ligue 1", {"ligue 1"}),
}

COLONNES = ["date", "event_id", "championnat", "annee_saison", "domicile", "exterieur",
            "buts_domicile", "buts_exterieur", "xg_domicile", "xg_exterieur", "statut",
            "tirs", "buts_contre_son_camp"]


class Arret(Exception):
    """Arrêt propre : quota atteint, clé refusée, erreur répétée."""


class Client:
    def __init__(self, cle, limite):
        self.cle = cle
        self.limite = limite
        self.n = 0

    def get(self, chemin, params=None):
        if self.n >= self.limite:
            raise Arret(f"Limite de {self.limite} requêtes atteinte pour cette exécution.")
        url = BASE + chemin + ("?" + urllib.parse.urlencode(params) if params else "")
        req = urllib.request.Request(url, headers={"Authorization": "Token " + self.cle,
                                                   "User-Agent": "export-duelprono/1.0"})
        for essai in (1, 2, 3):
            self.n += 1
            try:
                with urllib.request.urlopen(req, timeout=40) as r:
                    data = json.loads(r.read().decode("utf-8"))
                time.sleep(0.1)
                return data
            except urllib.error.HTTPError as e:
                corps = e.read().decode("utf-8", "replace")[:200]
                if e.code in (401, 403):
                    raise Arret(f"Clé refusée (HTTP {e.code}) : {corps}")
                if e.code == 429:
                    raise Arret("Quota ou débit atteint (HTTP 429). Reprise à la prochaine exécution.")
                if e.code == 404:
                    return None
                if essai == 3:
                    raise Arret(f"Erreur HTTP {e.code} sur {chemin} : {corps}")
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                if essai == 3:
                    raise Arret(f"Erreur réseau sur {chemin} : {type(e).__name__} {e}")
            time.sleep(3 * essai)


def liste(d, cle=None):
    """Extrait la liste d'objets d'une réponse (results, seasons...)."""
    if isinstance(d, list):
        return d
    if not isinstance(d, dict):
        return []
    if cle and isinstance(d.get(cle), list):
        return d[cle]
    if isinstance(d.get("results"), list):
        return d["results"]
    for v in d.values():
        if isinstance(v, list) and v and isinstance(v[0], dict):
            return v
    return []


def lire_etat(p):
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"ligues": {}, "saisons": {}, "matchs": {}, "listes": [], "xg": {}, "complet": False}


def ecrire_etat(p, etat):
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(etat, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


def ecrire_sorties(dossier, etat, annees):
    lignes = []
    for eid, m in etat["matchs"].items():
        x = etat["xg"].get(eid)
        if x is None:
            continue
        lignes.append([m["date"], eid, m["championnat"], m["annee"], m["domicile"], m["exterieur"],
                       m["bd"], m["be"], x.get("xgd", ""), x.get("xge", ""), x["statut"],
                       x.get("tirs", ""), x.get("csc", "")])
    lignes.sort(key=lambda r: (r[2], r[3], r[0]))
    with open(dossier / "xg_bzzoiro.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(COLONNES)
        w.writerows(lignes)
    comptes = {}
    for eid, m in etat["matchs"].items():
        c = comptes.setdefault((m["championnat"], m["annee"]), {"total": 0, "mesure": 0, "estime": 0, "sans_xg": 0, "a_faire": 0})
        c["total"] += 1
        x = etat["xg"].get(eid)
        if x is None:
            c["a_faire"] += 1
        else:
            c[x["statut"]] += 1
    out = ["Résumé de l'export xG Bzzoiro", f"Mis à jour : {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC", ""]
    for (ch, an), c in sorted(comptes.items()):
        out.append(f"{ch} {an}/{str(an + 1)[2:]} : {c['total']} matchs | mesure {c['mesure']} | estime {c['estime']} | "
                   f"sans xG {c['sans_xg']} | à faire {c['a_faire']}")
    out.append("")
    out.append("Statut complet : " + ("OUI" if etat["complet"] else "non, reprise à la prochaine exécution"))
    (dossier / "xg_bzzoiro_resume.txt").write_text("\n".join(out) + "\n", encoding="utf-8")
    print("\n".join(out))


def trouver_ligue(cl, pays, noms):
    d = cl.get("/leagues/", {"country": pays, "limit": 200})
    for l in liste(d):
        if l.get("is_women"):
            continue
        if str(l.get("name", "")).strip().lower() in noms:
            return l["id"]
    return None


def extraire_xg(st):
    """Retourne le dict xG d'un match à partir de /events/{id}/stats/."""
    if not isinstance(st, dict):
        return {"statut": "sans_xg"}
    s = st.get("stats") or {}
    xd = (s.get("home") or {}).get("xg") or {}
    xe = (s.get("away") or {}).get("xg") or {}
    if xd.get("actual") is None or xe.get("actual") is None:
        return {"statut": "sans_xg"}
    tirs = st.get("shotmap") or []
    estime = bool(st.get("xg_estimated")) or bool(xd.get("estimated")) or bool(xe.get("estimated")) \
        or any(t.get("xg_estimated") for t in tirs)
    return {"xgd": xd["actual"], "xge": xe["actual"], "statut": "estime" if estime else "mesure",
            "tirs": len(tirs), "csc": sum(1 for t in tirs if t.get("gtype") == "own")}


def principal(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--annees", default="2023,2024,2025", help="années de début de saison, ex. 2023 = 2023/24")
    ap.add_argument("--limite", type=int, default=7000, help="requêtes max pour cette exécution")
    args = ap.parse_args(argv)
    annees = [int(a) for a in args.annees.split(",")]

    cle = os.environ.get("BZZOIRO_TOKEN", "").strip()
    if not cle:
        sys.exit("Variable BZZOIRO_TOKEN absente.")
    dossier = Path(".")
    p_etat = dossier / "xg_bzzoiro.etat.json"
    etat = lire_etat(p_etat)
    if etat.get("complet"):
        print("Export déjà complet : rien à faire.")
        ecrire_sorties(dossier, etat, annees)
        return 0
    cl = Client(cle, args.limite)
    code = 0
    try:
        # 1) ligues et saisons
        for pays, (nom, noms) in LIGUES.items():
            if nom not in etat["ligues"]:
                lid = trouver_ligue(cl, pays, noms)
                if lid is None:
                    raise Arret(f"Ligue introuvable : {nom} ({pays}). Vérifier les noms.")
                etat["ligues"][nom] = lid
            lid = etat["ligues"][nom]
            if nom not in etat["saisons"]:
                d = cl.get(f"/leagues/{lid}/seasons/")
                etat["saisons"][nom] = {str(s["year"]): s["id"] for s in liste(d, "seasons") if "year" in s}
            ecrire_etat(p_etat, etat)
        # 2) listes de matchs terminés
        for nom, lid in etat["ligues"].items():
            for an in annees:
                sid = etat["saisons"][nom].get(str(an))
                cle_liste = f"{lid}:{sid}"
                if sid is None:
                    raise Arret(f"Saison {an} introuvable pour {nom}.")
                if cle_liste in etat["listes"]:
                    continue
                offset = 0
                while True:
                    d = cl.get("/events/", {"league_id": lid, "season_id": sid, "status": "finished",
                                            "limit": 200, "offset": offset})
                    evs = liste(d)
                    for e in evs:
                        etat["matchs"][str(e["id"])] = {
                            "date": str(e.get("event_date", ""))[:10], "championnat": nom, "annee": an,
                            "domicile": e.get("home_team"), "exterieur": e.get("away_team"),
                            "bd": e.get("home_score"), "be": e.get("away_score"), "has_xg": bool(e.get("has_xg"))}
                    if not (isinstance(d, dict) and d.get("next")) or not evs:
                        break
                    offset += 200
                etat["listes"].append(cle_liste)
                ecrire_etat(p_etat, etat)
        # 3) xG match par match
        for eid, m in etat["matchs"].items():
            if eid in etat["xg"]:
                continue
            if not m["has_xg"]:
                etat["xg"][eid] = {"statut": "sans_xg"}
                continue
            st = cl.get(f"/events/{eid}/stats/")
            etat["xg"][eid] = extraire_xg(st)
            if len(etat["xg"]) % 50 == 0:
                ecrire_etat(p_etat, etat)
        etat["complet"] = True
    except Arret as e:
        print("ARRET PROPRE :", e)
        if "introuvable" in str(e) or "refusée" in str(e):
            code = 1
    finally:
        ecrire_etat(p_etat, etat)
        print(f"Requêtes utilisées dans cette exécution : {cl.n}")
        ecrire_sorties(dossier, etat, annees)
    return code


if __name__ == "__main__":
    sys.exit(principal())
