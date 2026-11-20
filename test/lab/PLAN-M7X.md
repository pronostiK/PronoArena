# Plan technique : ajout de M7X au journal du suivi (proposition, 20/11/2026)

**Statut : plan seulement. Rien n'est codé ni publié. J'attends la validation de l'auditeur avant de toucher au dispositif.**

## 1. Ce qu'est M7X (aucun réglage nouveau)
- M7X = M7, sauf la part « buts » des forces (70 %) : elle devient 50 % buts + 50 % xG mesurés. C'est exactement la variante de `test/lab/run-xg-m7.mjs` (test hors ligne du 20/11).
- Seulement dans les 5 championnats qui ont des xG : Ligue 1 (61), Premier League (39), Liga (140), Serie A (135), Bundesliga (78).
- Elo, promus, corners, classement : identiques à M7.
- Source des xG : Bzzoiro, déjà utilisé par le robot pour l'affichage. Seuls les xG « mesurés » sont pris (même règle que le test).

## 2. Garanties d'absence d'impact sur M0 / M7
1. **Fichiers du moteur inchangés** : `src/model.js`, `src/config.js` et `src/corners.js` ne sont pas touchés. Le calcul de M7X est dans `src/suivi.js` et utilise les fonctions du moteur sans les modifier.
2. **Ordre de calcul** : M0 et M7 sont calculés et enregistrés exactement comme aujourd'hui. M7X est calculé **après**, dans un bloc séparé. S'il échoue (xG absents, base en panne, erreur), la ligne M0 / M7 est écrite quand même et l'incident est noté dans `/status`.
3. **Journal séparé** : M7X va dans une table à part (`suivi_x`), avec sa propre chaîne d'empreintes et les mêmes protections (ajout seul, modification et suppression refusées par la base). La table `suivi`, sa formule d'empreinte et le fichier de sceaux M0 / M7 ne changent pas. Les sceaux M7X vont dans un fichier à part (`suivi/empreintes-x.jsonl`), dans le même commit GitHub toutes les 30 min.
4. **Interrupteur** : une seule constante (`SUIVI_X = false`) coupe M7X sans rien changer d'autre.
5. **Preuves avant publication** :
   - `check-suivi-moteurs.mjs` relancé, qui doit redonner M0 = `02509e8` et M7 = `8044a83` sur 360/360 matchs ;
   - un test qui compare le journal M0 / M7 avec et sans M7X : il doit être identique octet pour octet ;
   - un test de panne : M7X en erreur, et M0 / M7 toujours écrits ;
   - un test qui vérifie que M7X redonne exactement les chiffres du script hors ligne sur les mêmes données.

## 3. Données xG : couverture, fraîcheur, aucune fuite
- **Problème actuel** : le robot ne garde les xG que 90 jours, et seulement pour la saison en cours. Or M7 utilise jusqu'à 80 matchs par équipe, saison passée comprise.
- **Solution** : une table D1 `xg_hist` (stockage interne autorisé par la licence ; jamais dans le dépôt public, jamais renvoyée par une route publique).
  - **Remplissage initial** : saison 2025-26 et début de la saison 2026-27, environ 1 900 matchs. Le robot les récupère lui-même, dans son budget Bzzoiro actuel (10 appels par passage au plus, quota de 2 500 par jour). Il n'en utilise aujourd'hui qu'environ 70 par jour. Durée : environ 3 jours.
  - **Ensuite** : chaque nouveau xG mesuré est ajouté à `xg_hist`, en plus de ce qui existe déjà pour l'affichage.
- **Liaison xG ↔ match du robot** : même méthode que les corners (date ± 1 jour, même score, équipes reconnues par leurs dates de match). Pas de liste de noms à tenir.
- **Aucune fuite** : seuls entrent les xG de matchs déjà terminés au moment du calcul, car le robot ne calcule les forces qu'avec ses matchs terminés. Chaque ligne M7X note :
  - le nombre de matchs de la fenêtre et le nombre de ceux qui ont un xG (couverture) ;
  - la date du dernier xG utilisé (fraîcheur).
- **Démarrage** : M7X commence à être enregistré seulement quand le remplissage initial est terminé et que la couverture atteint au moins 80 % dans les 5 championnats. Il n'y a pas de démarrage partiel. La date de démarrage est notée dans le protocole.

## 4. Règles d'évaluation, fixées avant le premier match M7X
- **xG manquant** pour un match passé (pas mesuré, estimé ou introuvable) : ce match garde ses vrais buts dans le calcul, comme dans le test hors ligne.
- **Prédiction retenue** : même règle 3 que le protocole principal (dernière ligne scellée avant le coup d'envoi ; ancrage tardif compté à part ; résultats toujours donnés avec et sans).
- **Comparaison** : M7X − M7 sur les mêmes matchs, en prenant la ligne M7 de la table `suivi` et la ligne M7X scellée avant le même coup d'envoi.
  - **Analyse principale** : matchs où la couverture xG de la ligne M7X est d'au moins 80 %.
  - **Analyse secondaire** : tous les matchs.
- **Mesures** : Brier et log loss ; IC 95 % par bootstrap regroupé par journée (10 000 tirages, graine 20261120) ; détail par championnat, Serie A présentée à part.
- **Gros favoris** (point faible du 19/11) : matchs où M7 ou M7X donne au moins 60 % à une issue. Pour chacun des deux moteurs : probabilité annoncée moyenne contre fréquence observée, et Brier sur ces matchs.
- **Critère final, fin de saison 2026-27** : M7X est jugé meilleur que M7 si les trois conditions sont réunies :
  1. l'écart de Brier est négatif, avec un IC 95 % entièrement sous 0 ;
  2. l'écart de log loss est négatif ;
  3. sur les gros favoris, l'écart entre annoncé et observé de M7X ne dépasse pas celui de M7 de plus de 2 points.

  Sinon, le gain n'est pas démontré.
- **Bilans** : en annexe des bilans M0 / M7, à titre informatif. Aucun réglage de M7X pendant l'évaluation.

## 5. Coût estimé
| | Aujourd'hui | Avec M7X |
|---|---|---|
| Écritures KV (limite gratuite 1 000 / jour, ~700 utilisées) | — | **0 de plus** : xG et journal M7X sont en D1 |
| Lectures KV | — | 0 de plus |
| Appels sortants du robot (limite 50 / passage) | Bzzoiro ≤ 10 / passage | **inchangé** : le remplissage reste dans ces 10 |
| Quota Bzzoiro (2 500 / jour réservés au site) | ~70 / jour | ~700 / jour pendant 3 jours, puis ~70 |
| Écritures D1 (limite gratuite 100 000 / jour) | quelques dizaines | + ~1 900 une seule fois, puis quelques dizaines par jour |
| Lectures D1 (limite 5 M lignes / jour) | faibles | + ~1 000 lignes par recalcul d'un des 5 championnats (≈ 100 000 / jour au plus) |
| Calcul (CPU) | — | + 1 calcul des forces par recalcul (≈ 0,1 ms mesuré sur 480 matchs) |
| GitHub | 1 commit de sceau / 30 min au plus | inchangé (même commit) |

Le passage à Workers Paid n'est pas nécessaire pour M7X.

## 6. Étapes, après validation du plan
1. Coder sur la branche de travail : `xg_hist`, remplissage, table `suivi_x`, calcul M7X, sceaux séparés, tests et preuves du point 2.
2. Montrer les preuves à Kay et à l'auditeur, puis publier seulement avec leur accord.
3. Remplissage (environ 3 jours), contrôle de la couverture, puis démarrage de M7X et date notée dans le protocole.
