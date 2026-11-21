# Protocole du suivi prospectif M0 / M7

Figé le 20/11/2026, avant le premier match suivi. Toute modification de ce protocole après le 21/11/2026 doit être datée, justifiée et signalée dans le bilan. Elle ne peut pas s'appliquer aux matchs déjà joués.

## 1. Ce qui est comparé

| | Moteur | Code de référence |
|---|---|---|
| **M0** | Ancien moteur : Poisson + Dixon-Coles, forces sur les buts seuls, sans correction des promus, sans mélange Elo, sans corners | fonctions du commit `02509e8` |
| **M7** | Moteur en production : M0 + promus (7 championnats) + Elo 25 % + corners 30 % (8 championnats, sans le Portugal) | fonctions du commit `8044a83` |

- Les réglages des deux moteurs sont ceux de `src/config.js` au commit `8044a83`. Leur empreinte SHA-256 (`reglages`) est écrite sur chaque ligne du journal et publiée avec chaque empreinte. Si elle change, les lignes concernées sont exclues et le changement est signalé.
- **Preuve de reproduction (condition 4)** : `node test/lab/check-suivi-moteurs.mjs` extrait les deux commits du dépôt et les fait tourner sur les mêmes données que le journal. Résultat au 20/11/2026 : M0 identique à `02509e8` sur 360/360 matchs, M7 identique à `8044a83` sur 360/360 matchs, y compris un passage avec des promus ; matchs notés au-delà des 10 publiés : 4/4 identiques pour M0 et pour M7.
- Aucun réglage n'est modifié pendant le suivi. Aucun nouveau test de paramètres n'est lancé sur les matchs du suivi.

## 2. Enregistrement (avant chaque match)

- **Où** : table `suivi` de la base D1 du site. Le robot l'alimente à chaque recalcul d'un des 9 championnats (code : `src/suivi.js`).
- **Quoi** : pour chaque match pas encore commencé, les probabilités 1-N-2 de M7 telles que publiées sur le site et celles de M0, calculées au même moment avec les mêmes données. Plus l'heure d'enregistrement, l'heure du coup d'envoi, les équipes, la source des données et le nombre de promus et de matchs avec corners utilisés.
- **Matchs non affichés** (ajout du 20/11/2026, avant le premier match suivi, accord de Kay) : le site ne calcule que les 10 prochains matchs de chaque championnat. Le journal note aussi les matchs des 7 prochains jours au-delà de ces 10 (Championship : 12 matchs le samedi), avec les mêmes fonctions et le même modèle. Ces lignes portent `publie: false` dans `infos` ; leurs probabilités M7 ne sont pas affichées sur le site. Le bilan donne le résultat avec et sans elles.
- **Quand** : une nouvelle ligne seulement quand les probabilités ou l'heure du match changent. Rien n'est écrit pour un match déjà commencé.
- **Impossible à remplacer** :
  1. La base refuse toute modification et toute suppression (déclencheurs `suivi_sans_modif` et `suivi_sans_suppr`).
  2. Chaque ligne contient l'empreinte SHA-256 de son contenu, chaînée à celle de la ligne précédente. Changer ou retirer une ligne casse toute la suite de la chaîne.
  3. Toutes les 30 min, l'empreinte de tête est publiée par un commit sur la branche `suivi-empreintes` du dépôt GitHub (`suivi/empreintes.jsonl`). La date du commit prouve que toutes les lignes jusqu'à ce point existaient déjà.
