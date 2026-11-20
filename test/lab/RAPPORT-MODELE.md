# Duel Prono — rapport d'audit du modèle (12/11/2026)

Objet : vérifier, avec les données actuelles uniquement, trois pistes d'amélioration du modèle de buts (Poisson + Dixon-Coles).
Scripts : `test/lab/` (dump-baseline.mjs, run-decay.mjs, run-joint.py, run-elo.py, analyse.py). Données : historique PronostiK (football-data.co.uk, 9 championnats, cotes moyennes comprises).

## Protocole (identique pour toutes les pistes)
- Pour chaque match, le modèle ne voit que les matchs joués avant la date du match, saison en cours + précédente (même règle que le moteur du site).
- 7 360 matchs de test (2024-08-09 → 2026-11-08, matchs avec cotes). Trois périodes :
  - **A (réglage)** : jusqu'au 30/06/2025, 3 222 matchs. Tous les réglages sont choisis ici, et uniquement ici.
  - **B (validation)** : 01/07/2025 → 28/02/2026, 2 290 matchs.
  - **C (final)** : 01/03/2026 → 08/11/2026, 1 848 matchs. Regardée une seule fois, pour le seul finaliste (piste 3).
- Mesure : erreur de Brier (somme des écarts au carré sur les 3 issues, plus bas = mieux). Écart par match avec le moteur actuel, intervalle de confiance à 95 % par rééchantillonnage (1 000 tirages).
- Référence : moteur actuel. Brier A 0,5950 · B 0,6053 · C 0,6061. Bookmakers (cotes moyennes, marge retirée) : 0,5787 · 0,5861 · 0,5929.

## Piste 1 — décroissance dans le temps (poids 0,5^(jours/H))
18 variantes : H = 45, 90, 135, 180, 270, 365 jours × lissage K = 3, 6, 10 (le moteur actuel : 80 derniers matchs, 8 récents ×1,5, K = 6).
- Demi-vies courtes (45–90 j) : nettement pires (A : +0,003 à +0,020).
- 270–365 j : équivalentes (A : −0,0004 à +0,0001 ; B : −0,0004 ; intervalles contenant 0).
- **Conclusion : aucun gain. Moteur inchangé.**

## Piste 2 — forces estimées ensemble (adversaires pris en compte)
Régression de Poisson pénalisée : log λ_dom = μ + h + att[dom] + def[ext] ; log λ_ext = μ + att[ext] + def[dom]. Pénalisation ridge τ = 3, 8, 20 ; poids temporel H = ∞, 365, 180. ρ Dixon-Coles gardé à −0,08 (on isole l'effet de l'estimation). Réajustée à chaque journée de matchs.
- A : de +0,0006 (τ = 8, H = 365, meilleure) à +0,0052 (τ = 20, H = 180). B pour la meilleure : −0,0013 [−0,0031 ; +0,0007].
- **Conclusion : équivalent au moteur actuel, jamais significativement meilleur. Moteur inchangé.**

## Piste 3 — Elo des clubs en complément
Régression ordonnée sur l'écart d'Elo (pente et seuils réglés sur A), puis mélange (1−α)·actuel + α·Elo, α choisi sur A (= 0,30).
- Elo seul : pire que l'actuel sur A (+0,0034) et C (+0,0044), un peu mieux sur B (−0,0018), jamais significatif.
- Mélange α = 0,30 : A −0,0010 [−0,0021 ; +0,0002] · B −0,0024 [−0,0036 ; −0,0010] · **C −0,0007 [−0,0022 ; +0,0009]**.
- **Conclusion : gain d'environ 0,001, non confirmé sur la période finale. Pas retenu pour l'instant.**

## Contrôle annexe : nuls
Nuls annoncés 25,7 % / 26,1 % (A / B) contre 25,5 % / 25,8 % observés : pas de biais visible sur les nuls pour les clubs.

