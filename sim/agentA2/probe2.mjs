// Second-pass instrumented sim run (does not modify the brain). node sim/agentA2/probe2.mjs --brain <file> --seeds a,b --pack '{...}'
import fs from "node:fs"
import zlib from "node:zlib"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "../..")
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : (process.argv[i + 1] ?? true) }
performance.now = () => 1e6
const { World } = await import(path.join(ROOT, "src/world.mjs"))
const { Sim } = await import(path.join(ROOT, "sim/sim.mjs"))
const { Dummy, setPack } = await import(path.join(ROOT, "sim/dummy.mjs"))
const pack = { noise: 1.5, react: 2, every: 300, perKill: 0.5, share: 10, near: 0, ...JSON.parse(arg("pack", '{"noise":4,"react":3,"perKill":0.5,"base":1,"every":150,"retaliate":6,"ff":0,"tAll":330}')) }
setPack(pack)
const world = new World(path.join(ROOT, "arena"))
const cfg = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "check/stream.jsonl.gz"))).toString().split("\n")[0]).config
const Mine = (await import(pathToFileURL(path.resolve(arg("brain", path.join(ROOT, "sim/variants/t36-fixes.mjs")))).href)).Brain
const seeds = String(arg("seeds", "1000")).split(",").map(Number)
const trace = arg("trace") ? String(arg("trace")).split(":").map(Number) : null
const C = {}
const inc = (k, v = 1) => (C[k] = (C[k] || 0) + v)
const res = []
const episodes = []
for (const seed of seeds) {
  const mineSlot = (seed * 7) % 16
  const bots = [], order = []
  const skills = Array(4).fill("easy").concat(Array(4).fill("medium"), Array(4).fill("hard"), Array(3).fill("expert"))
  const squad = { prey: mineSlot, shared: null, near: pack.near ?? 30 }
  let k = 0
  for (let i = 0; i < 16; i++) {
    if (i === mineSlot) bots.push({ label: "mine", make: (h) => new Mine(h, world) })
    else { const sk = skills[k++]; order.push(i); bots.push({ label: sk, make: (h) => new Dummy(h, world, sk, squad) }) }
  }
  squad.order = order
  const sim = new Sim(world, cfg, seed, bots)
  if (pack.ff === 0) sim.noFF = new Set(order)
  const base = pack.base ?? 1, perKill = pack.perKill ?? 1, every = pack.every ?? 90, tAll = pack.tAll ?? 300
  squad.count = (t) => { const dead = order.filter((q) => !sim.mechs[q].alive).length; return t > tAll ? 15 : base + dead * perKill + Math.floor(t / every) }
  squad.active = (id, t) => { const alive = order.filter((q) => sim.mechs[q].alive); const i = alive.indexOf(id); return i >= 0 && i < squad.count(t) }
  const m = sim.mechs[mineSlot], b = m.bot
  let farmT = null
  const daf = b.doAimFire.bind(b)
  b.doAimFire = (A) => { farmT = b.farmTarget; return daf(A) }
  const last = { takenMech: -99, takenNpc: -99, takenZone: -99, dealtMechFight: -99, dealtMechOther: -99, dealtNpc: -99, dealtCrate: -99 }
  let ep = null, prevMode = b.mode, standSince = null
  for (;;) {
    const more = sim.step()
    const t = sim.t
    if (!m.alive || !more) break
    const a = m.action || {}
    inc("decisions")
    // events of this observation
    for (const ev of b.o.events || []) {
      if (ev.type === "damaged") {
        if (ev.by == null) last.takenZone = t
        else if (ev.by >= 100) last.takenNpc = t
        else { last.takenMech = t; inc("dmg taken from mechs", ev.amount); inc("dmg taken in mode " + b.mode, ev.amount); if (ev.rear) { inc("dmg taken from mechs with rear x1.5", ev.amount); inc("rear dmg in mode " + b.mode, ev.amount) } }
      } else if (ev.type === "hit") {
        if (ev.target < 100) { if (b.mode === "fight") last.dealtMechFight = t; else { last.dealtMechOther = t; inc("hits on a mech outside fight mode, mode " + b.mode) } }
        else if (ev.target < 1000) last.dealtNpc = t
        else last.dealtCrate = t
      }
    }
    // regeneration accounting (real rule: taken, dealt-to-mech and dealt-to-drone restart the timer; crate hits do not)
    const rd = b.regenDelay
    if (m.hp < m.maxHp - 1 && b.inZone) {
      inc("hurt decisions (inside zone)")
      const cand = [["taking mech damage", last.takenMech], ["taking drone damage", last.takenNpc], ["our hit on a mech in fight mode", last.dealtMechFight], ["our hit on a mech outside fight mode", last.dealtMechOther], ["our hit on a drone", last.dealtNpc], ["zone damage", last.takenZone]].filter((c) => t - c[1] < rd)
      if (!cand.length) inc("hurt: regenerating (5 s clean)")
      else {
        cand.sort((x, y) => y[1] - x[1])
        const only = cand.length === 1 ? cand[0][0] : null
        inc("hurt: regen blocked")
        if (only) inc("hurt: regen blocked ONLY by " + only + " (mode " + b.mode + ")")
        const taken = t - Math.max(last.takenMech, last.takenNpc, last.takenZone) < rd
        if (!taken) inc("hurt: regen blocked only by our own hits (nobody hit us for the delay)")
      }
    }
    // retreat episodes
    if (b.mode === "retreat" && !ep) ep = { seed, t0: t, hp0: m.hp, dealt: 0, taken: 0, fired: 0, hidden: 0, n: 0 }
    if (ep) {
      if (b.mode !== "retreat") { ep.dur = t - ep.t0; ep.dhp = m.hp - ep.hp0; ep.next = b.mode; episodes.push(ep); ep = null }
      else {
        ep.n++
        for (const ev of b.o.events || []) { if (ev.type === "hit" && ev.target < 100) ep.dealt += ev.amount; if (ev.type === "damaged" && ev.by != null && ev.by < 100) ep.taken += ev.amount }
        if (a.fire && (a.fire[0] || a.fire[1])) ep.fired++
        if (!b.vis.some((e) => e.los)) ep.hidden++
      }
    }
    // standing in loot mode on a walk-onto target
    if (b.mode === "loot" && b.loot && (b.loot.type === "cube" || b.loot.type === "pick")) {
      inc("loot decisions (cube/pick)")
      const mv = Math.hypot(...(a.move || [0, 0]))
      if (mv < 0.05) {
        const key = b.loot.id === -7 ? "kill spot (-7)" : b.loot.id < -99 ? "cubeRun" : b.loot.type
        inc("loot decisions standing still on: " + key)
        if (standSince == null) standSince = t
      } else { if (standSince != null && t - standSince > 2) { inc("stand-still episodes > 2 s in loot"); (C._stand ??= []).push(`${seed}@${standSince.toFixed(1)}-${t.toFixed(1)}`) } standSince = null }
    } else { if (standSince != null && t - standSince > 2) { inc("stand-still episodes > 2 s in loot"); (C._stand ??= []).push(`${seed}@${standSince.toFixed(1)}-${t.toFixed(1)}`) } standSince = null }
    // laser release classification
    const las = b.laser
    if (las && las.charge > 0 && a.fire && !a.fire[b.slotOf.laser]) {
      inc("laser releases")
      const tg = b.aimTarget
      if (farmT) inc("laser release at a crate/drone (deliberate)")
      else if (b.vis.some((e) => e.los)) { if (tg && tg.los) inc("laser release at the target in LOS"); else inc("laser release with a mech in LOS (not aimTarget)") }
      else { inc("laser release BLIND (no mech in LOS, no farm target) in mode " + b.mode); inc("laser release BLIND total") }
    }
    if (trace && seed === trace[0] && t >= trace[1] && t <= trace[2]) {
      const near = sim.mechs.filter((q) => q.alive && q !== m).map((q) => [Math.hypot(q.pos[0] - m.pos[0], q.pos[1] - m.pos[1]), q]).sort((x, y) => x[0] - y[0]).slice(0, 3)
      console.log(`${t.toFixed(1)} ${b.mode}${b.targetId >= 0 ? ">" + b.targetId : ""} hp ${m.hp.toFixed(0)} atk ${b.attackers(3).map((e) => e.id + (e.los ? "L" : e.phantom ? "p" : "-")).join(",")} cov ${b.cover ? b.cover.node : "-"} mv ${(a.move || [0, 0]).map((v) => v.toFixed(1))}${a.boost ? "B" : ""} aim ${a.aim[0].toFixed(2)} fire ${(a.fire || []).map((f) => (f ? 1 : 0)).join("")} pos ${m.pos[0].toFixed(0)},${m.pos[1].toFixed(0)} | ` + near.map(([d, q]) => `#${q.id} d${d.toFixed(0)} hp${q.hp.toFixed(0)}`).join(" ; ") + ` vis ${b.vis.map((e) => e.id + (e.los ? "L" : "")).join(",")}`)
    }
    prevMode = b.mode
  }
  res.push({ seed, pts: 16 - m.place, surv: +(m.deathT ?? sim.t).toFixed(1), kills: m.kills, cubes: m.cubes, crashes: m.crashed || 0 })
}
console.log(JSON.stringify({ n: seeds.length, pts: +(res.reduce((s, r) => s + r.pts, 0) / res.length).toFixed(2), surv: +(res.reduce((s, r) => s + r.surv, 0) / res.length).toFixed(0), crashes: res.reduce((s, r) => s + r.crashes, 0) }))
for (const k of Object.keys(C).filter((k) => !k.startsWith("_")).sort()) console.log("  " + k.padEnd(84), Math.round(C[k]))
for (const k of Object.keys(C).filter((k) => k.startsWith("_"))) console.log(k, C[k].slice(0, 14))
if (episodes.length) {
  const E = episodes, mean = (f) => (E.reduce((s, e) => s + f(e), 0) / E.length)
  console.log(`retreat episodes ${E.length}: mean ${mean((e) => e.dur).toFixed(1)} s, mean HP change ${mean((e) => e.dhp).toFixed(0)}, with our hits on a mech during it ${E.filter((e) => e.dealt > 0).length}, fired at all ${E.filter((e) => e.fired > 0).length}, mean share of decisions with no mech in LOS ${(100 * mean((e) => e.hidden / Math.max(1, e.n))).toFixed(0)}%, HP gained > 0 in ${E.filter((e) => e.dhp > 0).length}, lasting < 1 s ${E.filter((e) => e.dur < 1).length}, next mode: ${JSON.stringify(E.reduce((o, e) => ((o[e.next] = (o[e.next] || 0) + 1), o), {}))}`)
}
