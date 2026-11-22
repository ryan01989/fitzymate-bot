// Parallel evaluator: one of ours vs the simulated house pack (or free-for-all), many seeds, all cores.
//   node sim/eval.mjs --brain src/bot.mjs --mode practice --n 96 --seed 1 [--par 7] [--pack '{"noise":1.2}']
// --brain starter runs the kit's example bot in our seat. Prints mean points with its standard error.
import fs from "node:fs"
import zlib from "node:zlib"
import path from "node:path"
import os from "node:os"
import { fork } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => {
  const i = process.argv.indexOf("--" + k)
  return i < 0 ? d : (process.argv[i + 1] ?? true)
}
const brainArg = arg("brain", "src/bot.mjs")
const mode = arg("mode", "practice")
const N = +arg("n", 48)
const seed0 = +arg("seed", 1)
const par = +arg("par", Math.max(1, os.cpus().length - 1))
// default pack: calibrated so the starter / v1 / v2 land near their real practice scores (1.15 / 3.42 / 3.75)
// cal2: accurate house shooters (~55% hits, real expert 61%), hunters lose us after 10 s, slower escalation.
// Reproduces the real ordering of our six submissions (v3 farm jump +0.97 vs real +0.83). Absolute level ~1.3 low.
const pack = { noise: 1.5, react: 2, every: 300, perKill: 0.5, share: 10, near: 0, ...JSON.parse(arg("pack", "{}")) }
const quiet = process.argv.includes("--quiet")
// --stop-on-death: end a match the moment our mech dies (its place is already fixed). 2-3x faster.
const stopOnDeath = process.argv.includes("--stop-on-death")
// --frozen-clock: the bot cuts its searches off by wall clock, so the same seed can play differently under CPU load.
// Freezing performance.now() makes every search run to its own cap, so a (brain, params, pack, seed) result is repeatable.
// maxMs is then measured with hrtime. Timing itself is checked separately (check.py, or a run without this flag).
const frozenClock = process.argv.includes("--frozen-clock")

