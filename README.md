# Prono Arena

Moteur de pronostics football (Cloudflare Worker).

En ligne : https://prono-arena-worker.hitch-legende.workers.dev
Publication automatique : chaque envoi sur `main` est publié par Cloudflare.

## Fonctionnement (V7)
- **Robot** (toutes les 10 min) : met à jour les données des compétitions, puis recalcule les pronostics. Le site ne fait que lire le résultat : réponses instantanées.
- **Moteur** : forces attaque/défense par équipe (domicile/extérieur, saison en cours + précédente), Elo reporté d'une saison à l'autre, Poisson + Dixon-Coles.
- **Coupes d'Europe** : renforcées par les données des championnats nationaux, corrigées du niveau de chaque championnat.
- **Stats** : forme (5 derniers), buts, % over 2,5, % les deux marquent, % clean sheet, classement.
- **Face-à-face** : toutes compétitions, orientés vers l'équipe à domicile du match.

## Site (dossier `site/`)
- Duels (avec le prono du joueur), Analyse d'un duel, Verdict, Arène (classement de la semaine), Compte — mobile d'abord, style sombre/orange.
- Publié sur le worker `prono-arena` (Cloudflare, répertoire racine `site`).

## Routes
- `/league-predictions?leagueId=61` : pronostics des 10 prochains matchs + classement
- `/match-details?matchId=…&source=…&teamDomId=…&teamExtId=…` : stats + face-à-face
- `/verdict?leagueId=all` : résultats comparés aux pronostics figés avant le coup d'envoi + taux de réussite
- `/leagues` : compétitions et nombre de matchs à venir
- `/status` : état du robot et de chaque source (transparence)

## Code
- `src/config.js` réglages et compétitions · `src/model.js` moteur · `src/sources.js` données
- `src/build.js` pronostics · `src/robot.js` robot · `src/index.js` routes
- `test/` : `npm test` (monde simulé complet + précision)

La clé football-data (`FOOTBALL_DATA_KEY`) est stockée dans Cloudflare, jamais dans ce dépôt.
