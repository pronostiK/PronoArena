# Test hors ligne : longueur de la mémoire du moteur (21/11/2026)

Demande de Kay. Rien n'est publié. Le moteur est figé pendant le suivi M0 / M7 : toute adoption passera par l'auditeur, après l'évaluation.
Script : `test/lab/run-fenetres.mjs`. Données : les 7 437 matchs de l'audit (9 championnats, 2024-25 → 2026-27). Base : M7 (moteur en ligne).

## Rappel : ce que fait le moteur aujourd'hui
Il utilise les matchs de la **saison en cours et de la saison précédente seulement**, avec au plus 80 matchs par équipe. Les 8 derniers comptent ×1,5. Aujourd'hui, ce sont donc les saisons 2025-26 et 2026-27, pas 2023.

## Variantes (fixées avant le calcul)
- W40, W30, W20 : 40, 30 ou 20 derniers matchs par équipe.
- SAISON : saison en cours seule dès que chaque équipe a joué au moins 8 matchs (sinon, comme aujourd'hui).

## Résultats (écart de Brier avec le moteur actuel ; négatif = mieux)
| | W40 | W30 | W20 | SAISON |
|---|---|---|---|---|
| Total | +0,0004 | +0,0010 | **+0,0027** (net) | +0,0009 |
| 2024-25 | +0,0003 | +0,0007 | +0,0025 | +0,0010 |
| 2025-26 | +0,0003 | +0,0010 | +0,0026 | +0,0015 |
| 2026-27 | +0,0010 | +0,0024 | +0,0036 | −0,0010 |
| Matchs avec un promu | −0,0006 | −0,0005 | +0,0008 | +0,0026 |
| Clubs qui ont beaucoup changé | −0,0007 | +0,0001 | +0,0006 | −0,0012 |

**Raccourcir la mémoire pour tous les championnats rend le moteur moins bon, sur chacune des 3 saisons.** Plus la fenêtre est courte, plus c'est mauvais.

## Ce qui va dans le sens de Kay
- **Ligue 1 et Ligue 2, « saison en cours seule »** : meilleur sur les 3 saisons. Ligue 1 : −0,0039 / −0,0040 / −0,0059. Ligue 2 : −0,0026 / −0,0009 / −0,0055.
- Clubs qui ont beaucoup changé, et promus : petit mieux avec 40 matchs, mais pas net.
- Serie A et Portugal : nettement pire avec une mémoire courte, sur les 3 saisons.

## Prudence
- 9 championnats × 4 variantes = 36 essais. Il est possible que 2 championnats sortent « bons » 3 fois de suite par hasard. C'est une piste, pas une preuve.
- Proposition pour après l'évaluation : tester « saison seule pour la Ligue 1 et la Ligue 2 » sur des matchs nouveaux, avec l'accord de l'auditeur.

## Sortie complète
```
7437 matchs, 2355 journées ; « saison seule » active sur 1656 journées

TOTAL (n=7437)  W80 Brier 0.5963  bookmakers 0.5840
  W40    Brier +0.0004 [-0.0003 ; +0.0012]   LL +0.0006 [-0.0005 ; +0.0017]
  W30    Brier +0.0010 [-0.0000 ; +0.0022]   LL +0.0016 [+0.0001 ; +0.0033]
  W20    Brier +0.0027 [+0.0011 ; +0.0043]   LL +0.0039 [+0.0016 ; +0.0061]
  SAISON Brier +0.0009 [-0.0006 ; +0.0025]   LL +0.0014 [-0.0007 ; +0.0036]

Saison 2024-25 (n=3222)  W80 Brier 0.5910  bookmakers 0.5787
  W40    Brier +0.0003 [-0.0009 ; +0.0015]   LL +0.0006 [-0.0013 ; +0.0024]
  W30    Brier +0.0007 [-0.0011 ; +0.0024]   LL +0.0013 [-0.0013 ; +0.0038]
  W20    Brier +0.0025 [+0.0001 ; +0.0049]   LL +0.0039 [+0.0005 ; +0.0075]
  SAISON Brier +0.0010 [-0.0010 ; +0.0031]   LL +0.0017 [-0.0013 ; +0.0047]

Saison 2025-26 (n=3221)  W80 Brier 0.6027  bookmakers 0.5904
  W40    Brier +0.0003 [-0.0009 ; +0.0016]   LL +0.0004 [-0.0013 ; +0.0022]
  W30    Brier +0.0010 [-0.0008 ; +0.0028]   LL +0.0013 [-0.0012 ; +0.0038]
  W20    Brier +0.0026 [+0.0001 ; +0.0051]   LL +0.0033 [-0.0001 ; +0.0069]
  SAISON Brier +0.0015 [-0.0010 ; +0.0042]   LL +0.0021 [-0.0013 ; +0.0059]

Saison 2026-27 (n=994)  W80 Brier 0.5924  bookmakers 0.5804
  W40    Brier +0.0010 [+0.0003 ; +0.0017]   LL +0.0013 [+0.0004 ; +0.0024]
  W30    Brier +0.0024 [+0.0006 ; +0.0043]   LL +0.0039 [+0.0013 ; +0.0066]
  W20    Brier +0.0036 [+0.0006 ; +0.0065]   LL +0.0054 [+0.0011 ; +0.0096]
  SAISON Brier -0.0010 [-0.0043 ; +0.0021]   LL -0.0014 [-0.0065 ; +0.0033]

Matchs avec un promu (n=1519)  W80 Brier 0.5760  bookmakers 0.5636
  W40    Brier -0.0006 [-0.0016 ; +0.0005]   LL -0.0007 [-0.0022 ; +0.0009]
  W30    Brier -0.0005 [-0.0022 ; +0.0011]   LL -0.0002 [-0.0025 ; +0.0021]
  W20    Brier +0.0008 [-0.0015 ; +0.0032]   LL +0.0017 [-0.0017 ; +0.0051]
  SAISON Brier +0.0026 [-0.0013 ; +0.0064]   LL +0.0046 [-0.0011 ; +0.0099]

Matchs avec un club qui a beaucoup changé (n=1728)  W80 Brier 0.5986  bookmakers 0.5828
  W40    Brier -0.0007 [-0.0028 ; +0.0013]   LL -0.0009 [-0.0039 ; +0.0020]
  W30    Brier +0.0001 [-0.0031 ; +0.0031]   LL +0.0003 [-0.0042 ; +0.0047]
  W20    Brier +0.0006 [-0.0038 ; +0.0045]   LL +0.0007 [-0.0053 ; +0.0063]
  SAISON Brier -0.0012 [-0.0059 ; +0.0034]   LL -0.0020 [-0.0085 ; +0.0043]

Par championnat (Brier, écart à W80) :
  FL1  n=702 W40 -0.0018  W30 -0.0005  W20 -0.0002  SAISON -0.0042
  PL   n=860 W40 -0.0002  W30 +0.0011  W20 +0.0022  SAISON +0.0016
  PD   n=879 W40 +0.0006  W30 +0.0015  W20 +0.0037  SAISON +0.0022
  SA   n=870 W40 +0.0025  W30 +0.0024  W20 +0.0043  SAISON +0.0060
  BL1  n=693 W40 -0.0008  W30 +0.0014  W20 +0.0039  SAISON +0.0001
  PPL  n=710 W40 +0.0017  W30 +0.0038  W20 +0.0073  SAISON +0.0057
  DED  n=720 W40 +0.0003  W30 +0.0002  W20 +0.0041  SAISON -0.0006
  ELC  n=1284 W40 +0.0011  W30 +0.0013  W20 +0.0004  SAISON -0.0005
  FL2  n=719 W40 -0.0008  W30 -0.0022  W20 -0.0001  SAISON -0.0023

Par championnat et saison (Brier, écart à W80 : W40 / SAISON) :
  FL1  2024: -0.0024 / -0.0039   2025: -0.0018 / -0.0040   2026: +0.0006 / -0.0059
  PL   2024: -0.0007 / +0.0046   2025: -0.0002 / -0.0004   2026: +0.0017 / -0.0022
  PD   2024: -0.0009 / +0.0023   2025: +0.0020 / +0.0039   2026: +0.0007 / -0.0035
  SA   2024: +0.0026 / +0.0048   2025: +0.0029 / +0.0072   2026: +0.0005 / +0.0057
  BL1  2024: -0.0020 / -0.0007   2025: +0.0005 / -0.0001   2026: -0.0012 / +0.0041
  PPL  2024: +0.0013 / +0.0044   2025: +0.0021 / +0.0067   2026: +0.0014 / +0.0070
  DED  2024: +0.0000 / -0.0039   2025: +0.0009 / +0.0034   2026: -0.0005 / -0.0023
  ELC  2024: +0.0032 / +0.0017   2025: -0.0015 / -0.0017   2026: +0.0026 / -0.0033
  FL2  2024: -0.0007 / -0.0026   2025: -0.0016 / -0.0009   2026: +0.0012 / -0.0055
```
