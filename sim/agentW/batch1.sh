#!/bin/zsh
cd /Users/dylanryan/Desktop/BuildersMech/fitzymate-bot
PB='{"noise":4,"react":3,"perKill":0.5,"base":1,"every":150,"retaliate":6,"ff":0,"tAll":330}'
PL='{"base":0,"every":100000,"perKill":0,"tAll":240,"retaliate":0,"ff":0,"near":0}'
for b in t13-hunt90 t22b-fightcube t31-stack t33a-cubes-more t33b-firstshot t33c-shortretreat t34a-nohunt t34b-crowd130 t34c-cube40 t34d-laserall t33e-finish h01-econlegs t11-late-pos t30-endrush t29-early-squeeze; do
  s=${b%%-*}
  node sim/agentW/evalW.mjs --brain sim/variants/$b.mjs --n 48 --seed 1000 --quiet --frozen-clock --stop-on-death --par 2 --pack "$PB" --dump sim/agentW/B_$s.json 2>&1 | head -2
  node sim/agentW/evalW.mjs --brain sim/variants/$b.mjs --n 24 --seed 1000 --quiet --frozen-clock --stop-on-death --par 2 --pack "$PL" --dump sim/agentW/L_$s.json 2>&1 | head -2
done
echo BATCH1 DONE
