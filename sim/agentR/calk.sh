#!/bin/bash
# kill-timeline calibration: v3-farm real k90 1.58, k180 3.58, final 4.58 (4.33 replicate); pacifist 0.17
cd /Users/dylanryan/Desktop/BuildersMech/fitzymate-bot
for pk in "$@"; do
  T=$(echo "$pk" | md5 | cut -c1-6)
  node sim/agentR/evalR.mjs --brain sim/variants/v3-farm.mjs --n 48 --seed 1000 --quiet --frozen-clock --stop-on-death --par 3 --pack "$pk" --dump sim/agentR/calk_$T.json > /dev/null
  python3 -c "
import json,sys
R=json.load(open('sim/agentR/calk_$T.json')); n=len(R)
k90=sum(sum(1 for t in r['killTs'] if t<=90) for r in R)/n; k180=sum(sum(1 for t in r['killTs'] if t<=180) for r in R)/n
s=sorted(r['surv'] for r in R)
print('$pk', 'pts %.2f k90 %.2f k180 %.2f survMed %d p75 %d'%(sum(r['pts'] for r in R)/n,k90,k180,s[n//2],s[3*n//4]))"
done
