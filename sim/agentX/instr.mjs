// Instrumented brain: wraps the brain file in $XB (default t36-fixes) and records per-mode time, stillness, damage taken (rear share)
// and a few internal events; each worker process appends its totals to $XOUT (jsonl) on exit.
import fs from "node:fs"
const src = process.env.XB || new URL("../variants/t36-fixes.mjs", import.meta.url).href
const mod = await import(src.startsWith("file:") ? src : new URL(src, "file://" + process.cwd() + "/").href)
export const P = mod.P
const T = { modes: {}, still: {}, dmg: {}, rear: {}, n: 0, coverNull: 0, coverCalls: 0, extra: {} }
globalThis.__XT = T
const add = (o, k, v) => (o[k] = (o[k] || 0) + v)
process.on("exit", () => {
  if (process.env.XOUT) fs.appendFileSync(process.env.XOUT, JSON.stringify(T) + "\n")
})
export class Brain extends mod.Brain {
  constructor(h, w) {
    super(h, w)
    T.n++
  }
  findCover(th) {
    const c = super.findCover(th)
    T.coverCalls++
    if (!c) T.coverNull++
    return c
  }
  act(o) {
    const A = super.act(o)
    const t = o.t
    if (t > (+process.env.XT1 || 240)) return A
    const m = this.mode
    add(T.modes, m, 0.1)
    const v = Math.hypot(o.self.vel[0], o.self.vel[1])
    if (v < 1) add(T.still, m, 0.1)
    if (A.boost) add(T.extra, "boost_" + m, 0.1)
    if (m === "loot" && this.loot && this.loot.type === "npc") {
      const n = this.npcs.get(this.loot.id)
      add(T.extra, "npcLoot", 0.1)
      if (n && t - n.t > 0.3) add(T.extra, "npcLootRemembered", 0.1)
    }
    if (m === "fight") add(T.extra, "eFight", o.self.energy * 0.1)
    for (const e of o.events || []) if (e.type === "damaged" && e.by != null && e.by < 100) {
      add(T.dmg, m, e.amount)
      if (e.rear) add(T.rear, m, e.amount)
    }
    // drones: farm-list expiry (t - n.t crosses 6 s) and whether the same drone is listed again later
    this._xd ??= new Map()
    for (const n of this.npcs.values()) {
      const age = t - n.t
      if (age >= 6 && !this._xd.has(n.id)) { this._xd.set(n.id, t); T.extra.droneExpire = (T.extra.droneExpire || 0) + 1 }
      if (age < 0.01 && this._xd.has(n.id)) { T.extra.droneRelist = (T.extra.droneRelist || 0) + 1; add(T.extra, "relistGap", t - this._xd.get(n.id)); this._xd.delete(n.id) }
    }
    // own lateral speed (perpendicular to the shot) when the gun fires at a mech
    if (this.gun && A.fire && A.fire[this.slotOf.gun] && this.aimTarget && this.aimTarget.los) {
      const e = this.aimTarget, dx = e.pos[0] - o.self.pos[0], dy = e.pos[1] - o.self.pos[1], d = Math.hypot(dx, dy) || 1
      const lat = Math.abs(-o.self.vel[0] * dy + o.self.vel[1] * dx) / d
      add(T.extra, "fireN", 1); add(T.extra, "fireLat", lat); if (lat > 8) add(T.extra, "fireLat8", 1)
    }
    return A
  }
}
export const SimpleBrain = mod.SimpleBrain
export const P_FFA = mod.P_FFA
