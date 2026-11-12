-- ============================================================
-- PRONO ARENA — Base D1 « prono-arena » (bloc 2 : comptes, pronostics des joueurs, Arène)
-- Peut être rejoué sans danger : rien n'est effacé.
-- ============================================================

CREATE TABLE IF NOT EXISTS joueurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pseudo TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  mdp TEXT NOT NULL,            -- mot de passe haché (jamais en clair) : pbkdf2$tours$sel$empreinte
  cree_le INTEGER NOT NULL,
  prenom TEXT,                  -- espace personnel : visibles par le joueur seulement
  ville TEXT,
  club TEXT,                    -- club favori (nom + blason), affiché au classement
  club_logo TEXT
);
-- Base créée avant l'espace personnel : ajouter une seule fois
--   ALTER TABLE joueurs ADD COLUMN prenom TEXT;  (idem ville, club, club_logo)

CREATE TABLE IF NOT EXISTS sessions (
  jeton TEXT PRIMARY KEY,       -- empreinte SHA-256 du jeton de connexion
  joueur_id INTEGER NOT NULL,
  expire_le INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_joueur ON sessions (joueur_id);

CREATE TABLE IF NOT EXISTS pronos (
  joueur_id INTEGER NOT NULL,
  ligue_id INTEGER NOT NULL,
  match_id TEXT NOT NULL,
  saison INTEGER NOT NULL,
  coup_envoi INTEGER NOT NULL,
  semaine TEXT NOT NULL,        -- lundi de la semaine du match (heure de Paris), ex. 2026-11-09
  choix TEXT NOT NULL,          -- 1, N ou 2
  mise_pts INTEGER NOT NULL,    -- points en jeu, figés au moment du choix
  dom TEXT, dom_logo TEXT, ext TEXT, ext_logo TEXT,
  resultat TEXT,                -- 1, N ou 2 une fois le match terminé
  score TEXT,
  points INTEGER,               -- vide tant que le match n'est pas noté
  maj_le INTEGER NOT NULL,
  PRIMARY KEY (joueur_id, ligue_id, match_id)
);
CREATE INDEX IF NOT EXISTS pronos_semaine ON pronos (semaine, joueur_id);
CREATE INDEX IF NOT EXISTS pronos_attente ON pronos (coup_envoi) WHERE points IS NULL;

-- Mot de passe oublié : lien envoyé par e-mail, valable 1 heure, utilisable une seule fois
CREATE TABLE IF NOT EXISTS resets (
  jeton TEXT PRIMARY KEY,       -- empreinte SHA-256 du jeton envoyé par e-mail
  joueur_id INTEGER NOT NULL,
  expire_le INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS resets_joueur ON resets (joueur_id);

-- Anti-abus (essais de connexion, inscriptions à la chaîne)
CREATE TABLE IF NOT EXISTS limites (
  cle TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  debut INTEGER NOT NULL
);
