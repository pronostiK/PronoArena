# Prono Arena

Moteur de pronostics football (Cloudflare Worker).

En ligne : https://prono-arena-worker.hitch-legende.workers.dev
Publication automatique : chaque envoi sur `main` est publié par Cloudflare.

- `worker.js` : moteur V6 (forces attaque/défense par équipe, Elo, Poisson + Dixon-Coles)
- `wrangler.jsonc` : configuration Cloudflare (cache KV `PRONO_CACHE`)
- `test/` : tests automatiques (`npm test`)

La clé football-data (`FOOTBALL_DATA_KEY`) est stockée dans Cloudflare, jamais dans ce dépôt.

## Routes
- `/league-predictions?leagueId=61&season=2026` : pronostics des 10 prochains matchs
- `/match-details?matchId=…&source=…&teamDomId=…&teamExtId=…` : face-à-face
