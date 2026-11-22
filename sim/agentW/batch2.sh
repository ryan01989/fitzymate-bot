#!/bin/zsh
cd /Users/dylanryan/Desktop/BuildersMech/fitzymate-bot
while ! grep -q "BATCH1 DONE" sim/agentW/batch1.log; do sleep 5; done
PB='{"noise":4,"react":3,"perKill":0.5,"base":1,"every":150,"retaliate":6,"ff":0,"tAll":330}'
PS='{"noise":7,"react":4,"perKill":0.5,"base":1,"every":150,"retaliate":6,"ff":0,"tAll":240}'
T22='"huntFrom":90,"huntUntil":420,"seekUntil":420,"fightCube":55'
T32='"huntFrom":90,"huntUntil":420,"seekUntil":420,"fightCube":55,"fightPick":70,"weave":0.6,"weaveAll":1,"cubeHit":1,"upSet":6'
run() { # tag pack n fmP
  FM_P="{$4}" node sim/agentW/evalW.mjs --brain sim/variants/rad8.mjs --n $3 --seed 1000 --quiet --frozen-clock --stop-on-death --par 2 --pack "$2" --dump sim/agentW/$1.json 2>&1 | head -1 | sed "s/^/$1: /"
}
run C_base "$PB" 48 "$T22"
run C_weave "$PB" 48 "$T22,\"weave\":0.6,\"weaveAll\":1"
run C_cubehit "$PB" 48 "$T22,\"cubeHit\":1"
run C_upset "$PB" 48 "$T22,\"upSet\":6"
run S_base "$PS" 48 "$T22"
run S_weave "$PS" 48 "$T22,\"weave\":0.6,\"weaveAll\":1"
run S_cubehit "$PS" 48 "$T22,\"cubeHit\":1"
run S_upset "$PS" 48 "$T22,\"upSet\":6"
run S_t32 "$PS" 48 "$T32"
run S_cap "$PS" 48 "$T32,\"fightCubeCap\":1"
run S_t33a "$PS" 48 "$T32,\"fightCube\":80,\"cubeRun\":180,\"cubeRunS\":30"
run S_fc80 "$PS" 48 "$T32,\"fightCube\":80"
run S_cr180 "$PS" 48 "$T32,\"cubeRun\":180,\"cubeRunS\":30"
run S_las240 "$PS" 48 "$T32,\"laserFirst\":240"
run S_crowd "$PS" 48 "$T32,\"crowd\":130"
run S_fs "$PS" 48 "$T32,\"firstShot\":0.5"
run S_nohunt "$PS" 48 "$T32,\"huntUntil\":0,\"seekUntil\":0"
echo BATCH2 DONE
