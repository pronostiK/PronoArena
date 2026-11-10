# Prono Arena — note de passation (à lire en début de nouvelle conversation)

## Utilisateur
- Francophone, novice en informatique : réponses courtes et claires, pas de jargon, guider pas à pas.
- Règle « tout ou rien » : jamais de fonctionnalité à moitié faite.
- Valide chaque étape avant de passer à la suivante.
- Ne fait plus confiance à Gemini/Meta (code factice) : toujours prouver (tests, captures, /status).

## Concept (validé)
Une « arène » : chaque match est un duel. Jeu **gratuit, pour le fun, sans lot ni argent à gagner**.
- **Duels** : matchs à venir + avis du moteur (+ bientôt le prono du visiteur).
- **Verdict** : résultats vs pronostics figés avant le coup d'envoi + taux de réussite réel.
- **Arène** : classement hebdomadaire des pronostiqueurs (bloc 2).
- **Accès** : gratuit = 2 pronostics par jour ; **5 €/mois** = tous les pronostics (bloc 3, Stripe). Pas d'offre à 9 €.
- Style : sombre + orange (#FF6B00), polices Archivo + Space Grotesk, visuel (logos, icônes, barres), peu de texte.

## Architecture (Cloudflare, offre gratuite — attention aux quotas)
- Dépôt : github.com/pronostiK/PronoArena (Claude pousse, Cloudflare publie automatiquement).
- Moteur : worker `prono-arena-worker` (racine du dépôt, `src/`), URL prono-arena-worker.hitch-legende.workers.dev
- Site : worker `prono-arena` (dossier `site/`, répertoire racine `site`), URL prono-arena.hitch-legende.workers.dev
- Cache KV `PRONO_CACHE`. Secrets dans Cloudflare : `FOOTBALL_DATA_KEY` (et `API_FOOTBALL_KEY`, inutilisée).
- Robot (cron toutes les 10 min) : prépare tout, les visiteurs ne font que lire. Jamais d'appel API au clic.
- Quotas mesurés : ~144 requêtes/jour pour le robot, ~350 écritures KV/jour (limite 1000), visiteur ≈ 5 requêtes.
- Le compte Cloudflare héberge aussi PronostiK : quotas partagés.

## Moteur (V7)
- 40 derniers matchs par équipe, les 5 plus récents comptent double (règle de l'utilisateur).
- Forces attaque/défense dom/ext, Elo reporté d'une saison à l'autre, Poisson + Dixon-Coles.
- Coupes d'Europe renforcées par les championnats nationaux (coefficients de niveau).
- Sources : football-data (principale) ; ESPN (UN JOUR PAR APPEL, toute période = erreur 400, budget 40 appels par passage) (Ligue 2, Europa, Conference, Nations, championnats pour les coupes, **secours automatique** si football-data en panne > 12 h).
- Compositions : onze du dernier match (ESPN, méthode PronostiK), correspondance d'identifiants football-data ↔ ESPN par matchs communs.
- Routes : /league-predictions, /match-details, /verdict, /leagues, /status.

## Tests
- `npm test` : monde simulé complet (robot, coupes, secours, Verdict, compositions, quotas) — 51 tests.
- `test/preview.mjs` : site + moteur simulé dans Chrome, captures téléphone (PLAYWRIGHT_PATH=/opt/npm-tools/node_modules/playwright).

## Fait
- Bloc 1 : moteur, robot, site (Duels, Analyse visuelle avec marchés/stats/compos/face-à-face, Verdict). En ligne le 10/11/2026.

## À faire
- Vérifier /status le lendemain (remplissage, saison précédente football-data acceptée ou non par la clé gratuite).
- **Bloc 2** : comptes joueurs (pseudo), pronostics des visiteurs bloqués au coup d'envoi, Arène (classement hebdo), base D1 gratuite.
- **Bloc 3** : abonnement 5 €/mois (Stripe), limite 2 pronos/jour en gratuit.
- Plus tard : corners et cartons (stats détaillées ESPN, plus lourd pour le quota).
