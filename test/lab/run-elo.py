# Test 3 : l'Elo des clubs (calculé mais jamais utilisé) apporte-t-il quelque chose ?
# 1) régression ordonnée sur l'écart d'Elo, réglée UNIQUEMENT sur la période A ; 2) mélange (1-α)·actuel + α·Elo, α choisi sur A ; jugé sur B.
import json, sys, numpy as np
from scipy.optimize import minimize
base = [r for r in json.load(open(sys.argv[1])) if r["bk"]]
per = lambda s: "A" if s < "2025-07-01" else ("B" if s < "2026-03-01" else "C")
P = np.array([per(r["date"]) for r in base]); K = np.array([r["k"] for r in base]); Y = np.eye(3)[K]
X = np.array([(r["elo"][0] - r["elo"][1]) / 100 for r in base]); DP = np.array([r["dp"] for r in base]); BK = np.array([r["bk"] for r in base])
sig = lambda z: 1 / (1 + np.exp(-z))
def ordered(x, th):
    b, t1, t2 = th; pA = sig(t1 - b * x); pAD = sig(t2 - b * x)
    return np.stack([1 - pAD, np.maximum(pAD - pA, 1e-9), pA], 1)
brier = lambda p, m: ((p - Y) ** 2).sum(1)[m].mean()
A = P == "A"
th = minimize(lambda t: -np.log(ordered(X[A], t)[np.arange(A.sum()), K[A]]).sum(), [0.5, -0.6, 0.6]).x
print("Paramètres Elo (réglés sur A) : pente %.3f, seuils %.3f %.3f" % tuple(th))
E = ordered(X, th)
alphas = np.linspace(0, 1, 21)
bestA = min(alphas, key=lambda a: brier((1 - a) * DP + a * E, A))
print("α choisi sur A :", bestA)
rng = np.random.default_rng(7)
def ci(x):
    m = rng.integers(0, len(x), (1000, len(x))); s = np.sort(x[m].mean(1)); return s[25], s[974]
for p in (sys.argv[2] if len(sys.argv) > 2 else "A,B").split(","):
    m = P == p
    row = lambda pr: ((pr - Y) ** 2).sum(1)[m]
    ref = row(DP)
    print(f"\nPériode {p} ({m.sum()} matchs)   bookmakers {row(BK).mean():.4f}")
    for nm, pr in [("actuel", DP), ("Elo seul", E), (f"mélange α={bestA:.2f}", (1 - bestA) * DP + bestA * E), ("mélange α=0.25", .75 * DP + .25 * E), ("mélange α=0.5", .5 * DP + .5 * E)]:
        d = row(pr) - ref; lo, hi = ci(d)
        print(f"  {nm:<18} {row(pr).mean():.4f}   écart/actuel {d.mean():+.4f} [{lo:+.4f};{hi:+.4f}]")
# Calibration du nul (le Poisson sous-estime-t-il les nuls ?)
for p in ["A", "B"]:
    m = P == p; print(f"Nuls {p} : annoncés {DP[m,1].mean():.3f}  observés {Y[m,1].mean():.3f}  bookmakers {BK[m,1].mean():.3f}")
