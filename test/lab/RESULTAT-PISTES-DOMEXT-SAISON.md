# Test hors ligne : forme domicile/extérieur et saison en cours (24/11/2026)

Autorisé par l'auditeur hors production. Rien n'est publié, le moteur en ligne reste figé.
Script : `test/lab/run-pistes-domext-saison.mjs`. Sortie complète : `run-pistes-domext-saison.txt`.

## Règles suivies
- **Historique seulement.** Aucun match à partir du 20/11/2026 n'est utilisé, ni pour calculer ni pour noter : les matchs du suivi prospectif sont exclus.
- **Mêmes matchs que l'audit du 20/11** : 7 437 matchs, 9 championnats, saisons 2024-25 à 2026-27. Base de comparaison = M7.
- **6 variantes fixées avant le calcul**, soit 6 × 9 = **54 comparaisons par championnat**. Certaines peuvent sortir « bonnes » par hasard.
- **Contrôle** : la copie du moteur utilisée par le test donne exactement les mêmes forces que le vrai moteur (écart 0).

## Variantes
| Nom | Ce qui change |
|---|---|
| DE_FORME | La forme récente est comptée par lieu : les 4 derniers matchs à domicile pèsent plus pour la force à domicile, les 4 derniers à l'extérieur pour la force à l'extérieur |
| DE_50 | La force propre au lieu (domicile ou extérieur) pèse 50 % au lieu de 30 % |
| DE_15 | Elle pèse 15 % (pour vérifier dans quel sens ça joue) |
| PREC_50 | Les matchs de la saison précédente comptent à moitié, toute l'année |
| PREC_50_8 | Pareil, mais seulement quand chaque équipe a déjà joué 8 matchs de la saison en cours |
| SAISON_L1L2 | Saison en cours seule (après 8 matchs), en Ligue 1 et Ligue 2 uniquement |

## Résultats (écart de Brier avec M7 ; négatif = mieux)
| | Total | 2024-25 | 2025-26 | 2026-27 | Fourchette (total) |
|---|---|---|---|---|---|
| DE_FORME | −0,0000 | −0,0000 | −0,0000 | −0,0000 | de −0,0001 à +0,0000 |
| DE_50 | +0,0002 | −0,0000 | +0,0005 | +0,0004 | de −0,0000 à +0,0005 |
| DE_15 | −0,0000 | +0,0002 | −0,0002 | −0,0001 | de −0,0002 à +0,0001 |
| PREC_50 | +0,0000 | −0,0001 | +0,0001 | +0,0004 | de −0,0004 à +0,0005 |
| **PREC_50_8** | **−0,0004** | −0,0004 | −0,0003 | −0,0006 | de −0,0008 à +0,0000 |
| **SAISON_L1L2** | **−0,0006** | −0,0006 | −0,0005 | −0,0011 | de −0,0013 à −0,0000 |

## Ce qu'il faut en retenir
1. **Forme domicile/extérieur : aucun gain.** Compter la forme récente par lieu ne change presque rien. Donner plus de poids au lieu (50 %) est un peu moins bon. Le réglage actuel (30 %) tient.
2. **Saison précédente comptée à moitié après 8 matchs (PREC_50_8) : petit gain, dans le même sens sur les 3 saisons.**
   - Meilleur dans 6 championnats sur 9 : Ligue 1 −0,0017, Bundesliga −0,0010, Eredivisie −0,0010, Ligue 2 −0,0010, Championship −0,0005, Premier League −0,0004.
   - Moins bon en Serie A (+0,0009) et au Portugal (+0,0010).
   - La fourchette touche tout juste zéro : c'est une piste sérieuse, mais pas encore une preuve.
3. **Saison en cours seule en Ligue 1 et Ligue 2 : le gain se confirme** (Ligue 1 −0,0042, Ligue 2 −0,0023, sur les 3 saisons). Attention : ces deux championnats ont été repérés sur les mêmes données. Le chiffre est donc probablement trop flatteur, et seuls des matchs nouveaux peuvent le confirmer.
4. **Rappel** : comme tous les tests hors ligne, celui-ci prend les corners dans le fichier, donc presque complets. Ce n'est pas le cas en production pour l'instant (voir `AUDIT-BILAN-1.md`).

## Proposition (rien n'est fait sans accord)
Suivre **PREC_50_8** et **SAISON_L1L2** en prédictions cachées, sur des matchs nouveaux, comme M7X : enregistrement horodaté, rien d'affiché, aucun réglage modifié. On ne les adopterait qu'après l'évaluation, avec l'accord de l'auditeur.
