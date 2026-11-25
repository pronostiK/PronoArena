# M7C : activation, rupture et retour arrière

Statut : contrôle en lecture seule réussi le 25/11/2026 (CONTROLE-LECTURE-SEULE-25-11.md). **Activation accordée par le chef de projet le 25/11/2026 à 17:02 UTC.**

## Ce qui change avec M7C

- Seule la façon de relier les lignes des fichiers de corners (et des xG de M7X) aux matchs du robot.
- Nouvelle liaison : table explicite des noms d'équipes (`src/liaison-table.js`) + règle stricte (`src/liaison.js`) :
  même équipe à domicile, même équipe à l'extérieur, même date à un jour près, même score, une seule correspondance.
  Sinon, rien n'est attribué (jamais de donnée douteuse).
- Garde-fou par équipe : si moins de 90 % des lignes d'une équipe se relient, ses corners sont écartés.
- Seuls les matchs terminés reçoivent des données.
- **Aucun coefficient modifié** : `MODEL` (`src/config.js`) identique, vérifié par test.

## Interrupteur

`src/corners.js`, ligne `export let LIAISON_STRICTE = false;`

- `false` (actuel) : ancienne méthode, prédictions et journal M0/M7 identiques octet pour octet
  (`test/lab/check-suivi-moteurs.mjs` : M0 360/360, M7 360/360).
- `true` : M7C.

## Étape 1 : passage en lecture seule (avant activation)

Mise en ligne de la version avec l'interrupteur **éteint**. Elle ne change aucune prédiction et ajoute :
- la route `/liaison-controle?ligue=<id>` : lit les fichiers du robot et les sources, applique les deux méthodes,
  compare, **n'écrit rien** (vérifié par test : 0 écriture KV, aucune écriture D1) ;
- la désactivation de M7-40 (variante non retenue).

Championnats contrôlés : 39 (PL), 40 (Championship), 61 (Ligue 1), 62 (Ligue 2), 78 (Bundesliga), 88 (Eredivisie), 135 (Serie A), 140 (Liga).
Pour chacun : couverture des deux saisons, noms introuvables (dont les 17 équipes « prec »), équipes du robot sans table,
refus détaillés, matchs non terminés recevant des données (doit être 0), couverture xG pour les 5 grands championnats.

## Étape 2 : activation (après accord du chef de projet)

1. Passer `LIAISON_STRICTE` à `true`, lancer les tests, publier.
2. Au premier passage du robot, chaque fichier de corners est relu une fois avec la nouvelle méthode (au plus 16 écritures KV).
3. Le journal change de version (`SUIVI_VERSION` = M0/M7C) et d'empreinte de réglages (`SUIVI_PARAMS` gagne `liaison: "stricte-v1"`).
   Les lignes M0/M7 déjà écrites ne sont **ni modifiées ni supprimées** (journal en ajout seul, chaîne SHA-256 et sceaux GitHub conservés).
4. Transition : le robot relit un fichier de corners par passage (16 fichiers, environ 3 h). Pendant ce temps, une ligne peut porter
   la nouvelle empreinte alors que son championnat n'a pas encore ses corners relus. Ces lignes de transition ne sont PAS comptées.
5. Départ de l'évaluation M0/M7C = `suivi.m7c.depart` dans `/status` : premier passage où les 16 fichiers sont relus en liaison stricte.
   À ce passage, les 9 championnats sont recalculés une fois, si bien que chaque match à venir reçoit une ligne M0/M7C.
   Une ligne est aussi écrite quand seule l'empreinte des réglages change (même probabilités).
6. L'évaluation M0/M7C ne retient que les lignes avec la nouvelle empreinte ET créées à partir du départ. Jamais fusionnée avec M0/M7.
7. M7X (non affiché) suit la même rupture : sa base devient M7C (corners et xG en liaison stricte), nouvelle version et nouvelle empreinte.
5. `/status` publie, par championnat, la méthode, la couverture et les anomalies de liaison.

### Fiche de rupture (à remplir au moment de l'activation)

| Élément | Valeur |
|---|---|
| Date et heure (UTC) de la publication | … |
| Commit publié | … |
| Dernière ligne M0/M7 du journal (seq, empreinte) | … |
| Première ligne M0/M7C (seq, empreinte) | … |
| Empreinte des réglages M0/M7 | … |
| Empreinte des réglages M0/M7C | … |
| Version de la liaison | stricte-v1 |

## Retour arrière (en cas d'incident)

1. Remettre `LIAISON_STRICTE` à `false`, publier.
2. Au passage suivant, chaque fichier est relu une fois avec l'ancienne méthode (testé : retour complet, rapport retiré).
3. Le journal reprend la version et l'empreinte M0/M7 ; les lignes M0/M7C restent conservées et identifiables.
4. Consigner l'incident (date UTC, cause, matchs concernés) dans le bilan suivant.

Délai : une publication (quelques minutes) + un passage du robot (10 min).

## Incidents à surveiller après activation

- Couverture d'un championnat qui chute sous 90 % : nom changé à la source → compléter la table, ne rien deviner.
- Un match non terminé qui reçoit des données : arrêt immédiat (retour arrière).
- Une équipe écartée par le garde-fou : la signaler, pas de correction automatique.
