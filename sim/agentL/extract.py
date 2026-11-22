# One-pass extraction from the 47 MB export -> compact laser.json (headers, weapon/crate events, 1 Hz mech positions).
import json, sys
d = json.load(open(sys.argv[1]))
out = {'raw': {}, 'sumkeys': {}, 'trkkeys': list(d['trk'].keys())}
for k, v in d['sum'].items():
    out['sumkeys'][k] = {kk: v[kk] for kk in v if kk != 'rows'}
    out['sumkeys'][k]['rows'] = [{x: r.get(x) for x in ('id','name','place','first_weapon_t','loadout','weapons_taken','bot','spawn','death_t')} for r in v.get('rows', [])]
for k, raw in d['raw'].items():
    lines = raw.split('\n')
    h = json.loads(lines[0])
    ev = []; pos = {}
    for line in lines[1:]:
        if not line or line[0] != '{': continue
        o = json.loads(line)
        if o.get('type') and o['type'] != 'frame' and 'm' not in o:
            if o['type'] == 'result': out_res = o
            continue
        t = o.get('t', 0)
        for e in o.get('ev', []):
            if e.get('e') in ('weapon', 'crate', 'death'):
                e = dict(e); e['t'] = e.get('t', t); ev.append(e)
        if 'm' in o and t % 20 == 0:
            pos[t // 20] = [r[:4] + [r[11], r[12]] for r in o['m']]
    out['raw'][k] = {'header': {x: h.get(x) for x in ('seed','crates','pickups','mechs','drops','npcs','zone','showdown','bots')}, 'ev': ev, 'pos': pos}
json.dump(out, open(sys.argv[2], 'w'))
print('ok', len(out['raw']))
