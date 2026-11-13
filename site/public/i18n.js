// ============================================================
// DUEL PRONO — Langues (français par défaut, anglais au choix)
// Le site est écrit en français. En anglais, ce fichier traduit chaque texte au moment
// où il s'affiche (dictionnaire D pour les textes fixes, règles R pour ceux qui contiennent
// des chiffres ou des noms). Les 4 pages d'information ont leur version anglaise dans app.js.
// Ajouter un texte au site = ajouter sa traduction ici (test/i18n.mjs et test/preview.mjs le vérifient).
// ============================================================
(() => {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  let stored = null;
  try { stored = root.localStorage.getItem("lang"); } catch { /* navigation privée */ }
  const lang = stored === "en" || stored === "fr" ? stored : /^fr/i.test((root.navigator && root.navigator.language) || "fr") ? "fr" : "en";
  const I = (root.DP_I18N = {
    lang,
    locale: lang === "en" ? "en-GB" : "fr-FR",
    t: (s) => s,
    set(l) { try { root.localStorage.setItem("lang", l === "en" ? "en" : "fr"); } catch { /* navigation privée */ } root.location.reload(); },
  });
  const doc = root.document;
  if (doc && doc.documentElement) doc.documentElement.lang = lang;
  // Choix de la langue (bas de page et Paramètres) : boutons portant data-lang
  if (doc && doc.addEventListener) doc.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-lang]");
    if (b && b.dataset.lang !== lang) I.set(b.dataset.lang);
  });
  const mark = () => { if (doc && doc.querySelectorAll) doc.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang))); };
  I.mark = mark;
  // Ce fichier est chargé dans l'en-tête, avant l'affichage de la page : les boutons sont marqués dès qu'ils existent
  if (doc && doc.addEventListener) doc.addEventListener("DOMContentLoaded", mark);
  // ---------- Sélections nationales : noms en français ----------
  // Les fournisseurs de données donnent les sélections en anglais. En français, le site traduit le nom
  // dès la réception des données (champs nom / name / adversaire / opp). Les clubs ne sont pas touchés.
  const NATIONS = {
    // Afrique
    "algeria": "Algérie", "angola": "Angola", "benin": "Bénin", "botswana": "Botswana", "burkina faso": "Burkina Faso", "burundi": "Burundi", "cameroon": "Cameroun",
    "cape verde": "Cap-Vert", "cabo verde": "Cap-Vert", "cape verde islands": "Cap-Vert", "central african republic": "Centrafrique", "chad": "Tchad", "comoros": "Comores",
    "congo": "Congo", "congo republic": "Congo", "republic of the congo": "Congo", "congo dr": "RD Congo", "dr congo": "RD Congo", "democratic republic of the congo": "RD Congo",
    "djibouti": "Djibouti", "egypt": "Égypte", "equatorial guinea": "Guinée équatoriale", "eritrea": "Érythrée", "eswatini": "Eswatini", "swaziland": "Eswatini",
    "ethiopia": "Éthiopie", "gabon": "Gabon", "gambia": "Gambie", "the gambia": "Gambie", "ghana": "Ghana", "guinea": "Guinée", "guinea-bissau": "Guinée-Bissau",
    "guinea bissau": "Guinée-Bissau", "ivory coast": "Côte d'Ivoire", "cote d'ivoire": "Côte d'Ivoire", "cote divoire": "Côte d'Ivoire", "kenya": "Kenya", "lesotho": "Lesotho",
    "liberia": "Liberia", "libya": "Libye", "madagascar": "Madagascar", "malawi": "Malawi", "mali": "Mali", "mauritania": "Mauritanie", "mauritius": "Maurice",
    "morocco": "Maroc", "mozambique": "Mozambique", "namibia": "Namibie", "niger": "Niger", "nigeria": "Nigeria", "rwanda": "Rwanda",
    "sao tome and principe": "Sao Tomé-et-Principe", "sao tome e principe": "Sao Tomé-et-Principe", "senegal": "Sénégal", "seychelles": "Seychelles",
    "sierra leone": "Sierra Leone", "somalia": "Somalie", "south africa": "Afrique du Sud", "south sudan": "Soudan du Sud", "sudan": "Soudan", "tanzania": "Tanzanie",
    "togo": "Togo", "tunisia": "Tunisie", "uganda": "Ouganda", "zambia": "Zambie", "zimbabwe": "Zimbabwe",
    // Europe
    "albania": "Albanie", "andorra": "Andorre", "armenia": "Arménie", "austria": "Autriche", "azerbaijan": "Azerbaïdjan", "belarus": "Biélorussie", "belgium": "Belgique",
    "bosnia and herzegovina": "Bosnie-Herzégovine", "bosnia-herzegovina": "Bosnie-Herzégovine", "bulgaria": "Bulgarie", "croatia": "Croatie", "cyprus": "Chypre",
    "czech republic": "Tchéquie", "czechia": "Tchéquie", "denmark": "Danemark", "england": "Angleterre", "estonia": "Estonie", "faroe islands": "Îles Féroé",
    "finland": "Finlande", "france": "France", "georgia": "Géorgie", "germany": "Allemagne", "gibraltar": "Gibraltar", "greece": "Grèce", "hungary": "Hongrie",
    "iceland": "Islande", "ireland": "Irlande", "republic of ireland": "Irlande", "israel": "Israël", "italy": "Italie", "kazakhstan": "Kazakhstan", "kosovo": "Kosovo",
    "latvia": "Lettonie", "liechtenstein": "Liechtenstein", "lithuania": "Lituanie", "luxembourg": "Luxembourg", "malta": "Malte", "moldova": "Moldavie", "monaco": "Monaco",
    "montenegro": "Monténégro", "netherlands": "Pays-Bas", "north macedonia": "Macédoine du Nord", "fyr macedonia": "Macédoine du Nord", "macedonia": "Macédoine du Nord",
    "northern ireland": "Irlande du Nord", "norway": "Norvège", "poland": "Pologne", "portugal": "Portugal", "romania": "Roumanie", "russia": "Russie",
    "san marino": "Saint-Marin", "scotland": "Écosse", "serbia": "Serbie", "slovakia": "Slovaquie", "slovenia": "Slovénie", "spain": "Espagne", "sweden": "Suède",
    "switzerland": "Suisse", "turkey": "Turquie", "turkiye": "Turquie", "ukraine": "Ukraine", "wales": "Pays de Galles",
    // Amériques
    "argentina": "Argentine", "bolivia": "Bolivie", "brazil": "Brésil", "canada": "Canada", "chile": "Chili", "colombia": "Colombie", "costa rica": "Costa Rica",
    "cuba": "Cuba", "curacao": "Curaçao", "dominican republic": "République dominicaine", "ecuador": "Équateur", "el salvador": "Salvador", "guatemala": "Guatemala",
    "haiti": "Haïti", "honduras": "Honduras", "jamaica": "Jamaïque", "mexico": "Mexique", "nicaragua": "Nicaragua", "panama": "Panama", "paraguay": "Paraguay",
    "peru": "Pérou", "suriname": "Suriname", "trinidad and tobago": "Trinité-et-Tobago", "united states": "États-Unis", "usa": "États-Unis", "uruguay": "Uruguay",
    "venezuela": "Venezuela",
    // Asie et Océanie
    "australia": "Australie", "bahrain": "Bahreïn", "china": "Chine", "china pr": "Chine", "india": "Inde", "indonesia": "Indonésie", "iran": "Iran", "ir iran": "Iran",
    "iraq": "Irak", "japan": "Japon", "jordan": "Jordanie", "kuwait": "Koweït", "kyrgyzstan": "Kirghizistan", "lebanon": "Liban", "new zealand": "Nouvelle-Zélande",
    "north korea": "Corée du Nord", "korea dpr": "Corée du Nord", "oman": "Oman", "palestine": "Palestine", "qatar": "Qatar", "saudi arabia": "Arabie saoudite",
    "south korea": "Corée du Sud", "korea republic": "Corée du Sud", "syria": "Syrie", "tajikistan": "Tadjikistan", "thailand": "Thaïlande",
    "united arab emirates": "Émirats arabes unis", "uzbekistan": "Ouzbékistan", "vietnam": "Viêt Nam",
  };
  const natKey = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase().replace(/\s*&\s*/g, " and ").replace(/\./g, "").replace(/\s+/g, " ").trim();
  I.team = (s) => (lang === "fr" && typeof s === "string" && NATIONS[natKey(s)]) || s;
  const NAME_KEYS = new Set(["nom", "name", "adversaire", "opp"]);
  // Parcourt une réponse du moteur et met en français les noms de sélections qu'elle contient
  I.names = (data) => {
    if (lang !== "fr" || !data || typeof data !== "object") return data;
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (typeof v === "string") { if (NAME_KEYS.has(k)) data[k] = I.team(v); }
      else if (v && typeof v === "object") I.names(v);
    }
    return data;
  };
  if (lang !== "en") return;

  // ---------- Textes fixes ----------
  const D = {
    // Navigation, pied de page
    "Connexion": "Log in", "Arène": "Arena", "À propos": "About", "Conditions d'utilisation": "Terms of use", "Confidentialité": "Privacy", "Mentions légales": "Legal notice",
    "Probabilités calculées par un modèle statistique, sans garantie de résultat. Duel Prono est un jeu gratuit, sans mise ni gain d'argent. Réservé aux 18 ans et plus.": "Probabilities calculated by a statistical model, with no guarantee of results. Duel Prono is a free game, with no stakes and no cash prizes. For ages 18 and over.",
    // Compétitions et pays
    "Ligue des champions": "Champions League", "Süper Lig": "Turkish Super Lig", "Ligue des Nations": "Nations League", "Coupe du monde": "World Cup",
    "Angleterre": "England", "Espagne": "Spain", "Italie": "Italy", "Allemagne": "Germany", "Pays-Bas": "Netherlands", "Brésil": "Brazil", "Turquie": "Turkey", "Belgique": "Belgium", "Écosse": "Scotland", "Afrique": "Africa", "CAN": "AFCON", "Qualifications CAN": "AFCON Qualifiers", "Monde": "World",
    // Duels
    "Toutes les compétitions": "All competitions", "Choisis ton camp.": "Pick your side.",
    "Les probabilités de chaque match. Touche ton camp pour jouer dans l'Arène.": "The probabilities for every match. Tap your side to play in the Arena.",
    "Inscris-toi gratuitement": "Sign up for free", "pour voir toutes les probabilités.": "to see all the probabilities.",
    "Tout": "All", "À venir": "Upcoming", "matchs": "matches", "Auj.": "Today",
    "Offerts aujourd'hui": "Free today", "Offert aujourd'hui": "Free today", "Offert": "Free", "🔒 Inscrits": "🔒 Members",
    "En direct": "Live", "Terminé": "Full time", "Victoire": "Win", "Nul": "Draw", "✓ Mon prono": "✓ My pick", "🔒 Mon prono": "🔒 My pick",
    "Voir l'analyse complète": "See the full analysis",
    "Probabilités réservées aux inscrits": "Probabilities for members only", "Inscription gratuite, en 30 secondes": "Free sign-up, takes 30 seconds",
    "⚖ Duel équilibré": "⚖ Even duel", "⚖ Duel serré": "⚖ Close duel", "Grand favori": "Strong favourite", "Favori": "Favourite",
    "Aucun duel dans les 7 prochains jours. Choisis une compétition pour voir ses prochains matchs.": "No duels in the next 7 days. Choose a competition to see its upcoming matches.",
    "Les données de cette compétition sont en cours de préparation. Reviens dans quelques minutes.": "The data for this competition is being prepared. Come back in a few minutes.",
    "Aucun duel programmé pour le moment dans cette compétition.": "No duels scheduled in this competition for now.",
    "Cette compétition est momentanément indisponible.": "This competition is temporarily unavailable.",
    "Choisis-en une autre, ou réessaie dans quelques minutes.": "Choose another one, or try again in a few minutes.",
    "Réessayer": "Try again", "Impossible de charger les données pour le moment.": "The data cannot be loaded right now.",
    // Analyse
    "Ton prono": "Your pick", "Modifiable jusqu'au coup d'envoi. Ton prono compte pour le classement de l'Arène.": "You can change it until kick-off. Your pick counts in the Arena ranking.",
    "Coup d'envoi donné : les pronos sont bloqués.": "The match has kicked off: picks are locked.",
    "Marchés": "Markets", "Compos": "Line-ups", "Face-à-face": "Head-to-head",
    "Résultat": "Result", "Remboursé si nul": "Draw no bet", "Mi-temps": "Half-time",
    "Buts": "Goals", "Buts attendus": "Expected goals", "Total attendu": "Expected total", "+0,5": "+0.5", "+1,5": "+1.5", "+2,5": "+2.5", "+3,5": "+3.5",
    "Les deux équipes marquent": "Both teams score", "Buts par équipe": "Goals per team",
    "Victoire et plus": "Win and more", "Victoire sans encaisser": "Win to nil", "Victoire + les deux marquent": "Win + both teams score", "Victoire par 2 buts ou +": "Win by 2+ goals",
    "Scores exacts": "Exact scores", "Forme · 5 derniers matchs": "Form · last 5 matches", "Pas encore de match joué cette saison.": "No match played yet this season.",
    "Défaite": "Loss", "Face à face des stats": "Stats head-to-head", "Saison": "Season", "Classement": "Ranking",
    "Buts marqués / match": "Goals scored / match", "Buts encaissés / match": "Goals conceded / match", "Plus de 2,5 buts": "Over 2.5 goals",
    "Les deux marquent": "Both teams score", "Sans encaisser": "Clean sheets", "Buts marqués (dom. / ext.)": "Goals scored (home / away)",
    "Compositions": "Line-ups", "Chargement…": "Loading…", "Derniers duels": "Recent meetings",
    "Aucune confrontation récente entre ces deux équipes.": "No recent meeting between these two teams.",
    "Composition non disponible": "Line-up not available", "Compositions bientôt disponibles pour ce match.": "Line-ups will be available soon for this match.",
    "Onze aligné au dernier match. La composition officielle est publiée environ 1 h avant le coup d'envoi.": "Starting eleven from the last match. The official line-up is published about 1 hour before kick-off.",
    "Face-à-face indisponible pour le moment.": "Head-to-head is unavailable right now.", "Compositions indisponibles pour le moment.": "Line-ups are unavailable right now.",
    "Ce duel n'est plus à l'affiche (il est peut-être terminé : regarde le Verdict).": "This duel is no longer listed (it may be over: check the Verdict).",
    "Retour aux duels": "Back to the duels",
    "Analyse réservée aux inscrits": "Analysis for members only",
    "Probabilités, statistiques, compositions et face-à-face : tout est gratuit, il suffit de créer un compte. Chaque jour, 2 matchs restent offerts à tous.": "Probabilities, statistics, line-ups and head-to-head: it is all free, you only need an account. Every day, 2 matches stay free for everyone.",
    "Créer mon compte gratuit": "Create my free account",
    // Verdict
    "Transparence totale": "Full transparency", "Le Verdict": "The Verdict", "Les résultats tombent. Le moteur avait-il vu juste ?": "The results are in. Did the engine get it right?",
    "1N2 justes": "1X2 correct", "doubles chances": "double chances", "+/- 2,5 buts": "over/under 2.5 goals",
    "Le Verdict se remplit au fil des matchs : chaque pronostic est enregistré avant le coup d'envoi, puis comparé au score final.": "The Verdict fills up as matches are played: every forecast is saved before kick-off, then compared with the final score.",
    "Moteur :": "Engine:", "Vu juste": "Correct", "Raté": "Missed", "Verdict indisponible pour le moment.": "The Verdict is unavailable right now.",
    "Erreur du modèle (Brier)": "Model error (Brier)", "0 = parfait · 0,667 = prévoir un tiers partout": "0 = perfect · 0.667 = predicting one third everywhere",
    "Cotes des bookmakers": "Bookmaker odds", "Au hasard (un tiers partout)": "At random (one third each)",
    "Le modèle fait nettement mieux que le hasard, mais les bookmakers restent plus précis : ils connaissent les blessures et les compositions. Duel Prono sert à comprendre un match, pas à battre les bookmakers.": "The model does clearly better than chance, but bookmakers remain more accurate: they know about injuries and line-ups. Duel Prono helps you understand a match, not beat the bookmakers.",
    "Quand le modèle annonce… l'issue arrive": "When the model says… it happens",
    "Barre orange : probabilité annoncée. Barre bleue : fréquence réelle. Plus elles se ressemblent, plus les pourcentages sont fiables.": "Orange bar: announced probability. Blue bar: actual frequency. The closer they are, the more reliable the percentages.",
    "Détail par championnat": "Details by league", "Erreur (Brier)": "Error (Brier)", "Championnat": "League", "Matchs": "Matches", "Bookmakers": "Bookmakers",
    "Nombre de buts et « les deux équipes marquent » : sur ces marchés, le modèle ne fait pas mieux qu'une moyenne du championnat. Ces pourcentages sont donnés à titre indicatif.": "Number of goals and \"both teams score\": on these markets, the model does no better than a league average. These percentages are given for information only.",
    // Arène
    "Classement de la semaine": "This week's ranking", "L'Arène": "The Arena", "Chaque bon prono rapporte des points. Remise à zéro tous les lundis.": "Every correct pick earns points. Reset every Monday.",
    "Cette semaine": "This week", "Semaine dernière": "Last week", "Entre dans l'arène": "Enter the arena",
    "Gratuit, pour le fun. Un pseudo suffit pour figurer au classement.": "Free, just for fun. A username is all you need to appear in the ranking.",
    "Créer mon compte": "Create my account", "Ma semaine": "My week", "Ma semaine dernière": "My last week", "Rang": "Rank", "Pronos justes": "Correct picks",
    "Tu n'as pas encore pronostiqué cette semaine.": "You have not made a pick yet this week.", "Voir les duels": "See the duels",
    "Aucun de tes pronos ne porte sur un match de cette semaine. Chaque prono compte pour la semaine où le match se joue.": "None of your picks is on a match played this week. Each pick counts for the week in which the match is played.",
    "Voir mes pronos": "See my picks",
    "Personne n'a encore pronostiqué cette semaine. Prends la première place !": "Nobody has made a pick yet this week. Take first place!",
    "Aucun pronostic la semaine dernière.": "No picks last week.", "Mes pronos": "My picks", "En attente": "Pending",
    "Comment ça marche": "How it works", "1 · Choisis": "1 · Pick", "Victoire, nul ou victoire": "Win, draw or win", "2 · Avant le match": "2 · Before the match",
    "Bloqué au coup d'envoi": "Locked at kick-off", "3 · Le risque paie": "3 · Risk pays", "Favori 10 pts, surprise jusqu'à 100": "Favourite 10 pts, upset up to 100",
    "du groupe": "in the group", "au classement": "in the table", "4 · Chaque lundi": "4 · Every Monday", "Nouveau classement": "New ranking", "L'Arène est indisponible pour le moment.": "The Arena is unavailable right now.",
    // Compte
    "Gratuit · pour le fun": "Free · just for fun", "Entre dans l'arène.": "Enter the arena.",
    "Ton prono sera enregistré dès que tu es connecté.": "Your pick will be saved as soon as you are logged in.",
    "Un compte, et tes pronos comptent au classement.": "One account, and your picks count in the ranking.",
    "Créer un compte": "Sign up", "Se connecter": "Log in", "Pseudo": "Username", "3 à 16 lettres ou chiffres. Visible au classement.": "3 to 16 letters or digits. Shown in the ranking.",
    "E-mail": "Email", "Jamais affiché, jamais partagé.": "Never shown, never shared.", "Mot de passe": "Password", "8 caractères minimum.": "At least 8 characters.",
    "J'ai 18 ans ou plus et j'accepte les": "I am 18 or over and I accept the", "conditions d'utilisation": "terms of use", "et la": "and the", "politique de confidentialité": "privacy policy",
    "Jeu gratuit, sans mise ni gain d'argent. Tes données servent uniquement au jeu et tu peux supprimer ton compte à tout moment.": "A free game, with no stakes and no cash prizes. Your data is used only for the game and you can delete your account at any time.",
    "Pseudo ou e-mail": "Username or email", "Me connecter": "Log in",
    // Mot de passe oublié
    "Mot de passe oublié ?": "Forgot your password?", "Mot de passe oublié": "Forgotten password", "Retour à la connexion": "Back to log in",
    "Indique l'e-mail de ton compte : tu recevras un lien pour choisir un nouveau mot de passe.": "Enter your account email: you will receive a link to choose a new password.",
    "Recevoir le lien": "Send me the link", "E-mail envoyé": "Email sent",
    "Si un compte existe avec cette adresse, un lien vient de partir. Il est valable 1 heure. Pense à regarder dans les courriers indésirables.": "If an account exists with this address, a link has just been sent. It is valid for 1 hour. Remember to check your spam folder.",
    "Nouveau mot de passe": "New password", "Choisis ton nouveau mot de passe. Tu seras connecté aussitôt.": "Choose your new password. You will be logged in straight away.",
    "Enregistrer et me connecter": "Save and log in", "Lien invalide ou expiré. Demande un nouveau lien.": "Invalid or expired link. Ask for a new one.",
    "Service momentanément indisponible.": "Service temporarily unavailable.",
    // Mon espace et paramètres
    "Mon espace": "My space", "Paramètres": "Settings", "Mon jeu": "My game", "Général": "General", "Sécurité": "Security", "Langue": "Language",
    "Mon bilan": "My record", "Rang semaine": "Rank this week", "Points semaine": "Points this week", "Points en jeu": "Points at stake", "Réussite": "Success rate",
    "Voir le classement": "See the ranking", "Aucun prono en cours. Choisis ton camp dans les duels.": "No pick in progress. Pick your side in the duels.",
    "Aucun match terminé pour l'instant.": "No finished match yet.", "Mon profil": "My profile", "Prénom": "First name", "Ville": "City", "Club favori": "Favourite club",
    "Aucun club choisi": "No club chosen", "Choisir": "Choose", "Aucun": "None", "Enregistrer": "Save",
    "Ton prénom et ta ville restent privés. Seul le blason de ton club apparaît au classement.": "Your first name and city stay private. Only your club's crest appears in the ranking.",
    "Clubs indisponibles pour ce championnat.": "Clubs are unavailable for this league.", "Clubs indisponibles pour le moment.": "Clubs are unavailable right now.",
    "Mes identifiants": "My login details", "Nouvel e-mail": "New email", "Changer mon e-mail": "Change my email", "Mot de passe actuel": "Current password",
    "Nouveau mot de passe": "New password", "Changer mon mot de passe": "Change my password", "Ma session": "My session", "Me déconnecter": "Log out",
    "Supprimer mon compte": "Delete my account", "Ton compte et tous tes pronostics seront effacés définitivement.": "Your account and all your picks will be permanently erased.",
    "Supprimer définitivement": "Delete permanently", "Espace personnel indisponible pour le moment.": "Your space is unavailable right now.",
    // Messages
    "Infos enregistrées.": "Details saved.", "E-mail modifié.": "Email changed.", "Mot de passe modifié.": "Password changed.", "À bientôt !": "See you soon!", "Compte supprimé.": "Account deleted.",
    // Messages du moteur
    "L'Arène n'est pas encore ouverte.": "The Arena is not open yet.", "Trop d'essais. Réessaie dans quelques minutes.": "Too many attempts. Try again in a few minutes.",
    "Demande trop longue.": "Request too long.", "Demande illisible.": "Unreadable request.",
    "Pseudo : 3 à 16 lettres ou chiffres, sans espace.": "Username: 3 to 16 letters or digits, no spaces.", "Ce pseudo est réservé. Choisis-en un autre.": "This username is reserved. Choose another one.",
    "Ce pseudo est déjà pris.": "This username is already taken.", "Adresse e-mail invalide.": "Invalid email address.", "Mot de passe : 8 caractères minimum.": "Password: at least 8 characters.",
    "Coche la case : il faut avoir 18 ans ou plus et accepter les conditions d'utilisation.": "Tick the box: you must be 18 or over and accept the terms of use.",
    "Ce pseudo ou cet e-mail est déjà utilisé.": "This username or email is already in use.", "Un compte existe déjà avec cet e-mail.": "An account already exists with this email.",
    "Identifiant et mot de passe requis.": "Username and password required.", "Identifiant ou mot de passe incorrect.": "Incorrect username or password.",
    "Connecte-toi pour continuer.": "Log in to continue.", "Session expirée : reconnecte-toi.": "Session expired: log in again.", "Mot de passe incorrect.": "Incorrect password.",
    "Mot de passe actuel incorrect.": "Current password is incorrect.", "Nouveau mot de passe : 8 caractères minimum.": "New password: at least 8 characters.",
    "Club introuvable.": "Club not found.", "Pronostic invalide.": "Invalid pick.", "Ce duel n'est plus à l'affiche.": "This duel is no longer listed.",
    "Trop tard : le coup d'envoi a été donné.": "Too late: the match has kicked off.", "Inscris-toi gratuitement pour voir cette analyse.": "Sign up for free to see this analysis.",
    "LeagueId manquant.": "Missing leagueId.", "Paramètres manquants": "Missing parameters", "Route inconnue": "Unknown route",
    // Étiquettes pour les lecteurs d'écran
    "Duel Prono, accueil": "Duel Prono, home", "Navigation principale": "Main navigation", "Informations": "Information", "Compétitions": "Competitions", "Semaine": "Week",
    "Choisir un jour": "Choose a day", "Ton pronostic": "Your pick", "Sections de l'analyse": "Analysis sections", "Compte": "Account",
    "Probabilité de chaque score": "Probability of each score", "Connexion ou création de compte": "Log in or sign up", "Choisir la langue": "Choose the language",
    "Match nul": "Draw",
  };

  // ---------- Textes avec chiffres ou noms ----------
  const pl = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`;
  const ord = (n) => { n = Number(n); const v = n % 100; return n + (v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"); };
  const REL = { "élevée": "High", "moyenne": "Medium", "faible": "Low", "—": "—" };
  const AFTER = "Every forecast is frozen before kick-off: nothing is changed afterwards.";
  const R = [
    [/^Score à (\d{1,2}:\d{2})$/, (m) => `Score at ${m[1]}`],
    [/^(\d+) matchs?$/, (m) => pl(m[1], "match", "matches")],
    [/^(\d+) matchs offerts chaque jour\.$/, (m) => `${m[1]} free matches every day.`],
    [/^Fiabilité (élevée|moyenne|faible|—)$/, (m) => (m[1] === "—" ? "Reliability —" : `${REL[m[1]]} reliability`)],
    [/^Fiabilité (élevée|moyenne|faible|—) · (\S+) et (\S+) matchs analysés$/, (m) => `${m[1] === "—" ? "Reliability —" : REL[m[1]] + " reliability"} · ${m[2]} and ${m[3]} matches analysed`],
    [/^⚽ Match ouvert · \+2,5 (\d+)%$/, (m) => `⚽ Open game · +2.5 ${m[1]}%`],
    [/^🔒 Match fermé · −2,5 (\d+)%$/, (m) => `🔒 Tight game · −2.5 ${m[1]}%`],
    [/^⚽ Les deux marquent (\d+)%$/, (m) => `⚽ Both teams score ${m[1]}%`],
    [/^cote (.+)$/, (m) => `odds ${m[1]}`],
    [/^Testé sur ([\d\s\u202f\u00a0,]+) matchs passés$/, (m) => `Tested on ${m[1].replace(/[\s\u202f\u00a0]/g, ",")} past matches`],
    [/^De (.+) à (.+), 9 championnats\. Pour chaque match, le modèle ne connaissait que les matchs joués avant lui, exactement comme en vrai\.$/, (m) => `From ${m[1]} to ${m[2]}, 9 leagues. For each match, the model only knew the matches played before it, exactly as in real life.`],
    [/^(\d+) % de résultats trouvés$/, (m) => `${m[1]}% of results right`],
    [/^(\d+) %$/, (m) => `${m[1]}%`],
    [/^0,(\d+)$/, (m) => `0.${m[1]}`],
    [/^Oui (\d+)%$/, (m) => `Yes ${m[1]}%`],
    [/^Non (\d+)%$/, (m) => `No ${m[1]}%`],
    [/^(\d+)(?:er|e) du groupe$/, (m) => `${ord(m[1])} in the group`],
    [/^(\d+)(?:er|e) au classement$/, (m) => `${ord(m[1])} in the table`],
    [/^(\d+)(?:er|e) ·$/, (m) => `${ord(m[1])} ·`],
    [/^Bilan du moteur · (\d+) derniers jours$/, (m) => `Engine record · last ${m[1]} days`],
    [/^Calculé sur (\d+) matchs?\. Chaque pronostic est figé avant le coup d'envoi : rien n'est modifié après coup\.$/, (m) => `Based on ${pl(m[1], "match", "matches")}. ${AFTER}`],
    [/^Pas encore de match terminé sur la période\. Chaque pronostic est figé avant le coup d'envoi : rien n'est modifié après coup\.$/, () => `No finished match in this period yet. ${AFTER}`],
    [/^\((\d+) %\)$/, (m) => `(${m[1]}%)`],
    [/^· (\d+) en attente$/, (m) => `· ${m[1]} pending`],
    [/^(\d+) pronos? en attente du résultat\.$/, (m) => `${pl(m[1], "pick", "picks")} awaiting the result.`],
    [/^Du (.+) au (.+)$/, (m) => `${m[1]} – ${m[2]}`],
    [/^(\d+) justes? sur (\d+)(?: · (\d+) en attente)?$/, (m) => `${m[1]} correct out of ${m[2]}${m[3] ? ` · ${m[3]} pending` : ""}`],
    [/^(\d+) joueurs? dans l'arène(?: · (\d+) premiers affichés)?\.$/, (m) => `${pl(m[1], "player", "players")} in the arena${m[2] ? ` · top ${m[2]} shown` : ""}.`],
    [/^(\+?\d+) pts en jeu$/, (m) => `${m[1]} pts at stake`],
    [/^À venir \((\d+)\)$/, (m) => `Upcoming (${m[1]})`],
    [/^Terminés \((\d+)\)$/, (m) => `Finished (${m[1]})`],
    [/^Prono enregistré · (\d+) pts en jeu$/, (m) => `Pick saved · ${m[1]} pts at stake`],
    [/^Bienvenue dans l'arène, (.+) !$/, (m) => `Welcome to the arena, ${m[1]}!`],
    [/^Erreur (\d+)$/, (m) => `Error ${m[1]}`],
    [/^(.+) · (contre|à) (.+) · (.+)$/, (m) => `${m[1]} · ${m[2] === "contre" ? "vs" : "at"} ${m[3]} · ${m[4]}`],
    // Étiquettes pour les lecteurs d'écran
    [/^(.+) contre (.+), voir l'analyse$/, (m) => `${m[1]} v ${m[2]}, see the analysis`],
    [/^(.+) contre (.+), probabilités réservées aux inscrits$/, (m) => `${m[1]} v ${m[2]}, probabilities for members only`],
    [/^Victoire (.+), (\d+) %(, ton pronostic)?$/, (m) => `${m[1]} win, ${m[2]}%${m[3] ? ", your pick" : ""}`],
    [/^Match nul, (\d+) %(, ton pronostic)?$/, (m) => `Draw, ${m[1]}%${m[2] ? ", your pick" : ""}`],
    [/^Mon compte : (.+)$/, (m) => `My account: ${m[1]}`],
    [/^(.+), (\d+) matchs?$/, (m) => `${m[1]}, ${pl(m[2], "match", "matches")}`],
    [/^Retour aux duels de la compétition$/, () => "Back to the duels"],
    [/^Retour aux duels de (.+)$/, (m) => `Back to the ${tr(m[1]) || m[1]} duels`],
    [/^Contre (.+) : (.+)$/, (m) => `Home v ${m[1]}: ${m[2]}`],
    [/^À (.+) : (.+)$/, (m) => `Away at ${m[1]}: ${m[2]}`],
    [/^· (.+)$/, (m) => { const x = tr(m[1]); return x ? `· ${x}` : null; }],
    [/^(.+) · (.+)$/, (m) => { const a = tr(m[1]), b = tr(m[2]); return a || b ? `${a || m[1]} · ${b || m[2]}` : null; }],
  ];
  function tr(s) {
    if (Object.prototype.hasOwnProperty.call(D, s)) return D[s];
    for (const [re, fn] of R) { const m = re.exec(s); if (m) { const out = fn(m); if (out != null) return out; } }
    return null;
  }
  I.t = (s) => { const x = tr(String(s)); return x == null ? s : x; };
  I.ord = ord;
  if (!doc || !doc.documentElement || !root.MutationObserver) return;

  // ---------- Traduction de la page au fil de l'affichage ----------
  // Noms d'équipes et pseudos : jamais traduits, même s'ils ressemblent à un mot du site
  const KEEP = ".team b, .rk-name b, .pod b, .account-name, .me-hero h1, #club-now b, .club small, .pl-name, .form-head b, .xi-h b, .mp-teams, input, textarea";
  const ATTRS = ["aria-label", "title", "alt", "placeholder"];
  function text(n) {
    const p = n.parentElement;
    if (!p || /^(SCRIPT|STYLE)$/.test(p.nodeName) || p.closest(KEEP)) return;
    const raw = n.nodeValue, core = raw.replace(/\s+/g, " ").trim();
    if (!core) return;
    let out = null;
    // Rang : 1er, 2e… devient 1st, 2nd…
    if (p.nodeName === "SUP" && /^(er|e)$/.test(core)) { const num = /(\d+)\s*$/.exec((p.previousSibling && p.previousSibling.nodeValue) || ""); if (num) out = ord(num[1]).replace(/^\d+/, ""); }
    else out = tr(core);
    if (out != null && out !== core) n.nodeValue = raw.replace(/^(\s*)[\s\S]*?(\s*)$/, (_, a, b) => a + out + b);
  }
  function walk(n) {
    if (n.nodeType === 3) return text(n);
    if (n.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(n.nodeName)) return;
    for (const a of ATTRS) if (n.hasAttribute(a)) { const v = n.getAttribute(a), x = tr(v.replace(/\s+/g, " ").trim()); if (x != null && x !== v) n.setAttribute(a, x); }
    for (const c of n.childNodes) walk(c);
  }
  doc.title = "Duel Prono · The football forecast arena";
  const meta = doc.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute("content", "Duel Prono: every match becomes a duel. Probabilities calculated by a statistical model, results checked in full transparency.");
  if (doc.body) walk(doc.body);
  // La page est traduite au fur et à mesure qu'elle se construit : aucun texte français n'apparaît, même un instant
  new root.MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") text(m.target);
      else if (m.type === "attributes") { const v = m.target.getAttribute(m.attributeName); if (v != null) { const x = tr(v.replace(/\s+/g, " ").trim()); if (x != null && x !== v) m.target.setAttribute(m.attributeName, x); } }
      else for (const n of m.addedNodes) walk(n);
    }
  }).observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
})();