if (process.argv.includes("--worker")) {
  if (frozenClock) {
    const hr = () => Number(process.hrtime.bigint()) / 1e6
    globalThis.__realNow = hr
    performance.now = () => 1e6
  }
  const { World } = await import("../../src/world.mjs")
  const { Sim } = await import("../sim.mjs")
  const { Dummy, setPack } = await import(process.env.DUMMY ? pathToFileURL(path.resolve(process.env.DUMMY)).href : "../dummy.mjs")
  const { Starter } = await import("../starter.mjs")
  setPack(pack)
  const world = new World(path.join(HERE, "../../arena"))
  const cfg = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(HERE, "../../check/stream.jsonl.gz"))).toString().split("\n")[0]).config
  let Mine
  if (brainArg === "starter") Mine = Starter
  else Mine = (await import(pathToFileURL(path.resolve(brainArg)).href)).Brain
  const seeds = JSON.parse(arg("seeds"))
  for (const seed of seeds) {
    const mineSlot = (seed * 7) % 16
    const bots = []
    let squad = null
    if (mode === "practice") {
      const skills = Array(4).fill("easy").concat(Array(4).fill("medium"), Array(4).fill("hard"), Array(3).fill("expert"))
      const order = []
      squad = { prey: mineSlot, shared: null, near: pack.near ?? 30 }
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
    } else {
      const skills = ["easy", "medium", "hard", "expert"]
      for (let i = 0; i < 16; i++) {
        if (i === mineSlot) bots.push({ label: "mine", make: (h) => new Mine(h, world) })
        else {
          const sk = skills[i % 4]
          bots.push({ label: sk, make: (h) => new Dummy(h, world, sk, null) })
        }
      }
    }
    const sim = new Sim(world, cfg, seed, bots)
    // agentT pack knob "tough": scale the damage our mech deals to house mechs (stand-in for real house bots being harder to hit than sim ones)
    if ((pack.tough ?? 1) !== 1) {
      const dmg0 = sim.damage.bind(sim)
      sim.damage = (tg, amount, weapon, by, from) => dmg0(tg, tg && tg.mech && by === mineSlot ? amount * pack.tough : amount, weapon, by, from)
    }
    // pack "ff": 0 = no friendly fire between house bots (real data: they almost never die except to us)
    if (squad && pack.ff === 0) sim.noFF = new Set(squad.order)
    if (squad) {
      const o = squad.order
      const base = pack.base ?? 1,
        perKill = pack.perKill ?? 1,
        every = pack.every ?? 90,
        tAll = pack.tAll ?? 300
      squad.count = (t) => {
        const dead = o.filter((q) => !sim.mechs[q].alive).length
        return t > tAll ? 15 : base + dead * perKill + Math.floor(t / every)
      }
      squad.active = (id, t) => {
        const alive = o.filter((q) => sim.mechs[q].alive)
        const i = alive.indexOf(id)
        return i >= 0 && i < squad.count(t)
      }
    }
    const m = sim.mechs[mineSlot]
    let wallMax = 0
    const killInfo = []
    const trace = []
    const lasInfo = {}
    const farm = { modes: {}, c: {}, boostS: 0, stillS: 0 }
    for (;;) {
      const w0 = frozenClock ? globalThis.__realNow() : 0
      const act0 = squad ? squad.order.filter((q) => sim.mechs[q].alive).map((q) => [q, squad.active(q, sim.t)]) : []
      if (sim.tick === 2) {
        const [sx, sy, sz] = m.pos
        lasInfo.near = [...sim.pickups.values()].filter((p) => p.kind === "laser").map((p) => ({ d: Math.round(Math.hypot(p.pos[0] - sx, p.pos[1] - sy)), dz: Math.round(p.pos[2] - world.ground(p.pos[0], p.pos[1])) })).sort((a, b) => a.d - b.d).slice(0, 4)
      }
      if (lasInfo.t == null && m.weapons.some((q) => q && q.kind === "laser")) lasInfo.t = Math.round(sim.t)
      if (lasInfo.seenT == null && m.bot && m.bot.picks && [...m.bot.picks.values()].some((p) => p.kind === "laser")) lasInfo.seenT = Math.round(sim.t)
      if (sim.t <= 120.01 && m.alive) {
        farm.modes[m.bot.mode] = (farm.modes[m.bot.mode] || 0) + 0.05
        if (m.action && m.action.boost) farm.boostS += 0.05
        if (Math.hypot(m.vel[0], m.vel[1]) < 2) farm.stillS += 0.05
        for (const T of [30, 60, 90, 120]) if (farm.c[T] == null && sim.t >= T) farm.c[T] = m.cubes
      }
      if (m.alive && sim.tick % 20 === 0) {
        const act = squad ? squad.order.filter((q) => sim.mechs[q].alive && squad.active(q, sim.t)) : []
        const near = (L, R) => L.filter((q) => Math.hypot(sim.mechs[q].pos[0] - m.pos[0], sim.mechs[q].pos[1] - m.pos[1]) < R).length
        const alive = squad ? squad.order.filter((q) => sim.mechs[q].alive) : []
        trace.push([Math.round(sim.t), Math.round(m.hp), m.bot.mode, act.length, near(act, 120), near(alive, 120), m.cubes, m.kills, m.weapons.map((q) => q?.kind?.[0] ?? "-").join(""), m.bot.targetId ?? -1, m.pos.map(Math.round), m.bot.loot ? [m.bot.loot.id, (m.bot.loot.pos||[]).map(Math.round), m.bot.loot.kind] : null, m.bot.cubes ? m.bot.cubes.size : -1, m.action ? [m.action.move, m.action.boost, m.action.jump] : null, m.vel.map(v=>Math.round(v*10)/10), m.bot.myNode, m.bot.path ? m.bot.path.length : -1])
      }
      const more = sim.step()
      for (const [q, a] of act0) if (!sim.mechs[q].alive) killInfo.push({ t: Math.round(sim.t), active: a, sk: sim.mechs[q].label, by: sim.mechs[q].killedBy === mineSlot })
      if (frozenClock) wallMax = Math.max(wallMax, globalThis.__realNow() - w0)
      if (!more || (stopOnDeath && !m.alive)) break
    }
    const others = sim.mechs.filter((q) => q !== m)
    const acc = (L) => {
      const f = L.reduce((s, q) => s + (q.gunFires || 0), 0)
      return f ? L.reduce((s, q) => s + (q.gunHits || 0), 0) / f : null
    }
    process.send({
      killInfo, lasInfo, farm, seed, trace, dmgHist: (m.dmgHist || []).map((h) => [Math.round(h[0] * 10) / 10, h[1], Math.round(h[2]), h[3], h[4], typeof h[1] === "number" && h[1] < 16 ? sim.mechs[h[1]].label : "npc"]), place: m.place, pts: 16 - m.place, kills: m.kills, surv: m.deathT ?? sim.t, cubes: m.cubes,
      killedBy: m.alive ? "survived" : typeof m.killedBy === "number" ? sim.mechs[m.killedBy].label : String(m.killedBy),
      w: m.weapons.map((q) => q?.kind ?? "-").join("+"), maxMs: frozenClock ? wallMax : sim.maxActMs, crashes: m.crashed || 0,
      killTs: (m.killTs || []).map((q) => Math.round(q * 10) / 10), endT: Math.round(sim.t * 10) / 10,
      myAcc: acc([m]), packAcc: acc(others), dmg: Math.round(m.dmgDealt),
      npcK: m.npcKills || 0, crateK: m.crateKills || 0, picks: m.cubePicks || 0, c120: m.cubes120 || 0, ups: m.upgrades.length, drops: m.dropsTaken || 0,
      diag: (() => {
        if (m.alive || !m.dmgHist) return null
        const last = m.dmgHist.filter((h) => h[0] > m.deathT - 6)
        const who = new Set(last.map((h) => h[1]))
        // hunters active at death, and how the HP went in the last 20 s
        const hp20 = (m.hpHist || []).filter((h) => h[0] >= m.deathT - 20)
        return { atk: who.size, mode: m.bot.mode, rear: last.filter((h) => h[4]).length / Math.max(1, last.length), firstHpIn20: hp20.length ? Math.round(hp20[0][1] / m.maxHp * 100) : null, t: Math.round(m.deathT), cubes: m.cubes, npc: last.some((h) => h[1] >= 100) }
      })(),
    })
  }
  process.exit(0)
}

