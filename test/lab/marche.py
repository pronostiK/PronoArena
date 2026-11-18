# Compare le moteur Duel Prono au marché (cotes moyennes), marge retirée de 3 façons. Analyse INTERNE (rien n'est affiché sur le site).
# Usage : node test/lab/dump-baseline-cotes.mjs <history.json> base.json ; python3 test/lab/marche.py base.json
import json, sys, numpy as np
from scipy.optimize import brentq
R=[r for r in json.load(open(sys.argv[1])) if r.get('bk') and all(x and x>1 for x in r['o'])]
print(len(R),'matchs avec cotes')
O=np.array([r['o'] for r in R],float); K=np.array([r['k'] for r in R]); Y=np.eye(3)[K]
DP=np.array([r['dp'] for r in R]); D=np.array([r['date'] for r in R]); LG=np.array([r['lg'] for r in R])
per=np.array(['A' if d<'2025-07-01' else ('B' if d<'2026-03-01' else 'C') for d in D])
raw=1/O; over=raw.sum(1)
def prop(p): return p/p.sum(1,keepdims=True)
def power(p):
    out=[]
    for r in p:
        c=brentq(lambda c:(r**c).sum()-1,0.5,2.0); out.append(r**c)
    return np.array(out)
def shin(p):
    out=[]
    for r in p:
        S=r.sum()
        def f(z):
            q=(np.sqrt(z*z+4*(1-z)*r*r/S)-z)/(2*(1-z)); return q.sum()-1
        try: z=brentq(f,1e-9,0.99)
        except ValueError: out.append(r/S); continue  # pas de marge mesurable : proportionnelle
        q=(np.sqrt(z*z+4*(1-z)*r*r/S)-z)/(2*(1-z)); out.append(q/q.sum())
    return np.array(out)
M={'proportionnelle':prop(raw),'puissance':power(raw),'Shin':shin(raw)}
br=lambda p:((p-Y)**2).sum(1)
ll=lambda p:-np.log(np.clip(p[np.arange(len(p)),K],1e-6,1))
print('\nMarge moyenne des cotes moyennes : %.1f %%'%(100*(over.mean()-1)))
print('\nBrier (plus bas = mieux)        A      B      C    tout')
def line(n,p): b=br(p); print('%-26s %.4f %.4f %.4f %.4f   logloss %.4f'%(n,*[b[per==s].mean() for s in 'ABC'],b.mean(),ll(p).mean()))
line('Duel Prono',DP)
for k,v in M.items(): line('Marché ('+k+')',v)
print('\nProbabilité moyenne annoncée vs fréquence réelle (tout) :   1      N      2')
print('%-26s %s'%('réel',' '.join('%.3f'%x for x in Y.mean(0))))
print('%-26s %s'%('Duel Prono',' '.join('%.3f'%x for x in DP.mean(0))))
print('%-26s %s'%('Marché (Shin)',' '.join('%.3f'%x for x in M['Shin'].mean(0))))
print('\nBrier par championnat : Duel Prono / marché (Shin)')
for lg in sorted(set(LG)):
    m=LG==lg; print('  %-4s %5d  %.4f / %.4f'%(lg,m.sum(),br(DP)[m].mean(),br(M['Shin'])[m].mean()))
# Mélange modèle + marché : poids réglé sur A, jugé sur B+C
A=per=='A'; T=~A
ws=np.linspace(0,1,21); f=lambda w,m:br(w*DP+(1-w)*M['Shin'])[m].mean()
wA=min(ws,key=lambda w:f(w,A))
print('\nMélange w*Duel Prono + (1-w)*Marché(Shin) : meilleur w sur A = %.2f'%wA)
print('  sur B+C : Duel Prono seul %.4f · marché seul %.4f · mélange %.4f'%(f(1,T),f(0,T),f(wA,T)))
# Qui a raison quand ils divergent ?
d=DP[:,0]-M['Shin'][:,0]
print('\nQuand le modèle donne PLUS que le marché à l\'équipe à domicile (écart sur la proba 1) :')
for lo,hi in [(-1,-0.10),(-0.10,-0.05),(-0.05,0.05),(0.05,0.10),(0.10,1)]:
    m=(d>lo)&(d<=hi)
    if m.sum()<30: continue
    print('  écart %+.2f..%+.2f  n=%4d  modèle %.3f  marché %.3f  réel %.3f'%(lo,hi,m.sum(),DP[m,0].mean(),M['Shin'][m,0].mean(),Y[m,0].mean()))
# Bootstrap par date : Brier(modèle) - Brier(marché Shin)
dates=np.unique(D); idx={x:np.where(D==x)[0] for x in dates}; diff=br(DP)-br(M['Shin']); rng=np.random.default_rng(1)
s=np.array([diff[idx[x]].sum() for x in dates]); c=np.array([len(idx[x]) for x in dates]); bs=[]
for _ in range(3000):
    j=rng.integers(0,len(dates),len(dates)); bs.append(s[j].sum()/c[j].sum())
print('\nÉcart de Brier modèle - marché : %+.4f  IC95%% [%+.4f ; %+.4f]'%(diff.mean(),*np.percentile(bs,[2.5,97.5])))
