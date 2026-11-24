# Correctif de liaison des corners et des xG : preuves de fiabilité et impact (24/11/2026)

**Rien n'est déployé.** Le correctif est écrit (`src/liaison.js`), mais aucun fichier du robot ne l'appelle. Les coefficients du moteur ne changent pas. Ce qui suit a été fait hors production, sur les données publiques et sur les données déjà enregistrées.

## 1. Ce que fait le correctif

### La table de correspondance explicite (`test/lab/liaison/correspondances.mjs`)
- Elle a été écrite à la main, nom par nom.
- Pour chacune des 183 équipes des 8 championnats, sur les deux saisons, elle donne :
  - le nom exact chez le robot ;
  - le nom dans le fichier des corners (183 noms) ;
  - le nom chez la source xG (113 noms).
- Une même équipe peut avoir plusieurs noms chez la source xG. C'est déjà arrivé : par exemple « Lille », puis « LOSC Lille ».
- Le robot retrouve l'identifiant de chaque équipe par le **nom exact** dans ses propres données. Si un nom est introuvable ou en double chez le robot, l'équipe est ignorée.

### La liaison stricte (`src/liaison.js`)
Une donnée n'est attribuée à un match que si toutes les conditions suivantes sont remplies :
1. les deux équipes sont dans la table ;
2. il existe **un seul** match terminé du robot avec le même domicile, le même extérieur et une date à 1 jour près ;
3. le score est **identique** ;
4. aucune autre ligne ne vise le même match.

Il y a aussi un **garde-fou par équipe** : si moins de 90 % des lignes d'une équipe trouvent leur match, toutes les lignes de cette équipe sont écartées.

Dans tous les autres cas, **rien n'est attribué**, et le cas est noté dans un rapport.

### Données disponibles avant chaque prédiction
- Seuls les matchs déjà terminés peuvent recevoir des corners ou des xG.
- Dans le test d'impact, chaque prédiction n'utilise que les lignes datées d'avant le jour du match.

## 2. Contrôles réalisés

| Contrôle | Résultat |
|---|---|
| Tests de la liaison stricte (inversion domicile/extérieur, date trop éloignée, score différent, match en double, équipe inconnue, ligne en double, match futur, table fausse, nom introuvable) | **10/10** (`test-liaison.txt`) |
| Structure de la table : chaque nom du fichier relié une fois, aucun nom relié deux fois | **0 erreur** (`verif-table.txt`) |
| Saison en cours : bilan de chaque équipe (matchs, V, N, D, buts pour et contre) d'après le fichier des corners, comparé au classement du robot | **152 sur 156 identiques**, 8 championnats. Les 4 écarts viennent de 2 matchs : un doublon dans l'historique public utilisé pour le test (Auxerre–Nice, avec deux dates différentes) et un match joué après la dernière mise à jour du robot (Nantes–Grenoble, 23/11). Aucun ne vient d'une erreur de table |
| Saison en cours : bilans d'après la source xG, comparés au classement du robot | **96 sur 96 identiques** (5 championnats) |
| Saison précédente : bilans du fichier des corners comparés à ceux de la source xG (y compris matchs et buts à domicile) | **92 sur 96 identiques**. Les 4 écarts sont des matchs de barrage, présents seulement chez la source xG (Nice, Wolfsburg), et un match absent de la source xG (Toulouse–Nantes) |
| **Ligue 2, match par match, contre la même source que le robot (ESPN), deux saisons** | 2025-26 : **305/305** reliés. 2026-27 : **117/117** reliés, contre 50 avec la méthode actuelle. 0 liaison fausse, 0 désaccord (`resultat-github-actions.txt`) |
| **xG, match par match, contre les matchs du fichier des corners, saison 2025-26, 5 championnats** | **1 751** lignes reliées, 0 liaison fausse. 6 lignes refusées à juste titre : les matchs de barrage, avec des équipes extérieures au championnat ou des matchs absents du championnat |

### Ce qui n'a pas pu être contrôlé hors ligne
- **17 équipes** de la saison précédente ne sont plus dans un championnat suivi : 3 relégués par championnat, et 2 en Ligue 1. Leur nom exact chez football-data.org n'a pas pu être lu sans la clé du robot (refus 403).
- Ces équipes sont marquées « prec » dans la table. Si leur nom ne correspond pas, leurs matchs restent simplement **sans corners ni xG**. Aucune donnée fausse n'est possible.
- Un exemple réel : j'avais d'abord écrit « Amiens » pour la Ligue 2, alors qu'ESPN écrit « SC Amiens ». La vérification l'a détecté et je l'ai corrigé.
- Pour tout vérifier aussi en Premier League, Liga, etc., deux possibilités :
  - ajouter la clé football-data.org du robot aux secrets du dépôt GitHub (une action de Kay) ;
  - ou laisser le robot publier son rapport de liaison au premier passage après validation.

## 3. Impact hors production (`impact.txt`)

Le test porte sur les 7 437 matchs de l'audit (9 championnats, 2024-25 à 2026-27). Les matchs du suivi prospectif sont exclus. Les coefficients sont identiques. Deux versions sont comparées :
- **M7P** : les corners reliés comme aujourd'hui, en rejouant la méthode actuelle à chaque journée ;
- **M7C** : les corners reliés par le correctif.

| | M7P | M7C | Écart (Brier) | Fourchette | Écart (log loss) |
|---|---|---|---|---|---|
| Total | 0,5970 | 0,5963 | **−0,0007** | de −0,0011 à −0,0003 | −0,0010 |
| 2024-25 | 0,5916 | 0,5910 | −0,0006 | de −0,0013 à −0,0000 | −0,0009 |
| 2025-26 | 0,6035 | 0,6027 | −0,0008 | de −0,0013 à −0,0002 | −0,0011 |
| 2026-27 | 0,5931 | 0,5924 | −0,0007 | de −0,0021 à +0,0007 | −0,0010 |

- **Le gain va dans le même sens sur les 3 saisons.** Il est net sur l'ensemble des matchs (la fourchette ne contient pas zéro).
- **Par championnat** : Ligue 2 −0,0020, Ligue 1 −0,0014, Bundesliga −0,0013, Championship −0,0012. Ailleurs, l'écart est proche de zéro. Le Portugal ne change pas, puisqu'il n'utilise pas les corners.
- **Effet sur les probabilités** : 0,55 point en moyenne, au plus 8,8 points sur un match.
- **Couverture des corners au moment des prédictions** :
  - méthode actuelle rejouée : de 11 à 98 % selon le championnat et la saison ;
  - correctif : 100 %.

Le M7C correspond exactement au M7 qui avait été testé et validé avant la mise en ligne (0,5963).

## 4. Si le correctif est validé (rien n'est fait avant)
1. Brancher la liaison stricte à la place de la méthode actuelle, pour les corners et pour les xG de M7X.
2. Afficher le rapport de liaison sur `/status` : matchs reliés, lignes refusées et pourquoi, équipes introuvables.
3. Appeler ce moteur M7C. Noter la date, l'heure, le commit et la nature de la rupture. Garder intact le journal M0/M7 actuel. Ouvrir un nouveau suivi M0/M7C séparé.
4. Ensuite seulement : enregistrer en caché M7X, PREC_50_8 et SAISON_L1L2 face à M7C, avec des critères figés à l'avance.
