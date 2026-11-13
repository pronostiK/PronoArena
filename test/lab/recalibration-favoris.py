import json, numpy as np
rows=[r for r in json.load(open(__import__('sys').argv[1])) if r['bk']]
print(len(rows),'matchs')
per=lambda s:'A' if s<'2025-07-01' else ('B' if s<'2026-03-01' else 'C')
P=np.array([per(r['date']) for r in rows]); D=np.array([r['date'] for r in rows])
K=np.array([r['k'] for r in rows]); Y=np.eye(3)[K]
dp=np.array([r['dp'] for r in rows]); bk=np.array([r['bk'] for r in rows])
br=lambda p:((p-Y)**2).sum(1)
def temp(p,g):
    q=p**g; return q/q.sum(1,keepdims=True)
def fav(p,t,d):
    q=p.copy(); i=p.argmax(1); m=p.max(1)>=t; r=np.arange(len(p))
    pf=np.where(m,np.clip(p[r,i]+d,0.01,0.97),p[r,i]); oth=1-p[r,i]
    sc=np.where(oth>0,(1-pf)/oth,1)
    q=p*sc[:,None]; q[r,i]=pf; return q
base=br(dp)
print('Brier actuel A/B/C',[round(base[P==s].mean(),4) for s in 'ABC'],'bk',[round(br(bk)[P==s].mean(),4) for s in 'ABC'])
A=P=='A'
# réglage sur A uniquement
bestg=min(np.arange(0.8,1.31,0.02),key=lambda g:br(temp(dp,g))[A].mean())
cands=[(t,d) for t in (0.5,0.55,0.6,0.65,0.7) for d in np.arange(-0.08,0.081,0.01)]
bestf=min(cands,key=lambda c:br(fav(dp,*c))[A].mean())
print('temp gamma (A)=',round(bestg,2),' favoris (seuil,delta)(A)=',bestf)
# bootstrap groupé par date
dates=np.unique(D); idx={d:np.where(D==d)[0] for d in dates}
rng=np.random.default_rng(7)
def ci(diff,mask,n=3000):
    ds=[d for d in dates if mask[idx[d]].any()]
    s=np.array([diff[idx[d]][mask[idx[d]]].sum() for d in ds]); c=np.array([mask[idx[d]].sum() for d in ds])
    out=[]
    for _ in range(n):
        j=rng.integers(0,len(ds),len(ds)); out.append(s[j].sum()/c[j].sum())
    return np.percentile(out,[2.5,97.5])
for name,q in [('température',temp(dp,bestg)),('favoris',fav(dp,*bestf))]:
    b=br(q)
    for s in 'ABC':
        m=P==s; d=(b-base); lo,hi=ci(d,m)
        print(f'{name:12} {s}: Brier {b[m].mean():.4f}  écart {d[m].mean():+.4f} [{lo:+.4f};{hi:+.4f}]')
# calibration des gros favoris
for s in 'ABC':
    m=(P==s)&(dp.max(1)>=0.6); r=np.arange(len(dp))
    print(s,'favori>=60%: n',m.sum(),'annoncé',round(dp.max(1)[m].mean(),3),'observé',round((dp.argmax(1)==K)[m].mean(),3),'bk annoncé',round(bk[np.arange(len(bk)),dp.argmax(1)][m].mean(),3))
