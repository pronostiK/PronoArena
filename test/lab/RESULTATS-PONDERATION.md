# RESULTATS-PONDERATION — test de la pondération des matchs récents (19/11/2026)

Test exécuté (script `TEST-PONDERATION.mjs`, sortie complète conservée). Buts réels seulement, aucun xG lu. Aucun fichier de production modifié (seuls `MODEL.recentMatches` et `MODEL.recentWeight` sont changés en mémoire pendant le calcul, puis rétablis ; le script le vérifie).

## Protocole

- Configurations : **M0** moteur actuel (lu dans `src/config.js` : 8 derniers matchs ×1,5) ; **M1** 5 derniers ×2 ; **M2** 10 derniers ×2 ; **M3** 15 derniers ×1,5. Tout le reste est celui du moteur (fenêtre 80 matchs, lissage 6, poids spécifique domicile/extérieur 0,3, rho −0,08, Poisson + Dixon-Coles via `src/model.js` appelé tel quel).
- Données : `xg_bzzoiro.csv`, colonnes date, équipes, buts uniquement ; barrages retirés (18 matchs) ; 5 championnats.
- Chronologie : pour chaque date, seuls les matchs de dates **strictement antérieures** (aucun match du jour), saison en cours + précédente, au moins 20 matchs. Test à partir du 01/08/2024. Mêmes 3 503 matchs pour les quatre modèles.
- Périodes : A ≤ 30/06/2025 (1 752 matchs, sélection exploratoire) ; B 01/07/2025–28/02/2026 (1 218, vérification de stabilité) ; C ≥ 01/03/2026 (533, **diagnostic déjà consulté**, pas une validation). Aucune de ces périodes n'est une validation prospective intacte.
- Mesures : Brier 1-N-2 (somme des carrés sur 3 issues) et log loss 1-N-2. Écarts = modèle − M0 (négatif = meilleur). IC 95 % par rééchantillonnage regroupé par date (3 000 tirages, graine 11).

## Vérifications faites

- **M0 retrouve la Piste 6** : Brier 0,59487 sur 3 503 matchs (0,5949 annoncé en Piste 6), périodes A/B/C identiques à celles de ce test.
- Deux exécutions successives donnent un fichier de prédictions identique (SHA-256 commençant par `b5e8cf2a4b56adfc`).
- Les probabilités de chaque modèle somment à 1 (à l'arrondi) sur les 3 503 lignes ; dates du 2024-08-15 au 2026-05-24.
- Le script ne lit aucune colonne xG (recherche de `xg_` dans le script : aucune lecture).

## Résultats (extrait ; tableaux complets en fin de document)

| Période | M1 (5×2) Brier / LL | M2 (10×2) Brier / LL | M3 (15×1,5) Brier / LL |
|---|---|---|---|
| Tous (3 503) | +0,00045 / +0,00048 | −0,00020 / −0,00037 | −0,00028 / −0,00030 |
| A (1 752) | +0,00000 / −0,00019 | **−0,00034 / −0,00053** | −0,00023 / −0,00022 |
| B (1 218) | +0,00083 / +0,00113 | −0,00019 / −0,00032 | −0,00057 / −0,00078 |
| C (533, diagnostic) | +0,00102 / +0,00122 | +0,00025 / +0,00004 | +0,00024 / +0,00050 |

Brier de M0 : 0,59487 (tous), 0,59058 (A), 0,59475 (B), 0,60929 (C). Log loss de M0 : 0,9962 / 0,98892 / 0,99741 / 1,01737.

**Tous les intervalles à 95 % contiennent 0** pour les lignes « tous les matchs », A, B et C, les trois modèles et les deux mesures. Sur l'ensemble des 144 intervalles du document (y compris par championnat et par période), seuls 2 excluent 0 : M1 en Ligue 1 période B (+0,00377 de Brier, +0,00548 de log loss, donc **moins bon** que M0). Aucun intervalle ne montre un modèle meilleur que M0. Avec 144 intervalles à 95 %, quelques exclusions par pur hasard sont attendues.

Par championnat (toutes périodes, écart Brier vs M0) : La Liga M2 −0,00063, M3 −0,00098 [−0,00203 ; +0,00003] ; Premier League M2 −0,00091, M3 −0,00101 ; Bundesliga M1/M2/M3 +0,0006/+0,0003/+0,0007 (moins bon) ; Ligue 1 +0,0016/+0,0010/+0,0003 (moins bon) ; Serie A : voir tableaux. Sur les 15 cellules championnat × période, le modèle bat M0 en Brier dans 5 cellules pour M1, 7 pour M2, 8 pour M3.

Favoris (≥ 60 % annoncé) : M0 annonce 68,5 % pour 69,0 % observé (770 matchs) ; M1 68,7 / 68,8 (760) ; M2 68,8 / 68,8 (791) ; M3 68,6 / 68,6 (777). Aucune dérive visible.

## Lecture

1. **Selon le protocole** : A (sélection exploratoire) désigne M2 (meilleur Brier et log loss, −0,00034 / −0,00053). B (stabilité) ne le confirme pas nettement : M2 est quasi à égalité avec M0 (−0,00019) ; c'est M3 qui est meilleur en B (−0,00057). C (diagnostic) est défavorable aux trois modèles (+0,0002 à +0,001).
2. **Aucune différence n'est statistiquement distinguable de zéro** : les écarts sont de 0,0002 à 0,0006 de Brier, contre des intervalles d'environ ±0,001.
3. **M1 (5 derniers ×2) est le moins bon** : il est au-dessus de M0 en B et C et globalement ; mettre plus de poids sur très peu de matchs ne semble pas aider.
4. **Effets selon les championnats, non répétés** : M2 et M3 progressent en La Liga et en Premier League, mais reculent en Bundesliga et en Ligue 1. Un effet par championnat observé après coup ne vaut pas preuve (comparaisons multiples).
5. **Conclusion** : aucun signe d'amélioration robuste. **Le moteur actuel (M0) reste inchangé.** Ce test est un diagnostic historique ; si l'on voulait retenir M2 ou M3, il faudrait une validation sur la saison 2026/27, avec la configuration figée à l'avance.

## Limites

- Les quatre modèles sont corrélés (mêmes matchs, réglages proches) : les écarts sont très petits et les IC larges.
- C est déjà consulté dans des pistes précédentes ; A et B ont servi aux pistes précédentes pour d'autres variantes (ce n'est pas une période vierge).
- Pas de cotes de bookmakers dans le fichier : pas de comparaison au marché ici.
- Les 15 cellules championnat × période comptent 30 à 380 matchs chacune : bruit élevé.

