#!/bin/bash
# Données publiques pour l'audit de liaison (hors ligne) : Ligue 2 chez ESPN (même source que le robot), saisons 2025-26 et 2026-27.
set -u
D=data-liaison; mkdir -p $D
d=2025-07-25
while [[ "$d" < "2026-11-24" ]]; do
  ymd=$(date -d "$d" +%Y%m%d)
  curl -s --max-time 20 -o $D/espn-fra2-$ymd.json "https://site.api.espn.com/apis/site/v2/sports/soccer/fra.2/scoreboard?dates=$ymd" || true
  d=$(date -d "$d + 1 day" +%Y-%m-%d)
done
ls $D | wc -l
