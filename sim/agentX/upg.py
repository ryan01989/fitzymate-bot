# Real replays: (1) does plating heal? (2) upgrade picks vs placement and kills (3) cube count timeline of top-8 placers
import json, sys, collections as C
d = json.load(open(sys.argv[1]))
heal = C.Counter(); picks = C.Counter(); pickPlace = C.defaultdict(list)
first = C.Counter()
for key, raw in d['raw'].items():
    L = raw.split('\n'); prev = None; cur = None
    hdr = json.loads(L[0])
    for line in L[1:]:
        if not line or line[0] != '{': continue
        o = json.loads(line)
        if 'm' not in o: continue
        prev, cur = cur, {r[0]: r for r in o['m']}
        for e in o.get('ev', []):
            if e.get('e') == 'upgrade' and e['id'] in cur and prev and e['id'] in prev:
                a = prev[e['id']]; b = cur[e['id']]
                if e['up'] == 'plating':
                    heal[('plating', 'maxup' if b[10] > a[10] + 1 else 'nomax', 'hpup' if b[6] - a[6] > 0.5 * (b[10] - a[10]) else 'nohp')] += 1
    s = d['sum'][key]
    for r in s['rows']:
        ups = r['upgrades']
        for i, u in enumerate(ups):
            picks[u] += 1; pickPlace[u].append(r['place'])
            if i == 0: first[u] += 1
print(heal)
print('first picks', first.most_common())
for u, n in picks.most_common():
    pl = pickPlace[u]; print(f'{u:22s} n={n:4d} meanPlace={sum(pl)/len(pl):.2f}')
