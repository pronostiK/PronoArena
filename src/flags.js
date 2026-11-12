// Drapeaux des sélections africaines (la CAN n'a pas de logos chez SportAPI). Nom anglais → code pays à 2 lettres.
const AFRICA = {
  algeria: "dz", angola: "ao", benin: "bj", botswana: "bw", "burkina faso": "bf", burundi: "bi", cameroon: "cm", "cape verde": "cv", "cabo verde": "cv",
  "central african republic": "cf", chad: "td", comoros: "km", congo: "cg", "congo republic": "cg", "republic of the congo": "cg", "congo dr": "cd", "dr congo": "cd",
  "democratic republic of the congo": "cd", "dr. congo": "cd", djibouti: "dj", egypt: "eg", "equatorial guinea": "gq", eritrea: "er", eswatini: "sz", swaziland: "sz",
  ethiopia: "et", gabon: "ga", gambia: "gm", "the gambia": "gm", ghana: "gh", guinea: "gn", "guinea-bissau": "gw", "guinea bissau": "gw", "ivory coast": "ci",
  "cote d'ivoire": "ci", "cote divoire": "ci", kenya: "ke", lesotho: "ls", liberia: "lr", libya: "ly", madagascar: "mg", malawi: "mw", mali: "ml", mauritania: "mr",
  mauritius: "mu", morocco: "ma", mozambique: "mz", namibia: "na", niger: "ne", nigeria: "ng", rwanda: "rw", "sao tome and principe": "st", "sao tome e principe": "st",
  senegal: "sn", seychelles: "sc", "sierra leone": "sl", somalia: "so", "south africa": "za", "south sudan": "ss", sudan: "sd", tanzania: "tz", togo: "tg", tunisia: "tn",
  uganda: "ug", zambia: "zm", zimbabwe: "zw",
};
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const flagUrl = (name) => { const c = AFRICA[norm(name)]; return c ? `https://flagcdn.com/w160/${c}.png` : null; };
// Met le drapeau sur chaque équipe d'une table { id: [nom, logo] } (remplace le logo absent ou générique)
export function flagTeams(teams) {
  for (const t of Object.values(teams || {})) { const u = flagUrl(t[0]); if (u) t[1] = u; }
  return teams;
}
export const AFRICA_NAMES = Object.keys(AFRICA);
