// timeline of practice matches: node sim/agentC/tl.mjs <brain> <seed0> <n>
import fs from "node:fs"
import zlib from "node:zlib"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { World } from "../../src/world.mjs"
import { Sim } from "../sim.mjs"
import { Dummy, setPack } from "../dummy.mjs"
setPack({ noise: 4, near: 0, every: 150, react: 2 })
const { Brain } = await import(pathToFileURL(path.resolve(process.argv[2])).href)
const world = new World("arena")
const cfg = JSON.parse(zlib.gunzipSync(fs.readFileSync("check/stream.jsonl.gz")).toString().split("\n")[0]).config
const seed0 = +process.argv[3] || 1, N = +process.argv[4] || 10
for (let i = 0; i < N; i++) {
  const seed = seed0 + i * 101
  const mineSlot = (seed * 7) % 16
  const skills = Array(4).fill("easy").concat(Array(4).fill("medium"), Array(4).fill("hard"), Array(3).fill("expert"))
  const bots = [], order = []
  const squad = { prey: mineSlot, shared: null, near: 0 }
  let k = 0
  for (let j = 0; j < 16; j++) {
    if (j === mineSlot) bots.push({ label: "mine", make: (h) => new Brain(h, world) })
    else { const sk = skills[k++]; order.push(j); bots.push({ label: sk, make: (h) => new Dummy(h, world, sk, squad) }) }
  }
  const sim = new Sim(world, cfg, seed, bots)
  squad.count = (t) => { const dead = order.filter((id) => !sim.mechs[id].alive).length; return t > 300 ? 15 : 1 + dead + Math.floor(t / 150) }
  squad.active = (id, t) => { const alive = order.filter((q) => sim.mechs[q].alive); return alive.indexOf(id) >= 0 && alive.indexOf(id) < squad.count(t) }
  const m = sim.mechs[mineSlot]
  const alive = new Set(order)
  const ev = []
  let stale = 0, steps = 0
  const modeT = {}
  while (sim.step()) {
    steps++
    if (!squad.shared || sim.t - squad.shared.t > 20) stale++
    modeT[m.bot.mode] = (modeT[m.bot.mode] || 0) + 1
    for (const id of [...alive]) if (!sim.mechs[id].alive) { alive.delete(id); const q = sim.mechs[id]; ev.push(`${sim.t.toFixed(0)}:K${q.label[0]}${q.killedBy === mineSlot ? "" : "(" + q.killedBy + ")"}@${Math.round(m.hp)}/${Math.round(m.maxHp)}`) }
    if (!m.alive) break
  }
  const last = (m.dmgHist || []).filter((h) => h[0] > (m.deathT ?? 0) - 6)
  console.log(`seed ${seed} pts ${16 - m.place} surv ${(m.deathT ?? sim.t).toFixed(0)} by ${typeof m.killedBy === "number" ? sim.mechs[m.killedBy].label : m.killedBy} atk ${new Set(last.map((h) => h[1])).size} mode ${m.bot.mode} cubes ${m.cubes} stale ${(stale/steps*100).toFixed(0)}% modes ${Object.entries(modeT).map(([k,v])=>k+(v/steps*100).toFixed(0)).join(",")} | ${ev.join(" ")}`)
}
