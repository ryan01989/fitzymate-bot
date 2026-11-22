# Real showdowns: cubes held at 90 s per mech, and where its cubes up to 90 s came from (crate / drone / mech kill / drop)
import json, sys, math, collections as C
d = json.load(open(sys.argv[1]))
rows = []
for key, raw in d['raw'].items():
    L = raw.split('\n'); hdr = json.loads(L[0]); names = {m['id']: m['name'] for m in hdr['mechs']}
    origin = {}; src = C.defaultdict(C.Counter); c90 = {}; cur = {}; lastDeath = None
    for line in L[1:]:
        if not line or line[0] != '{': continue
        o = json.loads(line)
        if 'm' not in o: continue
        t = o['t'] / 20
        cur = {r[0]: r for r in o['m']}
        evs = o.get('ev', [])
        dead = [e for e in evs if e.get('e') in ('death', 'crate')]
        for e in evs:
            if e.get('e') == 'cube':
                kind = 'unk'
                for x in dead:
                    if x['t'] == e['t']: kind = 'crate' if x['e'] == 'crate' else ('npc' if x['id'] >= 100 else 'mech')
                origin[e['id']] = kind
            elif e.get('e') == 'pickup' and t <= 90:
                src[e['by']][origin.get(e['id'], 'unk')] += 1
            elif e.get('e') == 'drop' and t <= 90 and e.get('by') is not None:
                src[e['by']]['drop'] += 1
        if t >= 90 and not c90:
            c90 = {i: r[9] for i, r in cur.items()}
    s = d['sum'][key]
    for r in s['rows']:
        rows.append((c90.get(r['id'], None), r['place'], r['name'], dict(src[r['id']]), r['kills'], r.get('first_weapon_t')))
rows = [r for r in rows if r[0] is not None]
rows.sort(key=lambda r: -r[0])
print('mechs alive at 90 s:', len(rows), ' mean cubes at 90 s %.1f' % (sum(r[0] for r in rows) / len(rows)))
tot = C.Counter()
for r in rows: tot.update(r[3])
print('cube sources to 90 s (all mechs):', tot)
by = C.defaultdict(list)
for r in rows: by[r[2]].append(r)
print('per bot name (matches, mean cubes@90, mean place, sources):')
for nm, rs in sorted(by.items(), key=lambda kv: -sum(r[0] for r in kv[1]) / len(kv[1]))[:20]:
    sc = C.Counter()
    for r in rs: sc.update(r[3])
    print(f'  {nm:24s} n={len(rs):2d} c90={sum(r[0] for r in rs)/len(rs):5.1f} place={sum(r[1] for r in rs)/len(rs):4.1f} src/match={ {k: round(v/len(rs),1) for k, v in sc.items()} }')
