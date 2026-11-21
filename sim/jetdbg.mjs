import fs from "node:fs"
import zlib from "node:zlib"
import { World } from "../src/world.mjs"
import { Brain } from "../src/bot.mjs"
import { Sim } from "./sim.mjs"
const world = new World("arena")
const cfg = JSON.parse(zlib.gunzipSync(fs.readFileSync("check/stream.jsonl.gz")).toString().split("\n")[0]).config
const tx = +process.argv[4] || 93, ty = +process.argv[5] || -148
class Idle { act() { return {} } }
const sim = new Sim(world, cfg, 5, [{ label: "mine", make: (h) => new Brain(h, world) }, { label: "idle", make: () => new Idle() }])
const orig = sim._nextZone.bind(sim)
sim._nextZone = function () { orig(); if (this.cfg.zone.phases[this.phase]) this.zNext.c = [tx, ty] }
sim._nextZone()
const m = sim.mechs[0]
sim.mechs[1].hp = 1e9; sim.mechs[1].maxHp = 1e9
const T0 = +process.argv[2] || 104, T1 = +process.argv[3] || 112
while (sim.step() && m.alive && sim.t < T1) {
  if (sim.t < T0) continue
  const b = m.bot, a = m.action, w = world
  const p = b.path, i = b.pi
  let info = "nopath"
  if (p) { const n = p[Math.min(i, p.length - 1)], n2 = p[Math.min(i + 1, p.length - 1)]; info = `pi=${i}/${p.length} lk=${b.plink[i]} a=(${w.nodeX(n)},${w.nodeY(n)},${w.surf[n].toFixed(1)}) b=(${w.nodeX(n2)},${w.nodeY(n2)},${w.surf[n2].toFixed(1)}) wdA=${w.wd[n].toFixed(1)} wdB=${w.wd[n2].toFixed(1)}` }
  console.log(`${sim.t.toFixed(1)} ${b.mode} pos=${m.pos.map((v) => v.toFixed(1))} vz=${m.vel[2].toFixed(1)} g=${m.grounded ? 1 : 0} en=${m.energy.toFixed(0)} mv=${a.move.map((v) => v.toFixed(2))} j=${a.jump ? 1 : 0} b=${a.boost ? 1 : 0} jet=${b.jet ? b.jet.phase + ":" + b.jet.fails : "-"} ${info}`)
}
