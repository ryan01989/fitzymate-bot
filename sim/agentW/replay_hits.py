# Real showdown replays: gun hit rate vs target size (cubes), range and target motion.
# A gun 'fire' is attributed to the mech nearest the shooter's aim line (yaw offset < 0.10 rad, within 235 m).
import json, sys, math, collections as C
d = json.load(open(sys.argv[1]))
shots = C.Counter(); hits = C.Counter()
def cb(c): return '0-2' if c <= 2 else '3-5' if c <= 5 else '6-9' if c <= 9 else '10-14' if c <= 14 else '15+'
def db(x): return '<60' if x < 60 else '60-100' if x < 100 else '100-150' if x < 150 else '150+'
def lb(v): return 'still' if v < 2 else 'slow' if v < 8 else 'walk' if v < 13.5 else 'boost'
rows = []  # (hit?, cubes, dist, lat, rearfacing) per attributed shot is not possible 1:1; keep bucket counters
nm = 0
for key, raw in d['raw'].items():
    L = raw.split('\n'); nm += 1
    prev = {}; cur = {}
    for line in L[1:]:
        if not line or line[0] != '{': continue
        o = json.loads(line)
        if 'm' not in o: continue
        prev = cur; cur = {r[0]: r for r in o['m']}
        for e in o.get('ev', []):
            k = e.get('e')
            if k == 'fire' and e.get('w') == 'gun' and e['id'] in cur:
                s = cur[e['id']]; best = None; bo = 0.10
                for tid, r in cur.items():
                    if tid == e['id']: continue
                    dx = r[1] - s[1]; dy = r[2] - s[2]; dist = math.hypot(dx, dy)
                    if dist > 235 or dist < 3: continue
                    off = abs((math.atan2(dy, dx) - s[4] + math.pi) % (2 * math.pi) - math.pi)
                    if off < bo: bo = off; best = (tid, dist, dx, dy)
                if best:
                    tid, dist, dx, dy = best; r = cur[tid]; p = prev.get(tid)
                    lat = 0.0
                    if p:
                        vx = (r[1] - p[1]) / 0.1; vy = (r[2] - p[2]) / 0.1
                        lat = abs(vx * (-dy) + vy * dx) / dist
                    # is the target looking at the shooter (within 60 deg)?
                    look = abs((math.atan2(-dy, -dx) - r[4] + math.pi) % (2 * math.pi) - math.pi) < math.pi / 3
                    shots[('c', cb(r[9]))] += 1; shots[('d', db(dist))] += 1; shots[('l', lb(lat))] += 1
                    shots[('cd', cb(r[9]), db(dist))] += 1; shots[('ld', lb(lat), db(dist))] += 1
                    shots[('cl', cb(r[9]), lb(lat))] += 1; shots[('look', look)] += 1; shots[('all',)] += 1
                    shots[('air', not (r[8] & 1))] += 1
                    shots[('cdl', cb(r[9]), db(dist), lb(lat))] += 1
            elif k == 'hit' and e.get('w') == 'gun' and e.get('src') in cur and e.get('dst') in cur and e['dst'] < 16 and e['src'] < 16:
                s = cur[e['src']]; r = cur[e['dst']]; p = prev.get(e['dst'])
                dx = r[1] - s[1]; dy = r[2] - s[2]; dist = max(1e-6, math.hypot(dx, dy))
                lat = 0.0
                if p:
                    vx = (r[1] - p[1]) / 0.1; vy = (r[2] - p[2]) / 0.1
                    lat = abs(vx * (-dy) + vy * dx) / dist
                look = abs((math.atan2(-dy, -dx) - r[4] + math.pi) % (2 * math.pi) - math.pi) < math.pi / 3
                hits[('c', cb(r[9]))] += 1; hits[('d', db(dist))] += 1; hits[('l', lb(lat))] += 1
                hits[('cd', cb(r[9]), db(dist))] += 1; hits[('ld', lb(lat), db(dist))] += 1
                hits[('cl', cb(r[9]), lb(lat))] += 1; hits[('look', look)] += 1; hits[('all',)] += 1
                hits[('air', not (r[8] & 1))] += 1
                hits[('cdl', cb(r[9]), db(dist), lb(lat))] += 1
                if e.get('rear'): hits[('rear',)] += 1
print('matches', nm, 'attributed gun shots', shots[('all',)], 'gun hits on mechs', hits[('all',)], 'rear hits', hits[('rear',)])
for pre in ['c', 'd', 'l', 'look', 'air', 'cd', 'cl', 'ld', 'cdl']:
    print('--', pre)
    for k in sorted(shots):
        if k[0] != pre: continue
        if shots[k] < 150: continue
        print('  ', k[1:], 'shots', shots[k], 'hit rate', round(hits[k] / shots[k], 3))