## Fichiers

`TEST-PONDERATION.mjs` (script, commande : `node test/lab/TEST-PONDERATION.mjs xg_bzzoiro.csv PREDICTIONS-PONDERATION.csv`), `PREDICTIONS-PONDERATION.csv` (3 503 lignes : date, championnat, période, équipes, résultat 1/N/2, probabilités 1-N-2 des quatre modèles). Le CSV de prédictions ne contient ni buts ni xG, seulement le résultat 1/N/2 ; il ne doit pas être publié avec le CSV source.

## Tableaux complets

### Tous les matchs testés — 3503 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.59487 | — | 0.9962 | — |
| M1 5 derniers ×2 | 0.59532 | +0.00045 [-0.00027 ; 0.00115] | 0.99668 | +0.00048 [-0.00053 ; 0.0015] |
| M2 10 derniers ×2 | 0.59468 | -0.0002 [-0.00098 ; 0.00068] | 0.99583 | -0.00037 [-0.00152 ; 0.00091] |
| M3 15 derniers ×1,5 | 0.5946 | -0.00028 [-0.00085 ; 0.00029] | 0.9959 | -0.0003 [-0.00111 ; 0.00052] |

### Période A — 1752 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.59058 | — | 0.98892 | — |
| M1 5 derniers ×2 | 0.59058 | +0 [-0.00102 ; 0.00102] | 0.98873 | -0.00019 [-0.00166 ; 0.00126] |
| M2 10 derniers ×2 | 0.59023 | -0.00034 [-0.00141 ; 0.00077] | 0.9884 | -0.00053 [-0.00214 ; 0.00114] |
| M3 15 derniers ×1,5 | 0.59034 | -0.00023 [-0.00104 ; 0.0006] | 0.9887 | -0.00022 [-0.00141 ; 0.00098] |

### Période B — 1218 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.59475 | — | 0.99741 | — |
| M1 5 derniers ×2 | 0.59558 | +0.00083 [-0.00043 ; 0.00208] | 0.99854 | +0.00113 [-0.00071 ; 0.00292] |
| M2 10 derniers ×2 | 0.59456 | -0.00019 [-0.0018 ; 0.00147] | 0.99709 | -0.00032 [-0.00265 ; 0.00206] |
| M3 15 derniers ×1,5 | 0.59417 | -0.00057 [-0.00149 ; 0.00036] | 0.99663 | -0.00078 [-0.00207 ; 0.00051] |

