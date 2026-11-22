# Real showdown replays: gun hit rate by 20 m range bin x target cube bucket; laser hit rate by range and size.
import json, sys, math, collections as C
d = json.load(open(sys.argv[1]))
S = C.Counter(); H = C.Counter(); LS = C.Counter(); LH = C.Counter()
def cb(c): return 'c0-2' if c <= 2 else 'c3-9' if c <= 9 else 'c10+'
def rb(x): return min(int(x // 20) * 20, 180)
for key, raw in d['raw'].items():
    cur = {}
    for line in raw.split('\n')[1:]:
        if not line or line[0] != '{': continue
        o = json.loads(line)
        if 'm' not in o: continue
        cur = {r[0]: r for r in o['m']}
        for e in o.get('ev', []):
            k = e.get('e')
            if k == 'fire' and e.get('w') == 'gun' and e['id'] in cur:
                s = cur[e['id']]; best = None; bo = 0.10
                for tid, r in cur.items():
                    if tid == e['id']: continue
                    dx = r[1] - s[1]; dy = r[2] - s[2]; dist = math.hypot(dx, dy)
                    if dist > 235 or dist < 3: continue
                    off = abs((math.atan2(dy, dx) - s[4] + math.pi) % (2 * math.pi) - math.pi)
                    if off < bo: bo = off; best = (tid, dist)
                if best:
                    r = cur[best[0]]; S[(cb(r[9]), rb(best[1]))] += 1; S[('all', rb(best[1]))] += 1
            elif k == 'hit' and e.get('w') == 'gun' and e.get('src') in cur and e.get('dst') in cur and e['dst'] < 16 and e['src'] < 16:
                s = cur[e['src']]; r = cur[e['dst']]; dist = math.hypot(r[1] - s[1], r[2] - s[2])
                H[(cb(r[9]), rb(dist))] += 1; H[('all', rb(dist))] += 1
            elif k == 'laser' and e['id'] in cur:
                s = cur[e['id']]; fx, fy = e['from'][0], e['from'][1]; tx, ty = e['to'][0], e['to'][1]
                yaw = math.atan2(ty - fy, tx - fx); best = None; bo = 0.12
                for tid, r in cur.items():
                    if tid == e['id']: continue
                    dx = r[1] - s[1]; dy = r[2] - s[2]; dist = math.hypot(dx, dy)
                    if dist > 285 or dist < 3: continue
                    off = abs((math.atan2(dy, dx) - yaw + math.pi) % (2 * math.pi) - math.pi)
                    if off < bo: bo = off; best = (tid, dist)
                if best:
                    r = cur[best[0]]; kk = (cb(r[9]), min(int(best[1] // 50) * 50, 200))
                    LS[kk] += 1; LS[('all', kk[1])] += 1
                    if best[0] in (e.get('hits') or []): LH[kk] += 1; LH[('all', kk[1])] += 1
print('GUN hit rate by range bin (m) and target cubes: shots / hit rate')
for b in ['all', 'c0-2', 'c3-9', 'c10+']:
    print(' ', b, '  '.join(f"{r}:{S[(b, r)]}/{H[(b, r)] / S[(b, r)]:.2f}" for r in range(0, 200, 20) if S[(b, r)] >= 80))
print('LASER beams aimed at a mech: n / hit rate by 50 m bin')
for b in ['all', 'c0-2', 'c3-9', 'c10+']:
    print(' ', b, '  '.join(f"{r}:{LS[(b, r)]}/{LH[(b, r)] / LS[(b, r)]:.2f}" for r in range(0, 250, 50) if LS[(b, r)] >= 30))
