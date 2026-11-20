# Test hors ligne : les xG par-dessus M7 (20/11/2026)

Rien n'est publié. Le moteur n'est pas modifié (suivi M0 / M7 en cours, moteur figé).
Script : `test/lab/run-xg-m7.mjs`, exécuté dans GitHub Actions (`.github/workflows/test-xg-m7.yml`, exécution 44734906321) : les xG Bzzoiro restent dans le cache GitHub et ne sont jamais versés dans le dépôt public.

## Variante (une seule, fixée avant le calcul)
M7X = M7, mais la part « buts » des forces (70 %) devient 50 % buts + 50 % xG mesurés. C'est la variante du 19/11, posée sur M7. Aucun autre poids essayé.
Elo, promus, classement : vrais buts. xG utilisés seulement si « mesurés ».

## Données
5 championnats (Ligue 1, Premier League, Liga, Serie A, Bundesliga), saisons 2024-25 et 2025-26, 3 504 matchs (mêmes règles que l'audit du 20/11).
Liaison des xG aux matchs : FL1 917/929, PL 1066/1140, Liga 1140/1140, Serie A 1140/1140, Bundesliga 918/924. Les équipes non reconnues sont des clubs de 2e division (matchs de barrage).

## Résultats (écart M7X − M7 ; négatif = mieux ; IC 95 %)
| | Brier | Log loss |
|---|---|---|
| **Total** | **−0,0013 [−0,0021 ; −0,0005]** | −0,0018 [−0,0029 ; −0,0006] |
| 2024-25 | −0,0020 [−0,0030 ; −0,0009] | −0,0026 |
| 2025-26 | −0,0007 [−0,0018 ; +0,0006] | −0,0010 |
| Ligue 1 | −0,0014 | |
| Premier League | −0,0017 | |
| Liga | −0,0014 | |
| Serie A | **+0,0003** (un peu moins bon) | |
| Bundesliga | −0,0028 | |

Par championnat et par saison, 8 cases sur 10 vont dans le bon sens. Deux sont moins bonnes : Serie A 2025-26 (+0,0012) et Ligue 1 2024-25 (+0,0003). Aucune des deux n'est nette.
Pour comparaison, les mêmes xG sur M0 : −0,0040. Une grande partie de ce qu'apportent les xG est donc déjà captée par les corners et l'Elo.

## Ce qu'il faut en retenir
- Le gain est petit mais va dans le bon sens sur les deux saisons et dans 4 championnats sur 5. Serie A ne gagne rien.
- Ce n'est pas une preuve : 2025-26 avait déjà été regardée le 19/11, et aucune saison n'est vraiment neuve.
- Couverture : les 5 grands championnats seulement. Rien pour Ligue 2, Championship, Eredivisie et Portugal.
- Coût pour le robot : il récupère déjà les xG Bzzoiro de la saison en cours pour ces 5 championnats (affichage). Pour le calcul, il faudrait aussi la saison précédente, à importer une seule fois (environ 1 800 matchs, à faire hors du robot pour ne pas dépasser sa limite d'appels).
- Le 19/11, la variante xG sous-estimait les gros favoris. À revérifier avant toute décision.
- Impossible à mettre en ligne pendant le suivi M0 / M7 (moteur figé). Possibilité, avec l'accord de l'auditeur : noter M7X en plus dans le journal, sans l'afficher, pour le juger sur des matchs vraiment nouveaux.
