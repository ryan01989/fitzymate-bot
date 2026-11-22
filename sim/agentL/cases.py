# Export observer cases (spawns at t=0 and laserless mechs at 15/45/90 s) with the lasers lying on the ground then.
import json, math
d = json.load(open('laser.json'))
out = []
for k, r in d['raw'].items():
    h = r['header']; ev = r['ev']; pos = {int(a): b for a, b in r['pos'].items()}
    items = {}
    for p in h['pickups']:
        if p['kind'] == 'laser': items[p['id']] = dict(pos=p['pos'], on=0, off=None, src='floor')
    for e in ev:
        if e['e'] != 'weapon' or e['kind'] != 'laser': continue
        if e['op'] in ('spawn', 'drop'): items[(e['id'], e['t'])] = dict(pos=e['at'], on=e['t'] / 20, off=None, src=e['op'])
        elif e['op'] == 'take':
            for kk, it in items.items():
                if (kk == e['id'] or (isinstance(kk, tuple) and kk[0] == e['id'])) and it['off'] is None and it['on'] <= e['t'] / 20: it['off'] = e['t'] / 20
    lying = lambda Tm: [it['pos'] for it in items.values() if it['on'] <= Tm and (it['off'] is None or it['off'] > Tm)]
    for m in h['mechs']: out.append(dict(k=k, T=0, id=m['id'], p=m['spawn'], las=lying(0)))
    for Tm in (15, 45, 90):
        fr = pos.get(Tm)
        if not fr: continue
        for q in fr:
            if 2 in (q[4], q[5]): continue
            out.append(dict(k=k, T=Tm, id=q[0], p=q[1:4], las=lying(Tm)))
json.dump(out, open('cases.json', 'w')); print(len(out))
