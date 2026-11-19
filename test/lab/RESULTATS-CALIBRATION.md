# RESULTATS-CALIBRATION — calibration par température du moteur M0 (19/11/2026)

Test exécuté (`TEST-CALIBRATION.mjs`). Entrée : colonnes M0 de `PREDICTIONS-PONDERATION.csv` (3 503 matchs, probabilités du moteur arrondies à 3 décimales). Aucun fichier de production modifié, aucun xG.

## Protocole (fixé avant le calcul)

p'_i = p_i^(1/T) / somme_j(p_j^(1/T)). T parmi 0,85 ; 0,90 ; 0,95 ; 1,00 ; 1,05 ; 1,10 ; 1,15 ; 1,20. Choix de T sur la période A seule (Brier moyen le plus bas, T = 1 en référence, on ne le quitte que si un autre T est strictement meilleur). Le T choisi est évalué ensuite sur B sans réajustement, puis sur C (diagnostic déjà consulté). Mêmes matchs pour tous les T. Périodes : A ≤ 30/06/2025 (1 752 matchs), B 01/07/2025 → 28/02/2026 (1 218), C ≥ 01/03/2026 (533). Aucune n'est une validation prospective intacte.

## Résultat principal

**Sur A, aucun T n'améliore le Brier : T = 1,00 est retenu. Le moteur M0 n'est donc pas corrigé, et l'évaluation du « T retenu » sur B et C est identique à M0.**

| T | Brier A | Écart vs T = 1 | Log loss A |
|---|---|---|---|
| 0,85 | 0,59226 | +0,00169 | 0,99127 |
| 0,90 | 0,59125 | +0,00068 | 0,98976 |
| 0,95 | 0,59072 | +0,00015 | 0,98904 |
| **1,00** | **0,59057** | — | 0,98893 |
| 1,05 | 0,59072 | +0,00015 | 0,98927 |
| 1,10 | 0,59111 | +0,00054 | 0,98996 |
| 1,15 | 0,59169 | +0,00111 | 0,99092 |
| 1,20 | 0,59240 | +0,00183 | 0,99206 |

Le Brier de A est minimal à T = 1 et monte des deux côtés : le moteur est déjà bien « étalé » globalement. Contrôle : M0 brut (non renormalisé) 0,59058, identique à T = 1 à l'arrondi.

## B, C et tous matchs (T = 1 retenu, donc valeurs de M0)

| Période | Matchs | Brier | Log loss |
|---|---|---|---|
| A | 1 752 | 0,59057 | 0,98893 |
| B | 1 218 | 0,59475 | 0,99742 |
| C (diagnostic) | 533 | 0,60930 | 1,01737 |
| Tous | 3 503 | 0,59487 | 0,99621 |

## Information seulement (non utilisée pour choisir T)

| T | Brier B | Écart vs T = 1 | Brier C | Écart vs T = 1 |
|---|---|---|---|---|
| 0,85 | 0,59446 | −0,00029 | 0,61178 | +0,00248 |
| 0,90 | 0,59422 | −0,00053 | 0,61053 | +0,00123 |
| 0,95 | 0,59434 | −0,00040 | 0,60973 | +0,00043 |
| 1,00 | 0,59475 | — | 0,60930 | — |
| 1,05 | 0,59536 | +0,00062 | 0,60915 | −0,00015 |
| 1,10 | 0,59614 | +0,00140 | 0,60922 | −0,00007 |
| 1,15 | 0,59704 | +0,00230 | 0,60948 | +0,00018 |
| 1,20 | 0,59803 | +0,00328 | 0,60987 | +0,00057 |

Le meilleur T change selon la période : 1,00 en A, environ 0,90 en B, environ 1,05-1,10 en C. Les écarts restent ≤ 0,0005 de Brier en dehors des T extrêmes. Aucune direction stable : on ne peut pas dire qu'il faille « resserrer » ou « étaler » les probabilités.

## Calibration des favoris (groupes par probabilité M0 du favori ; mêmes matchs)

| Groupe | A : matchs, observé, annoncé | B : matchs, observé, annoncé | C : matchs, observé, annoncé |
|---|---|---|---|
| favori < 50 % | 907 : 41,8 % / 42,4 % | 691 : 44,1 % / 42,4 % | 296 : 39,9 % / 42,3 % |
| 50-60 % | 397 : 56,9 % / 54,5 % | 305 : 55,7 % / 54,4 % | 137 : 58,4 % / 54,7 % |
| 60-70 % | 289 : 61,3 % / 64,4 % | 153 : 69,9 % / 64,0 % | 67 : 59,7 % / 64,3 % |
| ≥ 70 % | 159 : 79,3 % / 76,6 % | 69 : 79,7 % / 76,6 % | 33 : 78,8 % / 77,4 % |
| favoris ≥ 60 % | 448 : 67,6 % / 68,7 % | 222 : 73,0 % / 68,0 % | 100 : 66,0 % / 68,6 % |
| nuls | observé 24,9 % / annoncé 25,1 % | 25,4 % / 25,8 % | 25,5 % / 25,7 % |

Tous matchs : favoris ≥ 60 % : 770 matchs, 68,96 % observé pour 68,46 % annoncé ; nuls 25,2 % observé pour 25,4 % annoncé. Les écarts changent de signe d'une période à l'autre (favoris ≥ 60 % : sur-annoncés en A et C, sous-annoncés en B). Les groupes de C comptent 33 à 296 matchs : bruit important.

## Lecture

1. **Aucune calibration par température n'est justifiée** : A choisit T = 1, et l'information B/C montre un meilleur T instable.
2. Pas de biais systématique des favoris : sur tous les matchs, 68,96 % observé contre 68,46 % annoncé.
3. Ce résultat est cohérent avec les pistes précédentes (pas de gain robuste) ; **le moteur reste inchangé**.
4. Limites : probabilités du fichier arrondies à 3 décimales ; A, B et C déjà utilisées dans les pistes précédentes ; une température unique ne corrige pas un défaut propre à une zone de probabilités (les groupes de favoris ne montrent pas de schéma stable à corriger).

## Fichiers

`TEST-CALIBRATION.mjs` ; `PREDICTIONS-CALIBRATION.csv` (3 503 lignes : date, championnat, période, équipes, résultat, probabilités M0 et probabilités corrigées pour le T retenu = 1,00, donc égales à M0 à la renormalisation près ; empreinte SHA-256 `6207bded42f2ff50…`). Ne pas publier avec les données sources Bzzoiro.
