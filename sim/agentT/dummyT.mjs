// Stand-in opponents for the local sim: simple hunters with a skill dial.
// squad = { prey, shared:{pos,t}, active(id,t) } makes them a house-bot style pack; null = free-for-all.
const PI = Math.PI
const TAU = 2 * PI
const hyp = Math.hypot
const angNorm = (a) => {
  a %= TAU
  if (a > PI) a -= TAU
  else if (a < -PI) a += TAU
  return a
}
// Pack knobs for calibration: aim noise scale, reaction scale, boosting while chasing, strafe scale.
export let PACK = { noise: 1, react: 1, boost: 0, strafe: 1, range: 1 }
export function setPack(p) {
  PACK = { ...PACK, ...(p || {}) }
}
export const SKILLS = {
  easy: { noise: 0.05, strafe: 0, range: 45, react: 0.6, lead: 0.5 },
  medium: { noise: 0.025, strafe: 0.6, range: 55, react: 0.3, lead: 0.9 },
  hard: { noise: 0.012, strafe: 1, range: 65, react: 0.15, lead: 1 },
  expert: { noise: 0.006, strafe: 1, range: 75, react: 0.1, lead: 1 },
}

export class Dummy {
  constructor(hello, world, skill, squad) {
    this.w = world
    this.cfg = hello.config
    const b = SKILLS[skill]
    this.sk = { ...b, noise: b.noise * PACK.noise, react: b.react * PACK.react, strafe: Math.max(PACK.strafeMin ?? 0, Math.min(1, b.strafe * PACK.strafe)), range: b.range * PACK.range }
    this.skill = skill
    this.squad = squad
    this.id = hello.slot
    let s = hello.seed >>> 0 || 1
    this.rand = () => {
      s = (s + 0x6d2b79f5) | 0
      let t = Math.imul(s ^ (s >>> 15), 1 | s)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    this.path = null
    this.pi = 0
    this.planT = -99
    this.goalKey = ""
    this.side = 1
    this.flipT = 0
    this.seenT = -99
    this.wander = null
    this.hitBy = new Map()
  }
  goto(A, me, gx, gy, t) {
    const w = this.w
    const [x, y, z] = me.pos
    const key = `${Math.round(gx / 8)},${Math.round(gy / 8)}`
    if (!this.path || key !== this.goalKey || t - this.planT > 4) {
      const s = w.nearestNode(x, y, z, 3.2, 9.6)
      const g = w.nearestNode(gx, gy, w.ground(gx, gy), 3.2, 9.6, 20)
      this.path = s >= 0 && g >= 0 ? w.search(s, g, { reqR: 3.2 + 0.05 * me.cubes * 2.5, myH: 9.5 * (1 + 0.05 * me.cubes), allowJet: false, maxExp: 30000 }) : null
      this.pi = 0
      this.planT = t
      this.goalKey = key
    }
    const p = this.path
    if (!p) {
      const d = hyp(gx - x, gy - y) || 1
      A.move = [(gx - x) / d, (gy - y) / d]
      return
    }
    let bi = this.pi,
      bd = 1e9
    for (let k = this.pi; k < Math.min(p.length, this.pi + 8); k++) {
      const d = hyp(w.nodeX(p[k]) - x, w.nodeY(p[k]) - y)
      if (d < bd) {
        bd = d
        bi = k
      }
    }
    this.pi = bi
    let tgt = Math.min(p.length - 1, bi + 6)
    while (tgt > bi + 1 && !w.walkLine(x, y, z, w.nodeX(p[tgt]), w.nodeY(p[tgt]), 2.9, 9)) tgt--
    const dx = w.nodeX(p[tgt]) - x,
      dy = w.nodeY(p[tgt]) - y,
      d = hyp(dx, dy)
    if (d > 0.5) A.move = [dx / d, dy / d]
  }
  act(o) {
    const me = o.self
    const t = o.t
    const [x, y, z] = me.pos
    const sk = this.sk
    const A = { move: [0, 0], aim: [me.aim[0], 0], fire: [false, false], boost: false }
    if (o.offer) A.pick = 0
    for (const ev of o.events) if (ev.type === "damaged" && ev.by != null) this.hitBy.set(ev.by, t)
    // target
    let tgt = null
    const mechs = o.mechs.filter((m) => m.kind === "mech")
    if (this.squad) {
      const prey = mechs.find((m) => m.id === this.squad.prey)
      if (prey) this.squad.shared = { pos: prey.pos, t }
      const active = this.squad.active(this.id, t)
      // agentT knob "aware": an idle house bot that sees us within this many m engages like a hunter (real bystanders shoot)
      if (prey && (active || t - (this.hitBy.get(prey.id) ?? -99) < (PACK.retaliate ?? 6) || hyp(prey.pos[0] - x, prey.pos[1] - y) < Math.max(this.squad.near ?? 30, PACK.aware ?? 0))) tgt = prey
      this.huntGoal = active && this.squad.shared && t - this.squad.shared.t < (PACK.share ?? 20) ? this.squad.shared.pos : null
    } else {
      let bd = 190
      for (const m of mechs) {
        const d = hyp(m.pos[0] - x, m.pos[1] - y)
        if (d < bd) {
          bd = d
          tgt = m
        }
      }
      this.huntGoal = null
    }
    // pickups
    for (const p of o.pickups) {
      if (p.kind === "mortar") continue
      if (me.weapons.some((q) => q && q.kind === p.kind)) continue
      const d = hyp(p.pos[0] - x, p.pos[1] - y)
      if (d < 3.6 && Math.abs(p.pos[2] - z) < 3.5) {
        if (!me.weapons[1]) A.take = p.id
        else if (p.kind === "laser" && me.weapons[1].kind !== "laser") {
          A.take = p.id
          A.drop = 1
        }
      }
    }
    const zc = o.zone
    const dn = hyp(x - zc.next_center[0], y - zc.next_center[1])
    const mustMove = dn > zc.next_radius * 0.85 && t > zc.shrink_start - 25
    let los = false
    if (tgt) {
      const cz = tgt.pos[2] + 4.5
      los = this.w.los(x, y, z + 8, tgt.pos[0], tgt.pos[1], cz)
    }
    if (tgt && los) {
      if (this.seenT < 0 || t - this.lastLos > 1) this.seenT = t
      this.lastLos = t
      const d = hyp(tgt.pos[0] - x, tgt.pos[1] - y) || 1
      const ux = (tgt.pos[0] - x) / d,
        uy = (tgt.pos[1] - y) / d
      if (t > this.flipT) {
        this.side = -this.side
        this.flipT = t + (0.5 + this.rand() * 1.2) * (PACK.flip ?? 1)
      }
      // agentT knob "zapR": a lightning carrier closes to this range (real experts: lightning is 33% of their damage, 45 m reach)
      const zapR = (PACK.zapR ?? 0) > 0 && me.weapons.some((q) => q && q.kind === "lightning") && me.energy > 15 ? PACK.zapR : sk.range
      const radial = Math.max(-1, Math.min(1, (d - zapR) / 15))
      let mx = ux * radial + -uy * this.side * sk.strafe,
        my = uy * radial + ux * this.side * sk.strafe
      if (mustMove) {
        mx += ((zc.next_center[0] - x) / dn) * 1.5
        my += ((zc.next_center[1] - y) / dn) * 1.5
      }
      const m = hyp(mx, my) || 1
      A.move = [mx / m, my / m]
      // pack knob fboost: boost-strafe in a fight while energy is above it (0 = off, the old behaviour)
      if ((PACK.fboost ?? 0) > 0 && me.energy > PACK.fboost) A.boost = true
      // agentT knob "hop": jump with this chance per decision while fighting (organiser probe bots hop constantly; real experts jet)
      if ((PACK.hop ?? 0) > 0 && me.grounded && this.rand() < PACK.hop) A.jump = true
      // aim with lead and skill noise
      const gun = me.weapons.find((q) => q && q.kind === "gun")
      const tof = (d / (gun ? gun.stats.speed : 252)) * sk.lead
      if (!this.noiseT || t > this.noiseT) {
        this.noise = [(this.rand() - 0.5) * 2 * sk.noise, (this.rand() - 0.5) * sk.noise]
        this.noiseT = t + 0.4
      }
      const px = tgt.pos[0] + tgt.vel[0] * (tof + 0.07),
        py = tgt.pos[1] + tgt.vel[1] * (tof + 0.07)
      const yaw = Math.atan2(py - y, px - x) + this.noise[0]
      const pitch = Math.atan2(tgt.pos[2] + 4.5 - (z + 7), d) + this.noise[1]
      A.aim = [yaw, pitch]
      if (t - this.seenT >= sk.react && Math.abs(angNorm(yaw - me.aim[0])) < 0.12) {
        for (let s = 0; s < 2; s++) {
          const wp = me.weapons[s]
          if (!wp) continue
          if (wp.kind === "gun") A.fire[s] = d < wp.stats.range
          else if (wp.kind === "lightning") A.fire[s] = d < wp.stats.range - 2 && me.energy > 10
          else if (wp.kind === "laser") A.fire[s] = wp.charge < wp.stats.charge - 0.04 && d < wp.stats.range
        }
      }
      return A
    }
    this.seenT = -99
    let goal = null
    if (mustMove) goal = zc.next_center
    else if (tgt) goal = tgt.pos
    else if (this.huntGoal) goal = this.huntGoal
    else if ((PACK.dropSeek ?? 0) > 0 && (o.drops || []).some((d) => d.lands_in < 12 && (d.holder == null || d.holder === this.id) && hyp(d.pos[0] - x, d.pos[1] - y) < PACK.dropSeek)) {
      // agentR: idle house bots go for supply drops (human lobbies: house bots captured 25 of 27 drops)
      let bd = 1e9
      for (const d of o.drops) {
        const dd = hyp(d.pos[0] - x, d.pos[1] - y)
        if (d.lands_in < 12 && (d.holder == null || d.holder === this.id) && dd < bd) {
          bd = dd
          goal = d.pos
        }
      }
      if (bd < 3) {
        A.move = [0, 0]
        A.aim = [me.aim[0] + 0.3, 0]
        return A
      }
    } else {
      // agentT knob "pickR": idle house bots walk to weapon pickups within this many m (and to a laser even with slot 1 full) (default 60, slot 1 empty only)
      const near = o.pickups.find((p) => p.kind !== "mortar" && !me.weapons.some((q) => q && q.kind === p.kind) && (!me.weapons[1] || ((PACK.pickR ?? 0) > 60 && p.kind === "laser")) && Math.abs(p.pos[2] - z) < 3 && hyp(p.pos[0] - x, p.pos[1] - y) < (PACK.pickR ?? 60))
      if (near) goal = near.pos
      else {
        if (!this.wander || hyp(this.wander[0] - x, this.wander[1] - y) < 8 || hyp(this.wander[0] - zc.next_center[0], this.wander[1] - zc.next_center[1]) > zc.next_radius * 0.8 || t > this.wanderT) {
          const a = this.rand() * TAU,
            r = Math.sqrt(this.rand()) * zc.next_radius * 0.75
          this.wander = [zc.next_center[0] + Math.cos(a) * r, zc.next_center[1] + Math.sin(a) * r]
          this.wanderT = t + 40
        }
        goal = this.wander
      }
    }
    this.goto(A, me, goal[0], goal[1], t)
    A.boost = me.in_zone === false || (PACK.boost > 0 && (tgt || this.huntGoal) && me.energy > 100 * (1 - PACK.boost))
    const mvYaw = Math.atan2(A.move[1], A.move[0])
    A.aim = [mvYaw + Math.sin(t * 1.3) * 0.9, 0]
    if (me.weapons[0] && me.weapons[0].kind === "gun" && me.weapons[0].ammo < 6 && !me.weapons[0].reload) A.reload = true
    // stuck: hop sideways
    if (this.lastPos && hyp(x - this.lastPos[0], y - this.lastPos[1]) < 0.05 && hyp(A.move[0], A.move[1]) > 0.5) {
      this.stuck = (this.stuck || 0) + 1
      if (this.stuck > 8) {
        const a = this.rand() * TAU
        A.move = [Math.cos(a), Math.sin(a)]
        A.jump = true
        this.path = null
        if (this.stuck > 14) this.stuck = 0
      }
    } else this.stuck = 0
    this.lastPos = [x, y]
    return A
  }
}
