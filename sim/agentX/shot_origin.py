# Real showdowns: from where (which tick's shooter position) does a gun bullet leave? Perpendicular distance from the shooter's
# interpolated position at ticks tf-2 .. tf+1 to the bullet's line (fire event at tick tf). Moving shooters only (lateral speed > 6 m/s).
import json, sys, math, collections as C, statistics as S
d = json.load(open(sys.argv[1]))
res = C.defaultdict(list)
for key, raw in list(d['raw'].items())[:10]:
    L = raw.split('\n'); frames = []
    for line in L[1:]:
        if not line or line[0] != '{': continue
        o = json.loads(line)
        if 'm' in o: frames.append(o)
    byT = {f['t']: i for i, f in enumerate(frames)}
    for i in range(1, len(frames) - 2):
        f = frames[i]
        for e in f.get('ev', []):
            if e.get('e') != 'fire' or e.get('w') != 'gun': continue
            tf = e['t']; sid = e['id']
            # frames around: f_prev.t <= tf-? ; positions at frame ticks
            P = {}
            for k in range(i - 2, i + 3):
                if 0 <= k < len(frames):
                    r = {q[0]: q for q in frames[k]['m']}.get(sid)
                    if r: P[frames[k]['t']] = (r[1], r[2])
            if len(P) < 4: continue
            ts = sorted(P)
            def at(tick):
                for a, b in zip(ts, ts[1:]):
                    if a <= tick <= b:
                        w = (tick - a) / (b - a); return (P[a][0] + (P[b][0] - P[a][0]) * w, P[a][1] + (P[b][1] - P[a][1]) * w)
                return None
            # bullet: new id in the first frame with t >= tf, also in the next frame
            fa = next((k for k in range(i, min(i + 2, len(frames))) if frames[k]['t'] >= tf), None)
            if fa is None or fa + 1 >= len(frames): continue
            prevIds = set(p[0] for p in frames[fa - 1].get('p', []))
            pa = {p[0]: p for p in frames[fa].get('p', []) if p[1] == 0 and p[0] not in prevIds}
            pb = {p[0]: p for p in frames[fa + 1].get('p', []) if p[1] == 0}
            s0 = at(tf)
            if not s0: continue
            cand = [(math.hypot(p[2] - s0[0], p[3] - s0[1]), pid) for pid, p in pa.items() if pid in pb]
            if not cand: continue
            dd, pid = min(cand)
            if dd > 30: continue
            b1, b2 = pa[pid], pb[pid]
            ux, uy = b2[2] - b1[2], b2[3] - b1[3]; n = math.hypot(ux, uy)
            if n < 5: continue
            ux /= n; uy /= n
            v = (P[ts[-1]][0] - P[ts[0]][0]) / ((ts[-1] - ts[0]) * 0.05), (P[ts[-1]][1] - P[ts[0]][1]) / ((ts[-1] - ts[0]) * 0.05)
            vlat = -v[0] * uy + v[1] * ux
            if abs(vlat) < 6: continue
            for off in (-2, -1, 0, 1):
                s = at(tf + off)
                if not s: continue
                # signed perpendicular offset of the shooter from the bullet line, in units of the shooter's lateral step per tick
                perp = -(s[0] - b1[2]) * uy + (s[1] - b1[3]) * ux
                res[off].append(abs(perp))
for off in sorted(res):
    v = res[off]; print(f'shooter at fire tick {off:+d}: n={len(v)} median |perp dist to bullet line| {S.median(v):.3f} m  mean {S.mean(v):.3f}')
