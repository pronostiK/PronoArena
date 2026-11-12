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
4. Comparaison aux bookmakers sur cotes moyennes (probablement de clôture) : légèrement favorable à eux.
5. Plusieurs dizaines de variantes testées : un petit gain isolé serait à interpréter avec prudence (comparaisons multiples).
6. Non testé : Poisson bivarié / binomiale négative (nuls bien calibrés), xG, absences, cotes.
