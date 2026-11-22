# Real showdowns: where do a dead mech's cubes land relative to its last position, and how long do they lie there
import json, sys, math, collections as C
d = json.load(open(sys.argv[1]))
ds = []; n_by = C.Counter(); taken = []; who = C.Counter()
for key, raw in d['raw'].items():
    L = raw.split('\n'); cur = {}; pending = {}; cubeAt = {}; cubeOwner = {}
    for line in L[1:]:
        if not line or line[0] != '{': continue
        o = json.loads(line)
        if 'm' not in o: continue
        prev = cur; cur = {r[0]: r for r in o['m']}
        evs = o.get('ev', [])
        deaths = [e for e in evs if e.get('e') == 'death' and e['id'] < 16]
        for e in evs:
            if e.get('e') == 'cube': cubeAt[e['id']] = (e['at'], e['t'])
        for dd in deaths:
            p = prev.get(dd['id']) or cur.get(dd['id'])
            if not p: continue
            cs = [e for e in evs if e.get('e') == 'cube']
            n_by[len(cs)] += 1
            for c in cs:
                ds.append(math.hypot(c['at'][0] - p[1], c['at'][1] - p[2]))
                cubeOwner[c['id']] = (dd.get('by'), c['t'])
        for e in evs:
            if e.get('e') == 'pickup' and e['id'] in cubeOwner:
                k, t0 = cubeOwner.pop(e['id'])
                taken.append((e['t'] - t0) / 20); who['killer' if e.get('by') == k else 'other'] += 1
ds.sort()
q = lambda f: ds[int(f * (len(ds) - 1))]
print('death cubes', len(ds), 'dist from death pos: p50 %.1f p75 %.1f p90 %.1f max %.1f' % (q(.5), q(.75), q(.9), ds[-1]))
print('share beyond 4.5 m: %.2f' % (sum(1 for x in ds if x > 4.5) / len(ds)))
taken.sort(); print('death cubes picked', len(taken), 'by', who, 'time to pickup p50 %.1f p90 %.1f' % (taken[len(taken)//2], taken[int(.9*len(taken))]))
