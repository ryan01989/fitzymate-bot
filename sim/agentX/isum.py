import json, sys, collections as C
for f in sys.argv[1:]:
    T = C.defaultdict(C.Counter); n = 0; cc = cn = 0
    for line in open(f):
        o = json.loads(line); n += o['n']; cc += o['coverCalls']; cn += o['coverNull']
        for k in ['modes', 'still', 'dmg', 'rear']: T[k].update(o[k])
    print(f, 'matches', n, 'findCover calls', cc, 'null %.2f' % (cn / max(1, cc)))
    tot = sum(T['dmg'].values())
    for m in sorted(T['modes'], key=lambda k: -T['modes'][k]):
        print(f"  {m:8s} s/match {T['modes'][m]/n:6.1f} still {T['still'][m]/max(1e-9,T['modes'][m]):.2f}  dmg share {T['dmg'][m]/max(1,tot):.2f}  rear share of its dmg {T['rear'][m]/max(1,T['dmg'][m]):.2f}")
    print('  total rear share %.2f' % (sum(T['rear'].values()) / max(1, tot)))
