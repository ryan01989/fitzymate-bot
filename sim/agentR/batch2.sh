#!/bin/bash
cd /Users/dylanryan/Desktop/BuildersMech/fitzymate-bot
P1='{"noise":2,"perKill":1,"retaliate":0,"ff":0}'
P2='{"every":120,"noise":2.5,"perKill":1,"retaliate":0,"ff":0}'
P3='{"noise":2.5,"perKill":0.5,"base":0,"every":60,"retaliate":0,"ff":0,"tAll":330,"react":3}'
P1D='{"noise":2,"perKill":1,"retaliate":0,"ff":0,"dropSeek":400}'
P3D='{"noise":2.5,"perKill":0.5,"base":0,"every":60,"retaliate":0,"ff":0,"tAll":330,"react":3,"dropSeek":400}'
run() { echo "== $1 $2"; node sim/agentR/$3 --brain $1 --n 48 --seed 1000 --quiet --frozen-clock --stop-on-death --par 3 --pack "$2" --dump sim/agentR/$4.json | head -1; }
run sim/variants/rad3.mjs "$P3D" evalD.mjs baseD_p3
run sim/variants/r03-dropwar.mjs "$P3D" evalD.mjs dropD_p3
run sim/variants/r03-dropwar.mjs "$P1" evalR.mjs drop_p1
run sim/variants/r03-dropwar.mjs "$P2" evalR.mjs drop_p2
run sim/variants/r03-dropwar.mjs "$P3" evalR.mjs drop_p3
run sim/variants/rad3.mjs "$P1D" evalD.mjs baseD_p1
run sim/variants/r03-dropwar.mjs "$P1D" evalD.mjs dropD_p1
echo DONE