## Limites à auditer
1. Les pistes 1 et 2 n'ont pas de finaliste : la période C n'a pas été utilisée pour elles.
2. Piste 3 : les paramètres Elo sont ajustés sur A (donc optimistes sur A) ; α retenu sur A puis jugé sur B et C.
3. Piste 2 : ρ non estimé avec les forces ; pas de paramètres propres domicile/extérieur (le moteur actuel en a, poids 0,3).
4. Comparaison aux bookmakers sur cotes moyennes : dans cet export, avgH/avgD/avgA contenaient les cotes de clôture (précisé le 18/11/2026). Légèrement favorable à eux.
5. Plusieurs dizaines de variantes testées : un petit gain isolé serait à interpréter avec prudence (comparaisons multiples).
6. Non testé : Poisson bivarié / binomiale négative (nuls bien calibrés), xG, absences, cotes.

## Piste 4 — recalibration des gros favoris (13/11/2026)
Script : `recalibration-favoris.py <baseline.json>` (baseline produit par `dump-baseline.mjs`). 7 408 matchs avec cotes (7 360 dans le fichier précédent : 48 matchs ajoutés ; sur les 7 360 communs, probabilités du moteur identiques).
- Protocole : réglage sur A seul, jugement sur B, C exploratoire (déjà consultée en piste 3). Intervalles à 95 % par rééchantillonnage regroupé par date (3 000 tirages).
- Essais réellement faits : 26 pentes globales (0,80 → 1,30) et 85 couples seuil/décalage pour les favoris (seuil 0,50 → 0,70 × décalage −0,08 → +0,08).
- Optimum sur A : pente 1,00 (= moteur actuel, les infimes écarts viennent de la renormalisation des probabilités arrondies) ; favoris : seuil 0,50, décalage +0,01.
- Écart de Brier : favoris B −0,0000 [−0,0004 ; +0,0003], C −0,0001 [−0,0005 ; +0,0003].
- Diagnostic favoris ≥ 60 % : A 69,3 % annoncé / 68,8 % observé (714) ; B 69,0 / 72,7 (384) ; C 69,0 / 72,9 (317). Bookmakers ≈ 69 %. Signal à surveiller, pas une preuve. Attention : diagnostic à 60 %, correction appliquée dès 50 %.
- Brier C avec 7 408 matchs : moteur 0,6046 (0,6061 avec 7 360), bookmakers 0,5904 (0,5929).
- **Conclusion (confirmée par l'audit Perplexity) : aucune recalibration, production inchangée.**

## Piste 6 — test xG (lancé le 19/11/2026, résultat plus bas)
*(Protocole écrit à l'avance ; ancien titre « Prochaine étape — test xG (non lancé) ».)*
Une seule variante fixée à l'avance : 50 % buts / 50 % xG (buts marqués et encaissés dans les forces, moyennes de championnat recalculées avec le même mélange), autres réglages inchangés, mêmes matchs, uniquement des xG de matchs antérieurs. Poids = choix de test, pas un optimum. C reste exploratoire : une nouvelle période intacte devra confirmer. Bloquant : fichier xG historique des 5 grands championnats (Understat à vérifier : accès, couverture, conditions d'utilisation).

## Piste 5 — comparaison du moteur au marché (18/11/2026)
Scripts : `dump-baseline-cotes.mjs` puis `marche.py` (retrait de la marge : proportionnel, puissance, Shin ; mélange à poids unique ; écarts de Brier avec rééchantillonnage regroupé par date).
- **Conclusion : sur les 7 437 matchs étudiés, le marché obtient un meilleur Brier que Duel Prono, avant clôture comme à la clôture (0,58571 et 0,58381 avec Shin, contre 0,60057). Le mélange à poids unique testé n'améliore pas le marché seul. Cela ne démontre pas que le moteur n'apporte jamais d'information utile.**
- Précisions sur les données : dans cet export, avgH/avgD/avgA contenaient les cotes de clôture.
- Le Brier avant clôture de 0,58571 provient d'un recalcul indépendant sur les mêmes 7 437 matchs, à partir des colonnes AvgH/AvgD/AvgA des CSV Football-Data, après retrait de la marge par Shin. marche.py utilise les cotes de clôture de l'export PronostiK.
- Précisions sur le calcul : l'Elo des clubs était exporté (champ `elo` de `dump-baseline-cotes.mjs`), mais il n'entrait pas dans le calcul 1/N/2 testé. Le test compare les probabilités du moteur seul (proba1, probaN, proba2) aux cotes.

## Piste 6 — résultat du test xG (19/11/2026)
Script : `test/lab/run-xg.mjs <xg_bzzoiro.csv>` (source : export Bzzoiro, 5 grands championnats 2023-24 → 2025-26, fichier non versé dans le dépôt public : licence non lue). Une seule variante, aucun réglage, un seul lancement.
- Règles fixées avant le calcul (en-tête du script) : xG utilisé seulement si statut « mesure » (sinon buts réels) ; 18 matchs de barrage retirés (5 273 → 5 255) ; Elo calculé sur les buts réels ; périodes A ≤ 30/06/2025, B → 28/02/2026, C ≥ 01/03/2026 ; IC 95 % regroupé par date (3 000 tirages) ; 3 503 matchs de test (5 championnats, du 01/08/2024 au 29/05/2026).
- Écart de Brier (variante 50/50 − moteur), négatif = mieux :
  - Tous : −0,0040 [−0,0057 ; −0,0024] (0,5949 → 0,5909)
  - A : −0,0049 [−0,0070 ; −0,0026] · B : −0,0045 [−0,0073 ; −0,0016] · **C : −0,0001 [−0,0040 ; +0,0044]** (533 matchs seulement, mars → mai 2026)
  - Par championnat : Bundesliga −0,0072 [−0,0108 ; −0,0036], Premier League −0,0039 [−0,0072 ; −0,0006], La Liga −0,0043 [−0,0078 ; −0,0009], Ligue 1 −0,0037 [−0,0079 ; +0,0006], Serie A −0,0013 [−0,0053 ; +0,0028].
- Nuls : annoncés 0,2539 (moteur) / 0,2542 (xG), observés 0,2518.
- **Favoris ≥ 60 % : le moteur annonce 68,5 % pour 68,9 % observé (770 matchs) ; la variante xG annonce 68,0 % pour 73,6 % observé (641 matchs) : elle sous-estime les gros favoris** (le mélange rapproche les forces de la moyenne). Point à auditer avant toute mise en production.
- **Conclusion : gain d'environ 0,004 sur A et B, non retrouvé sur C (nul, intervalle large). Signal prometteur, pas confirmé. Moteur inchangé.** Vérification attendue sur des matchs réellement nouveaux (saison 2026-27, xG accumulés par l'export automatique).
- Limites : C déjà consultée dans les pistes précédentes (autres variantes) et courte ; pas de cotes dans ce fichier, donc pas de comparaison directe aux bookmakers (matchs différents des pistes 1 à 5) ; poids 50/50 = choix de test, pas un optimum ; xG « mesuré » = estimé par tir par le fournisseur (modèle propre à Bzzoiro).
- **Audit indépendant (ChatGPT, 19/11/2026)** : test reproduit, calcul principal validé. Verdict : valide comme comparaison historique exploratoire reproductible ; ne démontre pas que la variante xG améliore durablement le moteur. Recommandation : conserver la conclusion et le moteur actuel inchangés. Dossier fourni à l'auditeur : points 1 à 8, dont Elo sans effet sur ce test, bootstrap par dates (dépendance entre journées non prise en compte, contrôle par blocs de 28 jours donnant des intervalles proches sur A et B), mécanisme des favoris (écart-type des écarts de force −9 % ; buts/xG 1,073 pour les 4 premiers, 0,891 pour les 4 derniers).


