# Elo commun en Ligue des champions (rev 15)

Principe : Elo unique calculé sur matchs nationaux + Ligue des champions, mélangé (α = 0,4) aux probabilités Poisson.
Seed statique au 04/11/2026 (src/elo-cup-seed.js), mis à jour ensuite par les matchs de C1 seulement.

## Backtest (420 matchs réels de C1, Brier, plus bas = mieux)
| Saison | Sans Elo | Avec Elo α=0,4 |
|---|---|---|
| 24-25 (réglage) | 0,5211 | 0,5195 |
| 25-26 (hors réglage) | 0,5635 | 0,5581 |
| 26-27 (hors réglage) | 0,5602 | 0,5259 |

Écart moyen au marché sur les 10 matchs du 24-25/11 : 8,6 → 7,6 points.

## Limites connues
- Galatasaray et Sabah s'éloignent du marché ; Real Madrid ne bouge presque pas.
- Seed figé : les matchs nationaux ne mettent pas l'Elo à jour (seuls les matchs de C1 le font).
- Rafraîchir le seed : test/lab/cdc-elo/mkseed.mjs.
