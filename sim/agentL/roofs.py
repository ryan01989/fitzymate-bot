# Roof lasers: which roofs, how high, how far from spawns / laserless mechs, how visible.
import json, math, collections as C, numpy as np, statistics as S
d = json.load(open('laser.json')); W = json.load(open('../../arena/v2/world.json'))
T = np.fromfile('../../arena/v2/terrain.i16', dtype='<i2').reshape(724, 1070) * 0.01
gz = lambda x, y: T[min(723, max(0, int(round(y + 334)))), min(1069, max(0, int(round(x + 513))))]
hyp = lambda a, b: math.hypot(a[0] - b[0], a[1] - b[1])
def inpoly(x, y, ring):
    n = len(ring) // 2; c = False; j = n - 1
    for i in range(n):
        xi, yi, xj, yj = ring[2*i], ring[2*i+1], ring[2*j], ring[2*j+1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: c = not c
        j = i
    return c
pr = W['prisms']
def prism_of(p):
    best = None
    for i, q in enumerate(pr):
        if q['kind'] == 'bridge': continue
        if inpoly(p[0], p[1], q['ring']) and abs(q['top'] - p[2]) < 1.5: return i
    return None
def area(ring):
    n = len(ring) // 2; return abs(sum(ring[2*i]*ring[2*((i+1)%n)+1] - ring[2*((i+1)%n)]*ring[2*i+1] for i in range(n))) / 2
hits = C.Counter(); heights = []; unk = 0; roofitems = 0
for r in d['raw'].values():
    for p in r['header']['pickups'] + [dict(c, kind='crate') for c in r['header']['crates']]:
        if p['pos'][2] - gz(*p['pos'][:2]) <= 3: continue
        roofitems += 1
        i = prism_of(p['pos'])
        if i is None: unk += 1; continue
        hits[i] += 1; heights.append(p['pos'][2] - gz(*p['pos'][:2]))
print('roof items (floor pickups + crates):', roofitems, 'matched to prism', roofitems - unk)
A = {i: area(pr[i]['ring']) for i in hits}
tot_area = sum(area(q['ring']) for q in pr if q['kind'] != 'bridge')
print('prisms ever holding a roof item %d of %d building prisms' % (len(hits), sum(1 for q in pr if q['kind'] != 'bridge')))
# items per prism vs area: correlation
xs = np.array([A[i] for i in hits]); ys = np.array([hits[i] for i in hits])
print('corr(count, area) %.2f; items per 1000 m2 roof: median %.2f' % (np.corrcoef(xs, ys)[0, 1], np.median(ys / xs * 1000)))
top = hits.most_common(12)
print('top prisms: (idx, items in 21 matches, area m2, top z, height above ground)')
for i, c in top:
    q = pr[i]; cx = np.mean(q['ring'][0::2]); cy = np.mean(q['ring'][1::2])
    print('  ', i, c, round(A[i]), q['top'], round(q['top'] - gz(cx, cy), 1), (round(cx), round(cy)))
# expected under area-proportional: share of items on top 12 prisms vs area share
print('roof height above ground of roof items: median %.1f p10 %.1f p90 %.1f max %.1f' % (np.median(heights), np.percentile(heights, 10), np.percentile(heights, 90), max(heights)))
# spawn -> nearest roof laser
near = C.Counter(); n = 0; dz = []
for r in d['raw'].values():
    rl = [p for p in r['header']['pickups'] if p['kind'] == 'laser' and p['pos'][2] - gz(*p['pos'][:2]) > 3]
    for m in r['header']['mechs']:
        n += 1
        if not rl: continue
        best = min(rl, key=lambda p: hyp(m['spawn'], p['pos'])); dd = hyp(m['spawn'], best['pos'])
        for R_ in (100, 150, 200, 300): near[R_] += dd < R_
        if dd < 200: dz.append(best['pos'][2] - m['spawn'][2])
print('roof lasers per match:', [sum(1 for p in r['header']['pickups'] if p['kind'] == 'laser' and p['pos'][2] - gz(*p['pos'][:2]) > 3) for r in d['raw'].values()])
print('spawns with a roof laser within', {k: round(v / n, 2) for k, v in near.items()}, ' climb needed (laser z - spawn z) for <200 m: median %.1f p90 %.1f' % (np.median(dz), np.percentile(dz, 90)))