## Piste 7 — finition historique (buts − xG) : suspendue (19/11/2026)
Opérations 7.1.1 à 7.1.4 faites (inventaire, identités, audit du statut xG, plan de vérification API), sans calcul prédictif. Constats utiles : les 282 matchs « xG estimés » contiennent tous un but contre son camp ; l'attribution des CSC à une équipe n'est pas dans les données ; Nantes – Toulouse 2025/26 absent (match abandonné selon ESPN). **Décision de l'auditeur : investigations API suspendues, phase 7.2 non commencée.**

## Test de pondération des matchs récents (19/11/2026) — clôturé
M0 (8 derniers ×1,5) Brier 0,59487 ; M1 (5 ×2) 0,59532 ; M2 (10 ×2) 0,59468 ; M3 (15 ×1,5) 0,59460, sur 3 503 matchs, buts réels seulement. Aucun intervalle favorable à 95 %. **Moteur inchangé.** Détail : `RESULTATS-PONDERATION.md`, script `TEST-PONDERATION.mjs`.

## Test de calibration par température (19/11/2026) — clôturé
Huit T de 0,85 à 1,20 ; sur la période A le meilleur est T = 1,00 (aucune correction). Le meilleur T change d'une période à l'autre. **Moteur inchangé.** Détail : `RESULTATS-CALIBRATION.md`, script `TEST-CALIBRATION.mjs`.

