// dev: detailed combat trace of one practice match.  node sim/dbg.mjs <seed> <t0> <t1>
import fs from "node:fs"
import zlib from "node:zlib"
import { World } from "../src/world.mjs"
import { Brain } from "../src/bot.mjs"
import { Sim } from "./sim.mjs"
import { Dummy } from "./dummy.mjs"
const world = new World("arena")
const cfg = JSON.parse(zlib.gunzipSync(fs.readFileSync("check/stream.jsonl.gz")).toString().split("\n")[0]).config
const seed = +process.argv[2] || 104, T0 = +process.argv[3] || 0, T1 = +process.argv[4] || 60
const mineSlot = (seed * 7) % 16
const skills = Array(4).fill("easy").concat(Array(4).fill("medium"), Array(4).fill("hard"), Array(3).fill("expert"))
const bots = []
const order = []
const squad = { prey: mineSlot, shared: null, near: 30 }
let k = 0
for (let i = 0; i < 16; i++) {
  if (i === mineSlot) bots.push({ label: "mine", make: (h) => new Brain(h, world) })
  else { const sk = skills[k++]; order.push(i); bots.push({ label: sk, make: (h) => new Dummy(h, world, sk, squad) }) }
}
const sim = new Sim(world, cfg, seed, bots)
squad.count = (t) => { const dead = order.filter((id) => !sim.mechs[id].alive).length; return t > 300 ? 15 : 1 + dead + Math.floor(t / 90) }
squad.active = (id, t) => { const alive = order.filter((q) => sim.mechs[q].alive); return alive.indexOf(id) >= 0 && alive.indexOf(id) < squad.count(t) }
const m = sim.mechs[mineSlot]
let lastHp = m.hp
while (sim.step() && m.alive) {
  if (sim.t < T0 || sim.t > T1) continue
  if (Math.round(sim.t * 10) % 5 !== 0) continue
  const b = m.bot, a = m.action
  const near = sim.mechs.filter((q) => q.alive && q !== m).map((q) => [Math.hypot(q.pos[0] - m.pos[0], q.pos[1] - m.pos[1]), q]).sort((x, y) => x[0] - y[0]).slice(0, 2)
  console.log(`${sim.t.toFixed(1)} ${b.mode}${b.targetId >= 0 ? ">" + b.targetId : ""} hp ${m.hp.toFixed(0)} (${(m.hp - lastHp).toFixed(0)}) en ${m.energy.toFixed(0)} mv ${a.move.map((v) => v.toFixed(1))} ${a.boost ? "B" : ""} fire ${a.fire.map((f) => (f ? 1 : 0)).join("")} ammo ${m.weapons[0].ammo} | ` + near.map(([d, q]) => `#${q.id}${q.label[0]} d${d.toFixed(0)} hp${q.hp.toFixed(0)} los${world.los(m.pos[0], m.pos[1], m.pos[2] + 8, q.pos[0], q.pos[1], q.pos[2] + 4.5) ? 1 : 0} f${(q.action.fire || []).map((f) => (f ? 1 : 0)).join("")}`).join(" ; ") + ` vis ${b.vis.map((e) => e.id + (e.los ? "L" : "")).join(",")}`)
  lastHp = m.hp
}
console.log("end", sim.t.toFixed(1), "alive", m.alive, "killedBy", m.killedBy, "dmg", m.dmgDealt.toFixed(0))
