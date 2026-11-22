# Real showdowns: when do NPC drones die, and how many are alive at 60/90/120/180/240 s
import json, sys, collections as C
d = json.load(open(sys.argv[1]))
alive = C.defaultdict(list); deathT = []; killers = C.Counter(); nm = 0
for key, raw in d['raw'].items():
    L = raw.split('\n'); nm += 1
    marks = [60, 90, 120, 180, 240]; mi = 0
    for line in L[1:]:
        if not line or line[0] != '{': continue
        o = json.loads(line)
        if 'n' not in o: continue
        t = o['t'] / 20
        while mi < len(marks) and t >= marks[mi]:
            alive[marks[mi]].append(len(o['n'])); mi += 1
        for e in o.get('ev', []):
            if e.get('e') == 'death' and e['id'] >= 100 and e['id'] < 1000:
                deathT.append(e['t'] / 20); killers['mech' if e.get('by') is not None and e['by'] < 16 else str(e.get('by'))] += 1
print('matches', nm)
for k, v in sorted(alive.items()): print(f'alive drones at {k}s: mean {sum(v)/len(v):.1f} of 12 (n={len(v)})')
deathT.sort(); print('drone deaths', len(deathT), 'median t', deathT[len(deathT)//2] if deathT else None, killers)
import bisect
for T in [30, 60, 90, 120, 180]: print(f'  share of drone deaths before {T}s: {bisect.bisect(deathT, T)/max(1,len(deathT)):.2f}')
# human lobbies: sum rows
for k, s in d['sum'].items():
    if k.startswith('x#'):
        print(k, s.get('title'), [ (r.get('name'), r.get('kills'), r.get('cubes_max')) for r in s['rows']][:16]); break
