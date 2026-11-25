import fs from "node:fs";
export const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ø/g, "o").replace(/ł/g, "l").replace(/[^a-z0-9 ]/g, " ").replace(/\b(fc|cf|sc|ac|as|afc|fk|sk|rc|ssc|us|ud|cd|sv|bv|vfb|vfl|tsg|rb|ca|sl|sporting clube de|club|de|the|1907|1909|1913|1893|calcio|balompie|bk|if|ik|sk)\b/g, " ").replace(/\s+/g, " ").trim();
const parseCsv = (txt) => { const L = txt.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean); const h = L[0].split(","); return L.slice(1).map((l) => { const c = l.split(","); const o = {}; h.forEach((k, i) => (o[k] = c[i])); return o; }); };
const dmy = (s) => { const [d, m, y] = s.split("/"); return Date.parse(`${y.length === 2 ? "20" + y : y}-${m}-${d}T12:00:00Z`); };
const LG = { E0: "eng", SP1: "esp", I1: "ita", D1: "ger", F1: "fra", P1: "por", N1: "ned", B1: "bel", T1: "tur", SC0: "sco", G1: "gre" };
const SEAS = { 2324: 2023, 2425: 2024, 2526: 2025, 2627: 2026 };
export function domesticMatches() {
  const out = []; // {lg, season, home, away, hg, ag, ts}
  for (const [c, lg] of Object.entries(LG)) for (const [s, season] of Object.entries(SEAS)) {
    const f = `data/${c}_${s}.csv`; if (!fs.existsSync(f)) continue;
    for (const r of parseCsv(fs.readFileSync(f, "utf8"))) { if (!r.Date || r.FTHG === "" || r.FTHG === undefined || isNaN(+r.FTHG)) continue; out.push({ lg, season, home: r.HomeTeam, away: r.AwayTeam, hg: +r.FTHG, ag: +r.FTAG, ts: dmy(r.Date) }); }
  }
  for (const [c, lg] of [["AUT", "aut"], ["NOR", "nor"]]) {
    for (const r of parseCsv(fs.readFileSync(`data/new_${c}.csv`, "utf8"))) {
      const y = parseInt(String(r.Season)); if (!(y >= 2023) || r.HG === "" || isNaN(+r.HG)) continue;
      // saison européenne (aut) : "2024/2025" ; norvégienne (nor) : année civile
      out.push({ lg, season: lg === "aut" ? +String(r.Season).slice(0, 4) : y, home: r.Home, away: r.Away, hg: +r.HG, ag: +r.AG, ts: dmy(r.Date) });
    }
  }
  return out;
}
export const clMatches = () => Object.values(JSON.parse(fs.readFileSync("data/cl.json"))).flat().filter((m) => m.done && Number.isFinite(m.hg) && Number.isFinite(m.ag));
