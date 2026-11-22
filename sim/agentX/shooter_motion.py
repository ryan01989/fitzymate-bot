# Real showdowns: gun hit rate by the SHOOTER's own lateral speed (perpendicular to the line of fire) and range.
# A shooter that does not correct for its own motion puts every shot off by v_lat * (delay between its observation and the shot).
import json, sys, math, collections as C
d = json.load(open(sys.argv[1]))
shots = C.Counter(); hits = C.Counter()
def db(x): return '<60' if x < 60 else '60-100' if x < 100 else '100-150' if x < 150 else '150+'
def lb(v): return 'still<2' if v < 2 else 'slow2-8' if v < 8 else 'walk8-13.5' if v < 13.5 else 'boost13.5+'
for key, raw in d['raw'].items():
    L = raw.split('\n'); prev = {}; cur = {}
    pend = []  # (tick, shooter, target, bucket)
    for line in L[1:]:
        if not line or line[0] != '{': continue
        o = json.loads(line)
        if 'm' not in o: continue
        prev = cur; cur = {r[0]: r for r in o['m']}
        for e in o.get('ev', []):
            k = e.get('e')
            if k == 'fire' and e.get('w') == 'gun' and e['id'] in cur and e['id'] in prev:
                s = cur[e['id']]; p = prev[e['id']]; best = None; bo = 0.10
                for tid, r in cur.items():
                    if tid == e['id']: continue
                    dx = r[1] - s[1]; dy = r[2] - s[2]; dist = math.hypot(dx, dy)
                    if dist > 235 or dist < 3: continue
                    off = abs((math.atan2(dy, dx) - s[4] + math.pi) % (2 * math.pi) - math.pi)
                    if off < bo: bo = off; best = (tid, dist, dx, dy)
                if best:
                    tid, dist, dx, dy = best
                    vx = (s[1] - p[1]) / 0.1; vy = (s[2] - p[2]) / 0.1
                    lat = abs(vx * (-dy) + vy * dx) / dist
                    b = (lb(lat), db(dist)); shots[b] += 1
                    pend.append((e['t'], e['id'], tid, b))
            elif k == 'hit' and e.get('w') == 'gun' and e.get('src', 99) < 16 and e.get('dst', 99) < 16:
                for i in range(len(pend) - 1, -1, -1):
                    pt, sid, tid, b = pend[i]
                    if sid == e['src'] and tid == e['dst'] and e['t'] - pt < 30:
                        hits[b] += 1; pend.pop(i); break
        pend = [q for q in pend if cur and True][-400:]
for dd in ['<60', '60-100', '100-150', '150+']:
    print(dd, '  '.join(f"{l}: {hits[(l, dd)]/max(1,shots[(l, dd)]):.3f} (n={shots[(l, dd)]})" for l in ['still<2', 'slow2-8', 'walk8-13.5', 'boost13.5+']))
