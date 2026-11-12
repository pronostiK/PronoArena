# Test anti-fuite (« canari ») : on falsifie TOUS les scores à partir du 2025-02-01, puis on recalcule.
# Si une prévision d'un match AVANT cette date change, le modèle a vu le futur.
# Usage : python3 canary.py history.json  (utilise node pour le moteur actuel et run-joint.py pour les forces conjointes)
import json, sys, random, subprocess, os, tempfile
HIST = sys.argv[1]; CUT = "2025-02-01"; here = os.path.dirname(os.path.abspath(__file__)); tmp = tempfile.mkdtemp()
h = json.load(open(HIST)); random.seed(1); fake = []
for m in h:
    m = dict(m)
    if m["date"] >= CUT: m["hg"], m["ag"] = random.randint(0, 5), random.randint(0, 5)
    fake.append(m)
json.dump(fake, open(f"{tmp}/fake.json", "w"))
def cmp(a, b, label, key):
    A = {(r["lg"], r["date"], r.get("home"), r.get("away"), i if r.get("home") is None else 0): r for i, r in enumerate(a)}
    n = bad = 0
    for ra, rb in zip(a, b):
        if ra["date"] >= CUT: continue
        n += 1
        if json.dumps(ra[key]) != json.dumps(rb[key]): bad += 1
    print(f"{label} : {n} matchs avant {CUT} comparés, {bad} prévision(s) modifiée(s) →", "FUITE" if bad else "aucune fuite")
    return bad
bad = 0
for tag, src in (("reel", HIST), ("faux", f"{tmp}/fake.json")):
    subprocess.run(["node", f"{here}/dump-baseline.mjs", src, f"{tmp}/base_{tag}.json"], check=True, capture_output=True)
a, b = json.load(open(f"{tmp}/base_reel.json")), json.load(open(f"{tmp}/base_faux.json"))
assert len(a) == len(b)
bad += cmp(a, b, "Moteur actuel", "dp")
bad += cmp(a, b, "Elo des clubs", "elo")
for tag in ("reel", "faux"):
    subprocess.run(["python3", f"{here}/run-joint.py", HIST if tag == "reel" else f"{tmp}/fake.json", f"{tmp}/base_{tag}.json", f"{tmp}/joint_{tag}.json"], check=True, capture_output=True)
a, b = json.load(open(f"{tmp}/joint_reel.json"))["rows"], json.load(open(f"{tmp}/joint_faux.json"))["rows"]
bad += cmp(a, b, "Forces conjointes", "p")
sys.exit(1 if bad else 0)
