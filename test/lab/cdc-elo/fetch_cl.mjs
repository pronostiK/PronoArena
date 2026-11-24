import fs from "node:fs";
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36", Accept: "application/json" };
const days = [];
const add = (a, b) => { for (let d = new Date(a); d <= new Date(b); d = new Date(+d + 86400000)) { const w = d.getUTCDay(); if (w === 2 || w === 3 || (w === 6 && d.getUTCMonth() >= 4)) days.push(d.toISOString().slice(0, 10)); } };
add("2024-09-17", "2025-06-01"); add("2025-09-16", "2026-06-01"); add("2026-09-15", "2026-11-22");
const out = {}; try { Object.assign(out, JSON.parse(fs.readFileSync("data/cl.json"))); } catch {}
let n = 0;
for (const d of days) {
  if (out[d]) continue;
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard?dates=${d.replace(/-/g, "")}`, { headers: H });
  if (r.status === 403) { console.log("403 à", d); await new Promise(r => setTimeout(r, 20000)); continue; }
  if (!r.ok) { console.log(d, r.status); continue; }
  const j = await r.json();
  out[d] = (j.events || []).map(ev => { const c = ev.competitions?.[0]; const h = c?.competitors?.find(x => x.homeAway === "home"), a = c?.competitors?.find(x => x.homeAway === "away"); return { id: ev.id, ts: Date.parse(ev.date), done: !!ev.status?.type?.completed, st: ev.status?.type?.name, h: h?.team?.displayName, a: a?.team?.displayName, hg: parseInt(h?.score), ag: parseInt(a?.score), nm: ev.name }; });
  if (++n % 20 === 0) fs.writeFileSync("data/cl.json", JSON.stringify(out));
  await new Promise(r => setTimeout(r, 350));
}
fs.writeFileSync("data/cl.json", JSON.stringify(out));
console.log("fini", Object.keys(out).length, "jours", Object.values(out).flat().length, "matchs");
