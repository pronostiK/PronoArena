#!/bin/bash
# Téléchargement des données publiques pour l'audit de liaison (hors ligne).
set -u
D=data-liaison; mkdir -p $D
for c in PL ELC FL1 BL1 DED SA PD; do for s in 2025 2026; do
  code=$(curl -s -o $D/fd-$c-$s.json -w "%{http_code}" "https://api.football-data.org/v4/competitions/$c/matches?season=$s")
  echo "fd $c $s -> $code $(wc -c < $D/fd-$c-$s.json)"; sleep 7
done; done
for s in 2526 2627; do for c in E0 E1 F1 F2 D1 N1 I1 SP1; do
  curl -s -o $D/csv-$c-$s.csv -w "csv $c $s -> %{http_code} %{size_download}\n" "https://www.football-data.co.uk/mmz4281/$s/$c.csv"
done; done
for r in 20250801-20251231 20260101-20260630 20260701-20261231; do
  curl -s -o $D/espn-fra2-$r.json -w "espn fra.2 $r -> %{http_code} %{size_download}\n" "https://site.api.espn.com/apis/site/v2/sports/soccer/fra.2/scoreboard?dates=$r&limit=1000"
done
