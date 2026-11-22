# Laser-spawn analysis over the 21 real team showdowns (laser.json from extract.py).
import json, math, collections as C, numpy as np, statistics as S
d = json.load(open('laser.json'))
T = np.fromfile('../../arena/v2/terrain.i16', dtype='<i2').reshape(724, 1070) * 0.01
def gz(x, y):
    i = min(1069, max(0, int(round(x + 513)))); j = min(723, max(0, int(round(y + 334)))); return T[j, i]
hyp = lambda a, b: math.hypot(a[0] - b[0], a[1] - b[1])
R = d['raw']
rows = []
tk_all = []; crate_stats = C.Counter(); perm = []
avail = {45: [], 90: [], 30: [], 15: []}
mech_has = {15: 0, 30: 0, 45: 0, 90: 0}; mech_alive = {15: 0, 30: 0, 45: 0, 90: 0}
first_las = []
spawn_near = C.Counter(); spawn_n = 0; spawn_nearest = []
roof_take = []; ground_take = []
for k, r in R.items():
    h = r['header']; ev = r['ev']; pos = {int(a): b for a, b in r['pos'].items()}
    fl = [p for p in h['pickups'] if p['kind'] == 'laser']
    roof = {p['id']: p['pos'][2] - gz(*p['pos'][:2]) > 3 for p in h['pickups']}
    croof = {c['id']: c['pos'][2] - gz(*c['pos'][:2]) > 3 for c in h['crates']}
    broken = [e for e in ev if e['e'] == 'crate']
    cspawn = [e for e in ev if e['e'] == 'weapon' and e['op'] == 'spawn' and e['src'] >= 1000]
    for e in broken: crate_stats['broken'] += 1; crate_stats['broken_roof'] += croof.get(e['id'], 0)
    for e in cspawn: crate_stats['w_' + e['kind']] += 1
    crate_stats['crates'] += len(h['crates']); crate_stats['crates_roof'] += sum(croof.values())
    first_take = {}
    for e in ev:
        if e['e'] == 'weapon' and e['op'] == 'take' and e['id'] not in first_take: first_take[e['id']] = e
    # ground-truth laser items on the ground over time: id -> (pos, t_on, t_off)
    items = {}
    for p in fl: items[p['id']] = [p['pos'], 0, None, 'floor', roof[p['id']]]
    for e in ev:
        if e['e'] != 'weapon' or e['kind'] != 'laser': continue
        if e['op'] in ('spawn', 'drop'):
            items[(e['id'], e['t'])] = [e['at'], e['t'], None, 'crate' if e['op'] == 'spawn' else 'drop', False]
        elif e['op'] == 'take':
            # close the open item with this id
            for kk, it in items.items():
                if (kk == e['id'] or (isinstance(kk, tuple) and kk[0] == e['id'])) and it[2] is None and it[1] <= e['t']: it[2] = e['t']; it.append(e['by'])
    for p in fl:
        e = first_take.get(p['id']); tt = e['t'] / 20 if e else None
        sp = h['mechs'][e['by']]['spawn'] if e else None
        rows.append(dict(k=k, roof=roof[p['id']], t=tt, by=e['by'] if e else None, dsp=hyp(sp, p['pos']) if sp else None))
    # spawn -> nearest floor laser
    for m in h['mechs']:
        ds = sorted(hyp(m['spawn'], p['pos']) for p in fl)
        dsg = sorted(hyp(m['spawn'], p['pos']) for p in fl if not roof[p['id']])
        spawn_n += 1; spawn_nearest.append(ds[0])
        for R_ in (100, 150, 200, 300): spawn_near[('any', R_)] += ds[0] < R_; spawn_near[('ground', R_)] += dsg[0] < R_ if dsg else 0
    # per-mech laser possession from frames (slot index 2 = laser)
    for m in h['mechs']:
        fT = None
        for s in sorted(pos):
            row = next((q for q in pos[s] if q[0] == m['id']), None)
            if row and 2 in (row[4], row[5]): fT = s; break
        first_las.append(fT)
    for Tm in mech_has:
        fr = pos.get(Tm) or pos.get(Tm - 1)
        if not fr: continue
        for q in fr:
            mech_alive[Tm] += 1; has = 2 in (q[4], q[5]); mech_has[Tm] += has
            if has: continue
            # nearest laser lying on the ground right now, and whether someone else is nearer
            best = None
            for it in items.values():
                if it[1] / (20 if it[3] != 'floor' else 1) > Tm: continue
                if it[2] is not None and it[2] / 20 <= Tm: continue
                dd = hyp(q[1:3], it[0])
                if best is None or dd < best[0]:
                    other = min((hyp(o[1:3], it[0]) for o in fr if o[0] != q[0]), default=1e9)
                    best = (dd, other < dd, it[4], it[3])
            avail[Tm].append(best)
    perm.append(sum(1 for it in items.values() if it[2] is None and it[3] == 'floor'))
