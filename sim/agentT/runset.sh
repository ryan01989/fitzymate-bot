#!/bin/bash
# usage: runset.sh <tag> <pack-json> <n> <dummy|-> build1 build2 ...   (build = variants file stem)
cd /Users/dylanryan/Desktop/BuildersMech/fitzymate-bot
tag=$1; pack=$2; n=$3; dm=$4; shift 4
for b in "$@"; do
  out=sim/agentT/out/${tag}_$b.json
  if [ ! -f $out ]; then
    if [ "$dm" = "-" ]; then D=""; else D=$dm; fi
    DUMMY=$D node sim/agentT/evalT.mjs --brain sim/variants/$b.mjs --n $n --seed 1000 --quiet --frozen-clock --stop-on-death --par 3 --pack "$pack" --dump $out | head -1
  fi
done
