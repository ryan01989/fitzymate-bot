import json,sys,collections as C
def md(L): L=sorted(L); return L[len(L)//2] if L else None
for f in sys.argv[1:]:
    R=json.load(open(f)); n=len(R)
    m=lambda g: sum(g(r) for r in R)/n
    kills=m(lambda r:r['kills']); surv=m(lambda r:r['surv'])
    dmg=m(lambda r:r['W']['dmgT']); reg=m(lambda r:r['W']['regen']); dealt=m(lambda r:r['dmg'])
    modes=C.Counter(); dm=C.Counter()
    for r in R:
        for k,v in r['W']['modeS'].items(): modes[k]+=v/n
        for k,v in r['W']['dmgMode'].items(): dm[k]+=v/n
    ups=C.Counter(); nan_idx=[]
    for r in R:
        for i,u in enumerate(r['upg']): ups[u]+=1
        if 'nanites' in r['upg']: nan_idx.append(r['upg'].index('nanites')+1)
    fs=[x for r in R for x in r['W']['fs']]
    print(f"{f.split('/')[-1]}: n {n} pts {m(lambda r:r['pts']):.2f} kills {kills:.2f} surv {surv:.0f}s cubes {m(lambda r:r['cubes']):.1f}")
    print(f"   dmg taken {dmg:.0f}  regen {reg:.0f} ({100*reg/max(dmg,1):.0f}% of dmg)  dmg dealt {dealt:.0f}  taken per kill {dmg/max(kills,.01):.0f}  dealt/taken {dealt/max(dmg,1):.2f}  rear share {m(lambda r:r['W']['rearD'])/max(dmg,1):.2f}")
    print('   mode s:',{k:round(v,1) for k,v in modes.most_common()},' laser share of alive time',round(m(lambda r:r['W']['lasS'])/m(lambda r:r['W']['aliveS']),2),' at-cap share',round(m(lambda r:r['W']['capS'])/m(lambda r:r['W']['aliveS']),2))
    print('   dmg by mode:',{k:round(v) for k,v in dm.most_common()})
    print('   dmg per s in mode:',{k:round(dm[k]/modes[k],1) for k in modes if modes[k]>0.5})
    print('   fight starts/match',round(len(fs)/n,2),' hp% median',md([x[1] for x in fs]),' hp<60:',round(sum(x[1]<60 for x in fs)/max(1,len(fs)),2),' other mech <90m:',round(sum(x[2]>0 for x in fs)/max(1,len(fs)),2),'<130m:',round(sum(x[3]>0 for x in fs)/max(1,len(fs)),2),'<200m:',round(sum(x[4]>0 for x in fs)/max(1,len(fs)),2),' vs active hunter:',round(sum(x[5] for x in fs)/max(1,len(fs)),2),' before 90s:',round(sum(x[0]<90 for x in fs)/max(1,len(fs)),2),' dist median',md([x[9] for x in fs]))
    print('   upgrades:',dict(ups.most_common(8)),' nanites in',len(nan_idx),'matches, median slot',md(nan_idx))