### Période C — 533 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.60929 | — | 1.01737 | — |
| M1 5 derniers ×2 | 0.61031 | +0.00102 [-0.00026 ; 0.00231] | 1.01859 | +0.00122 [-0.00064 ; 0.00303] |
| M2 10 derniers ×2 | 0.60954 | +0.00025 [-0.00141 ; 0.00184] | 1.01742 | +0.00004 [-0.00241 ; 0.00247] |
| M3 15 derniers ×1,5 | 0.60954 | +0.00024 [-0.0014 ; 0.00175] | 1.01788 | +0.0005 [-0.002 ; 0.0028] |

### Bundesliga (toutes périodes) — 612 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.60237 | — | 1.00913 | — |
| M1 5 derniers ×2 | 0.60298 | +0.0006 [-0.00124 ; 0.00245] | 1.01025 | +0.00113 [-0.00146 ; 0.00373] |
| M2 10 derniers ×2 | 0.60267 | +0.00029 [-0.00176 ; 0.00241] | 1.00954 | +0.00041 [-0.00254 ; 0.00344] |
| M3 15 derniers ×1,5 | 0.60303 | +0.00066 [-0.00094 ; 0.00241] | 1.00996 | +0.00084 [-0.00144 ; 0.0033] |

### La Liga (toutes périodes) — 760 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.58401 | — | 0.98288 | — |
| M1 5 derniers ×2 | 0.58419 | +0.00018 [-0.00127 ; 0.0016] | 0.98278 | -0.00011 [-0.00229 ; 0.00196] |
| M2 10 derniers ×2 | 0.58338 | -0.00063 [-0.00212 ; 0.00085] | 0.98154 | -0.00134 [-0.00358 ; 0.00083] |
| M3 15 derniers ×1,5 | 0.58303 | -0.00098 [-0.00203 ; 0.00003] | 0.98182 | -0.00106 [-0.00265 ; 0.00045] |

### Ligue 1 (toutes périodes) — 611 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.59247 | — | 0.99207 | — |
| M1 5 derniers ×2 | 0.59411 | +0.00164 [-0.00037 ; 0.00372] | 0.99423 | +0.00216 [-0.00071 ; 0.00519] |
| M2 10 derniers ×2 | 0.59346 | +0.00099 [-0.00102 ; 0.00302] | 0.99359 | +0.00151 [-0.00149 ; 0.00451] |
| M3 15 derniers ×1,5 | 0.59277 | +0.0003 [-0.00133 ; 0.00195] | 0.99284 | +0.00077 [-0.0017 ; 0.00316] |

### Premier League (toutes périodes) — 760 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.60462 | — | 1.00878 | — |
| M1 5 derniers ×2 | 0.60464 | +0.00002 [-0.00146 ; 0.00154] | 1.00853 | -0.00025 [-0.0024 ; 0.00191] |
| M2 10 derniers ×2 | 0.60371 | -0.00091 [-0.00268 ; 0.00091] | 1.00735 | -0.00143 [-0.00402 ; 0.00123] |
| M3 15 derniers ×1,5 | 0.60361 | -0.00101 [-0.00228 ; 0.00018] | 1.00742 | -0.00137 [-0.00314 ; 0.0003] |

### Serie A (toutes périodes) — 760 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.5919 | — | 0.98985 | — |
| M1 5 derniers ×2 | 0.59195 | +0.00005 [-0.00137 ; 0.00144] | 0.98979 | -0.00006 [-0.00206 ; 0.00193] |
| M2 10 derniers ×2 | 0.59149 | -0.00041 [-0.0021 ; 0.00137] | 0.98938 | -0.00047 [-0.00302 ; 0.00216] |
| M3 15 derniers ×1,5 | 0.59182 | -0.00007 [-0.00136 ; 0.00115] | 0.98959 | -0.00026 [-0.00214 ; 0.00152] |

### Bundesliga — période A — 306 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.61898 | — | 1.03194 | — |
| M1 5 derniers ×2 | 0.61854 | -0.00044 [-0.00308 ; 0.00222] | 1.03149 | -0.00045 [-0.00432 ; 0.00334] |
| M2 10 derniers ×2 | 0.61945 | +0.00047 [-0.00272 ; 0.00359] | 1.03247 | +0.00053 [-0.00417 ; 0.00514] |
| M3 15 derniers ×1,5 | 0.6204 | +0.00142 [-0.00097 ; 0.00388] | 1.03374 | +0.00179 [-0.00173 ; 0.00532] |

