// mechfight/1 runner: JSON lines on stdin/stdout, logs on stderr.
import path from "node:path"
import { fileURLToPath } from "node:url"
import { World } from "./src/world.mjs"
import { SimpleBrain } from "./src/bot.mjs"
import { Brain } from "./src/vanguard.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const log = (...a) => console.error(...a)
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n")

let brain = null
let simple = null
let last = {}
let errors = 0
let slow = 0

function start(hello) {
  simple = new SimpleBrain(hello)
  let world = null
  const dirs = [hello.map?.dir, "/arena", path.join(HERE, "arena")].filter(Boolean)
  for (const d of dirs) {
    try {
      world = new World(d)
      break
    } catch (e) {
      log(`map load failed from ${d}: ${e?.message}`)
    }
  }
  try {
    if (world) warmUp(hello, world)
  } catch (e) {
    log("warm-up failed (harmless):", e?.message)
  }
  try {
    brain = world ? new Brain(hello, world) : null
  } catch (e) {
    log("brain init failed:", e)
    brain = null
  }
  send({ type: "ready", name: "FitzyMate" })
}

/**
 * Drive a throwaway brain through synthetic situations before `ready`, so the JIT has compiled the
 * hot paths (path search, ray casts, cover search, aiming) before the 50 ms clock starts.
 */
function warmUp(hello, world) {
  const cfg = hello.config
  const t0 = performance.now()
  const b = new Brain(hello, world)
  const zc = cfg.zone.start_center
  const ph = cfg.zone.phases[0]
  const gun = { kind: "gun", cooldown: 0, ammo: cfg.weapons.gun.mag, reload: 0, stats: { ...cfg.weapons.gun } }
  const laser = { kind: "laser", cooldown: 0, charge: 0, stats: { ...cfg.weapons.laser } }
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  let pos = null
  // a slow start already ate into the 20 s hello budget: keep the warm-up short there
  const budget = performance.now() > 5000 ? 400 : 2000
  for (let i = 0; i < 400 && performance.now() - t0 < budget; i++) {
    if (i % 40 === 0) {
      const a = rnd() * 6.283,
        r = rnd() * cfg.zone.start_radius * 0.7
      const n = world.nearestNode(zc[0] + Math.cos(a) * r, zc[1] + Math.sin(a) * r, 0, 3.2, 9.5, 40)
      if (n < 0) continue
      pos = [world.nodeX(n), world.nodeY(n), world.nodeZ(n)]
    }
    if (!pos) continue
    const t = i * 0.1
    const phase = (i / 40) | 0
    const ex = pos[0] + 60 + 30 * Math.sin(t),
      ey = pos[1] + 40 * Math.cos(t)
    const enemy = { id: (slotOther(hello.slot) + phase) % 16, kind: "mech", pos: [ex, ey, world.ground(ex, ey)], vel: [5, -3, 0], aim: [3.1, 0], hp: phase % 3 === 0 ? 500 : 1400, max_hp: 1400, cubes: 0, weapons: ["gun"], charging: false }
    const obs = {
      type: "obs", tick: i * 2, t, alive: 16,
      self: { id: hello.slot, pos: pos.slice(), vel: [0, 0, 0], aim: [0, 0], hp: phase % 4 === 1 ? 500 : 1400, max_hp: 1400, energy: 100, max_energy: 100, grounded: true, cubes: 0, upgrades: [], weapons: [{ ...gun }, phase % 2 ? { ...laser } : null], in_zone: true, stats: { ...cfg.mech } },
      mechs: phase % 5 === 4 ? [] : [enemy],
      projectiles: phase % 2 ? [{ id: 1, kind: "gun", pos: [ex - 10, ey, enemy.pos[2] + 7], vel: [-240, -60, -5] }] : [],
      crates: [], cubes: [], pickups: [], sounds: [], beams: [],
      events: phase % 3 === 1 && i % 5 === 0 ? [{ type: "damaged", amount: 45, weapon: "gun", bearing: 0.5, by: enemy.id }] : [],
      drops: [],
      zone: { center: zc, radius: cfg.zone.start_radius, next_center: zc, next_radius: ph.radius, shrink_start: ph.hold_s, shrink_end: ph.hold_s + ph.shrink_s, dps: ph.dps },
      offer: null,
    }
    const a = b.act(obs)
    // walk the fake mech along its own command so paths get followed
    if (a && a.move) {
      const nx = pos[0] + a.move[0] * 1.1,
        ny = pos[1] + a.move[1] * 1.1
      if (world.nodeAt(nx, ny, pos[2], 2.5) >= 0) pos = [nx, ny, world.standZ(nx, ny, pos[2])]
    }
  }
  world.banned.clear()
  log(`warm-up ${(performance.now() - t0).toFixed(0)} ms`)
}
const slotOther = (s) => (s + 1) % 16

function decide(obs) {
  let action
  const t0 = performance.now()
  try {
    action = (brain || simple).act(obs)
    last = { move: action.move, aim: action.aim, boost: action.boost }
  } catch (e) {
    errors++
    if (errors <= 5 || errors % 200 === 0) log(`act() failed at tick ${obs.tick} (${errors} so far):`, e)
    try {
      action = simple.act(obs)
    } catch {
      action = { ...last }
    }
  }
  const ms = performance.now() - t0
  if (ms > 35 && ++slow <= 10) log(`slow tick ${obs.tick}: ${ms.toFixed(1)} ms`)
  action.tick = obs.tick
  send(action)
}

let buf = ""
let queued = false
function flush() {
  queued = false
  const lines = buf.split("\n")
  buf = lines.pop() ?? ""
  let latest = null
  for (const line of lines) {
    if (!line.trim()) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (msg.type === "hello") start(msg)
    else if (msg.type === "obs") latest = msg
    else if (msg.type === "end") process.exit(0)
  }
  // a backlog collapses to the newest observation
  if (latest) decide(latest)
}
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buf += chunk
  if (queued) return
  queued = true
  setImmediate(flush)
})
process.stdin.on("end", () => {
  buf += "\n"
  flush()
  process.exit(0)
})