// ---------------------------------------------------------------- parent
// --seedlist 1,102,203 runs exactly those seeds (for paired comparisons); otherwise seed0 + i*101.
const seeds = arg("seedlist") ? String(arg("seedlist")).split(",").map(Number) : Array.from({ length: N }, (_, i) => seed0 + i * 101)
const chunks = Array.from({ length: Math.min(par, N) }, () => [])
seeds.forEach((s, i) => chunks[i % chunks.length].push(s))
const results = []
const t0 = Date.now()
await Promise.all(
  chunks.map(
    (ch) =>
      new Promise((res) => {
        const c = fork(fileURLToPath(import.meta.url), [...process.argv.slice(2), "--worker", "--seeds", JSON.stringify(ch)], { stdio: ["ignore", "ignore", "inherit", "ipc"] })
        c.on("message", (r) => {
          results.push(r)
          if (!quiet) process.stderr.write(".")
        })
        c.on("exit", res)
      }),
  ),
)
if (!quiet) process.stderr.write("\n")
const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)
const pts = results.map((r) => r.pts)
const sd = Math.sqrt(mean(pts.map((p) => (p - mean(pts)) ** 2)))
const by = {}
for (const r of results) by[r.killedBy] = (by[r.killedBy] || 0) + 1
const accs = (k) => mean(results.map((r) => r[k]).filter((v) => v != null))
console.log(
  `${path.basename(brainArg)} ${mode} pack=${JSON.stringify(pack)}: pts ${mean(pts).toFixed(2)} ±${(sd / Math.sqrt(pts.length)).toFixed(2)} (n=${pts.length})  kills ${mean(results.map((r) => r.kills)).toFixed(2)}  surv ${mean(results.map((r) => r.surv)).toFixed(0)}s  cubes ${mean(results.map((r) => r.cubes)).toFixed(1)}  wins ${results.filter((r) => r.place === 1).length}  acc me ${accs("myAcc").toFixed(2)} pack ${accs("packAcc").toFixed(2)}  maxMs ${Math.max(...results.map((r) => r.maxMs)).toFixed(1)}  crashes ${results.reduce((s, r) => s + r.crashes, 0)}  ${((Date.now() - t0) / 1000).toFixed(0)}s`,
)
console.log("  deaths:", JSON.stringify(by), ` npcK ${mean(results.map((r) => r.npcK)).toFixed(2)} crates ${mean(results.map((r) => r.crateK)).toFixed(2)} cubePicks ${mean(results.map((r) => r.picks)).toFixed(2)} cubesBy120 ${mean(results.map((r) => r.c120)).toFixed(2)} upgrades ${mean(results.map((r) => r.ups)).toFixed(2)}`)
if (process.argv.includes("--diag")) {
  const D = results.map((r) => r.diag).filter(Boolean)
  const c = (f) => D.filter(f).length
  console.log(`  diag n=${D.length}: atk>=2 ${c((d) => d.atk >= 2)}  atk1 ${c((d) => d.atk === 1)}  rear>30% ${c((d) => d.rear > 0.3)}  npc ${c((d) => d.npc)}  died<60s ${c((d) => d.t < 60)} 60-150 ${c((d) => d.t >= 60 && d.t < 150)} 150+ ${c((d) => d.t >= 150)}`)
  const modes = {}
  D.forEach((d) => (modes[d.mode] = (modes[d.mode] || 0) + 1))
  console.log("  mode at death:", JSON.stringify(modes), " hp% 20s before death (median):", D.map((d) => d.firstHpIn20).sort((a, b) => a - b)[D.length >> 1])
}
if (process.argv.includes("--dump")) fs.writeFileSync(arg("dump"), JSON.stringify(results))
