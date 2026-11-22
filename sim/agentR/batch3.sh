#!/bin/bash
cd /Users/dylanryan/Desktop/BuildersMech/fitzymate-bot
PB='{"noise":4,"react":3,"perKill":0.5,"base":1,"every":150,"retaliate":6,"ff":0,"tAll":330}'
PBD='{"noise":4,"react":3,"perKill":0.5,"base":1,"every":150,"retaliate":6,"ff":0,"tAll":330,"dropSeek":400}'
for b in rad3 r03-dropwar r02-hop r01-nanite; do echo "== $b PB"; node sim/agentR/evalR.mjs --brain sim/variants/$b.mjs --n 48 --seed 1000 --quiet --frozen-clock --stop-on-death --par 3 --pack "$PB" --dump sim/agentR/pb_$b.json | head -1; done
for b in rad3 r03-dropwar; do echo "== $b PBD"; node sim/agentR/evalD.mjs --brain sim/variants/$b.mjs --n 48 --seed 1000 --quiet --frozen-clock --stop-on-death --par 3 --pack "$PBD" --dump sim/agentR/pbd_$b.json | head -1; done
echo DONE
