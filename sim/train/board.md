# Training board

Updated 11/21/2026, 9:21:31 PM · round 11 · reward = mean(16 − place) − 2 × share dead before 90 s

## Current best

`sim/train/cand/rush.mjs` with `{"cubeRun":130,"laserFirst":90,"noRetreat":true,"rushUntil":120}`

| Pack | Seeds | Fitness | Raw points | Dead < 90 s | Kills by 90 s | by 180 s | n |
|---|---|---|---|---|---|---|---|
| `{"noise":2,"perKill":1,"retaliate":0}` | train | 2.79 | 4.13 ±0.30 | 67% | 3.08 | 3.83 | 48 |
| `{"noise":2,"perKill":1,"retaliate":0}` | held-out | 2.79 | 3.90 ±0.21 | 55% | 2.69 | 3.52 | 96 |
| `{"every":120,"noise":2.5,"perKill":1,"retaliate":0}` | held-out | 2.80 | 4.01 ±0.20 | 60% | 2.85 | 3.68 | 96 |

## Promotions

| Round | Change | Fitness gain (held-out) | Lower bound | Raw points |
|---|---|---|---|---|
| 1 | opening-grab | +0.70 | +0.32 | +0.58 |
| 5 | combo | +0.70 | +0.36 | +0.52 |

## Real practice scores

| Build | Real | Sim predicted | Note |
|---|---|---|---|
| starter | 1.15 |  | kit example bot |
| v1 | 3.42 |  |  |
| v2 | 3.75 |  |  |
| v3-farm | 4.58 |  | best so far |
| v4-merge | 4.48 |  |  |
| farm-all | 4.4 |  |  |
| v5-peek | 4.15 |  |  |
| probe-idle90 | 1.58 |  | v3-farm kills by 90 s |
| probe-idle180 | 3.58 |  | v3-farm kills by 180 s |
| probe-pacifist | 0.17 |  | never shoots |
| ctrl | 4.33 |  | exact replicate of v3-farm (4.58): real run-to-run difference 0.25 |
| t01-laser-first | 4.96 | +0.58 vs v3-farm (192 held-out matches, both packs positive) | runs 4.96 and 4.85; best real build |
| exp-hunt100 | pending | -0.13 vs v3-farm (16 seeds, no signal) | not submitted yet |
| t01-laser-first (run 2) | 4.85 |  | rerun of the same build; two-run mean 4.905 vs 4.455 for v3-farm |
| t02-one-front | 4.73 | +0.46 vs t01-laser-first (192 held-out matches, both packs positive) | sim predicted +0.46 over t01; real is 0.18 below the t01 two-run mean |
| t03-combo | 4.71 | +0.52 vs t01-laser-first (192 held-out matches, both packs positive) | sim predicted +0.52 over t01; real is 0.20 below the t01 two-run mean |
| t04-no-retreat | 5 | sim -0.32 pts on 192 held-out matches (the +0.44 on 16 seeds did not hold); strategic probe | NEW BEST. Corrected sim predicted -0.32; real +0.10 vs t01 mean. Sim wrong on direction. |
| t05-drop-heal | 4.88 | sim cannot judge: never triggers before the sim bot dies; strategic probe | no effect vs t01 mean 4.905 |
| t07-cube-run | pending | sim 0.00 on 48 seeds |  |
| t08-nr-cubes | 4.98 | sim -0.81 on 16 seeds; sim was wrong on noRetreat | same as t04-no-retreat (5.00): cube run adds nothing on top of no-retreat; sim predicted -0.81 vs t01 |
| t09-rush | 5.28 | sim: 3.63 vs 3.69 base on 16 fresh seeds (flat); +0.6 cubes by 120 s | NEW BEST: +0.28 over t04-no-retreat (5.00). Sim said flat (3.63 vs 3.69). |

## Last round (11)

| Stage | Change | Fitness vs best | ± | Raw points | n |
|---|---|---|---|---|---|
| C | rush150 | +0.01 | 0.012 | +0.01 | 192 |
| B | rush150 | +0.04 | 0.042 | +0.04 | 48 |
| B | gun140 | -0.13 | 0.212 | -0.08 | 48 |
| A | rush150 | +0.00 | 0 | +0.00 | 32 |
| A | gun140 | -0.13 | 0.29 | -0.13 | 32 |
| A | gun160 | -0.28 | 0.157 | -0.22 | 32 |
| A | rush-veto | -0.41 | 0.359 | -0.72 | 32 |
