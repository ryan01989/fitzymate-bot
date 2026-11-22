import json, sys
for f in sys.argv[1:]:
    R = json.load(open(f))
    out = []
    for T in (20, 45, 90):
        alive = [r for r in R if r['surv'] >= T]
        has = [r for r in alive if r['lasInfo'].get('t') is not None and r['lasInfo']['t'] <= T]
        out.append('%ds %d/%d=%.0f%%' % (T, len(has), len(alive), 100 * len(has) / max(1, len(alive))))
    ts = sorted(r['lasInfo']['t'] for r in R if r['lasInfo'].get('t') is not None)
    seen = sorted(r['lasInfo']['seenT'] for r in R if r['lasInfo'].get('seenT') is not None)
    hops = [r.get('hopN', 0) for r in R]
    print('%-22s laser held: %s | median first laser %s s | first laser seen median %s s (%d/%d) | hops/match %.1f, matches with a hop %d' % (f, ' '.join(out), ts[len(ts)//2] if ts else '-', seen[len(seen)//2] if seen else '-', len(seen), len(R), sum(hops)/len(R), sum(1 for h in hops if h)))
