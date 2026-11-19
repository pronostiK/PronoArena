# Piste 8 — absences de joueurs : proposition technique courte (19/11/2026)

Aucun développement, aucun abonnement, aucun appel API. Moteur inchangé.

## 1. Quelle information nouvelle ?

La liste des joueurs indisponibles (blessés, suspendus) **connue avant le match**, que le moteur ignore aujourd'hui : il ne voit que les scores passés.

## 2. Ce qu'on sait déjà

- Une étude antérieure sur 1 698 matchs de 2024-25 (5 championnats, absents API-Football) a donné un gain minuscule et non significatif : −0,0011 de log loss, intervalle contenant 0 (`lab/RAPPORT-ABSENCES.md` du dépôt PronostiK, cité dans la passation du 12/11). **Attente réaliste : un effet faible.**
- Notre test détecte mal les petits effets : sur 3 500 matchs, l'intervalle à 95 % sur un écart de Brier est d'environ ±0,001.

## 3. Données nécessaires

Pour chaque match de 2023/24 à 2025/26 (5 championnats) :
1. la liste des joueurs indisponibles **telle qu'elle était connue la veille du match** : joueur, équipe, motif (blessure / suspension), date de début, date de fin ou retour prévu ;
2. **la date à laquelle l'information est apparue** (sinon on ne peut pas exclure une fuite) ;
3. l'importance du joueur, calculée sans fuite à partir des matchs *précédents* seulement (part des minutes jouées sur les 10 derniers matchs, via les compositions).

## 4. Disponibilité chez Sportmonks (à confirmer, rien n'est acheté)

- Sportmonks expose les joueurs blessés ou suspendus par match via l'inclusion `sidelined`, avec les dates de début et de fin quand elles sont connues ([Sportmonks, tutoriel compositions](https://docs.sportmonks.com/football/tutorials-and-guides/tutorials/lineups-and-formations)). La documentation de changements précise que ces dates peuvent manquer ([Sportmonks, changelog](https://docs.sportmonks.com/v3/changelog)).
- Les compositions officielles sont publiées environ 1 heure avant le coup d'envoi ; les compositions prévues « expected lineups » sont un module à part, payant ([Sportmonks, expected lineups](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/premium-expected-lineups)).
- **Non démontré** : que l'historique des absences 2023-2026 soit disponible dans l'offre abordable, couvre nos 5 championnats, et surtout **ne soit pas un état final réécrit après coup**. Une date de début n'est pas une date de publication : un joueur peut être enregistré « blessé depuis le 3 » alors que l'info n'est apparue que le 10. C'est le risque principal de fuite.
- Autre source repérée : TheStatsAPI propose les blessures et suspensions par équipe et par joueur ([TheStatsAPI, équipes](https://www.thestatsapi.com/docs/api-reference/teams/injuries.md)) ; l'historique et l'horodatage ne sont pas confirmés non plus.
- Les tarifs notés dans la passation (Sportmonks 29 €/mois clubs, TheStatsAPI 50 $/mois) datent du 12/11 et sont à revérifier avant toute décision.

## 5. Conditions d'un test historique sans fuite

1. **Règle de statut** : un joueur compte comme absent le jour D si son absence a commencé avant D−1 **et** n'était pas terminée à D−1. La fin réelle n'est jamais utilisée pour prédire.
2. **Contrôle de fuite avant tout calcul** (gratuit, sur 30 à 50 matchs) : vérifier, pour des absences connues (ex. blessures longues annoncées dans la presse), que la donnée historique porte bien une date d'apparition antérieure au match. Si les données sont des états finaux sans horodatage de publication, **le test historique est invalide** et on bascule en collecte prospective.
3. **Collecte prospective** (plan B, fiable) : archiver chaque jour, à partir d'aujourd'hui, la liste des absents des matchs à venir, avec l'horodatage de relevé. Test sur la saison 2026/27 une fois assez de matchs accumulés (environ 1 500 pour les 5 championnats, soit 3 à 4 mois de saison).

## 6. Mesure et critère d'intégration

- **Une seule variante, définie avant le calcul** : un indice d'absence par équipe (part des minutes récentes des absents) qui multiplie l'attaque et la défense attendues de l'équipe d'un facteur 1 − β × indice, β choisi sur la période A dans une grille fixée à l'avance, vérifié sur B sans réglage, C en diagnostic.
- Mesures : Brier et log loss 1-N-2, calibration des favoris, par championnat et période, IC 95 % par rééchantillonnage par date (comme les tests précédents).
- **Critère d'intégration** : gain de Brier d'au moins 0,002 avec un intervalle à 95 % entièrement sous 0 sur A+B, même signe sur A, B et C, et confirmation sur des matchs réellement nouveaux (2026/27) avant mise en production. Sinon, le moteur reste inchangé.

## 7. Étapes et décisions demandées à l'auditeur

| Étape | Coût | Décision |
|---|---|---|
| 1. Contrôle de fuite sur 30 à 50 matchs (essai gratuit ou plan gratuit, sinon abandon) | 0 € | Autorisation de créer un compte d'essai et de lire quelques matchs |
| 2. Si l'historique est horodaté : test historique A/B/C | abonnement d'un mois à décider | Autorisation d'abonnement |
| 3. Sinon : collecte prospective quotidienne | abonnement continu ou API gratuite | Autorisation de développement |

Option moins chère à examiner en parallèle : relancer les probabilités une heure avant le coup d'envoi avec les compositions officielles (déjà collectées par le site via ESPN). C'est une information nouvelle, mesurable sur la saison 2026/27, mais les probabilités affichées changeraient peu avant le match ; à discuter.

## 8. Arrêt

Proposition seule. Rien n'est lancé en attendant la validation de l'auditeur.
