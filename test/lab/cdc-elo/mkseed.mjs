import fs from "node:fs";
import { eloSnapshots } from "./elo.mjs";
import { CL, ALIAS } from "./harness.mjs";
import { norm } from "./load.mjs";
const { elo } = eloSnapshots({ K: 20, Kcl: 32, home: 60, carry: 0.8, start: 1500 });
const key = (n) => norm(ALIAS[n] || n);
const ratings = {}; let asOf = 0;
for (const m of CL) { asOf = Math.max(asOf, m.ts); for (const [name, k] of [[m.h, m.hId], [m.a, m.aId]]) if (elo[k] !== undefined) ratings[norm(name)] = Math.round(elo[k]); }
const names = Object.keys(ratings).sort();
fs.writeFileSync("seed.json", JSON.stringify({ asOf, ratings }));
console.log(names.length, "clubs, asOf", new Date(asOf).toISOString()); console.log(names.map((n) => n + ":" + ratings[n]).join(" | "));