### Bundesliga — période B — 212 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.58568 | — | 0.98648 | — |
| M1 5 derniers ×2 | 0.58733 | +0.00165 [-0.00201 ; 0.00539] | 0.98944 | +0.00296 [-0.00203 ; 0.00797] |
| M2 10 derniers ×2 | 0.58533 | -0.00035 [-0.00411 ; 0.00309] | 0.98626 | -0.00022 [-0.00506 ; 0.00453] |
| M3 15 derniers ×1,5 | 0.58596 | +0.00028 [-0.00246 ; 0.00295] | 0.98698 | +0.0005 [-0.00327 ; 0.0042] |

### Bundesliga — période C — 94 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.58598 | — | 0.98593 | — |
| M1 5 derniers ×2 | 0.58761 | +0.00163 [-0.0013 ; 0.00457] | 0.98806 | +0.00213 [-0.00188 ; 0.00613] |
| M2 10 derniers ×2 | 0.58717 | +0.00119 [-0.00328 ; 0.00574] | 0.98739 | +0.00146 [-0.00471 ; 0.00763] |
| M3 15 derniers ×1,5 | 0.58501 | -0.00097 [-0.00437 ; 0.0024] | 0.9844 | -0.00153 [-0.00642 ; 0.00322] |

### La Liga — période A — 380 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.58591 | — | 0.98449 | — |
| M1 5 derniers ×2 | 0.58637 | +0.00046 [-0.00177 ; 0.0026] | 0.98468 | +0.00019 [-0.00312 ; 0.00331] |
| M2 10 derniers ×2 | 0.58529 | -0.00062 [-0.00282 ; 0.00149] | 0.98327 | -0.00122 [-0.00445 ; 0.00187] |
| M3 15 derniers ×1,5 | 0.58489 | -0.00102 [-0.00237 ; 0.00037] | 0.98354 | -0.00095 [-0.00307 ; 0.00118] |

### La Liga — période B — 254 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.57478 | — | 0.96954 | — |
| M1 5 derniers ×2 | 0.57411 | -0.00067 [-0.0035 ; 0.00198] | 0.96826 | -0.00128 [-0.00547 ; 0.00268] |
| M2 10 derniers ×2 | 0.57366 | -0.00112 [-0.00354 ; 0.00136] | 0.96726 | -0.00228 [-0.00589 ; 0.00154] |
| M3 15 derniers ×1,5 | 0.57328 | -0.0015 [-0.00339 ; 0.00038] | 0.96737 | -0.00216 [-0.00479 ; 0.0005] |

### La Liga — période C — 126 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.59687 | — | 1.00493 | — |
| M1 5 derniers ×2 | 0.59794 | +0.00106 [-0.00207 ; 0.00417] | 1.00629 | +0.00136 [-0.00332 ; 0.00593] |
| M2 10 derniers ×2 | 0.59721 | +0.00033 [-0.00289 ; 0.00342] | 1.00513 | +0.0002 [-0.00453 ; 0.0046] |
| M3 15 derniers ×1,5 | 0.59707 | +0.0002 [-0.00214 ; 0.00253] | 1.00575 | +0.00082 [-0.00265 ; 0.00424] |

### Ligue 1 — période A — 306 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.57887 | — | 0.97289 | — |
| M1 5 derniers ×2 | 0.57941 | +0.00054 [-0.00251 ; 0.00348] | 0.97336 | +0.00047 [-0.00391 ; 0.00473] |
| M2 10 derniers ×2 | 0.57955 | +0.00068 [-0.00211 ; 0.00358] | 0.97408 | +0.00119 [-0.00292 ; 0.0055] |
| M3 15 derniers ×1,5 | 0.57785 | -0.00102 [-0.00323 ; 0.00138] | 0.972 | -0.00089 [-0.00408 ; 0.00248] |

### Ligue 1 — période B — 211 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.59595 | — | 0.99971 | — |
| M1 5 derniers ×2 | 0.59973 | +0.00377 [0.00022 ; 0.00719] | 1.00519 | +0.00548 [0.00027 ; 0.01052] |
| M2 10 derniers ×2 | 0.59677 | +0.00082 [-0.00269 ; 0.00403] | 1.00127 | +0.00156 [-0.00374 ; 0.00647] |
| M3 15 derniers ×1,5 | 0.59741 | +0.00146 [-0.00123 ; 0.00423] | 1.00198 | +0.00226 [-0.00186 ; 0.00657] |

