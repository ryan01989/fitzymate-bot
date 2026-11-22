// gd-policy: how often each lesson acted. node sim/agentG/fires.mjs <brain.mjs> <nSeeds> [seed0]  (pack B, frozen clock, stop on death)
import fs from "node:fs"
import zlib from "node:zlib"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
performance.now = () => 1e6
const HERE = path.dirname(fileURLToPath(import.meta.url))
const { World } = await import("../../src/world.mjs")
const { Sim } = await import("../sim.mjs")
const { Dummy, setPack } = await import("../dummy.mjs")
const pack = { noise: 4, react: 3, perKill: 0.5, base: 1, every: 150, retaliate: 6, ff: 0, tAll: 330, share: 10, near: 0 }
setPack(pack)
const world = new World(path.join(HERE, "../../arena"))
const cfg = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(HERE, "../../check/stream.jsonl.gz"))).toString().split("\n")[0]).config
const Mine = (await import(pathToFileURL(path.resolve(process.argv[2])).href)).Brain
const N = +process.argv[3] || 6, s0 = +process.argv[4] || 1000
const tot = {}, modeT = {}
let fightStarts = 0, retreatEntries = 0, retreatTime = 0
const exits = {}, durs = []
let rStart = 0
for (let i = 0; i < N; i++) {
  const seed = s0 + i * 101
  const mineSlot = (seed * 7) % 16
  const skills = Array(4).fill("easy").concat(Array(4).fill("medium"), Array(4).fill("hard"), Array(3).fill("expert"))
  const order = [], bots = []
  const squad = { prey: mineSlot, shared: null, near: pack.near }
  let k = 0
  for (let j = 0; j < 16; j++) {
    if (j === mineSlot) bots.push({ label: "mine", make: (h) => new Mine(h, world) })
    else { const sk = skills[k++]; order.push(j); bots.push({ label: sk, make: (h) => new Dummy(h, world, sk, squad) }) }
  }
  squad.order = order
  const sim = new Sim(world, cfg, seed, bots)
  sim.noFF = new Set(order)
  squad.count = (t) => (t > pack.tAll ? 15 : pack.base + order.filter((q) => !sim.mechs[q].alive).length * pack.perKill + Math.floor(t / pack.every))
  squad.active = (id, t) => { const a = order.filter((q) => sim.mechs[q].alive); const x = a.indexOf(id); return x >= 0 && x < squad.count(t) }
  const m = sim.mechs[mineSlot]
  let lastMode = null, lastTgt = -1
  while (sim.step() && m.alive) {
    const b = m.bot
    if (!b) continue
    modeT[b.mode] = (modeT[b.mode] || 0) + 1
    if (b.mode === "fight" && (lastMode !== "fight" || b.targetId !== lastTgt)) fightStarts++
    if (b.mode === "retreat" && lastMode !== "retreat") { retreatEntries++; rStart = sim.t }
    if (b.mode !== "retreat" && lastMode === "retreat") { exits[b.mode] = (exits[b.mode] || 0) + 1; durs.push(sim.t - rStart) }
    lastMode = b.mode; lastTgt = b.targetId
  }
  for (const [kk, v] of Object.entries(m.bot.gst || {})) tot[kk] = (tot[kk] || 0) + v
  console.log(seed, "pts", 16 - m.place, "surv", (m.deathT ?? sim.t).toFixed(0), JSON.stringify(m.bot.gst))
}
const all = Object.values(modeT).reduce((a, b) => a + b, 0)
console.log("total", JSON.stringify(tot), "fightStarts/match", (fightStarts / N).toFixed(1), "retreatEntries/match", (retreatEntries / N).toFixed(1))
durs.sort((a, b) => a - b)
console.log("retreat exits to:", JSON.stringify(exits), "durations s: median", (durs[durs.length >> 1] ?? 0).toFixed(1), "p90", (durs[Math.floor(durs.length * 0.9)] ?? 0).toFixed(1), "n", durs.length)
console.log("mode share:", Object.entries(modeT).map(([k, v]) => k + " " + ((100 * v) / all).toFixed(1) + "%").join(", "))