n = len(R)
print('matches', n)
fl_counts = [sum(1 for p in r['header']['pickups'] if p['kind'] == 'laser') for r in R.values()]
print('floor lasers/match: mean %.1f min %d max %d  (40 floor items, 1/3 laser expected 13.3)' % (S.mean(fl_counts), min(fl_counts), max(fl_counts)))
roofc = sum(x['roof'] for x in rows); print('floor lasers on roofs: %d/%d = %.0f%%' % (roofc, len(rows), 100 * roofc / len(rows)))
allroof = [p['pos'][2] - gz(*p['pos'][:2]) > 3 for r in R.values() for p in r['header']['pickups']]
print('all floor items on roofs: %.0f%%' % (100 * sum(allroof) / len(allroof)))
print('crates', dict(crate_stats))
print('  per match: broken %.1f of 36, crate lasers %.1f' % (crate_stats['broken'] / n, crate_stats['w_laser'] / n))
for name, sel in (('ground', lambda x: not x['roof']), ('roof', lambda x: x['roof'])):
    rs = [x for x in rows if sel(x)]; ts = [x['t'] for x in rs]
    f = lambda c: sum(1 for t in ts if t is not None and t <= c) / len(ts)
    tt = sorted(t for t in ts if t is not None)
    print('%s floor lasers n=%d taken by 15s %.0f%% 30s %.0f%% 45s %.0f%% 90s %.0f%% ever %.0f%%; median take t %.1f' % (name, len(rs), 100 * f(15), 100 * f(30), 100 * f(45), 100 * f(90), 100 * f(1e9), tt[len(tt) // 2] if tt else -1))
ds = [x['dsp'] for x in rows if x['t'] is not None and x['t'] <= 30]
print('taker spawn->laser distance for takes <=30 s: median %.0f m, p90 %.0f' % (S.median(ds), sorted(ds)[int(.9 * len(ds))]))
print('floor lasers never taken per match: mean %.1f' % S.mean(perm))
print('spawn: nearest floor laser median %.0f m; share with a laser within' % S.median(spawn_nearest), {kk: round(v / spawn_n, 2) for kk, v in spawn_near.items()})
print('mechs holding a laser:', {Tm: '%d/%d=%.0f%%' % (mech_has[Tm], mech_alive[Tm], 100 * mech_has[Tm] / mech_alive[Tm]) for Tm in mech_has})
fl2 = sorted(x for x in first_las if x is not None); print('first laser time (alive-any): median %ds; share of mechs ever %.0f%%' % (fl2[len(fl2) // 2], 100 * len(fl2) / len(first_las)))
for Tm in (15, 30, 45, 90):
    a = [b for b in avail[Tm] if b]
    nb = len(avail[Tm]) - len(a)
    w = lambda c: sum(1 for b in a if b[0] < c)
    print('t=%ds laserless alive mechs %d: nearest laser on ground median %.0f m; <100 %d <200 %d <300 %d <450 %d; of those <300 m: other mech nearer %d, roof %d; none on map %d' % (Tm, len(avail[Tm]), S.median(b[0] for b in a), w(100), w(200), w(300), w(450), sum(1 for b in a if b[0] < 300 and b[1]), sum(1 for b in a if b[0] < 300 and b[2]), nb))
json.dump([{**x, "roof": bool(x["roof"])} for x in rows], open('floor_lasers.json', 'w'))