### Ligue 1 — période C — 94 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.62889 | — | 1.03737 | — |
| M1 5 derniers ×2 | 0.62932 | +0.00043 [-0.00389 ; 0.00433] | 1.03758 | +0.00021 [-0.00588 ; 0.00585] |
| M2 10 derniers ×2 | 0.63129 | +0.0024 [-0.00164 ; 0.00669] | 1.03984 | +0.00246 [-0.0035 ; 0.00909] |
| M3 15 derniers ×1,5 | 0.63091 | +0.00202 [-0.00213 ; 0.00648] | 1.04017 | +0.0028 [-0.00336 ; 0.00954] |

### Premier League — période A — 380 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.58774 | — | 0.98356 | — |
| M1 5 derniers ×2 | 0.58767 | -0.00007 [-0.00203 ; 0.00191] | 0.98317 | -0.00039 [-0.00308 ; 0.00238] |
| M2 10 derniers ×2 | 0.58571 | -0.00204 [-0.00412 ; 0.00025] | 0.98055 | -0.00301 [-0.00594 ; 0.00032] |
| M3 15 derniers ×1,5 | 0.58675 | -0.001 [-0.00287 ; 0.00081] | 0.98204 | -0.00152 [-0.00422 ; 0.00111] |

### Premier League — période B — 277 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.61613 | — | 1.02611 | — |
| M1 5 derniers ×2 | 0.61602 | -0.0001 [-0.00312 ; 0.00284] | 1.02583 | -0.00028 [-0.00462 ; 0.00394] |
| M2 10 derniers ×2 | 0.61684 | +0.00072 [-0.00263 ; 0.00451] | 1.02702 | +0.00091 [-0.00398 ; 0.00665] |
| M3 15 derniers ×1,5 | 0.61451 | -0.00161 [-0.00373 ; 0.00045] | 1.02399 | -0.00211 [-0.0051 ; 0.00068] |

### Premier League — période C — 103 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.63591 | — | 1.05527 | — |
| M1 5 derniers ×2 | 0.63661 | +0.0007 [-0.00283 ; 0.00365] | 1.05558 | +0.00031 [-0.00492 ; 0.00455] |
| M2 10 derniers ×2 | 0.63478 | -0.00113 [-0.00439 ; 0.0019] | 1.05337 | -0.0019 [-0.0068 ; 0.00253] |
| M3 15 derniers ×1,5 | 0.6365 | +0.00058 [-0.0015 ; 0.00277] | 1.05646 | +0.00119 [-0.00173 ; 0.00413] |

### Serie A — période A — 380 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.58464 | — | 0.977 | — |
| M1 5 derniers ×2 | 0.58418 | -0.00046 [-0.00251 ; 0.00176] | 0.97628 | -0.00072 [-0.00364 ; 0.00242] |
| M2 10 derniers ×2 | 0.58479 | +0.00015 [-0.00222 ; 0.00264] | 0.97741 | +0.00041 [-0.00302 ; 0.00405] |
| M3 15 derniers ×1,5 | 0.58526 | +0.00062 [-0.00117 ; 0.0024] | 0.97772 | +0.00073 [-0.00182 ; 0.00325] |

### Serie A — période B — 264 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.59783 | — | 1.00103 | — |
| M1 5 derniers ×2 | 0.59809 | +0.00026 [-0.00216 ; 0.00262] | 1.00103 | +0 [-0.00344 ; 0.00348] |
| M2 10 derniers ×2 | 0.59692 | -0.00091 [-0.00401 ; 0.00209] | 0.99975 | -0.00128 [-0.00581 ; 0.00326] |
| M3 15 derniers ×1,5 | 0.59694 | -0.00089 [-0.0031 ; 0.00131] | 0.99953 | -0.0015 [-0.00464 ; 0.00162] |

### Serie A — période C — 116 matchs

| Modèle | Brier | Écart Brier vs M0 [IC 95 %] | Log loss | Écart log loss vs M0 [IC 95 %] |
|---|---|---|---|---|
| M0 moteur actuel | 0.60216 | — | 1.00652 | — |
| M1 5 derniers ×2 | 0.60341 | +0.00124 [-0.00142 ; 0.00387] | 1.00848 | +0.00196 [-0.00208 ; 0.0058] |
| M2 10 derniers ×2 | 0.60104 | -0.00112 [-0.0054 ; 0.00304] | 1.00501 | -0.00151 [-0.00812 ; 0.00489] |
| M3 15 derniers ×1,5 | 0.60169 | -0.00048 [-0.00361 ; 0.00265] | 1.00585 | -0.00067 [-0.00526 ; 0.0039] |
