// Run local test matches.  node sim/run.mjs --mode practice|ffa|mirror --n 10 --seed 1 [--trace]
import fs from "node:fs"
import zlib from "node:zlib"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { World } from "../src/world.mjs"
import { Brain } from "../src/bot.mjs"
import { Sim } from "./sim.mjs"
import { Dummy } from "./dummy.mjs"
import { Starter } from "./starter.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => {
  const i = process.argv.indexOf("--" + k)
  return i < 0 ? d : process.argv[i + 1] ?? true
}
const mode = arg("mode", "practice")
const N = +arg("n", 5)
const seed0 = +arg("seed", 1)
const trace = process.argv.includes("--trace")
const Mine = process.argv.includes("--starter") ? Starter : Brain
const world = new World(path.join(HERE, "../arena"))
const hello = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(HERE, "../check/stream.jsonl.gz"))).toString().split("\n")[0])
const cfg = hello.config

const totals = { pts: 0, n: 0, wins: 0 }
const causes = {}
let maxMs = 0
const t00 = performance.now()
for (let g = 0; g < N; g++) {
  const seed = seed0 + g * 101
  const bots = []
  const mineSlot = (seed * 7) % 16
  let squad = null
  if (mode === "practice") {
    const order = []
    squad = { prey: mineSlot, shared: null, active: (id, t) => order.indexOf(id) < squad.count(t) }
    const skills = [..."eeee"].map(() => "easy").concat(Array(4).fill("medium"), Array(4).fill("hard"), Array(3).fill("expert"))
    let k = 0
    for (let i = 0; i < 16; i++) {
      if (i === mineSlot) bots.push({ label: "mine", make: (h) => new Mine(h, world) })
      else {
        const sk = skills[k++]
        order.push(i)
        bots.push({ label: sk, make: (h) => new Dummy(h, world, sk, squad) })
      }
    }
    squad.order = order
  } else if (mode.startsWith("duel")) {
    // one hunter of a given skill against us
    const sk = mode.split(":")[1] || "medium"
    squad = { prey: 0, shared: null, active: () => true, count: () => 1, order: [1] }
    bots.push({ label: "mine", make: (h) => new Brain(h, world) })
    bots.push({ label: sk, make: (h) => new Dummy(h, world, sk, squad) })
  } else if (mode === "mirror") {
    for (let i = 0; i < 16; i++) bots.push({ label: "mine", make: (h) => new Brain(h, world) })
  } else {
    const skills = ["easy", "medium", "hard", "expert"]
    for (let i = 0; i < 16; i++) {
      if (i === mineSlot || (mode === "ffa4" && i % 4 === mineSlot % 4)) bots.push({ label: "mine", make: (h) => new Brain(h, world) })
      else {
        const sk = skills[i % 4]
        bots.push({ label: sk, make: (h) => new Dummy(h, world, sk, null) })
      }
    }
  }
  const sim = new Sim(world, cfg, seed, bots)
  if (squad && !mode.startsWith("duel")) {
    // weakest first: one hunter early, more as the pack thins, all of them late
    squad.count = (t) => {
      const alive = squad.order.filter((id) => sim.mechs[id].alive)
      squad.order = alive.concat(squad.order.filter((id) => !sim.mechs[id].alive))
      const dead = 15 - alive.length
      return t > 300 ? 15 : 1 + dead + Math.floor(t / 90)
    }
    const o = squad.order
    squad.active = (id, t) => {
      const alive = o.filter((q) => sim.mechs[q].alive)
      return alive.indexOf(id) >= 0 && alive.indexOf(id) < squad.count(t)
    }
  }
  let lastLog = -10
  while (sim.step()) {
    if (trace && sim.t - lastLog >= 5) {
      lastLog = sim.t
      for (const m of sim.mechs)
        if (m.label === "mine" && m.alive && (mode !== "mirror" || m.id === 0))
          console.log(`t=${sim.t.toFixed(0)} #${m.id} ${m.bot.mode}${m.bot.targetId >= 0 ? "->" + m.bot.targetId : ""} hp=${m.hp.toFixed(0)}/${m.maxHp.toFixed(0)} pos=${m.pos.map((v) => v.toFixed(0))} cubes=${m.cubes} w=${m.weapons.map((q) => q?.kind ?? "-")} ${m.bot.mode === "loot" && m.bot.loot ? "loot=" + m.bot.loot.type + ":" + m.bot.loot.id + "@" + m.bot.loot.pos.map((v) => v.toFixed(0)) : ""} alive=${sim.alive} zone=${sim.zr.toFixed(0)} in=${hyp(m.pos, sim.zc) <= sim.zr}`)
    }
  }
  const mine = sim.mechs.filter((m) => m.label === "mine")
  for (const m of mine) {
    totals.pts += 16 - m.place
    totals.n++
    if (m.place === 1) totals.wins++
    const cause = m.alive ? "survived" : typeof m.killedBy === "number" ? "mech:" + sim.mechs[m.killedBy].label : String(m.killedBy)
    causes[cause] = (causes[cause] || 0) + 1
  }
  maxMs = Math.max(maxMs, sim.maxActMs)
  const m0 = mine[0]
  for (const m of mine) {
    if (m.alive || !m.dmgHist) continue
    const last = m.dmgHist.filter((h) => h[0] > m.deathT - 6)
    const who = [...new Set(last.map((h) => h[1]))]
    m.diag = ` atk6s=${who.length}[${who.map((id) => (id < 100 ? sim.mechs[id].label[0] + id : "npc")).join(",")}] rear=${Math.round((100 * last.filter((h) => h[4]).length) / Math.max(1, last.length))}% wpn=${[...new Set(last.map((h) => h[3]))].join("/")} mode=${m.bot.mode}`
  }
  const line = mine.length <= 2 ? mine.map((m) => `place ${m.place}${m.diag || ""} t=${(m.deathT ?? sim.t).toFixed(0)} by=${m.killedBy} kills=${m.kills} cubes=${m.cubes} dmg=${m.dmgDealt.toFixed(0)} w=${m.weapons.map((q) => q?.kind ?? "-")} up=${m.upgrades.join("+")}`).join(" | ") : `places ${mine.map((m) => m.place).sort((a, b) => a - b).join(",")}`
  console.log(`seed ${seed} end=${sim.t.toFixed(0)}s ${line}  act avg ${(sim.sumActMs / Math.max(1, sim.nAct)).toFixed(2)}ms max ${sim.maxActMs.toFixed(1)}ms crashes=${mine.reduce((s, m) => s + (m.crashed || 0), 0)}`)
}
function hyp(p, c) {
  return Math.hypot(p[0] - c[0], p[1] - c[1])
}
console.log(`\n${mode}: mean points ${(totals.pts / totals.n).toFixed(2)} over ${totals.n} runs, wins ${totals.wins}, max act ${maxMs.toFixed(1)}ms, wall ${((performance.now() - t00) / 1000).toFixed(1)}s`)
console.log("deaths:", JSON.stringify(causes))
