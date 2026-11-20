# Duel Prono — audit des modifications du 20/11/2026

Objet : audit reproductible des trois modifications mises en production le 20/11/2026 (promus, Elo 25 %, corners 30 %). **Aucun paramètre de production modifié, aucune nouvelle optimisation, aucune dépense d'API.** Les résultats ci-dessous sont **historiques** : ils ne prouvent pas un gain futur.

- Script : `test/lab/audit-20nov.mjs` — `node test/lab/audit-20nov.mjs <history.json> <sortie.csv> [sortie.json]` (≈ 20 s). Il lit les paramètres directement dans `src/config.js` et `src/corners.js` et appelle les fonctions de production (`buildModel`, `computeTeamRatings`, `computeElo`, `calculate_match_prediction`, `blendCorners`).
- Données : `data/history.json` du dépôt public PronostiK, commit `d7095cd` du 20/11/2026 (football-data.co.uk : résultats, corners, cotes moyennes). Code audité : PronoArena `8044a83` (production du 20/11, corners compris).
- CSV des prédictions (9 colonnes de probabilités, résultats réels, dates) : remis à part (`audit-20nov-predictions.csv`), non versé dans le dépôt public. Résultats chiffrés complets : `audit-20nov-resultats.json`.

## 0. Matchs évalués
- **7 437 matchs**, du **09/08/2024 au 08/11/2026** (dernière date évaluée), 9 championnats (FL1, PL, PD, SA, BL1, PPL, DED, ELC, FL2), 1re division du fichier uniquement.
- Exclusions : 1 match sans cotes moyennes (7 438 → 7 437, pour garder exactement l'échantillon des tests précédents) ; aucun match exclu pour manque d'historique (seuil : 20 matchs passés dans la compétition). 2 matchs sans corners : leurs vrais buts sont gardés (comme en production).
- Même ensemble de matchs pour les 8 configurations (apparié).

## 1. Fuites temporelles

| Modification | Fichiers / fonctions | Données accessibles pour un match du jour J |
|---|---|---|
| Promus | `src/build.js` `promotedTeams()` (l. 87) ; `src/model.js` `computeTeamRatings(finished, { newcomers })` (l. 90-130) ; `src/config.js` `MODEL.promoted`, `promotedMaxTeams`, `promus: true` (7 championnats) | Statut : équipe présente dans la saison S (matchs joués + calendrier à venir) et absente de tous les matchs **terminés** de S−1. Forces : matchs terminés avant J. |
| Elo 25 % | `src/model.js` `computeElo()` (l. 132-148) et mélange dans `calculate_match_prediction` (l. 267-272) ; `src/config.js` `MODEL.eloMix`, `eloK`, `eloHomeAdv`, `eloSeasonCarry` ; `src/build.js` l. 152 (`eloMix: !lg.cup && !lg.national`) | Elo recalculé à chaque fois depuis zéro sur les matchs terminés avant J (saison S et S−1). |
| Corners 30 % | `src/corners.js` `refreshCorners()`, `matchCorners()`, `blendCorners()` ; `src/build.js` l. 113-120 ; `src/robot.js` l. 197 | Corners des seuls matchs terminés présents dans le fichier football-data.co.uk au moment du passage du robot, reliés à un match déjà terminé du robot (date ± 1 jour **et** même score). |

Preuves :
- **Résultat du match prédit et matchs ultérieurs exclus.** En production, `toFinished()` (`src/sources.js`) ne garde que les matchs au statut `FINISHED` (football-data.org) ou `FT/AET/PENS` (SportAPI) ; un match à venir n'a pas de score. Dans l'audit, chaque journée J est prédite avec `past = matchs de date < J` (saisons S et S−1). Contrôle automatique du script : sur 2 355 journées, **0** utilise un match du jour ou postérieur (`controles.fuiteResultat = 0`).
- **Corners disponibles avant la prédiction.** La table de corners de chaque journée est construite uniquement à partir de `past` (`controles.fuiteCorners = 0`). Le fichier football-data.co.uk n'est mis à jour que quelques fois par semaine : la variante **M7r** n'utilise que les corners des matchs joués au moins 4 jours avant J. Résultat identique à M7 (Brier 0,5963 dans les deux cas) : le délai de publication ne change pas le gain. En production, un match pas encore présent dans le fichier garde ses vrais buts.
- **Elo** : départ 1 500 pour toute équipe à son premier match de la fenêtre ; entre deux saisons, retour de 20 % vers 1 500 (`eloSeasonCarry 0,8`) ; après chaque match, `d = 20 × (1 + ln(1 + |écart de buts|)) × (résultat − attendu)`, avantage du terrain 60 points, attendu logistique base 10 / 400. Calculé sur les **vrais buts** uniquement (pas sur les corners). Le mélange : prévision Elo = régression ordonnée sur l'écart d'Elo / 100 (pente 0,514, seuils −0,904 et 0,290), mélangée à 25 % aux probabilités 1-N-2 ; la grille des scores est remise à l'échelle par zone. **Attention : ces 3 paramètres et le poids 25 % ont été ajustés sur les résultats de 2024-25** (voir §4) : pour 2024-25, c'est un ajustement dans l'échantillon, pas une fuite chronologique au sens strict, mais ce n'est pas une prédiction honnête non plus.
- **Statut de promu** : déterminé par la composition de la saison (calendrier connu avant la saison) et les matchs terminés de S−1 ; jamais par un résultat de la saison S. Garde-fou : plus de 4 nouvelles équipes → pas de correction. Dans l'audit, la liste des équipes de S vient de toutes les lignes de S du fichier (équipes uniquement, pas leurs résultats), ce qui équivaut au calendrier.
- **Corners dans les forces** : moyenne de championnat, buts/corners et forces calculés sur `past` uniquement ; l'Elo, le classement, la forme et les statistiques affichées restent sur les vrais buts.

## 2. Performances combinées (mêmes 7 437 matchs)

Écart = configuration − M0, apparié match par match ; IC 95 % par bootstrap regroupé par date (3 000 tirages). Négatif = mieux.

| Config | Contenu | Brier | Log loss | Écart Brier vs M0 [IC 95 %] | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|---|
| M0 | ancien moteur | 0,6006 | 1,0040 | +0,0000 [+0,0000 ; +0,0000] | +0,0000 [+0,0000 ; +0,0000] |
| M1 | promus | 0,5990 | 1,0018 | −0,0016 [−0,0030 ; −0,0003] | −0,0022 [−0,0042 ; −0,0003] |
| M2 | Elo | 0,5994 | 1,0023 | −0,0012 [−0,0019 ; −0,0005] | −0,0017 [−0,0027 ; −0,0007] |
| M3 | corners | 0,5985 | 1,0012 | −0,0020 [−0,0032 ; −0,0009] | −0,0028 [−0,0046 ; −0,0011] |
| M4 | promus + Elo | 0,5976 | 0,9998 | −0,0029 [−0,0042 ; −0,0017] | −0,0042 [−0,0060 ; −0,0025] |
| M5 | promus + corners | 0,5972 | 0,9992 | −0,0034 [−0,0053 ; −0,0017] | −0,0048 [−0,0075 ; −0,0024] |
| M6 | Elo + corners | 0,5978 | 1,0003 | −0,0027 [−0,0040 ; −0,0015] | −0,0038 [−0,0057 ; −0,0020] |
| M7 | les trois (production) | 0,5963 | 0,9979 | −0,0043 [−0,0060 ; −0,0028] | −0,0061 [−0,0086 ; −0,0039] |
| M7r | M7, corners avec 4 j de retard | 0,5963 | 0,9979 | −0,0043 [−0,0060 ; −0,0028] | −0,0061 [−0,0086 ; −0,0040] |


**Saison 2024-25** (3222 matchs)

| Config | Brier | Log loss | Écart Brier [IC 95 %] | Écart log loss [IC 95 %] |
|---|---|---|---|---|
| M0 | 0,5950 | 0,9952 | +0,0000 [+0,0000 ; +0,0000] | +0,0000 [+0,0000 ; +0,0000] |
| M1 | 0,5929 | 0,9924 | −0,0021 [−0,0041 ; −0,0002] | −0,0028 [−0,0058 ; −0,0001] |
| M2 | 0,5941 | 0,9940 | −0,0009 [−0,0020 ; +0,0002] | −0,0013 [−0,0029 ; +0,0003] |
| M3 | 0,5935 | 0,9932 | −0,0016 [−0,0033 ; +0,0003] | −0,0021 [−0,0046 ; +0,0006] |
| M4 | 0,5921 | 0,9911 | −0,0029 [−0,0049 ; −0,0011] | −0,0041 [−0,0069 ; −0,0015] |
| M5 | 0,5915 | 0,9903 | −0,0036 [−0,0063 ; −0,0010] | −0,0049 [−0,0088 ; −0,0013] |
| M6 | 0,5930 | 0,9926 | −0,0020 [−0,0040 ; −0,0000] | −0,0027 [−0,0057 ; +0,0003] |
| M7 | 0,5910 | 0,9897 | −0,0040 [−0,0066 ; −0,0016] | −0,0055 [−0,0094 ; −0,0020] |
| M7r | 0,5910 | 0,9896 | −0,0041 [−0,0067 ; −0,0017] | −0,0056 [−0,0095 ; −0,0021] |

**Saison 2025-26** (3221 matchs)

| Config | Brier | Log loss | Écart Brier [IC 95 %] | Écart log loss [IC 95 %] |
|---|---|---|---|---|
| M0 | 0,6072 | 1,0140 | +0,0000 [+0,0000 ; +0,0000] | +0,0000 [+0,0000 ; +0,0000] |
| M1 | 0,6064 | 1,0127 | −0,0007 [−0,0027 ; +0,0012] | −0,0013 [−0,0041 ; +0,0014] |
| M2 | 0,6054 | 1,0114 | −0,0018 [−0,0029 ; −0,0007] | −0,0026 [−0,0042 ; −0,0010] |
| M3 | 0,6047 | 1,0105 | −0,0025 [−0,0042 ; −0,0007] | −0,0035 [−0,0061 ; −0,0008] |
| M4 | 0,6044 | 1,0098 | −0,0028 [−0,0045 ; −0,0011] | −0,0042 [−0,0067 ; −0,0019] |
| M5 | 0,6044 | 1,0097 | −0,0028 [−0,0053 ; −0,0002] | −0,0043 [−0,0078 ; −0,0005] |
| M6 | 0,6035 | 1,0087 | −0,0037 [−0,0055 ; −0,0019] | −0,0053 [−0,0081 ; −0,0025] |
| M7 | 0,6027 | 1,0074 | −0,0044 [−0,0066 ; −0,0022] | −0,0066 [−0,0097 ; −0,0033] |
| M7r | 0,6028 | 1,0075 | −0,0044 [−0,0065 ; −0,0022] | −0,0065 [−0,0096 ; −0,0032] |

**Saison 2026-27** (994 matchs)

| Config | Brier | Log loss | Écart Brier [IC 95 %] | Écart log loss [IC 95 %] |
|---|---|---|---|---|
| M0 | 0,5971 | 1,0003 | +0,0000 [+0,0000 ; +0,0000] | +0,0000 [+0,0000 ; +0,0000] |
| M1 | 0,5943 | 0,9972 | −0,0028 [−0,0074 ; +0,0016] | −0,0031 [−0,0102 ; +0,0037] |
| M2 | 0,5968 | 0,9997 | −0,0004 [−0,0023 ; +0,0014] | −0,0006 [−0,0034 ; +0,0020] |
| M3 | 0,5950 | 0,9973 | −0,0022 [−0,0057 ; +0,0015] | −0,0030 [−0,0080 ; +0,0021] |
| M4 | 0,5937 | 0,9958 | −0,0034 [−0,0074 ; +0,0005] | −0,0045 [−0,0102 ; +0,0013] |
| M5 | 0,5923 | 0,9940 | −0,0048 [−0,0100 ; +0,0003] | −0,0063 [−0,0138 ; +0,0012] |
| M6 | 0,5954 | 0,9979 | −0,0017 [−0,0054 ; +0,0021] | −0,0024 [−0,0077 ; +0,0032] |
| M7 | 0,5924 | 0,9938 | −0,0047 [−0,0094 ; −0,0001] | −0,0065 [−0,0131 ; +0,0001] |
| M7r | 0,5922 | 0,9936 | −0,0049 [−0,0096 ; −0,0002] | −0,0067 [−0,0133 ; −0,0000] |

### Par championnat (écarts de Brier vs M0)

| Champ. | Matchs | Brier M0 | M1 écart [IC] | M2 écart [IC] | M3 écart [IC] | M4 écart [IC] | M5 écart [IC] | M6 écart [IC] | M7 écart [IC] |
|---|---|---|---|---|---|---|---|---|---|
| FL1 | 702 | 0,5934 | −0,0025 [−0,0082 ; +0,0026] | −0,0021 [−0,0044 ; +0,0001] | −0,0022 [−0,0060 ; +0,0015] | −0,0049 [−0,0095 ; −0,0006] | −0,0050 [−0,0109 ; +0,0009] | −0,0037 [−0,0076 ; +0,0004] | −0,0066 [−0,0115 ; −0,0017] |
| PL | 860 | 0,6061 | −0,0020 [−0,0067 ; +0,0027] | −0,0007 [−0,0027 ; +0,0012] | −0,0021 [−0,0050 ; +0,0010] | −0,0031 [−0,0068 ; +0,0008] | −0,0041 [−0,0096 ; +0,0013] | −0,0024 [−0,0055 ; +0,0007] | −0,0047 [−0,0093 ; −0,0003] |
| PD | 879 | 0,5814 | −0,0014 [−0,0048 ; +0,0019] | −0,0005 [−0,0023 ; +0,0012] | +0,0001 [−0,0036 ; +0,0036] | −0,0021 [−0,0054 ; +0,0011] | −0,0011 [−0,0064 ; +0,0038] | −0,0005 [−0,0040 ; +0,0029] | −0,0021 [−0,0067 ; +0,0021] |
| SA | 870 | 0,5845 | −0,0030 [−0,0072 ; +0,0011] | −0,0006 [−0,0026 ; +0,0014] | +0,0006 [−0,0031 ; +0,0044] | −0,0034 [−0,0071 ; +0,0001] | −0,0020 [−0,0073 ; +0,0034] | −0,0000 [−0,0039 ; +0,0040] | −0,0026 [−0,0074 ; +0,0022] |
| BL1 | 693 | 0,5989 | −0,0033 [−0,0087 ; +0,0021] | −0,0018 [−0,0040 ; +0,0004] | −0,0038 [−0,0073 ; −0,0003] | −0,0050 [−0,0097 ; −0,0004] | −0,0057 [−0,0121 ; +0,0006] | −0,0046 [−0,0085 ; −0,0006] | −0,0068 [−0,0124 ; −0,0015] |
| PPL | 710 | 0,5511 | +0,0005 [−0,0043 ; +0,0052] | +0,0009 [−0,0010 ; +0,0027] | +0,0000 [+0,0000 ; +0,0000] | +0,0005 [−0,0032 ; +0,0042] | +0,0005 [−0,0043 ; +0,0052] | +0,0009 [−0,0010 ; +0,0027] | +0,0005 [−0,0032 ; +0,0042] |
| DED | 720 | 0,5896 | −0,0038 [−0,0097 ; +0,0022] | −0,0015 [−0,0037 ; +0,0006] | −0,0036 [−0,0075 ; +0,0003] | −0,0053 [−0,0101 ; −0,0005] | −0,0065 [−0,0132 ; +0,0005] | −0,0039 [−0,0084 ; +0,0005] | −0,0070 [−0,0128 ; −0,0010] |
| ELC | 1284 | 0,6343 | +0,0000 [+0,0000 ; +0,0000] | −0,0015 [−0,0031 ; +0,0000] | −0,0030 [−0,0053 ; −0,0005] | −0,0015 [−0,0031 ; +0,0000] | −0,0030 [−0,0053 ; −0,0005] | −0,0039 [−0,0063 ; −0,0015] | −0,0039 [−0,0063 ; −0,0015] |
| FL2 | 719 | 0,6450 | +0,0000 [+0,0000 ; +0,0000] | −0,0031 [−0,0054 ; −0,0007] | −0,0047 [−0,0080 ; −0,0014] | −0,0031 [−0,0054 ; −0,0007] | −0,0047 [−0,0080 ; −0,0014] | −0,0066 [−0,0102 ; −0,0030] | −0,0066 [−0,0102 ; −0,0030] |


**Pourquoi 0,5968 était annoncé sans corners.** Le Verdict a été recalculé le 20/11 vers 10 h 40 (Paris), avant la décision sur les corners (10 h 57) ; `test/backtest.mjs` reproduit les promus et l'Elo mais **pas encore les corners**. Il porte aussi sur un échantillon un peu différent (7 168 matchs : il exige la prévision PronostiK). Les corners sont en cours de rattrapage par le robot (≈ 3 h). Sur l'échantillon de cet audit, la production (M7) vaut **0,5963** contre 0,5976 pour promus + Elo (M4). Le Verdict ne sera recalculé avec les corners qu'après validation de l'auditeur.

## 3. Solidité statistique
- Global : M7 − M0 = **−0,0043** de Brier [−0,0060 ; −0,0028] et **−0,0061** de log loss [−0,0086 ; −0,0039], sur 7 437 matchs.
- Chaque modification seule a un intervalle entièrement négatif sur l'ensemble (M1, M2, M3). Les combinaisons s'additionnent à peu près (M4 −0,0029 ≈ M1 + M2 −0,0028 ; M7 −0,0043 < somme des trois −0,0048).
- Par saison, M7 est négatif sur les trois saisons (−0,0040, −0,0044, −0,0047) ; pour 2026-27 (994 matchs), l'intervalle touche presque 0 ([−0,0094 ; −0,0001]).
- Par championnat : M7 n'est **pas** meilleur au Portugal (+0,0005, IC contenant 0 ; seul l'Elo s'y applique et il y est légèrement défavorable) ; Liga et Serie A : négatif mais intervalle contenant 0.
- Ces intervalles ne tiennent pas compte des comparaisons multiples ni du fait que les réglages ont été choisis sur ces mêmes saisons (§4) : ils **surestiment** la solidité.

## 4. Surapprentissage : saisons ayant servi aux choix

| Choix | Saisons utilisées pour le régler | Saisons consultées avant la décision |
|---|---|---|
| Promus : réglage (K 15, attaque 0,75, défense 1,30) | 2024-25 | 2024-25, 2025-26, 2026-27 (résultats affichés avant la décision) |
| Promus : exclusion Championship et Ligue 2 | décidée **après** avoir vu 2025-26 (et 2026-27) | toutes |
| Elo : paramètres de la régression et poids 25 % | 2024-25 | toutes (piste 3 du 12/11 : périodes A/B/C, α 0,30 ; reprise le 20/11 sur 3 saisons) |
| Corners 30 % | 2024-25 ; grille élargie 30-70 % **après** avoir vu les 3 saisons (optimum resté 30 %) | toutes |
| Exclusion du Portugal (corners) | décidée **après** avoir vu 2025-26 et 2026-27 | toutes |

**Aucune des trois saisons (2024-25, 2025-26, 2026-27 jusqu'au 08/11) n'est une validation indépendante.** Les gains du §2 sont des résultats historiques en partie dans l'échantillon.

Annexe (information, pas une validation) : un contrôle par rotation a été lancé juste avant la demande d'audit (`test/lab/run-controle-rotation.mjs`) : pour chaque saison jugée, réglages ET exclusions refaits sur les deux autres. Gains totaux sur la saison laissée de côté : 2024-25 −0,0028, 2025-26 −0,0021, 2026-27 −0,0043 (moyenne −0,0027, contre −0,0043 avec les réglages de production). Les exclusions retrouvées varient d'une rotation à l'autre (corners : Portugal exclu 3 fois sur 3, Liga et Serie A 2 fois, Bundesliga, Ligue 1 et Premier League 1 fois ; promus : Ligue 2 gardée une fois, Portugal exclu une fois). Ce contrôle reste biaisé : les méthodes et les grilles ont été conçues après avoir vu toutes les saisons.

## 5. Validation chronologique réellement nouvelle (proposition)
- **Paramètres figés** : ceux du commit `8044a83` (production du 20/11/2026), sans aucune réoptimisation. Toute modification ultérieure du moteur démarre une nouvelle période de validation.
- **Matchs** : uniquement ceux joués **à partir du 21/11/2026**, mêmes 9 championnats, mêmes règles (matchs avec cotes moyennes, 1re division du fichier).
- **Comparaison** : M7 (production) contre M0 (ancien moteur), et M1/M2/M3 pour information, avec ce même script (seule la date de début change : `≥ 2026-11-21`).
- **Points de mesure fixés à l'avance** : point intermédiaire à **1 500 matchs** (≈ fin mars 2027), point final à la **fin de la saison 2026-27** (≈ 2 300 matchs). Le résultat sera publié quel qu'il soit.
- **Critère fixé à l'avance** : écart de Brier M7 − M0 négatif avec l'intervalle à 95 % (bootstrap par date) entièrement sous 0 au point final ; même signe pour le log loss. Sinon, la conclusion sera « gain non confirmé », et le retour à M0 sera proposé à Kay.
- Le 20/11, aucune nouvelle optimisation n'a été lancée pour cet audit. Le test des tirs cadrés est suspendu.
