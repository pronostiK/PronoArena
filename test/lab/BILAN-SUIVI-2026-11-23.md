# Premier bilan du suivi M0 / M7 : matchs des 21 et 22 novembre 2026

Ce bilan sert seulement à informer. On ne tire aucune conclusion et on ne change aucun réglage. Le moteur reste figé.

## En bref

- **64 matchs comptés** et 1 écarté (Wolverhampton–Charlton, Championship, samedi 21/11 à 16 h : aucun résultat publié par notre source).
- **M7 a fait un peu mieux que M0** : il a vu plus juste sur 37 matchs sur 64.
- **Ce n'est pas encore une preuve.** Sur seulement 64 matchs, l'écart peut encore venir du hasard. La fourchette de confiance va d'un net avantage pour M7 à un petit avantage pour M0.
- **Aucun incident** : registre intact, aucun match publié sans pronostic enregistré, aucun pronostic enregistré en retard, et les 64 scores concordent avec une seconde source.

## Les chiffres

Plus le chiffre est bas, meilleur est le pronostic.

| | M0 (ancien) | M7 (en ligne) | Écart |
|---|---|---|---|
| Note de précision (Brier) | 0,5900 | 0,5849 | −0,0051 en faveur de M7 |
| Note de confiance (log loss) | 0,9890 | 0,9838 | −0,0051 en faveur de M7 |
| Fourchette de confiance de l'écart (Brier) | | | de −0,0081 à +0,0011 |

Avec ou sans les pronostics enregistrés en retard, le résultat est le même : il n'y en a eu aucun. Aucun match non affiché n'a été compté.

## Par championnat

| Championnat | Matchs | M0 | M7 | Écart | M7 meilleur |
|---|---|---|---|---|---|
| Premier League | 9 | 0,6990 | 0,6987 | −0,0003 | 6 sur 9 |
| Championship | 11 | 0,5950 | 0,5922 | −0,0029 | 7 sur 11 |
| Ligue 1 | 8 | 0,7787 | 0,7759 | −0,0027 | 5 sur 8 |
| Ligue 2 | 2 | 0,8585 | 0,8336 | −0,0250 | 1 sur 2 |
| Eredivisie | 9 | 0,5742 | 0,5858 | **+0,0116 (M0 meilleur)** | 5 sur 9 |
| Serie A | 9 | 0,4293 | 0,4210 | −0,0082 | 3 sur 9 |
| Liga | 8 | 0,5104 | 0,5005 | −0,0100 | 5 sur 8 |

**Présentés à part, comme demandé :**

| Championnat | Matchs | M0 | M7 | Écart | Corners réellement disponibles |
|---|---|---|---|---|---|
| Bundesliga | 8 | 0,4825 | 0,4614 | −0,0210 | 2 matchs sur environ 90 cette saison, 156 la saison dernière |
| Portugal | 0 | | | | sans objet (les corners ne sont pas utilisés au Portugal) |

- **Bundesliga** : comme presque aucun corner n'est disponible cette saison, l'écart vient surtout des autres parties de M7 (Elo et promus), pas des corners.
- **Portugal** : aucun match du championnat ce week-end, donc rien à mesurer (probablement un week-end de coupe, non vérifié).

Avec 2 à 11 matchs par championnat, ces détails ne veulent encore rien dire. On les regardera quand il y aura plusieurs semaines de matchs.

## Anomalie de données à signaler

**Très peu de corners sont disponibles pour la saison en cours**, dans presque tous les championnats. La saison précédente, elle, est complète.

| | PL | Championship | Ligue 1 | Ligue 2 | Bundesliga | Eredivisie | Serie A | Liga |
|---|---|---|---|---|---|---|---|---|
| Matchs avec corners cette saison | 5 | 25 | 22 | 47 | 2 | 4 | 23 | 119 |
| Saison précédente | 380 | 552 | 305 | 305 | 156 | 240 | 380 | 306 |

Conséquence : la part « corners » de M7 s'appuie surtout sur la saison dernière. Conformément à la décision de l'auditeur, on ne corrige rien, on le signale seulement.

## Hibernian–Dundee United (0-4)

Ce match a montré que le moteur peut regarder trop loin en arrière (jusqu'à 2 saisons). On a fait un test sur les matchs passés :
- garder 40 matchs au lieu de 80 donne un résultat à peu près identique, voire très légèrement moins bon ;
- garder seulement la saison en cours fait mieux en Ligue 1 et en Ligue 2.

Une variante cachée, « M7-40 », est prête. Elle ne s'affiche pas et n'écrit rien de plus. **Elle n'est pas en ligne** : elle attend l'accord de l'auditeur et le tien. Hibernian (Écosse) ne fait pas partie des championnats suivis dans ce bilan.

## M7X (version avec les buts attendus)

M7X est en ligne depuis le 21/11. Il attend que l'historique des buts attendus soit complet avant d'enregistrer ses premiers pronostics :
- **ce matin : 1 248 matchs récupérés, 975 restants** ;
- **premiers pronostics M7X prévus vers le 24 ou le 25/11.**

Rien n'a encore été enregistré pour M7X, c'est normal.

## Pistes notées pour après l'évaluation (rien n'est fait maintenant)

1. **Forme domicile et extérieur** : peser davantage la forme récente à domicile pour l'équipe qui reçoit, et à l'extérieur pour l'équipe qui se déplace.
2. **« Saison en cours seule » en Ligue 1 et en Ligue 2** : c'était meilleur sur 3 saisons de test, mais on a fait 36 essais, donc ça peut être de la chance. À suivre en caché, comme M7X, si l'auditeur l'accepte.

## Comment ce bilan a été produit

- Script : `test/lab/bilan-suivi.mjs` (période du 21/11 à 0 h au 23/11 à 0 h, heure de Paris).
- Le script vérifie le registre (1 031 lignes, chaîne d'empreintes intacte) et les 35 sceaux GitHub.
- Il applique la règle de protocole n° 3 : on garde le dernier pronostic scellé avant le coup d'envoi.
- Les scores sont recoupés avec une seconde source : 64 comparés, 0 désaccord.
- Intervalle de confiance : rééchantillonnage par journée, 10 000 tirages, graine 20261120.
- Prochain bilan : lundi 30/11.
