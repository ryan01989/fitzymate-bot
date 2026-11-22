# Real house-bot / team-bot cube counts over time from the recorder export (human lobbies + showdowns).
import json, sys, collections
d = json.load(open(sys.argv[1]))
print('top keys', list(d.keys()))
for k, raw in list(d['raw'].items()):
    lines = raw.split('\n'); h = json.loads(lines[0])
    sd = bool(h.get('showdown'))
    names = {m['id']: (m.get('name'), (h.get('bots') or [None]*16)[m['id']] if h.get('bots') else None) for m in h['mechs']}
    cub = collections.defaultdict(dict); alive = collections.defaultdict(int)
    for line in lines[1:]:
        if not line or line[0] != '{': continue
        o = json.loads(line)
        if 'm' not in o: continue
        t = o['t'] / 20
        for T in (30, 60, 90, 120, 180, 240):
            if T not in cub and t >= T:
                cub[T] = {r[0]: r[9] for r in o['m']}
    print(k, 'showdown' if sd else 'lobby', list(names.values())[:3])
    for T in (30, 60, 90, 120, 180, 240):
        c = cub.get(T, {})
        v = sorted(c.values())
        print('  t=%d alive %d cubes median %s max %s mean %.1f' % (T, len(v), v[len(v)//2] if v else None, v[-1] if v else None, sum(v)/max(1,len(v))))
