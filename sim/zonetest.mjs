// dev: force the zone to close on a chosen point (roof, stadium) and watch one bot follow it.
// node sim/zonetest.mjs <x> <y> [startX startY]
import fs from "node:fs"
import zlib from "node:zlib"
import { World } from "../src/world.mjs"
import { Brain } from "../src/bot.mjs"
import { Sim } from "./sim.mjs"
const world = new World("arena")
const cfg = JSON.parse(zlib.gunzipSync(fs.readFileSync("check/stream.jsonl.gz")).toString().split("\n")[0]).config
const tx = +process.argv[2], ty = +process.argv[3]
class Idle { act() { return {} } }
const bots = [{ label: "mine", make: (h) => new Brain(h, world) }, { label: "idle", make: () => new Idle() }]
const sim = new Sim(world, cfg, 5, bots)
// every next circle is centred on the target
const orig = sim._nextZone.bind(sim)
sim._nextZone = function () { orig(); if (this.cfg.zone.phases[this.phase]) this.zNext.c = [tx, ty] }
sim._nextZone()
const m = sim.mechs[0]
if (process.argv[4]) { const sx = +process.argv[4], sy = +process.argv[5]; m.pos = [sx, sy, world.ground(sx, sy)] }
sim.mechs[1].hp = 1e9; sim.mechs[1].maxHp = 1e9
console.log("target top", world.topZ(tx, ty).toFixed(1), "ground", world.ground(tx, ty).toFixed(1))
let last = -10, outS = 0
while (sim.step() && m.alive) {
  const inz = Math.hypot(m.pos[0] - sim.zc[0], m.pos[1] - sim.zc[1]) <= sim.zr
  if (!inz) outS += 0.1
  if (sim.t - last >= 10 || (sim.t > 330 && sim.t - last >= 5)) { last = sim.t; console.log(`t=${sim.t.toFixed(0)} ${m.bot.mode} pos=${m.pos.map((v) => v.toFixed(0))} hp=${m.hp.toFixed(0)} en=${m.energy.toFixed(0)} zr=${sim.zr.toFixed(0)} dC=${Math.hypot(m.pos[0] - tx, m.pos[1] - ty).toFixed(0)} in=${inz} jet=${m.bot.jet ? m.bot.jet.phase : "-"}`) }
}
console.log("end t", sim.t.toFixed(1), "alive", m.alive, "killedBy", m.killedBy, "seconds outside zone", outS.toFixed(1), "max act ms", sim.maxActMs.toFixed(1))