## Décision de l'auditeur (19/11/2026)
Moteur actuel maintenu, tous les tests de coefficients clôturés (décroissance, forces jointes, Elo, recalibration des favoris, xG, pondération, température). Ne pas les refaire sans justification nouvelle. Prochaine piste : absences de joueurs, sous réserve de données historiques fiables et horodatées (proposition : `PISTE8-ABSENCES-PROPOSITION.md`).

## Piste 9 — équipes promues (20/11/2026)
Scripts : `test/lab/run-promus.mjs <history.json>` (laboratoire) et `test/lab/check-promus-moteur.mjs` (même calcul avec le vrai moteur). Historique PronostiK, 7 437 matchs avec cotes, 2024-08 → 2026-11-08. Périodes par saison : A = 2024-25 (réglage), B = 2025-26, C = 2026-27 (jamais utilisée avant pour ce test).
- **Diagnostic** : sur les 10 premiers matchs d'une équipe absente du championnat la saison précédente, points par match annoncés moteur / bookmakers / réels : A 1,21 / 1,10 / 1,05 · B 1,23 / 1,17 / 1,09 · C 1,19 / 1,11 / 1,01. Après 10 matchs l'écart disparaît. Surestimation répétée en début de saison.
- Variante toutes divisions (réglée sur A : K=6, att 0,95, déf 1,30) : A −0,0010, B +0,0001, C −0,0020 ; abîme Championship (+0,0028) et Ligue 2 (+0,0060), où une nouvelle venue peut être un relégué.
- **Variante retenue, 1res divisions seulement** (choix fait après avoir vu B) : K=15, att 0,75, déf 1,30 (réglée sur A, bords de grille pour K et déf). Tous matchs : A −0,0021 [−0,0042 ; −0,0003] · B −0,0007 [−0,0027 ; +0,0013] · C −0,0028 [−0,0076 ; +0,0016]. Avec le vrai moteur, 7 championnats de 1re division : A −0,0028 · B −0,0010 · C −0,0040. Points annoncés sur les 10 premiers matchs après correction : 1,05 / 1,07 / 1,03 pour 1,05 / 1,09 / 1,01 réels.
- **Décision de Kay (20/11/2026) : correction appliquée** (gain régulier sur 3 saisons, même s'il n'est pas prouvé statistiquement). Nouvelle règle de Kay : on n'écarte plus un gain parce qu'il est petit s'il va dans le même sens sur plusieurs saisons et n'abîme rien ailleurs.

## Piste 3 bis — Elo des clubs en complément, revu avec la règle de Kay (20/11/2026)
Scripts : `dump-baseline-promus.mjs` (moteur avec promus) → `run-elo2.mjs` ; contrôle avec le vrai moteur : `check-elo-moteur.mjs` (mêmes chiffres). 7 437 matchs, 9 championnats. Même méthode que la piste 3 : régression ordonnée sur l'écart d'Elo réglée sur 2024-25 (pente 0,514, seuils −0,904 / 0,290), α choisi sur 2024-25 = 0,25.
- Brier (mélange − moteur avec promus) : 2024-25 −0,0008 [−0,0020 ; +0,0003] · 2025-26 −0,0021 [−0,0032 ; −0,0009] · 2026-27 −0,0006 [−0,0026 ; +0,0015].
- Par championnat (2025-26 + 2026-27) : mieux en Ligue 1, PL, Serie A, Bundesliga, Eredivisie, Championship, Ligue 2 ; un peu moins bien en Liga (+0,0008) et au Portugal (+0,0003).
- **Décision de Kay (20/11/2026) : appliqué** (gain dans le même sens sur 3 saisons). La grille des scores est remise à l'échelle par zone (victoires dom. / nuls / victoires ext.) pour que tous les marchés restent cohérents. Championnats de clubs seulement.

