import json,sys,collections as C
R=json.load(open(sys.argv[1]))
W=float(sys.argv[2]) if len(sys.argv)>2 else 15
agg=C.Counter(); wep=C.Counter(); n=0; rear=0; tot=0; actd=0; idled=0
natk=C.Counter(); kinds=C.Counter(); acts=[]; modes=C.Counter(); hpstart=[]
ki=C.Counter()
for r in R:
  for k in r['killInfo']:
    if k['by']: ki[('act' if k['active'] else 'idle', k['sk'])]+=1
  if r['killedBy']=='survived': continue
  dt=r['surv']; n+=1
  last=[h for h in r['dmgHist'] if h[0]>dt-W]
  tr={x[0]:x for x in r['trace']}
  who=set()
  for t,by,a,w,re,lab in last:
    tot+=a; agg[lab]+=a; wep[w]+=a; rear+=a*re
    who.add(by)
    sec=int(t); act=tr.get(sec,tr.get(sec-1))
    if act and by in act[10]: actd+=a
    elif isinstance(by,int) and by<16: idled+=a
  natk[len([x for x in who if isinstance(x,int) and x<16])]+=1
  te=r['trace'][-1]; acts.append(te[3]); modes[te[2]]+=1
  t0=[x for x in r['trace'] if x[0]>=dt-W]
  if t0: hpstart.append(t0[0][1])
print('deaths',n,'window',W)
print('dmg by label',{k:round(v/tot,2) for k,v in agg.most_common()})
print('dmg by weapon',{k:round(v/tot,2) for k,v in wep.most_common()})
print('rear share',round(rear/tot,2),' from active',round(actd/tot,2),' from idle mechs',round(idled/tot,2))
print('distinct mech attackers in window',sorted(natk.items()))
print('active count at death',sorted(C.Counter(acts).items()))
print('modes at death',modes)
print('kills (ours) by active/idle,skill',sorted(ki.items()))
tk=sum(ki.values()); print('kills per match',tk/len(R),' idle share',sum(v for k,v in ki.items() if k[0]=='idle')/tk)
