#!/bin/bash
# usage: runfm.sh <brain> <tag> <FM_P json>
cd /Users/dylanryan/Desktop/BuildersMech/fitzymate-bot
B=$1; T=$2; F=$3
P1='{"noise":2,"perKill":1,"retaliate":0,"ff":0}'
P2='{"every":120,"noise":2.5,"perKill":1,"retaliate":0,"ff":0}'
P3='{"noise":2.5,"perKill":0.5,"base":0,"every":60,"retaliate":0,"ff":0,"tAll":330,"react":3}'
for k in 1 2 3; do eval PK=\$P$k; FM_P="$F" node sim/agentR/evalR.mjs --brain $B --n 48 --seed 1000 --quiet --frozen-clock --stop-on-death --par 3 --pack "$PK" --dump sim/agentR/${T}_p$k.json | head -2; done
