import json,sys,collections as C
R=json.load(open(sys.argv[1])); lo=float(sys.argv[2]); hi=float(sys.argv[3])
D=[r for r in R if r['killedBy']!='survived' and lo<=r['surv']<hi]
print('deaths in',lo,hi,':',len(D),'of',len(R))
seqs=C.Counter(); hp20=[]; hp40=[]; act20=[]; act0=[]; near20=[];near0=[]; ret=0; kills_last30=[]
for r in D:
  tr=r['trace']; dt=r['surv']
  def at(T):
    c=[x for x in tr if x[0]<=T]; return c[-1] if c else tr[0]
  a=at(dt-20); b=at(dt-40); z=tr[-1]
  hp20.append(a[1]); hp40.append(b[1]); act20.append(a[3]); act0.append(z[3]); near20.append(a[5]); near0.append(z[5])
  ms=[]; 
  for x in tr:
    if x[0]>=dt-20 and (not ms or ms[-1]!=x[2]): ms.append(x[2])
  seqs['>'.join(ms[-4:])]+=1
  kills_last30.append(sum(1 for t in r['killTs'] if t>dt-30))
md=lambda L: sorted(L)[len(L)//2]
print('HP 40s before median',md(hp40),' 20s before',md(hp20))
print('active hunters 20s before',md(act20),'at death',md(act0),'  house mechs within 120m 20s before',md(near20),'at death',md(near0))
print('kills in last 30s mean',sum(kills_last30)/len(D))
for k,v in seqs.most_common(10): print(v,k)
