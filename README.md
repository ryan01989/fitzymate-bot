# FitzyMate — Mech Royale bot

A `mechfight/1` bot for the Builders Buildathon Mech Royale track. Plain JavaScript on Node 22, no dependencies. This folder is the repository root to submit: the `Dockerfile` is at the top level.

## Layout

| Path | What it is |
| --- | --- |
| `main.mjs` | Protocol runner: JSON lines on stdin/stdout, newest-observation rule, JIT warm-up before `ready`, fallback if the brain throws. |
| `src/world.mjs` | Map model built from `/arena`: 1 m collision raster, ray casts (line of sight, shot clearance), two-layer 2 m nav graph (ground + roofs/bridge decks) with jet and drop links, weighted A* and bounded Dijkstra. |
| `src/vanguard.mjs` | The brain `main.mjs` runs: Vanguard, a fight-first brain (below). Settings are in `P` at the top. |
| `src/bot.mjs` | The earlier brain (memory of mechs/items/sounds, zone planning, fight / retreat / loot / hold decisions, aiming, dodging), kept for the simulator and as the source of the fallback `SimpleBrain`. |
| `Dockerfile` | Submission image (`node:22.17.1-bookworm-slim`, pinned). |
| `check/`, `mechfight.schema.json`, `arena/` | Copied from the official kit: conformance check, schema, map. |
| `sim/` | Local test tools (not in the image): an approximate game simulator, stand-in opponents, match runner. |

## Test

```sh
# protocol conformance, no Docker
python3 check/check.py --schema mechfight.schema.json --map-dir arena -- node main.mjs

# the way the scorer runs it (amd64, sandbox flags)
docker build --platform linux/amd64 -t fitzymate .
python3 check/check.py --schema mechfight.schema.json --map-dir /arena -- \
  docker run --rm -i --platform linux/amd64 --network none --cpus 1 --memory 512m --read-only \
  --tmpfs /tmp:rw,size=64m --user 65534:65534 -v "$PWD/arena:/arena:ro" fitzymate
```

On macOS, Docker Desktop may refuse to mount a folder under `~/Desktop`. Either add the folder under Docker Desktop → Settings → Resources → File sharing, or mount a copy of `arena/` from somewhere it can read (for example `/tmp`).

## Submit

1. Create a **public** GitHub repository from this folder (Dockerfile at the top).
2. Push, then submit the repository URL on the Mech Royale track page.
3. Limits: 20 MB at the submitted commit (this folder is about 2 MB), 10-minute build, 4 submissions an hour.

## How Vanguard plays

- **Who to fight.** Any mech within 60 m, one that hit us in the last 6 s, one closing in within 180 m, one under 40% HP within 160 m, or one aiming at us within 190 m. Among those, prefer the near, the weak, the one already being fought, and the one hurting us.
- **Where to stand.** Every tick, scores 16 spots 6 m around it (and standing still): distance from the preferred range (110 m with a laser, 90 m with the gun), a sight line to the target only when a weapon is ready (and none while the target charges a laser at us), a penalty for each other mech that could see the spot, and the zone. Closes to about 20 m on a target under 38% HP.
- **Bullets.** Sidesteps any bullet that will pass within reach in the next 0.7 s, boosting when it has the energy.
- **Breaking off.** Only while plainly losing (two mechs near and under 55% HP, three and under 80%, or under 35% against a healthier target), and only for a short pulse; otherwise it stays in the fight.
- **Weapons.** Laser first: walks up to 240 m to a known laser when calm. Takes a better second weapon within 110 m even mid-fight, and never leaves the second slot empty. Laser: charges to full and releases on target, releases early when the partial shot kills, keeps a charge through a brief loss of sight, and never starts one while running.
- **Cubes and drops.** Picks up cubes mid-fight within 40 m and up to 120 m when calm, stops at the 10-cube stat cap. Takes supply drops nobody else is near.
- **Practice or free-for-all.** Mechs dying that it did not kill mean a free-for-all: it then fights only attackers, very close mechs and nearly dead ones.

## How the earlier brain (`src/bot.mjs`) plays

The rules come from the team's showdown analysis (placement only; most deaths are early, to first shots, crossfires and fights started level).

- **Opening and positioning.** Picks a hold spot inside the *next* circle, toward its outer part, scored for cover, distance from every known mech and drone, and broken line of sight. Parks there silently and sweeps only the open sector. Rotates early; never plans to take zone damage.
- **Starting fights.** Only with the first shot and an edge: target under 60% HP, target busy with someone else, HP share 30+ points ahead, a laser against a mech without one from behind, or a mech that is plainly coming for it. Never when 10+ HP points or 5+ cubes behind, or with another mech within 110 m.
- **Being shot.** Faces the attacker (rear armor). Answers only when not out-gunned or behind; otherwise breaks line of sight.
- **During a fight.** Holds about 105–112 m, where gun bullets can be side-stepped; picks each step from candidate moves by the miss distance to bullets already in the air. Tracks the damage race (time-to-kill over time-to-die) and leaves when losing it, or below 50% HP without a lead. Steps behind a corner to reload.
- **Retreat.** Bounded search for the nearest spot hidden from every recent threat, weighted toward distance; keeps moving while a pursuer closes; regenerates; turns to fight only when running is not working against one or two pursuers.
- **Weapons and upgrades.** Keeps the gun; laser first, lightning until a laser turns up, never mortar. Upgrades: plating, armor, laser charge/damage, nanites, then gun.
- **Loot.** Only when quiet: lasers, cubes up to the stat cap, crates and lone drones, supply drops with nobody near.
- **Endgame.** Follows a small final circle onto a roof or into the stadium with jump jets if that is where it closes.

## Tuning

`P` in `src/bot.mjs`: `hideHp`, `resumeHp`, `initHpLow`, `initAdv`, `vetoAdv`, `vetoCubes`, `crowd`, `openingS`, `farm`, `calmS`, `zoneMarginFrac`, `silentNear`. Set `farm: false` for a purely passive bot.

## Local simulator

Add `--vanguard` to run Vanguard in our seat (practice mode).

```sh
node sim/run.mjs --mode practice --n 20 --seed 3   # one of ours vs a 15-bot hunting pack
node sim/run.mjs --mode ffa --n 20 --seed 3        # one of ours vs 15 free-for-all stand-ins
node sim/run.mjs --mode mirror --n 3               # 16 copies of this bot
node sim/run.mjs --mode duel:hard --n 16           # 1v1 against one stand-in (easy|medium|hard|expert)
node sim/zonetest.mjs -276 128                     # force the zone to close on a point (here: the stadium field)
```

Add `--starter` to run the kit's example bot in our seat, `--trace` for a 5-second log.

The simulator is our own approximation of `protocol.md`, **not** the real server: mortars are not simulated, tree canopy is ignored, movement and collisions are simplified, and the opponents are our guesses. Its pack is harsher than the real house bots (the kit's starter bot scores about 0.3 in it against a published 1.15), so use it to compare two versions of this bot and to catch crashes and stuck states, not to predict a leaderboard score.
