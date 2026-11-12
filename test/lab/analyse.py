# Analyse : Brier par période (A = réglage, B = validation, C = final) + écart par match avec intervalle de confiance
import json, sys, numpy as np
d = json.load(open(sys.argv[1])); rows = d["rows"]; names = [c["name"] for c in d["configs"]]
per = lambda s: "A" if s < "2025-07-01" else ("B" if s < "2026-03-01" else "C")
P = np.array([per(r["date"]) for r in rows])
K = np.array([r["k"] for r in rows]); Y = np.eye(3)[K]
def brier(arr): return ((arr - Y) ** 2).sum(1)
bk = brier(np.array([r["bk"] for r in rows]))
B = {n: brier(np.array([r["p"][n] for r in rows])) for n in names}
ref = B[names[0]]
rng = np.random.default_rng(7)
def ci(x):
    m = rng.integers(0, len(x), (1000, len(x))); s = np.sort(x[m].mean(1)); return s[25], s[974]
show = sys.argv[2].split(",") if len(sys.argv) > 2 else ["A", "B"]
print("config          " + "  ".join(f"{p}:Brier  écart/actuel [IC95]      " for p in show))
print("bookmakers      " + "  ".join(f"{bk[P==p].mean():.4f}" + " " * 30 for p in show))
for n in names:
    out = []
    for p in show:
        m = P == p; dlt = (B[n] - ref)[m]; lo, hi = ci(dlt)
        out.append(f"{B[n][m].mean():.4f}  {dlt.mean():+.4f} [{lo:+.4f};{hi:+.4f}]")
    print(f"{n:<15} " + "  ".join(out))
