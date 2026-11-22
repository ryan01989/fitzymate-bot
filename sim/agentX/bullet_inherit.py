# Real showdowns: does a gun bullet inherit its shooter's velocity? Compare bullet velocity (two frames) with the shooter's aim and velocity.
import json, sys, math
d = json.load(open(sys.argv[1]))
rows = []
for key, raw in list(d['raw'].items())[:8]:
    L = raw.split('\n')
    frames = []
    for line in L[1:]:
        if not line or line[0] != '{': continue
        o = json.loads(line)
        if 'm' in o: frames.append(o)
    for i in range(2, len(frames) - 2):
        f0, f1, f2 = frames[i - 1], frames[i], frames[i + 1]
        fires = [e for e in f1.get('ev', []) if e.get('e') == 'fire' and e.get('w') == 'gun']
        if not fires: continue
        m0 = {r[0]: r for r in f0['m']}; m1 = {r[0]: r for r in f1['m']}
        p1 = {p[0]: p for p in f1.get('p', []) if p[1] == 0}; p2 = {p[0]: p for p in f2.get('p', []) if p[1] == 0}
        new = [pid for pid in p1 if pid in p2 and not any(pp[0] == pid for pp in f0.get('p', []))]
        for e in fires:
            s0, s1 = m0.get(e['id']), m1.get(e['id'])
            if not s0 or not s1: continue
            vx, vy = (s1[1] - s0[1]) / 0.1, (s1[2] - s0[2]) / 0.1
            if math.hypot(vx, vy) < 8: continue
            # bullet nearest the shooter's muzzle
            best = None
            for pid in new:
                b = p1[pid]; dd = math.hypot(b[2] - s1[1], b[3] - s1[2])
                if dd < 40 and (best is None or dd < best[0]): best = (dd, pid)
            if not best: continue
            b1, b2 = p1[best[1]], p2[best[1]]
            bvx, bvy = (b2[2] - b1[2]) / 0.1, (b2[3] - b1[3]) / 0.1
            yaw = s1[4]; ux, uy = math.cos(yaw), math.sin(yaw)
            # lateral component (perpendicular to aim) of bullet velocity vs of shooter velocity
            lat_b = -bvx * uy + bvy * ux; lat_s = -vx * uy + vy * ux
            rows.append((lat_s, lat_b, math.hypot(bvx, bvy)))
import statistics as S
print('samples', len(rows))
xs = [r[0] for r in rows]; ys = [r[1] for r in rows]
mx, my = S.mean(xs), S.mean(ys)
beta = sum((x - mx) * (y - my) for x, y in rows for _ in [0]) if False else sum((r[0] - mx) * (r[1] - my) for r in rows) / sum((r[0] - mx) ** 2 for r in rows)
print('slope of bullet lateral speed on shooter lateral speed: %.3f (1 = inherits, 0 = not)' % beta)
print('bullet speed median %.1f' % S.median(r[2] for r in rows))
print('mean |shooter lateral| %.1f  mean |bullet lateral| %.1f' % (S.mean(abs(x) for x in xs), S.mean(abs(y) for y in ys)))
