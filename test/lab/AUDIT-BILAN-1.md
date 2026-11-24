# Réponse à l'audit du premier bilan (24 novembre 2026)

Rien n'a été modifié en production. Aucun déploiement. Tout ce qui suit a été fait hors ligne.

## 1. Audit des corners : la cause est trouvée

**La source n'est pas en cause.** Le fichier de football-data.co.uk contient bien les corners de la saison en cours : environ 90 à 100 % des matchs joués. Il ne manque que le dernier week-end, que la source ajoute avec quelques jours de retard. La saison précédente est complète à 100 %.

**Le problème vient de notre robot**, au moment où il relie chaque ligne du fichier au bon match :
- le robot ne compare pas les noms des équipes, qui s'écrivent différemment d'une source à l'autre ;
- il essaie de reconnaître chaque équipe d'après **les jours où elle a joué** ;
- en début de saison, presque toutes les équipes jouent les mêmes week-ends, donc le robot n'arrive pas à les distinguer. Il en confond une partie, et les matchs de ces équipes restent sans corners ;
- les dates et les scores, eux, concordent entre les deux sources (les 64 matchs du premier bilan ont le même score des deux côtés).

**Preuve.** J'ai rejoué la méthode du robot sur les vraies données de la source, en masquant les noms comme le fait le robot (`test/lab/audit-corners.mjs`, sortie dans `audit-corners.txt`). Elle retrouve les mêmes trous qu'en production : quelques matchs seulement en Bundesliga et en Premier League, une couverture partielle ailleurs. La Liga s'en sort mieux parce que ses matchs sont étalés du vendredi au lundi.

**Liaisons fausses.** C'est rare mais possible : au plus 1 match sur 20 essais. Quand le robot confond deux équipes, il peut tomber sur un match du même jour avec le même score et lui donner des corners qui ne sont pas les siens.

### Taux de couverture exacts en production (ce matin)

Matchs avec corners / matchs terminés connus du robot.

| Championnat | Saison en cours | Saison précédente |
|---|---|---|
| Premier League | 6 / 110 (5 %) | 380 / 380 (100 %) |
| Championship | 26 / 192 (14 %) | 552 / 557 (99 %) |
| Ligue 1 | 24 / 99 (24 %) | 305 / 305 (100 %) |
| Ligue 2 | 50 / 117 (43 %) | 305 / 306 (100 %) |
| Bundesliga | 2 / 90 (2 %) | 156 / 306 (51 %) |
| Eredivisie | 5 / 117 (4 %) | 240 / 306 (78 %) |
| Serie A | 39 / 120 (33 %) | 380 / 380 (100 %) |
| Liga | 129 / 129 (100 %) | 306 / 380 (81 %) |
| Portugal | sans objet (corners non utilisés) | sans objet |

### Conséquence importante

**Le M7 en ligne n'utilise pas autant de corners que le M7 testé avant sa mise en ligne.** Le test hors ligne (7 437 matchs) prenait les corners directement dans le fichier, donc sur presque 100 % des matchs. En production, une partie manque depuis le premier jour (20/11). Le suivi mesure donc « M7 tel qu'il tourne vraiment ». La part des corners y est plus faible que prévu, surtout en Bundesliga, en Eredivisie et en Premier League.

### Correction possible (non appliquée, en attente de ta décision)

J'ai écrit un prototype (`test/lab/corners-v2-prototype.mjs`) qui reconnaît les équipes par **la date ET le score** de leurs matchs.

Sur les mêmes données, il relie **100 % des matchs** qui ont des corners, dans les 8 championnats et sur les 2 saisons. Une seule liaison fausse est apparue : 1 match en Ligue 1, dans une partie seulement des essais. Il faudra donc encore vérifier ce prototype avant toute utilisation.

Le brancher modifierait le moteur M7 pendant l'évaluation. C'est donc à toi de décider : corriger maintenant (et le noter comme une rupture du suivi), ou attendre la fin de l'évaluation.

### Le même défaut touche M7X

M7X relie ses xG aux matchs avec la même méthode. En simulation sur les deux saisons :
- Premier League, Serie A et Liga : liaison complète ;
- Ligue 1 : 78 à 100 % des matchs reliés ;
- **Bundesliga : seulement 47 à 93 %.**

