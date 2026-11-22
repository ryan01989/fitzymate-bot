import json,sys,math
def load(f): return {r['seed']:r for r in json.load(open(f))}
tag=sys.argv[1]; base=sys.argv[2]
A=load(f'out/{tag}_{base}.json')
for b in sys.argv[3:]:
  B=load(f'out/{tag}_{b}.json'); S=sorted(set(A)&set(B)); d=[B[s]['pts']-A[s]['pts'] for s in S]; n=len(d); m=sum(d)/n
  sd=math.sqrt(sum((x-m)**2 for x in d)/max(1,n-1))
  mb=sum(B[s]['pts'] for s in S)/n; sv=sum(B[s]['surv'] for s in S)/n
  k=lambda R,T: sum(sum(1 for t in R[s]['killTs'] if t<=T) for s in S)/n
  print(f"{tag} {b:18s} pts {mb:.2f} surv {sv:4.0f}s k90 {k(B,90):.2f} k180 {k(B,180):.2f}  vs {base}: {m:+.2f} ±{sd/math.sqrt(n):.2f} (n={n})")
