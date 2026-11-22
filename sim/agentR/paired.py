# paired difference of two eval dumps by seed: python3 paired.py base.json cand.json
import json,sys,math
A={r['seed']:r for r in json.load(open(sys.argv[1]))}; B={r['seed']:r for r in json.load(open(sys.argv[2]))}
S=sorted(set(A)&set(B)); d=[B[s]['pts']-A[s]['pts'] for s in S]; n=len(d); m=sum(d)/n
sd=math.sqrt(sum((x-m)**2 for x in d)/max(1,n-1))
k=lambda R,T: sum(sum(1 for t in R[s]['killTs'] if t<=T) for s in S)/n
print(f"{sys.argv[2].split('/')[-1]} vs {sys.argv[1].split('/')[-1]}: diff {m:+.2f} ±{sd/math.sqrt(n):.2f} (n={n}, same {sum(1 for x in d if x==0)})  k90 {k(A,90):.2f}->{k(B,90):.2f}  k180 {k(A,180):.2f}->{k(B,180):.2f}")
