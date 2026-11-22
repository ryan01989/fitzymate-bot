// prints mode-gating info for my bot each second
import fs from "node:fs"
import zlib from "node:zlib"
import { World } from "../../src/world.mjs"
const { Brain } = await import("./bot.mjs")
import { Sim } from "../sim.mjs"
import { Dummy, setPack } from "../dummy.mjs"
setPack({ noise: 4, react: 2 })
const world = new World("arena")
const cfg = JSON.parse(zlib.gunzipSync(fs.readFileSync("check/stream.jsonl.gz")).toString().split("\n")[0]).config
const seed = +process.argv[2] || 104, T0 = +process.argv[3] || 0, T1 = +process.argv[4] || 60
const mineSlot = (seed * 7) % 16
const skills = Array(4).fill("easy").concat(Array(4).fill("medium"), Array(4).fill("hard"), Array(3).fill("expert"))
const bots = [], order = []
const squad = { prey: mineSlot, shared: null, near: 0 }
let k = 0
for (let i = 0; i < 16; i++) {
  if (i === mineSlot) bots.push({ label: "mine", make: (h) => new Brain(h, world) })
  else { const sk = skills[k++]; order.push(i); bots.push({ label: sk, make: (h) => new Dummy(h, world, sk, squad) }) }
}
const sim = new Sim(world, cfg, seed, bots)
squad.count = (t) => { const dead = order.filter((id) => !sim.mechs[id].alive).length; return t > 300 ? 15 : 1 + dead + Math.floor(t / 150) }
squad.active = (id, t) => { const alive = order.filter((q) => sim.mechs[q].alive); return alive.indexOf(id) >= 0 && alive.indexOf(id) < squad.count(t) }
const m = sim.mechs[mineSlot]
let last = -1
while (sim.step() && m.alive && sim.t < T1) {
  if (sim.t < T0 || Math.floor(sim.t) === last) continue
  last = Math.floor(sim.t)
  const b = m.bot
  console.log(`${sim.t.toFixed(0)} ${b.mode} c${m.cubes} k${m.kills} hp${Math.round(b.hpS*100)} pos ${m.pos.map(v=>v.toFixed(0))} slack ${b.zoneSlack?.toFixed(0)} dNext ${b.dNext?.toFixed(0)} inZ ${b.inZone} lmd ${(sim.t-b.lastMechDmgT).toFixed(0)} goal ${b.exploreGoal?b.exploreGoal.slice(0,2).map(v=>v.toFixed(0)):"-"} loot ${b.loot?b.loot.type+b.loot.id:"-"} crates ${b.crates.size} npcs ${b.npcs.size} cubes ${b.cubes.size} picks ${b.picks.size} drops ${(b.o.drops||[]).map(d=>Math.round(Math.hypot(d.pos[0]-m.pos[0],d.pos[1]-m.pos[1]))+"@"+d.lands_in+"h"+d.holder).join(",")} vis ${b.vis.map(e=>e.id+(e.los?"L":"")+Math.round(e.dist)).join(",")}`)
}
