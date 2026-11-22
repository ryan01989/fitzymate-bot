#!/bin/bash
# pack B against more real data points (real: t01 4.905 mean of 2, v5-peek 4.15, t12-kite200 5.21, t04 5.00, probe-pacifist 0.17)
cd /Users/dylanryan/Desktop/BuildersMech/fitzymate-bot
PB='{"noise":4,"react":3,"perKill":0.5,"base":1,"every":150,"retaliate":6,"ff":0,"tAll":330}'
for b in t01-laser-first v5-peek t12-kite200 probe-pacifist; do node sim/agentR/evalR.mjs --brain sim/variants/$b.mjs --n 48 --seed 1000 --quiet --frozen-clock --stop-on-death --par 3 --pack "$PB" --dump sim/agentR/pb_$b.json | head -1 | cut -c1-120; done
echo DONE
