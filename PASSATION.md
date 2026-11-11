# Duel Prono (ex-« Prono Arena ») — note de passation (à lire en début de nouvelle conversation)

## Utilisateur
- Francophone, novice en informatique : réponses courtes et claires, pas de jargon, guider pas à pas.
- Règle « tout ou rien » : jamais de fonctionnalité à moitié faite.
- Valide chaque étape avant de passer à la suivante.
- Ne fait plus confiance à Gemini/Meta (code factice) : toujours prouver (tests, captures, /status).

## Concept (validé)
Une « arène » : chaque match est un duel. Jeu **gratuit, pour le fun, sans lot ni argent à gagner**.
- **Duels** : matchs à venir + avis du moteur + prono du joueur (3 boutons 1-N-2 sur chaque duel).
- **Verdict** : résultats vs pronostics figés avant le coup d'envoi + taux de réussite réel.
- **Arène** : classement hebdomadaire des joueurs (lundi → dimanche, heure de Paris).
- **Accès** : gratuit = 2 pronostics par jour ; **5 €/mois** = tous les pronostics (bloc 3, Stripe). Pas d'offre à 9 €.
- Compétitions affichées par leur **logo** (images ESPN, adresses dans `src/config.js`), jamais par leur nom ; le nom ne s'affiche que si l'image ne charge pas. Elles sont rangées en **colonne à gauche** (Duels et Verdict), qui défile de haut en bas et reste visible pendant la lecture : choix de l'utilisateur pour se démarquer des autres sites.
- Logo officiel Duel Prono (casque de gladiateur + Colisée, fourni par l'utilisateur) : `site/public/duelprono-logo.webp`, `duelprono-logo-small.webp`, `duelprono-icone.png`, `duelprono-icone-180.png` (si une image change, changer aussi son nom de fichier, et le `?v=` de app.js / app.css dans index.html, sinon les téléphones gardent l'ancienne version). Affiché dans l'en-tête, le bandeau des Duels et l'écran de connexion.
- Duels : calendrier en haut (« À venir » + un bouton par jour de match, comme PronostiK) ; la colonne n'affiche que les compétitions qui ont au moins un match à venir.
- **Positionnement : site de probabilités + jeu gratuit, pas un site de paris.** Jamais les mots « pari », « cote », « bookmaker », « remboursé », « marchés » dans ce que voit le visiteur. Les points du jeu ne sont pas affichés sur les Duels (décision de l'utilisateur : ne pas mélanger points et probabilités) ; ils apparaissent après le choix (message), dans l'Arène et dans Mon espace.
- **Deux mises en page** : téléphone (par défaut) et ordinateur à partir de 1000 px de large (bloc « VERSION ORDINATEUR » à la fin de `app.css`) : navigation en haut, colonne des compétitions avec logo + nom, matchs sur deux colonnes, Arène et Mon espace sur deux colonnes. Toute nouveauté doit être vérifiée dans les deux (`test/preview.mjs` fait les deux).
- Boîte mail contact@duelprono.com créée chez Amen le 11/11/2026 (à tester une fois le domaine actif chez Cloudflare).
- Style : sombre + orange (#FF6B00), polices Archivo + Space Grotesk, visuel (logos, icônes, barres), peu de texte.

## Architecture (Cloudflare, offre gratuite — attention aux quotas)
- Dépôt : github.com/pronostiK/PronoArena (Claude pousse, Cloudflare publie automatiquement).
- Moteur : worker `prono-arena-worker` (racine du dépôt, `src/`), URL prono-arena-worker.hitch-legende.workers.dev
- Site : worker `prono-arena` (dossier `site/`, répertoire racine `site`), URL prono-arena.hitch-legende.workers.dev
- Base D1 `prono-arena` (binding `DB`, id 44108fa4-5b70-4731-a0e4-33605e47a1dc, tables dans `schema.sql`) : joueurs, sessions, pronos, limites.
- Cache KV `PRONO_CACHE`. Secrets dans Cloudflare : `FOOTBALL_DATA_KEY` (et `API_FOOTBALL_KEY`, inutilisée).
- Robot (cron toutes les 10 min) : prépare tout, les visiteurs ne font que lire. Jamais d'appel API au clic.
- Quotas mesurés : ~144 requêtes/jour pour le robot, ~350 écritures KV/jour (limite 1000), visiteur ≈ 5 requêtes.
- Le compte Cloudflare héberge aussi PronostiK : quotas partagés.

## Moteur (V7)
- 40 derniers matchs par équipe, les 5 plus récents comptent double (règle de l'utilisateur).
- Forces attaque/défense dom/ext, Elo reporté d'une saison à l'autre, Poisson + Dixon-Coles.
- Coupes d'Europe renforcées par les championnats nationaux (coefficients de niveau).
- Sources : football-data (principale) ; ESPN (UN JOUR PAR APPEL, toute période = erreur 400, budget 40 appels par passage) (Ligue 2, Europa, Conference, Nations, championnats pour les coupes, **secours automatique** si football-data en panne > 12 h).
- ESPN refuse parfois les appels (erreur 403, vue le 10/11/2026 à 21 h 10 UTC, juste après un changement de l'en-tête « User-Agent » ; cause non prouvée : en-tête ou rythme trop élevé). Parades en place : en-tête de navigateur neutre (`ESPN_HEADERS`), budget 30 appels par passage, **pause automatique** après un refus (30 min, 1 h, 2 h, 4 h max, visible dans /status rubrique « espn »), premier chargement des compétitions affichées avant les sources de secours. Remplissage complet simulé : ~42 h.
- Compositions : onze du dernier match (ESPN, méthode PronostiK), correspondance d'identifiants football-data ↔ ESPN par matchs communs.
- Routes : /league-predictions, /match-details, /verdict, /leagues, /status.

## Arène (bloc 2, `src/arena.js`)
- Compte : pseudo + e-mail + mot de passe. Mot de passe haché (PBKDF2, 100 000 tours), jeton de connexion haché, valable 90 jours, rangé dans le navigateur (pas de cookie : site et moteur sont sur deux adresses différentes).
- Prono 1-N-2 modifiable jusqu'au coup d'envoi, refusé ensuite par le moteur (pas seulement par le site).
- Points selon le risque : 10 ÷ probabilité du moteur, entre 10 et 100, figés au moment du choix. Mauvais prono = 0.
- Le robot note les pronos dès que le score final est connu (1 appel base par passage s'il n'y a rien à noter).
- Classement : points, puis pronos justes, puis moins de pronos joués, puis pseudo. 50 premiers affichés.
- Routes : POST /account/signup, /account/login, /account/logout, /account/delete ; GET /me ; POST /picks ; GET /arena[?semaine=precedente]. /status affiche le nombre de joueurs et de pronos.
- Espace personnel (écran Compte) : bilan semaine + total, tous ses pronos (à venir / terminés), prénom et ville (privés), club favori (blason affiché au classement), changement d'e-mail et de mot de passe. Routes POST /account/profile, /account/email, /account/password.
- Anti-abus : 10 essais de connexion par quart d'heure, 5 inscriptions par heure et par adresse.
- Pas encore fait : « mot de passe oublié » (il faut un service d'envoi d'e-mails).
- Pages d'information (11/11/2026), dans `site/public/app.js` (objet `DOCS`) : À propos, Conditions d'utilisation, Confidentialité, Mentions légales ; liens en bas de chaque page. L'éditeur est un particulier non professionnel qui reste anonyme (LCEN art. 6 III) : **ne jamais écrire son nom dans le site ni dans le dépôt.** Contact : contact@duelprono.com. Site réservé aux 18 ans et plus : case obligatoire à l'inscription, vérifiée aussi par le moteur. Textes non relus par un juriste.
- **À refaire avant le bloc 3 (abonnement payant)** : l'éditeur devient professionnel, donc identité ou société + SIRET dans les mentions légales, conditions de vente, droit de rétractation.
- Polices Archivo et Space Grotesk hébergées dans `site/public/fonts/` (plus aucun appel à Google).

## Tests
- `npm test` : monde simulé complet (robot, coupes, secours, Verdict, compositions, quotas, Arène avec un vrai SQLite) — 98 tests.
- `test/preview.mjs <dossier>` : parcours joueur complet dans Chrome (inscription, prono, Arène, déconnexion, suppression) + captures téléphone (PLAYWRIGHT_PATH=/opt/npm-tools/node_modules/playwright).

## Fait
- Bloc 1 : moteur, robot, site (Duels, Analyse visuelle avec marchés/stats/compos/face-à-face, Verdict). En ligne le 10/11/2026.
- Bloc 2 : comptes joueurs, pronos bloqués au coup d'envoi, Arène. Codé et testé le 10/11/2026 (voir l'historique du dépôt pour savoir si c'est en ligne).

## À faire
- **NOM : « Duel Prono » depuis le 10/11/2026. FAIT sur le site** (titre, en-tête, mentions, logo, icônes ; original du logo dans `assets/logo-duel-prono-original.png`, utilisé tel quel car son fond est propre). **RESTE : brancher les domaines.** Ne plus jamais écrire « Prono Arena » dans ce que voit le visiteur. Historique : (duel avec un « e »). Raison : « PronoArena » est une marque enregistrée à l'INPI par un tiers (n° 5261442, classes 9, 41, 42) et prono-arena.fr appartient à ce tiers. « Duel Prono » et « Prono Duel » : aucun résultat à l'INPI ; duelprono.com et .fr libres le 10/11/2026.
  - Domaines achetés chez Amen le 10/11/2026 : **duelprono.com** (adresse principale prévue) et **duelprono.fr** (redirigé vers le .com). Offre Amen : 3 comptes mail, DNS inclus. Ne pas déplacer les comptes joueurs chez Amen : ils restent dans D1.
  - Branchement prévu : ajouter les domaines dans Cloudflare (serveurs de noms à changer chez Amen par l'utilisateur, guidé pas à pas, libellés Cloudflare en français), recopier les lignes MX d'Amen pour garder la boîte mail, site sur duelprono.com, moteur sur api.duelprono.com. Les noms internes des workers (prono-arena, prono-arena-worker) peuvent rester : les visiteurs ne les verront plus.
  - Ne rien renommer à moitié. Attendre : 1) le domaine acheté par l'utilisateur (nom exact), 2) le nouveau logo (même visuel, texte DUEL PRONO).
  - Puis tout changer d'un coup : nom dans le site (titre, en-tête, mentions, textes), fichiers du logo, noms des workers et adresse du moteur dans `site/public/app.js`, branchement du domaine sur Cloudflare, boîte e-mail, cette note.
  - Le mot « Arène » (onglet classement) peut rester : c'est le nom complet « Prono Arena » qui pose problème.
- Icône de la future application Android (APK) fournie par l'utilisateur : `assets/icone-application.png` (casque + ballon, sans texte, 1254 px, coins arrondis). À utiliser telle quelle pour l'APK ; peut aussi servir d'icône du site au moment du changement de nom.
- Vérifier que la Ligue des Nations apparaît une fois son chargement terminé (matchs le 12/11/2026) ; sinon lire /status.
- Vérifier /status le lendemain (remplissage, saison précédente football-data acceptée ou non par la clé gratuite).
- Après mise en ligne du bloc 2 : créer un vrai compte sur le site, vérifier /status (rubrique « arene ») et que l'inscription ne dépasse pas la limite de calcul de l'offre gratuite.
- **Bloc 3** : abonnement 5 €/mois (Stripe), limite 2 pronos/jour en gratuit.
- Plus tard : corners et cartons (stats détaillées ESPN, plus lourd pour le quota).