## Pistes 10 à 14 (20/11/2026) — base : moteur en ligne (promus + Elo 25 %), règle de Kay (même sens sur chaque saison, rien d'abîmé)
Écarts de Brier 2024-25 / 2025-26 / 2026-27, négatif = mieux. Aucune n'est retenue.
- **10. Elo de départ des promus plus bas** (`run-elo-promus.mjs`, testé avec une version temporaire de `computeElo`) : départ 1350 choisi sur 2024-25 → −0,0001 / +0,0004 / +0,0002. Plus le départ est bas, plus 2025-26 et 2026-27 se dégradent.
- **11. Nuls par championnat** (`run-pistes-11-13.mjs`) : −0,0007 / +0,0003 / +0,0007. Seules PL et Eredivisie vont dans le bon sens 3 fois sur 3 : sur 9 championnats, c'est ce que le hasard donne, non retenu.
- **12. Enchaînement des matchs** (repos ≤ 3 ou 4 jours, championnat seulement) : ~0,0000 partout.
- **13. Poids des matchs récents** : 10 derniers ×2 +0,0003 / −0,0000 / −0,0002 ; 15 derniers ×1,5 +0,0002 / −0,0003 / +0,0003. Change de sens.
- **14. Absents** (`run-absents.mjs`, absents API-Football 2023-24 et 2024-25 de l'étude PronostiK, 3 398 matchs, données non versées) : réglage sur 2023-24 α = 0,05, β = 0 → 2023-24 −0,0003 · 2024-25 −0,0006 (moitiés −0,0003 / −0,0009). Mais Ligue 1 se dégrade les deux saisons (+0,0005 / +0,0010) et Liga en 2023-24 (+0,0015). Gain minuscule ; en production il faudrait en plus l'importance de chaque joueur (minutes de la saison précédente), que le robot n'a pas. À refaire sur les absents Bzzoiro collectés par le site.

## Pistes 15 à 18 (20/11/2026) — base : moteur en ligne, règle de Kay
Script : `run-pistes-15-18.mjs` (+ `run-corners.mjs` pour la grille élargie). 7 437 matchs. Écarts de Brier 2024-25 / 2025-26 / 2026-27.
- **15. Mélange avec PronostiK** : le meilleur poids sur 2024-25 est 0 (aucun mélange). Poids 0,1 : +0,0000 / −0,0001 / +0,0001. Rien à gagner : depuis promus + Elo, notre moteur fait déjà mieux.
- **16. Matchs avec carton rouge moins comptés** : meilleur poids 0,75 → +0,0001 / −0,0000 / +0,0002. Rien.
- **17. Corners mêlés aux buts dans les forces** (buts remplacés par 70 % buts + 30 % corners × buts/corners du championnat ; Elo sur les vrais buts) : 30 % choisi sur 2024-25 → **−0,0011 / −0,0015 / −0,0010**, même sens les 3 saisons (grille 10 à 70 % : optimum 30-40 %). Par championnat, très variable : Portugal pire en 2025-26 et 2026-27 (+0,0016 / +0,0036), Liga +0,0004 / −0,0007 / +0,0005, Serie A 2026-27 +0,0081 ; gros gains Championship, Ligue 2. Pour la production : il faut les corners de tous les matchs passés (football-data.co.uk, que le robot ne lit pas aujourd'hui).
- **18. Part domicile/extérieur** : 0,45 choisi → −0,0000 / +0,0004 / +0,0001. Rien, 0,3 reste.
- **Corners codés (20/11/2026, décision de Kay : 8 championnats, Portugal exclu)** : `src/corners.js` (fichiers football-data.co.uk), `blendCorners` dans `buildLeague`. Contrôle du chemin de production sur l'historique (`check-corners-moteur.mjs`) : −0,0011 / −0,0017 / −0,0013.
