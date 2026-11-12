# Test 2 : forces attaque / défense estimées EN MÊME TEMPS (régression de Poisson pénalisée), corrigées de l'adversaire.
#   log λ_dom = μ + h + att[dom] + def[ext]     log λ_ext = μ + att[ext] + def[dom]
#   (def = faiblesse défensive : plus elle est haute, plus l'équipe encaisse)
# Pénalisation ridge τ sur att/def (ramène vers la moyenne), poids optionnel 0,5^(jours/H). Même ρ de Dixon-Coles qu'aujourd'hui (−0,08) :
# on isole l'effet de l'estimation des forces. Même règle : le modèle ne voit que les matchs d'avant la date du match.
# Usage : python3 run-joint.py history.json base.json sortie.json
import json, sys, math, datetime as dt, numpy as np
from scipy.optimize import minimize
from multiprocessing import Pool
HIST, BASE, OUT = sys.argv[1:4]
LGS = ["FL1", "PL", "PD", "SA", "BL1", "PPL", "DED", "ELC", "FL2"]
TAUS = [3, 8, 20]; HS = [None, 365, 180]
CONFIGS = [(t, h) for t in TAUS for h in HS]
name = lambda c: f"T{c[0]}_H{c[1] or 'inf'}"
RHO = -0.08; N = 10
season = lambda d: int(d[:4]) if int(d[5:7]) >= 7 else int(d[:4]) - 1
day = lambda d: dt.date.fromisoformat(d).toordinal()
FACT = np.array([math.factorial(i) for i in range(N + 1)], float)

def grid_probs(lh, la):
    i = np.arange(N + 1)
    ph = np.exp(-lh) * lh ** i / FACT; pa = np.exp(-la) * la ** i / FACT
    M = np.outer(ph, pa)
    M[0, 0] *= 1 - lh * la * RHO; M[0, 1] *= 1 + lh * RHO; M[1, 0] *= 1 + la * RHO; M[1, 1] *= 1 - RHO
    M = np.maximum(M, 0); M /= M.sum()
    return [float(np.tril(M, -1).sum()), float(np.trace(M)), float(np.triu(M, 1).sum())]

def fit(hi, ai, yh, ya, w, n, tau, x0):
    def f(x):
        mu, h = x[0], x[1]; att, de = x[2:2 + n], x[2 + n:]
        lh = np.exp(mu + h + att[hi] + de[ai]); la = np.exp(mu + att[ai] + de[hi])
        val = (w * (lh - yh * np.log(lh) + la - ya * np.log(la))).sum() + 0.5 * tau * (att @ att + de @ de)
        rh = w * (lh - yh); ra = w * (la - ya)
        g = np.empty_like(x); g[0] = rh.sum() + ra.sum(); g[1] = rh.sum()
        g[2:2 + n] = np.bincount(hi, rh, n) + np.bincount(ai, ra, n) + tau * att
        g[2 + n:] = np.bincount(ai, rh, n) + np.bincount(hi, ra, n) + tau * de
        return val, g
    return minimize(f, x0, jac=True, method="L-BFGS-B", options={"maxiter": 200}).x

def run_league(lg):
    H = json.load(open(HIST)); L = sorted([m for m in H if m["lg"] == lg and (m.get("division") or "L1") == "L1"], key=lambda m: m["date"])
    base = {(r["date"], r["home"], r["away"]): r for r in json.load(open(BASE)) if r["lg"] == lg and r["bk"]}
    dates = sorted({m["date"] for m in L if m["date"] >= "2024-08-01"})
    warm = {c: {} for c in CONFIGS}; rows = []
    for d in dates:
        todo = [m for m in L if m["date"] == d and (d, m["home"], m["away"]) in base]
        if not todo: continue
        S = season(d); past = [m for m in L if m["date"] < d and season(m["date"]) >= S - 1]
        if len(past) < 20: continue
        teams = sorted({m["home"] for m in past} | {m["away"] for m in past}); ix = {t: i for i, t in enumerate(teams)}; n = len(teams)
        hi = np.array([ix[m["home"]] for m in past]); ai = np.array([ix[m["away"]] for m in past])
        yh = np.array([m["hg"] for m in past], float); ya = np.array([m["ag"] for m in past], float)
        age = day(d) - np.array([day(m["date"]) for m in past])
        res = {c: [] for c in CONFIGS}; par = {}
        for c in CONFIGS:
            tau, Hh = c; w = np.ones(len(past)) if Hh is None else 0.5 ** (age / Hh)
            w = w * len(past) / w.sum() if False else w
            x0 = np.zeros(2 + 2 * n); x0[0] = math.log(max(yh.mean(), .5)); x0[1] = .2
            wm = warm[c]
            if wm:
                x0[0], x0[1] = wm["mu"], wm["h"]
                for t, i in ix.items():
                    if t in wm["att"]: x0[2 + i] = wm["att"][t]; x0[2 + n + i] = wm["def"][t]
            x = fit(hi, ai, yh, ya, w, n, tau, x0)
            warm[c] = {"mu": x[0], "h": x[1], "att": {t: x[2 + i] for t, i in ix.items()}, "def": {t: x[2 + n + i] for t, i in ix.items()}}
            par[c] = x
        for m in todo:
            r = base[(d, m["home"], m["away"])]; p = {"actuel": r["dp"]}
            for c in CONFIGS:
                x = par[c]; a = lambda t: x[2 + ix[t]] if t in ix else 0.0; de = lambda t: x[2 + n + ix[t]] if t in ix else 0.0
                lh = min(4, max(.2, math.exp(x[0] + x[1] + a(m["home"]) + de(m["away"])))); la = min(4, max(.2, math.exp(x[0] + a(m["away"]) + de(m["home"]))))
                p[name(c)] = grid_probs(lh, la)
            rows.append({"lg": lg, "date": d, "k": r["k"], "bk": r["bk"], "p": p})
    return rows

if __name__ == "__main__":
    with Pool(min(len(LGS), 4)) as pool: parts = pool.map(run_league, LGS)
    rows = [r for p in parts for r in p]
    json.dump({"configs": [{"name": "actuel"}] + [{"name": name(c)} for c in CONFIGS], "rows": rows}, open(OUT, "w"))
    print(len(rows), "matchs")
