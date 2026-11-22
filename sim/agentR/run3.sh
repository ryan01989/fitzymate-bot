#!/bin/bash
# usage: run3.sh <brain> <tag> [packs...]  runs P1 P2 P3 sequentially, par 3, dumps to sim/agentR/<tag>_pN.json
cd /Users/dylanryan/Desktop/BuildersMech/fitzymate-bot
B=$1; T=$2; shift 2
P1='{"noise":2,"perKill":1,"retaliate":0,"ff":0}'
P2='{"every":120,"noise":2.5,"perKill":1,"retaliate":0,"ff":0}'
P3='{"noise":2.5,"perKill":0.5,"base":0,"every":60,"retaliate":0,"ff":0,"tAll":330,"react":3}'
for k in ${@:-1 2 3}; do
  eval PK=\$P$k
  if [ -f sim/agentR/${T}_p$k.json ]; then echo "skip $T p$k"; continue; fi
  echo "== $T p$k"; node sim/eval.mjs --brain $B --n 48 --seed 1000 --quiet --frozen-clock --stop-on-death --par 3 --pack "$PK" --diag --dump sim/agentR/${T}_p$k.json
done
