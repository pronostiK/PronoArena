# Contrôle M7C en lecture seule sur les vraies données du robot (25/11/2026)

- Version publiée : commit c2201d5 sur main, en ligne vers 09:22 UTC. Interrupteur M7C ÉTEINT (`interrupteurM7C: false` dans chaque réponse).
- Route : `https://api.duelprono.com/liaison-controle?ligue=<id>`, lue vers 09:23 UTC. Elle n'écrit rien (testé : 0 écriture KV, aucune écriture D1).
- Production inchangée : la version du journal M0/M7 et l'empreinte des réglages (2ef4a815…) sont identiques au dernier sceau GitHub (24/11 22:29 UTC). Aucune table de variante n'a été créée, et `/status` ne montre aucune section de liaison.

## Corners : couverture avec la liaison stricte, comparée à la production d'aujourd'hui

Chiffres = matchs terminés du robot reliés / matchs terminés du robot.

| Championnat | Saison en cours : reliés (prod. actuelle) | Saison précédente : reliés (prod. actuelle) |
|---|---|---|
| Premier League | 110/110 (6) | 380/380 (380) |
| Championship | 192/200, 96 % (26) ; 8 matchs absents du fichier de corners | 552/557, 99,1 % (552) ; 5 absents du fichier |
| Ligue 1 | 99/99 (24) | 305/305 (305) |
| Ligue 2 | 117/117 (50) | 305/306 (305) ; 1 absent du fichier |
| Bundesliga | 90/90 (2) | 306/306 (156) |
| Eredivisie | 117/117 (5) | 306/306 (240) |
| Serie A | 120/120 (39) | 380/380 (380) |
| Liga | 129/129 (129) | 380/380 (306) |

Pour les 8 championnats et les 2 saisons, les compteurs d'anomalies sont tous nuls :
- 0 cas ambigu ;
- 0 score en désaccord ;
- 0 doublon ;
- 0 équipe écartée par le garde-fou ;
- 0 nom inconnu ;
- 0 équipe du robot sans table ;
- **0 match non terminé recevant des données**.

### Écarts relevés

- **Ligue 1 2025 : Nantes–Toulouse (17/05/2026).** Le match est dans le fichier de corners mais absent du robot (déjà connu). Rien n'est attribué.
- **Ligue 1 2026 : match 559659.** Rejouée aujourd'hui, l'ancienne méthode lui attribue des corners **différents** de la ligne exacte. C'est la preuve qu'elle peut se tromper de match, pas seulement en manquer.
- **Championship : 13 matchs du robot n'ont aucune ligne dans le fichier de corners.** C'est une limite de la source, pas de la liaison.

## Les 17 équipes « prec » (reléguées, impossibles à vérifier hors ligne)

Les 17 équipes sont toutes retrouvées par leur nom exact dans les données du robot de la saison précédente, et toutes leurs lignes sont reliées. Le contrôle ne signale aucune d'elles comme introuvable en 2025. Elles n'apparaissent comme absentes qu'en saison 2026, ce qui est normal puisqu'elles ont quitté le championnat.

Liste des 17 équipes :
- Leicester, Oxford, Sheffield Wednesday ;
- Metz, Nantes ;
- Heidenheim, St. Pauli, Wolfsburg ;
- Heracles, NAC, Volendam ;
- Cremonese, Pisa, Verona ;
- Girona, Mallorca, Oviedo.

**Les noms « absents chez le robot » ne sont pas des erreurs.** Ce sont des équipes de la table qui ne jouent pas dans le championnat cette saison-là : promues, reléguées, ou présentes dans l'autre division.

## xG (M7X, 5 grands championnats) : disponibilité avant prédiction

| Championnat | Lignes de l'historique | Reliées (stricte) | Avec xG mesurés | Ancienne méthode |
|---|---|---|---|---|
| Premier League | 490 | 490 | 469 (95,7 %) | 490 |
| Ligue 1 | 408 | 404 | 394 (97,5 %) | 297 |
| Bundesliga | 398 | 386 | 375 (94,7 %) | 292 |
| Serie A | 500 | 500 | 483 (96,6 %) | 500 |
| Liga | 509 | 509 | 495 (97,2 %) | 509 |

Les lignes non reliées sont toutes des matchs de barrage, absents du championnat chez le robot :
- **Ligue 1 :** Saint-Étienne, Rodez, Red Star ;
- **Bundesliga :** Paderborn–Wolfsburg (×2).

Pour les deux sources, seuls les matchs terminés (avant l'heure de calcul) reçoivent des données.

## Coefficients

Aucun coefficient n'est modifié : `MODEL` est identique, ce que vérifie le test « M7C : aucun coefficient du moteur modifié ».

## Conclusion

Les contrôles demandés par l'auditeur sont réussis. L'activation de M7C reste soumise à l'accord explicite du chef de projet. La procédure d'activation et de retour arrière est décrite dans RUPTURE-M7C.md.
