// Instrumented sim run: node sim/agentA2/probe.mjs --brain <file> --seeds 1000,1101 --pack '{...}' [--frozen] [--trace seed:t0:t1]
// Counts conditions the audit cares about. Does not change the brain: it wraps methods from outside.
import fs from "node:fs"
import zlib from "node:zlib"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "../..")
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : (process.argv[i + 1] ?? true) }
const frozen = process.argv.includes("--frozen")
const hr = () => Number(process.hrtime.bigint()) / 1e6
if (frozen) performance.now = () => 1e6
const slow = +arg("slow", 1) // CPU slowdown factor emulation: deadline budget divided by this (real clock only)
const { World } = await import(path.join(ROOT, "src/world.mjs"))
const { Sim } = await import(path.join(ROOT, "sim/sim.mjs"))
const { Dummy, setPack } = await import(path.join(ROOT, "sim/dummy.mjs"))
const pack = { noise: 1.5, react: 2, every: 300, perKill: 0.5, share: 10, near: 0, ...JSON.parse(arg("pack", '{"noise":4,"react":3,"perKill":0.5,"base":1,"every":150,"retaliate":6,"ff":0,"tAll":330}')) }
setPack(pack)
const world = new World(path.join(ROOT, "arena"))
const cfg = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "check/stream.jsonl.gz"))).toString().split("\n")[0]).config
const mod = await import(pathToFileURL(path.resolve(arg("brain", path.join(ROOT, "sim/variants/t32-stack-pick.mjs")))).href)
const Mine = mod.Brain
const seeds = String(arg("seeds", "1000")).split(",").map(Number)
const trace = arg("trace") ? String(arg("trace")).split(":").map(Number) : null
const C = {} // counters
const inc = (k, v = 1) => (C[k] = (C[k] || 0) + v)
const ms = []
const trans = {}
const res = []
for (const seed of seeds) {
  const mineSlot = (seed * 7) % 16
  const bots = []
  const skills = Array(4).fill("easy").concat(Array(4).fill("medium"), Array(4).fill("hard"), Array(3).fill("expert"))
  const order = []
  const squad = { prey: mineSlot, shared: null, near: pack.near ?? 30 }
  let k = 0
  let B = null
  for (let i = 0; i < 16; i++) {
    if (i === mineSlot) bots.push({ label: "mine", make: (h) => (B = new Mine(h, world)) })
    else { const sk = skills[k++]; order.push(i); bots.push({ label: sk, make: (h) => new Dummy(h, world, sk, squad) }) }
  }
  squad.order = order
  const sim = new Sim(world, cfg, seed, bots)
  if (pack.ff === 0) sim.noFF = new Set(order)
  const base = pack.base ?? 1, perKill = pack.perKill ?? 1, every = pack.every ?? 90, tAll = pack.tAll ?? 300
  squad.count = (t) => { const dead = order.filter((q) => !sim.mechs[q].alive).length; return t > tAll ? 15 : base + dead * perKill + Math.floor(t / every) }
  squad.active = (id, t) => { const alive = order.filter((q) => sim.mechs[q].alive); const i = alive.indexOf(id); return i >= 0 && i < squad.count(t) }
  const m = sim.mechs[mineSlot]
  const b = m.bot
  // --- wraps
  const fc = b.findCover.bind(b)
  b.findCover = (th) => { const t0 = hr(); const r = fc(th); inc("findCover calls"); if (!r) inc("findCover -> null"); if (!frozen && performance.now() > b.deadline) inc("findCover ended past the deadline"); if (!r && !frozen && performance.now() > b.deadline) inc("findCover null AND past deadline"); return r }
  const ws = world.search.bind(world)
  let prevMode = b.mode, prevT = -1, lastTgt = null, flipLog = [], wasCharging = false
  let pend = null
  for (;;) {
    const act0 = b.act.bind(b)
    const w0 = hr()
    const more = sim.step()
    const t = sim.t
    if (!m.alive) break
    if (!more) break
    // act time of our bot measured inside sim (maxActMs is cumulative max); measure via prof
    const a = m.action || {}
    inc("ticks")
    inc("mode:" + b.mode)
    if (b.mode !== prevMode) {
      const k2 = prevMode + ">" + b.mode
      trans[k2] = (trans[k2] || 0) + 1
      flipLog.push([t, prevMode, b.mode])
      while (flipLog.length && flipLog[0][0] < t - 3) flipLog.shift()
      if (flipLog.length >= 6) inc("ticks with >=6 mode changes in the last 3 s")
    }
    while (flipLog.length && flipLog[0][0] < t - 3) flipLog.shift()
    if (flipLog.length >= 4) {
      const set = [...new Set(flipLog.flatMap((f) => [f[1], f[2]]))].sort().join("/")
      inc("dither ticks (>=4 mode changes in the last 3 s): " + set)
      inc("dither ticks total")
      if (!C["_dseed" + seed]) { C["_dseed" + seed] = 1; (C._dither ??= []).push(`${seed}@${t.toFixed(1)} ${set}`) }
    }
    // zone<->retreat ping-pong
    if ((prevMode === "zone" && b.mode === "retreat") || (prevMode === "retreat" && b.mode === "zone")) inc("zone<->retreat switches")
    // weak target dropped
    if (prevMode === "fight" && lastTgt != null && b.mode !== "fight") {
      const e = b.en.get(lastTgt)
      if (e && e.cur && e.los && e.hpS < 0.2 && b.hpS > 0.5) { inc("left a fight with target <20% HP in LOS while >50% HP"); (C._drops ??= []).push(`${seed}@${t.toFixed(1)} ->${b.mode} tgt hp ${(e.hpS * 100).toFixed(0)}% d ${e.dist.toFixed(0)} me ${(b.hpS * 100).toFixed(0)}% atk ${b.attackers(3).length} zoneUrg ${b.zoneUrgent} kc ${!!b.kcRun}`) }
    }
    // laser release classification
    const las = b.laser
    if (las) {
      const ls = b.slotOf.laser
      if (las.charge > 0 && a.fire && !a.fire[ls]) {
        inc("laser releases")
        const tg = b.aimTarget
        const anyLos = b.vis.some((e) => e.los)
        if (!anyLos) inc("laser released with no mech in LOS at all")
        else if (b.mode === "fight" && tg && !tg.los) inc("laser released in fight with the target out of LOS")
        if (las.charge < (las.stats.charge ?? 0.75) - 0.051) {
          inc("laser released before full charge")
          const why = !anyLos ? "no mech in LOS" : !(tg && tg.los) ? "aimTarget not in LOS (mode " + b.mode + ")" : "target in LOS (mode " + b.mode + ")"
          inc("  early release: " + why)
          if (las.charge < (las.stats.min_charge ?? 0.15) + 0.06) inc("  early release at <= 0.2 s of charge (35-40% damage)")
          ;(C._early ??= []).push(`${seed}@${t.toFixed(1)} ${b.mode} chg ${las.charge} tgt ${tg ? tg.id + (tg.los ? "L" : "-") + " d" + tg.dist.toFixed(0) : "none"} short ${t < b.shortUntil ? 1 : 0}`)
        }
      }
      wasCharging = las.charge > 0 || (a.fire && a.fire[ls] && (las.cooldown || 0) <= 0.11)
      wasCharging = las.charge > 0
    } else wasCharging = false
    // NPC pecks
    if (t - b.lastNpcDmgT < 2.5) {
      inc("ticks within 2.5 s of NPC damage")
      const mechTarget = b.vis.some((e) => e.los && (e === b.aimTarget || t - e.hitMeT < 2.5))
      if (!mechTarget && !b.pestNpc()) { inc("...with no mech to shoot and pestNpc() == null (drone unanswered)"); inc("unanswered in mode " + b.mode) }
    }
    if (b.myNode < 0) inc("ticks myNode < 0")
    if (b.escape) inc("ticks in escape")
    if (t < b.unstuckUntil) inc("ticks in unstick")
    if (b.ffa && !b._ffaSeen) { b._ffaSeen = true; inc("FFA flips"); (C._ffa ??= []).push(`${seed}@${t.toFixed(1)} alive ${sim.alive} myKills ${b.myKills || 0}`) }
    if (b.prof) { const tot = b.prof.ingest + b.prof.decide + (b.prof.modeMs || 0) + (b.prof.tail || 0); ms.push(tot); if (tot > 16) inc("act > 16 ms"); if (tot > 30) inc("act > 30 ms") }
    if (trace && seed === trace[0] && t >= trace[1] && t <= trace[2]) {
      const near = sim.mechs.filter((q) => q.alive && q !== m).map((q) => [Math.hypot(q.pos[0] - m.pos[0], q.pos[1] - m.pos[1]), q]).sort((x, y) => x[0] - y[0]).slice(0, 3)
      console.log(`${t.toFixed(1)} ${b.mode}${b.targetId >= 0 ? ">" + b.targetId : ""} hp ${m.hp.toFixed(0)} en ${m.energy.toFixed(0)} inZ ${b.inZone ? 1 : 0} slack ${b.zoneSlack === Infinity ? "inf" : b.zoneSlack.toFixed(1)} dNext ${b.dNext.toFixed(0)} atk ${b.attackers(3).length} cov ${b.cover ? 1 : 0} kc ${b.kcRun ? 1 : 0} mv ${(a.move || [0, 0]).map((v) => v.toFixed(1))}${a.boost ? "B" : ""} fire ${(a.fire || []).map((f) => (f ? 1 : 0)).join("")} | ` + near.map(([d, q]) => `#${q.id}${q.label[0]} d${d.toFixed(0)} hp${q.hp.toFixed(0)}`).join(" ; ") + ` vis ${b.vis.map((e) => e.id + (e.los ? "L" : "")).join(",")}`)
    }
    prevMode = b.mode
    lastTgt = b.mode === "fight" ? b.targetId : null
  }
  res.push({ seed, pts: 16 - m.place, surv: +(m.deathT ?? sim.t).toFixed(1), kills: m.kills, cubes: m.cubes, crashes: m.crashed || 0, ffa: !!b.ffa, maxMs: +sim.maxActMs.toFixed(1) })
}
ms.sort((a, b) => a - b)
const pc = (p) => ms[Math.min(ms.length - 1, (ms.length * p) | 0)]?.toFixed(1)
const out = { n: seeds.length, pts: +(res.reduce((s, r) => s + r.pts, 0) / res.length).toFixed(2), crashes: res.reduce((s, r) => s + r.crashes, 0), maxMs: Math.max(...res.map((r) => r.maxMs)), actMs: { p50: pc(0.5), p99: pc(0.99), p999: pc(0.999), max: ms[ms.length - 1]?.toFixed(1) } }
console.log(JSON.stringify(out))
const lists = Object.keys(C).filter((k) => k.startsWith("_"))
for (const k of Object.keys(C).filter((k) => !k.startsWith("_")).sort()) console.log("  " + k.padEnd(70), C[k])
for (const k of lists) if (Array.isArray(C[k])) console.log(k, C[k].slice(0, 12))
console.log("transitions", JSON.stringify(Object.fromEntries(Object.entries(trans).sort((a, b) => b[1] - a[1]).slice(0, 24))))
if (arg("dump")) fs.writeFileSync(arg("dump"), JSON.stringify(res))
