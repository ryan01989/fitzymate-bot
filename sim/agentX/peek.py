import json, sys, collections as C
d = json.load(open(sys.argv[1]))
print('raw keys', list(d['raw'].keys())[:3])
print('trk keys', list(d['trk'].keys())[:40])
k0 = list(d['trk'].keys())[0]
v = d['trk'][k0]
print(type(v), (v[:300] if isinstance(v, str) else json.dumps(v)[:600]))
k = list(d['raw'].keys())[0]
L = d['raw'][k].split('\n')
print(len(L))
for line in L[:3]: print(line[:1500])
print(L[-2][:3000])
s0 = list(d['sum'].keys())[:5]; print(s0); print(json.dumps(d['sum'][s0[0]])[:1500])