- **Consultation** : `https://api.duelprono.com/suivi/empreinte` (tête de chaîne, sans probabilités). `https://api.duelprono.com/suivi/export` (toutes les lignes ; probabilités visibles seulement 3 h après le coup d'envoi ; les autres gardent leur empreinte, la chaîne reste vérifiable).

## 3. Prédiction retenue pour chaque match

- On retient **la dernière ligne du match enregistrée avant le coup d'envoi et couverte par une empreinte publiée sur GitHub avant le coup d'envoi**.
- Si aucune ligne n'est couverte avant le coup d'envoi (recalcul dans la dernière demi-heure), on retient la dernière ligne enregistrée avant le coup d'envoi si elle est couverte par une empreinte publiée au plus tard 1 h après. Ces matchs sont comptés à part (« ancrage tardif ») et le bilan donne le résultat avec et sans eux.
- M0 et M7 sont toujours pris **sur la même ligne** : la règle ne peut favoriser aucun des deux.

## 4. Matchs inclus et exclus

- **Inclus** : matchs de championnat des 9 championnats de l'audit, coup d'envoi à partir du **samedi 21/11/2026 00:00 (Paris)** : Ligue 1 (61), Premier League (39), Liga (140), Serie A (135), Bundesliga (78), Eredivisie (88), Championship (40), Ligue 2 (62), Portugal (94).
- **Exclus, et listés dans chaque bilan** :
  - match sans aucune ligne retenue selon la règle 3 ;
  - match reporté : la ligne doit être antérieure au coup d'envoi **réel** ; une ligne faite pour l'ancienne date reste valable seulement si elle est antérieure au coup d'envoi réel ;
  - match annulé, arrêté ou donné sur tapis vert (pas de résultat sportif) ;
  - ligne dont l'empreinte des réglages diffère de celle du 20/11 ;
  - rupture de la chaîne d'empreintes : toutes les lignes après la rupture sont exclues jusqu'à la prochaine empreinte publiée valide, et l'incident est signalé.
- **Résultat** : score final après 90 min (temps additionnel compris), tiré des données du robot ; contrôlé par l'historique football-data.co.uk quand il est disponible. Un désaccord entre les deux sources est signalé et le match est exclu.
- **Données manquantes** : le nombre de matchs prévus, enregistrés, retenus et exclus est donné par championnat dans chaque bilan.

## 5. Mesures

- Erreur de Brier (1-N-2, somme des 3 carrés) et log loss, pour M0 et M7, écart M7 − M0 apparié match par match.
- Intervalle à 95 % de l'écart par bootstrap regroupé par journée (10 000 tirages, graine fixée 20261120).
- Détail par championnat et nombre de matchs. **Portugal présenté à part** (il n'a pas de corners dans M7 : seuls les promus et l'Elo jouent).

## 6. Bilans et décision

- **Bilans informatifs** (aucune décision ne peut en être tirée) : après le week-end du 21-22/11, puis chaque semaine, chaque mois, et le bilan de direction début janvier 2027. Point intermédiaire à 1 500 matchs (vers fin mars 2027).
- **Critère final, fixé à l'avance** (fin de saison 2026-27) : M7 est jugé meilleur que M0 si l'écart de Brier M7 − M0 est négatif **et** si son intervalle à 95 % est entièrement sous 0, **et** si l'écart de log loss est aussi négatif. Sinon, le gain prospectif n'est pas démontré.
- **Portugal** : même critère calculé à part, pour information. Aucun réglage propre au Portugal ne sera fait pendant le suivi.

## 7. Charge pour l'hébergement

- Aucun appel extérieur en plus pour le robot.
- Un calcul de plus (M0) par championnat recalculé, et au plus une lecture et quelques écritures dans la base par recalcul (une ligne seulement quand les probabilités changent).
- Environ 48 lectures par jour de `/suivi/empreinte` par GitHub (un commit seulement si l'empreinte a changé).
- Si la base est en panne, les pronostics du site sont publiés quand même ; l'erreur est notée dans `/status` (rubrique `suivi`).

## Annexe — suivi expérimental M7X (autorisé par l'auditeur le 20/11/2026)

- **Ce qu'est M7X** : M7, sauf la part « buts » des forces (70 %), qui devient 50 % buts + 50 % xG mesurés. Variante figée de `test/lab/run-xg-m7.mjs`, aucun autre réglage. 5 championnats : 61, 39, 140, 135, 78. Non affiché.
- **Code** : `src/xghist.js` (historique des xG en D1) et `src/suivi.js` (calcul et journal `suivi_x`). Ni M0, ni M7, ni la table `suivi`, ni ce protocole principal ne changent. Un test vérifie que le journal M0 / M7 est identique octet pour octet avec et sans M7X.
- **Sceaux** : `suivi/empreintes-x.jsonl`, dans le même commit que les sceaux M0 / M7. Adresses : `/suivi/empreinte-x` et `/suivi/export-x`.
- **Démarrage** : premier enregistrement M7X une fois l'historique des xG complet (saison 2025-26 et saison en cours ; date dans `/status` → `suivi.m7x.xgHistorique.remplissageTermine`). Pas de démarrage partiel.
- **Règles d'évaluation** : celles de `test/lab/PLAN-M7X.md`, section 4, fixées avant le premier enregistrement.
  - un xG manquant laisse les vrais buts ;
  - même règle 3 (ancrage tardif à part, résultats avec et sans) ;
  - analyse principale sur les lignes dont la couverture xG est d'au moins 80 % ;
  - gros favoris (≥ 60 %) suivis à part ;
  - critère final de fin de saison en 3 conditions ;
  - Serie A présentée à part ;
  - aucun réglage pendant l'évaluation.

## Annexe — variante cachée M7-40 (choix de Kay le 21/11/2026, sous réserve de l'auditeur)

- **Ce qu'est M7-40** : M7 identique (promus, Elo 25 %, corners 30 %), mais forces calculées sur les **40** derniers matchs par équipe au lieu de 80. 9 championnats. Non affiché.
- **Origine** : test hors ligne du 21/11 (`test/lab/RESULTAT-FENETRES.md`) : +0,0004 (non significatif), légèrement moins bon sur chacune des 3 saisons ; petit mieux non significatif pour les promus et les clubs qui ont beaucoup changé.
- **Code** : `src/suivi.js` (journal `suivi_v`, colonne `variante`, sa propre chaîne ; sceaux `suivi/empreintes-v.jsonl` ; adresses `/suivi/empreinte-v` et `/suivi/export-v`).
  - M0, M7 et M7X ne changent pas : un test vérifie que le journal M0 / M7 est identique octet pour octet avec et sans la variante.
  - Preuve de reproduction : M7-40 donne les mêmes chiffres que le code `8044a83` réglé sur 40 matchs, sur 90 matchs sur 90.
- **Règles d'évaluation**, fixées avant le premier enregistrement :
  - M7-40 − M7 sur les mêmes matchs, avec la même règle 3 (ancrage tardif à part, résultats avec et sans) ;
  - Brier et log loss, IC 95 % par bootstrap regroupé par journée (10 000 tirages, graine 20261120) ;
  - détail par championnat, avec la Bundesliga et le Portugal à part ;
  - sous-groupes : matchs avec un promu ; matchs avec un club dont les points par match de la saison en cours (au moins 6 matchs, avant le match) s'écartent de plus de 0,5 de ceux de la saison précédente.
- **Critère final, fin de saison 2026-27** : écart de Brier négatif avec un IC 95 % entièrement sous 0, et écart de log loss négatif. Sinon, le gain n'est pas démontré. Aucun réglage pendant l'évaluation.
