# Prono Arena

Moteur de pronostics football (Cloudflare Worker).

- `worker.js` : moteur V6 (forces attaque/défense par équipe, Elo, Poisson + Dixon-Coles)
- `wrangler.jsonc` : configuration Cloudflare (cache KV `PRONO_CACHE`)
- `test/` : tests automatiques (`npm test`)

La clé football-data (`FOOTBALL_DATA_KEY`) est stockée dans Cloudflare, jamais dans ce dépôt.

## Routes
- `/league-predictions?leagueId=61&season=2026` : pronostics des 10 prochains matchs
- `/match-details?matchId=…&source=…&teamDomId=…&teamExtId=…` : face-à-face
