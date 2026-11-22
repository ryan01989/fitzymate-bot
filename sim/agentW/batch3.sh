#!/bin/zsh
cd /Users/dylanryan/Desktop/BuildersMech/fitzymate-bot
PB='{"noise":4,"react":3,"perKill":0.5,"base":1,"every":150,"retaliate":6,"ff":0,"tAll":330}'
PL='{"base":0,"every":100000,"perKill":0,"tAll":240,"retaliate":0,"ff":0,"near":0}'
PS='{"noise":7,"react":4,"perKill":0.5,"base":1,"every":150,"retaliate":6,"ff":0,"tAll":240}'
T22='"huntFrom":90,"huntUntil":420,"seekUntil":420,"fightCube":55'
T32='"huntFrom":90,"huntUntil":420,"seekUntil":420,"fightCube":55,"fightPick":70,"weave":0.6,"weaveAll":1,"cubeHit":1,"upSet":6'
run() { FM_P="{$4}" node sim/agentW/evalW.mjs --brain sim/variants/rad8.mjs --n $3 --seed 1000 --quiet --frozen-clock --stop-on-death --par 2 --pack "$2" --dump sim/agentW/$1.json 2>&1 | head -1 | sed "s/^/$1: /" }
runb() { node sim/agentW/evalW.mjs --brain sim/variants/$4.mjs --n $3 --seed 1000 --quiet --frozen-clock --stop-on-death --par 2 --pack "$2" --dump sim/agentW/$1.json 2>&1 | head -1 | sed "s/^/$1: /" }
runb B_w01 "$PB" 48 w01-bigrange
runb L_w01 "$PL" 24 w01-bigrange
runb B_w02 "$PB" 48 w02-cubecap
runb L_w02 "$PL" 24 w02-cubecap
runb B_t32r "$PB" 48 t32-stack-pick
runb L_t32r "$PL" 24 t32-stack-pick
run C_weave "$PB" 48 "$T22,\"weave\":0.6,\"weaveAll\":1"
run C_cubehit "$PB" 48 "$T22,\"cubeHit\":1"
run C_upset "$PB" 48 "$T22,\"upSet\":6"
runb S_t32 "$PS" 48 t32-stack-pick
runb S_w01 "$PS" 48 w01-bigrange
runb S_w02 "$PS" 48 w02-cubecap
run S_fc80 "$PS" 48 "$T32,\"fightCube\":80"
run S_cr180 "$PS" 48 "$T32,\"cubeRun\":180,\"cubeRunS\":30"
echo BATCH3 DONE