La couverture réelle sera notée sur chaque ligne M7X. Rien n'est corrigé sans ton accord.

## 2. Vérification du premier bilan

**Wolverhampton–Charlton : c'est bien un match de Championship**, joué le samedi 21/11 à 15 h (heure anglaise), score 2-1. Il avait été écarté à tort. Comme il n'était pas affiché sur le site (au-delà des 10 matchs publiés), le script ne trouvait pas son résultat. Le script va maintenant chercher le score des matchs non affichés chez football-data.co.uk.

**Bilan corrigé :**

| | Matchs | M0 | M7 | Écart (Brier) | Fourchette | Écart (log loss) |
|---|---|---|---|---|---|---|
| Tous les matchs suivis | 65 | 0,5847 | 0,5793 | −0,0054 | de −0,0085 à +0,0011 | −0,0057 |
| Matchs affichés seulement (chiffres du 23/11) | 64 | 0,5900 | 0,5849 | −0,0051 | de −0,0081 à +0,0011 | −0,0051 |

- Pronostics enregistrés en retard : 0. Incidents : aucun.
- Registre : 1 113 lignes, chaîne d'empreintes intacte, 42 sceaux.

**Fragilité.** Cette fourchette a été calculée sur **deux journées seulement**. Elle est donc très fragile et ne permet aucune conclusion. Elle deviendra fiable seulement après plusieurs semaines de matchs.

**CSV des 65 prédictions** : `predictions-21-22-nov.csv`, une ligne par match. Il contient :
- les heures du coup d'envoi et de l'enregistrement ;
- le numéro de ligne au registre et l'empreinte ;
- la référence et l'heure du sceau GitHub (branche `suivi-empreintes`) ;
- le score, sa source, les probabilités M0 et M7, et les notes de chaque match.

Le fichier se refait avec `node test/lab/bilan-suivi.mjs <début> <fin> history.json predictions.csv`.

## 3. M7X

- **Aucune prédiction enregistrée à ce jour.** M7X attend la fin du remplissage de l'historique des xG.
- Ce matin, il restait **296 matchs** de la saison précédente à récupérer. Au rythme actuel, le remplissage devrait finir ce soir ou dans la nuit, avec une **première prédiction attendue le 25/11**. Je confirmerai la date réelle dès qu'elle sera enregistrée.

**Couverture xG de la saison en cours à la source** (matchs avec xG mesurés / matchs terminés) :

| Premier League | Ligue 1 | Bundesliga | Serie A | Liga |
|---|---|---|---|---|
| 90/110 (82 %) | 89/99 (90 %) | 80/90 (89 %) | 106/120 (88 %) | 115/129 (89 %) |

Il faut y ajouter l'effet de la liaison décrit au point 1, surtout en Bundesliga.

## 4. M7-40 : résultats détaillés du test historique

Détail complet dans `RESULTAT-FENETRES.md`.

- **Matchs** : 7 437, 9 championnats, saisons 2024-25 à 2026-27. Corners pris dans le fichier, donc presque complets.
- **Variantes essayées** : 4 (40, 30 et 20 derniers matchs, et « saison en cours seule »), sur 9 championnats, soit 36 comparaisons.
- **M7-40 contre M7 (80 matchs)** :
  - Brier **+0,0004**, fourchette de −0,0003 à +0,0012 ;
  - log loss **+0,0006**, fourchette de −0,0005 à +0,0017.
- **Par saison (Brier)** : +0,0003 / +0,0003 / +0,0010. M7-40 est donc **légèrement moins bon** sur les 3 saisons.
- **Où il fait un peu mieux** :
  - matchs avec un promu : −0,0006 ;
  - clubs qui ont beaucoup changé : −0,0007 ;
  - Ligue 1 : −0,0018 ;
  - Bundesliga : −0,0008 ;
  - Ligue 2 : −0,0008.
  
  Aucun de ces écarts n'est net.
- **Statut** : prêt en version cachée, **non déployé**.

## 5. Nouvelles recherches (forme domicile/extérieur, saison en cours)

Autorisées hors production. Elles seront menées uniquement sur l'historique, sans utiliser les matchs du suivi prospectif. Les variantes seront fixées avant le calcul et le nombre d'essais sera annoncé. Aucune piste ne sera rejetée seulement parce que son gain est petit. Résultats dans un prochain rapport.
