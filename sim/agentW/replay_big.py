# Real showdown replays: for mechs holding 8+ cubes fighting mechs holding 0-3, gun hits dealt vs taken by range bin (same pairs, both directions).
import json, sys, math, collections as C
d = json.load(open(sys.argv[1]))
deal = C.Counter(); take = C.Counter(); dealA = C.Counter(); takeA = C.Counter()
def rb(x): return '<60' if x < 60 else '60-90' if x < 90 else '90-130' if x < 130 else '130+'
for key, raw in d['raw'].items():
    cur = {}
    for line in raw.split('\n')[1:]:
        if not line or line[0] != '{': continue
        o = json.loads(line)
        if 'm' not in o: continue
        cur = {r[0]: r for r in o['m']}
        for e in o.get('ev', []):
            if e.get('e') == 'hit' and e.get('w') == 'gun' and e.get('src') in cur and e.get('dst') in cur and e['src'] < 16 and e['dst'] < 16:
                s = cur[e['src']]; r = cur[e['dst']]; b = rb(math.hypot(r[1] - s[1], r[2] - s[2]))
                if s[9] >= 8 and r[9] <= 3: deal[b] += 1; dealA[b] += e['amt']
                if r[9] >= 8 and s[9] <= 3: take[b] += 1; takeA[b] += e['amt']
print('big (8+ cubes) vs small (0-3 cubes), gun only: range, hits dealt by big, hits taken by big, hit ratio, damage ratio')
for b in ['<60', '60-90', '90-130', '130+']:
    print(' ', b, deal[b], take[b], round(deal[b] / max(1, take[b]), 2), round(dealA[b] / max(1, takeA[b]), 2))
