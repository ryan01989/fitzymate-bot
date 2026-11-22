import json,sys
for f in sys.argv[1:]:
    R=json.load(open(f)); n=len(R)
    print(f, 'n',n,'pts',round(sum(r['pts'] for r in R)/n,2),'surv',round(sum(r['surv'] for r in R)/n))
    for T in ['30','60','90','120','150','180','210','240']:
        A=[r['W']['at'][T] for r in R if T in r['W']['at']]
        if not A: continue
        m=lambda i: round(sum(a[i] for a in A)/len(A),2)
        print('  t',T,'alive',len(A),'cubes',m(0),'cap%',round(100*sum(a[0]>=10 for a in A)/len(A)),'>=15%',round(100*sum(a[0]>=15 for a in A)/len(A)),'laser%',round(100*m(1)),'hp',m(2),'maxhp',m(3),'kills',m(4),'ups',m(5))
