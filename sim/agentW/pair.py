# paired comparison of two dumps on the same seeds: identical matches, first divergence, bookkeeping deltas
import json,sys
A={r['seed']:r for r in json.load(open(sys.argv[1]))}; B={r['seed']:r for r in json.load(open(sys.argv[2]))}
S=sorted(set(A)&set(B)); same=0; div=[]
for s in S:
    a,b=A[s],B[s]
    ta=[x[:9] for x in a['trace']]; tb=[x[:9] for x in b['trace']]
    if ta==tb and a['surv']==b['surv']: same+=1; continue
    i=0
    while i<min(len(ta),len(tb)) and ta[i]==tb[i]: i+=1
    div.append(ta[i][0] if i<len(ta) else (tb[i][0] if i<len(tb) else a['surv']))
m=lambda D,g: sum(g(D[s]) for s in S)/len(S)
div.sort()
print(sys.argv[1].split('/')[-1],'vs',sys.argv[2].split('/')[-1],': n',len(S),'identical matches',same,' first divergence (s) median',div[len(div)//2] if div else None,'quartiles',div[len(div)//4] if div else None,div[3*len(div)//4] if div else None)
for name,g in [('pts',lambda r:r['pts']),('surv',lambda r:r['surv']),('cubes',lambda r:r['cubes']),('dmg taken',lambda r:r['W']['dmgT']),('regen',lambda r:r['W']['regen']),('dealt',lambda r:r['dmg']),('fight starts',lambda r:len(r['W']['fs'])),('fight s',lambda r:r['W']['modeS'].get('fight',0)),('loot s',lambda r:r['W']['modeS'].get('loot',0)),('retreat s',lambda r:r['W']['modeS'].get('retreat',0)),('laser s',lambda r:r['W']['lasS']),('cap s',lambda r:r['W']['capS']),('dmg non-fight',lambda r:sum(v for k,v in r['W']['dmgMode'].items() if not k.startswith('fight'))),('nanites',lambda r:r['upg'].count('nanites')),('fights hp<60',lambda r:sum(1 for x in r['W']['fs'] if x[1]<60)),('fights <90s',lambda r:sum(1 for x in r['W']['fs'] if x[0]<90))]:
    print(f"   {name:14s} {m(A,g):8.2f} -> {m(B,g):8.2f}  ({m(B,g)-m(A,g):+.2f})")
