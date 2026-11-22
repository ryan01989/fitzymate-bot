# FitzyMate — Mech Royale bot

A `mechfight/1` bot for the Builders Buildathon Mech Royale track. Plain JavaScript on Node 22, no dependencies. This folder is the repository root to submit: the `Dockerfile` is at the top level.

## Layout

| Path | What it is |
| --- | --- |
| `main.mjs` | Protocol runner: JSON lines on stdin/stdout, newest-observation rule, JIT warm-up before `ready`, fallback if the brain throws. |
| `src/world.mjs` | Map model built from `/arena`: 1 m collision raster, ray casts (line of sight, shot clearance), two-layer 2 m nav graph (ground + roofs/bridge decks) with jet and drop links, weighted A* and bounded Dijkstra. |
| `src/bot.mjs` | The brain: memory of mechs/items/sounds, zone planning, fight / retreat / loot / hold decisions, aiming, dodging. Tunables are in `P` at the top. |
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

## How it plays

The rules come from the team's showdown analysis (placement only; most deaths are early, to first shots, crossfires and fights started level).

- **Opening and positioning.** Picks a hold spot inside the *next* circle, toward its outer part, scored for cover, distance from every known mech and drone, and broken line of sight. Parks there silently and sweeps only the open sector. Rotates early; never plans to take zone damage.
- **Starting fights.** Only with the first shot and an edge: target under 60% HP, target busy with someone else, HP share 30+ points ahead, a laser against a mech without one from behind, or a mech that is plainly coming for it. Never when 10+ HP points or 5+ cubes behind, or with another mech within 110 m.
- **Being shot.** Faces the attacker (rear armor). Answers only when not out-gunned or behind; otherwise breaks line of sight.
- **During a fight.** Holds about 105–112 m, where gun bullets can be side-stepped; picks each step from candidate moves by the miss distance to bullets already in the air. When no walking step clears the bullets in the air, sprints whichever step does (boost dodge). Closes to about 20 m on a target under 38% HP while healthy and facing at most two attackers, so it cannot slip away to regenerate (finish rush). Tracks the damage race (time-to-kill over time-to-die) and leaves when losing it, or below 50% HP without a lead. Steps behind a corner to reload.
- **Retreat.** Bounded search for the nearest spot hidden from every recent threat, weighted toward distance; keeps moving while a pursuer closes; regenerates; turns to fight only when running is not working against one or two pursuers.
- **Weapons and upgrades.** Keeps the gun; laser first, lightning until a laser turns up, never mortar. Upgrades: plating, armor, laser charge/damage, nanites, then gun.
- **Loot.** Only when quiet: lasers, cubes up to the stat cap, crates and lone drones, supply drops with nobody near.
- **Endgame.** Follows a small final circle onto a roof or into the stadium with jump jets if that is where it closes.

## Tuning

`P` in `src/bot.mjs`: `hideHp`, `resumeHp`, `initHpLow`, `initAdv`, `vetoAdv`, `vetoCubes`, `crowd`, `openingS`, `farm`, `calmS`, `zoneMarginFrac`, `silentNear`, `dodgeBoost` (energy needed for a boost dodge, 0 = off), `finishRush` / `finishRushMe` / `finishRushR` (finish-rush thresholds and range, 0 = off), `hostileS` (open fights only on mechs that are after us; off, it lost in the simulator). Set `farm: false` for a purely passive bot.

## Local simulator

```sh
node sim/run.mjs --mode practice --n 20 --seed 3   # one of ours vs a 15-bot hunting pack
node sim/run.mjs --mode ffa --n 20 --seed 3        # one of ours vs 15 free-for-all stand-ins
node sim/run.mjs --mode mirror --n 3               # 16 copies of this bot
node sim/run.mjs --mode duel:hard --n 16           # 1v1 against one stand-in (easy|medium|hard|expert)
node sim/zonetest.mjs -276 128                     # force the zone to close on a point (here: the stadium field)
```

Add `--starter` to run the kit's example bot in our seat, `--trace` for a 5-second log.

The simulator is our own approximation of `protocol.md`, **not** the real server: mortars are not simulated, tree canopy is ignored, movement and collisions are simplified, and the opponents are our guesses. Its pack is harsher than the real house bots (the kit's starter bot scores about 0.3 in it against a published 1.15), so use it to compare two versions of this bot and to catch crashes and stuck states, not to predict a leaderboard score.
