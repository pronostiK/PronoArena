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
- **Accès (décision du 11/11/2026)** : un visiteur non inscrit ne voit les probabilités que de **2 matchs offerts par jour, les mêmes pour tous** ; un inscrit (gratuit) voit tout. Le moteur fait respecter la règle (`viewer`, `lockPrediction` : les matchs réservés partent sans aucune probabilité ; `/match-details` refusé). Les 2 matchs sont choisis une fois par jour, heure de Paris, par le robot (`chooseFree` dans `build.js` : matchs du jour, les grandes affiches d'abord), rangés dans `index._free` et visibles dans /status (`matchsOfferts`). Une fois ces 2 matchs joués, plus rien n'est offert jusqu'au lendemain. Verdict et Arène restent ouverts à tous. Plus tard (bloc 3) : accès selon la formule payée, au même endroit du code.
- **Langues : français et anglais (11/11/2026).** Le site est écrit en français ; `site/public/i18n.js` (chargé dans l'en-tête) traduit chaque texte à l'affichage : dictionnaire `D` pour les textes fixes, règles `R` pour ceux qui contiennent chiffres ou noms. Les 4 pages d'information ont leur version anglaise dans `app.js` (`DOCS_EN`). Langue par défaut = celle du navigateur (français si le navigateur est en français, anglais sinon) ; choix en bas de chaque page et dans Paramètres → Général, gardé dans le navigateur. **Tout nouveau texte doit être ajouté à `i18n.js`** : `test/i18n.mjs` (dans `npm test`) refuse un texte français sans traduction, et `test/preview.mjs` refait tout le parcours en anglais dans Chrome et échoue s'il reste un mot français à l'écran.
- **Accueil = « Tout »** (`#/`) : tous les matchs des 7 prochains jours, toutes compétitions, préparés par le robot (route `/upcoming`, clé KV `preds:all@saison`, version allégée de chaque match). Une compétition = `#/ligue/<id>`. Le logo du site et l'onglet Duels ramènent à l'accueil ; le retour depuis une analyse ramène à la compétition du match. Les compétitions sont classées par date de prochain match (`prochain` dans `/leagues`).
- Duels : calendrier en haut (« À venir » + un bouton par jour de match, comme PronostiK) ; la colonne n'affiche que les compétitions qui ont au moins un match à venir.
- **Positionnement : site de probabilités + jeu gratuit, pas un site de paris.** Jamais les mots « pari » ni « bookmaker » dans ce que voit le visiteur. (Le 11/11 au soir, l'utilisateur a fait remettre dans l'analyse les cotes, « Remboursé si nul » et l'onglet « Marchés », retirés le matin : la page lui paraissait vide.) Les points du jeu ne sont pas affichés sur les Duels (décision de l'utilisateur : ne pas mélanger points et probabilités) ; ils apparaissent après le choix (message), dans l'Arène et dans Mon espace.
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
- Clubs : tous les matchs des deux dernières saisons (au plus 80 par équipe), les 8 plus récents comptent ×1,5, lissage 6 (réglages validés par l'utilisateur le 12/11/2026 après test sur matchs réels ; avant : 40 matchs, 5 récents ×2).
- Forces attaque/défense dom/ext, Elo reporté d'une saison à l'autre, Poisson + Dixon-Coles.
- Coupes d'Europe renforcées par les championnats nationaux (coefficients de niveau).
- **Sélections nationales (Ligue des Nations, plus tard Euro et Coupe du monde)** : `src/nations.js`. Classement Elo sur tous les matchs internationaux, méthode et réglages repris de PronostiK (`src/nations-seed.js`, rafraîchi chaque semaine par le robot depuis le dépôt public PronostiK, puis mis à jour avec les matchs joués). Raison : avec 4 matchs par saison, l'ancien calcul donnait des absurdités (Turquie 9 % à domicile contre la Belgique ; maintenant 21 % / 28 % / 51 %). Si le fournisseur écrit un nom de pays inconnu, /status le signale (rubrique `selections`, liste `inconnues`) et ce match retombe sur l'ancien calcul : ajouter alors le nom dans `ALIASES`.
- Sources : football-data (principale) ; ESPN (UN JOUR PAR APPEL, toute période = erreur 400, budget 40 appels par passage) (Ligue 2, Europa, Conference, Nations, championnats pour les coupes, **secours automatique** si football-data en panne > 12 h).
- ESPN refuse parfois les appels (erreur 403, vue le 10/11/2026 à 21 h 10 UTC, juste après un changement de l'en-tête « User-Agent » ; cause non prouvée : en-tête ou rythme trop élevé). Parades en place : en-tête de navigateur neutre (`ESPN_HEADERS`), budget 30 appels par passage, **pause automatique** après un refus (30 min, 1 h, 2 h, 4 h max, visible dans /status rubrique « espn »), premier chargement des compétitions affichées avant les sources de secours. Remplissage complet simulé : ~42 h.
- Compositions : onze du dernier match (ESPN, méthode PronostiK), correspondance d'identifiants football-data ↔ ESPN par matchs communs.
- Routes : /league-predictions, /upcoming, /match-details, /verdict, /leagues, /status.

## Arène (bloc 2, `src/arena.js`)
- Compte : pseudo + e-mail + mot de passe. Mot de passe haché (PBKDF2, 100 000 tours), jeton de connexion haché, valable 90 jours, rangé dans le navigateur (pas de cookie : site et moteur sont sur deux adresses différentes).
- Prono 1-N-2 modifiable jusqu'au coup d'envoi, refusé ensuite par le moteur (pas seulement par le site).
- Points selon le risque : 10 ÷ probabilité du moteur, entre 10 et 100, figés au moment du choix. Mauvais prono = 0.
- Le robot note les pronos dès que le score final est connu (1 appel base par passage s'il n'y a rien à noter).
- Classement : points, puis pronos justes, puis moins de pronos joués, puis pseudo. 50 premiers affichés.
- Routes : POST /account/signup, /account/login, /account/logout, /account/delete ; GET /me ; POST /picks ; GET /arena[?semaine=precedente]. /status affiche le nombre de joueurs et de pronos.
- Mon espace a deux onglets : « Mon jeu » (`#/compte` : bilan, pronos) et « Paramètres », lui-même en « Général » (`#/compte/general` : prénom, ville, club favori, langue) et « Sécurité » (`#/compte/securite` : e-mail, mot de passe, déconnexion, suppression du compte). D'autres réglages pourront s'y ajouter si l'utilisateur les précise.
- Espace personnel (écran Compte) : bilan semaine + total, tous ses pronos (à venir / terminés), prénom et ville (privés), club favori (blason affiché au classement), changement d'e-mail et de mot de passe. Routes POST /account/profile, /account/email, /account/password.
- Anti-abus : 10 essais de connexion par quart d'heure, 5 inscriptions par heure et par adresse.
- **Mot de passe oublié** (12/11/2026) : lien par e-mail valable 1 h, une seule fois, jeton haché (table `resets`), anti-abus (3 e-mails/h par adresse, 5/h par IP), réponse identique si l'adresse est inconnue, toutes les connexions fermées après changement. Envoi par **Resend** (offre gratuite : 100 e-mails/jour, 3 000/mois ; l'envoi par Cloudflare demande l'offre payante Workers). Expéditeur `noreply@duelprono.com`, réponses vers `contact@duelprono.com`. **Le lien « Mot de passe oublié ? » n'apparaît que si le secret `RESEND_API_KEY` est réglé dans Cloudflare** (worker prono-arena-worker) ; domaine duelprono.com à valider dans Resend (lignes DNS ajoutées chez Cloudflare).
- Pages d'information (11/11/2026), dans `site/public/app.js` (objet `DOCS`) : À propos, Conditions d'utilisation, Confidentialité, Mentions légales ; liens en bas de chaque page. L'éditeur est un particulier non professionnel qui reste anonyme (LCEN art. 6 III) : **ne jamais écrire son nom dans le site ni dans le dépôt.** Contact : contact@duelprono.com. Site réservé aux 18 ans et plus : case obligatoire à l'inscription, vérifiée aussi par le moteur. Textes non relus par un juriste.
- 11/11/2026 : l'utilisateur n'ouvre pas de micro-entreprise pour l'instant → le bloc 3 (paiement) attend ; le site reste gratuit et l'éditeur reste anonyme.
- **À refaire avant le bloc 3 (abonnement payant)** : l'éditeur devient professionnel, donc identité ou société + SIRET dans les mentions légales, conditions de vente, droit de rétractation.
- Polices Archivo et Space Grotesk hébergées dans `site/public/fonts/` (plus aucun appel à Google).

## Test sur les matchs passés (12/11/2026, `test/backtest.mjs`)
- Données réelles : historique de PronostiK (`data/history.json` du dépôt PronostiK, football-data.co.uk, cotes moyennes des bookmakers). 7 091 matchs, août 2024 → novembre 2026, 9 championnats ; le modèle ne voit que les matchs joués avant chaque match.
- Erreur de Brier (plus bas = mieux), avec les nouveaux réglages : Duel Prono 0,600 (0,602 avec les anciens) · PronostiK 0,599 · bookmakers 0,584 · naïf 0,652 (un tiers partout = 0,667). Réussite 51 % / 51 % / 53 % / 43 %. Calibration bonne (annoncé ≈ observé).
- Buts (+2,5) et « les deux marquent » : aucun gain par rapport à une moyenne du championnat. Affiché honnêtement dans le Verdict.
- Le résultat est publié dans le Verdict (fichier `site/public/backtest.json`, à régénérer : `node test/backtest.mjs <history.json> <model.mjs PronostiK> site/public/backtest.json`).
- `test/tune.mjs` : réglage sur 2024-25, vérification unique sur 2025-26+. Meilleurs réglages trouvés (fenêtre 80 matchs, 8 récents ×1,5) : 0,6088 → 0,6056 sur les matchs jamais vus. **Appliqués le 12/11/2026 avec l'accord de l'utilisateur.**
- Absents : **ESPN ne les fournit pas** (vérifié en réel le 12/11/2026 sur Atlético-MG – Mirassol : la fiche ne contient ni blessés ni suspendus, et les compositions n'y apparaissent qu'environ 1 h avant le match). football-data gratuit non plus ; API-Football gratuit n'a pas la saison en cours. Pas d'absents sur le site tant qu'il n'y a pas de source fiable (payante). Rappel : l'étude de PronostiK montre que les absents n'améliorent presque pas les probabilités.

## Tests
- `npm test` : monde simulé complet (robot, coupes, secours, Verdict, compositions, quotas, Arène avec un vrai SQLite) — 128 tests, plus 4 contrôles de traduction (`test/i18n.mjs`).
- `test/preview.mjs <dossier>` : parcours joueur complet dans Chrome (inscription, prono, Arène, déconnexion, suppression) + captures téléphone (PLAYWRIGHT_PATH=/opt/npm-tools/node_modules/playwright).

## Fait
- Bloc 1 : moteur, robot, site (Duels, Analyse visuelle avec marchés/stats/compos/face-à-face, Verdict). En ligne le 10/11/2026.
- Bloc 2 : comptes joueurs, pronos bloqués au coup d'envoi, Arène. Codé et testé le 10/11/2026 (voir l'historique du dépôt pour savoir si c'est en ligne).

## À faire
- **NOM : « Duel Prono » depuis le 10/11/2026. FAIT sur le site** (titre, en-tête, mentions, logo, icônes ; original du logo dans `assets/logo-duel-prono-original.png`, utilisé tel quel car son fond est propre). **RESTE : brancher les domaines.** Ne plus jamais écrire « Prono Arena » dans ce que voit le visiteur. Historique : (duel avec un « e »). Raison : « PronoArena » est une marque enregistrée à l'INPI par un tiers (n° 5261442, classes 9, 41, 42) et prono-arena.fr appartient à ce tiers. « Duel Prono » et « Prono Duel » : aucun résultat à l'INPI ; duelprono.com et .fr libres le 10/11/2026.
  - Domaines achetés chez Amen le 10/11/2026 : **duelprono.com** (adresse principale prévue) et **duelprono.fr** (redirigé vers le .com). Offre Amen : 3 comptes mail, DNS inclus. Ne pas déplacer les comptes joueurs chez Amen : ils restent dans D1.
  - Branchement prévu : ajouter les domaines dans Cloudflare (serveurs de noms à changer chez Amen par l'utilisateur, guidé pas à pas, libellés Cloudflare en français), recopier les lignes MX d'Amen pour garder la boîte mail, site sur duelprono.com, moteur sur api.duelprono.com. Les noms internes des workers (prono-arena, prono-arena-worker) peuvent rester : les visiteurs ne les verront plus.
  - **11/11/2026 : duelprono.com actif chez Cloudflare.** Site relié à `duelprono.com` et `www.duelprono.com`, moteur à `api.duelprono.com` (routes `custom_domain` dans les deux `wrangler.jsonc`, `workers_dev: true` pour garder les anciennes adresses). Le site choisit l'adresse du moteur selon son propre nom de domaine et renvoie www / .fr vers duelprono.com (début de `app.js`). Les deux publications ont réussi ; fonctionnement réel à confirmer par l'utilisateur (l'environnement de Claude ne peut pas ouvrir le site).
  - **duelprono.fr actif chez Cloudflare le 11/11/2026 à 17 h 50**, relié au site (avec www) dans `site/wrangler.jsonc` ; il renvoie vers duelprono.com.
  - Ne rien renommer à moitié. Attendre : 1) le domaine acheté par l'utilisateur (nom exact), 2) le nouveau logo (même visuel, texte DUEL PRONO).
  - Puis tout changer d'un coup : nom dans le site (titre, en-tête, mentions, textes), fichiers du logo, noms des workers et adresse du moteur dans `site/public/app.js`, branchement du domaine sur Cloudflare, boîte e-mail, cette note.
  - Le mot « Arène » (onglet classement) peut rester : c'est le nom complet « Prono Arena » qui pose problème.
- Icône de la future application Android (APK) fournie par l'utilisateur : `assets/icone-application.png` (casque + ballon, sans texte, 1254 px, coins arrondis). À utiliser telle quelle pour l'APK ; peut aussi servir d'icône du site au moment du changement de nom.
- Vérifier que la Ligue des Nations apparaît une fois son chargement terminé (matchs le 12/11/2026) ; sinon lire /status.
- Vérifier /status le lendemain (remplissage, saison précédente football-data acceptée ou non par la clé gratuite).
- Après mise en ligne du bloc 2 : créer un vrai compte sur le site, vérifier /status (rubrique « arene ») et que l'inscription ne dépasse pas la limite de calcul de l'offre gratuite.
- **Bloc 3** : abonnement 5 €/mois (Stripe), limite 2 pronos/jour en gratuit.
- Plus tard : corners et cartons (stats détaillées ESPN, plus lourd pour le quota).
