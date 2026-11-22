// Vanguard: a fight-first mech brain. Engages whoever is after us, fights from spots chosen every tick
// (range, sight line, exposure to other mechs), dodges bullets, and breaks off only in short pulses.
// One instance per match. act(obs) -> action (the runner adds tick).

const PI = Math.PI
const TAU = 2 * PI
const hyp = Math.hypot
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const wrap = (a) => {
  a %= TAU
  return a > PI ? a - TAU : a < -PI ? a + TAU : a
}
const now = () => performance.now()
const RANK = { laser: 3, lightning: 2, gun: 1, mortar: 0 }
const UPGRADE_ORDER = [
  "plating", "armor", "laser_damage", "laser_charge", "nanites", "gun_damage", "gun_rate", "capacitor", "servos",
  "gun_velocity", "gun_mag", "sensors", "gyros", "reactor", "jets", "lightning_range", "lightning_chain",
  "laser_pierce", "lightning_efficiency", "mortar_reload", "mortar_velocity", "mortar_splash",
]

// Settings. The three submitted variants differ only in the Object.assign line below.
export const P = {
  // engagement
  engageNear: 60, // any mech this close is fair game
  engageHitS: 6, // ...or one that hit us within this many s
  engageClose: 180, // ...or one closing in on us (> 3 m/s) within this many m
  engageLow: 160, // ...or one under 40% HP within this many m
  engageAim: 190, // ...or one aiming at us within this many m (0 = off)
  selective: false, // only: within engageNear, hit us lately, under 35% HP, or aiming at us within 150 m
  noFirstNoLaser: false, // without a laser: no first shot at a laser carrier or a mech beyond 55 m unless it hunts us
  // ranges
  gunRange: 90, // preferred fight range with the gun
  laserRange: 110, // ...with a laser
  zapRange: 32, // ...with lightning and no laser, when ahead
  finishHp: 0.38, // close to finishR m on a target below this HP share
  finishMe: 0.42, // ...while we are above this share and at most 2 mechs are on us
  finishR: 22,
  // positioning
  isoW: 30, // per other mech that would see a fight spot
  isoR: 170,
  // losing pulses
  pulseS: 1.5, // a retreat lasts this long once we stop losing
  // dodge
  dodgeBoostE: 25, // boost a sidestep when energy is above this (0 = never)
  // loot and weapons
  laserSeek: 240, // walk to a known laser this far when calm and without one
  laserSeekHot: 70, // ...this far when not calm
  grabR: 110, // take a better second weapon this close, mid-fight too
  takeMortar: true, // fill an empty second slot with a mortar
  cubeR: 120, // collect cubes this far when calm
  cubeFightR: 40, // ...this far mid-fight
  cubeCap: 10, // no cubes past this count (size keeps growing, stats do not)
  farmUntil: 60, // shoot crates / drones when calm until this match time
  farmDrones: false, // also drones
  drops: true, // supply drops when hurt and uncontested
  // free-for-all switch
  ffaDead: 2, // deaths we did not cause...
  ffaObs: 5, // ...seen on this many observations in a row
}
Object.assign(P, {"dodgeBoostE":25}) // variant 1: duelist (defaults)
if (typeof process !== "undefined" && process.env && process.env.VG_P) Object.assign(P, JSON.parse(process.env.VG_P))

class Foe {
  constructor(id) {
    this.id = id
    this.pos = [0, 0, 0]
    this.vel = [0, 0, 0]
    this.aim = [0, 0]
    this.hp = 1400
    this.maxHp = 1400
    this.cubes = 0
    this.weapons = ["gun"]
    this.charging = false
    this.t = -99 // last seen
    this.hitMeT = -99
    this.myHitT = -99
    this.dmgToMe = 0
    this.closing = 0
    this.aimOn = false
    this.dist = 999
    this.inView = false
  }
  get hpS() {
    return this.maxHp > 0 ? this.hp / this.maxHp : 1
  }
  has(k) {
    return this.weapons.includes(k)
  }
}

export class Brain {
  constructor(hello, world) {
    this.cfg = hello.config
    this.w = world
    this.slot = hello.slot
    let s = (hello.seed ^ 0x5bd1e995) >>> 0 || 7
    this.rand = () => {
      s ^= s << 13
      s >>>= 0
      s ^= s >>> 17
      s ^= s << 5
      s >>>= 0
      return s / 4294967296
    }
    this.foes = new Map()
    this.npcs = new Map()
    this.picks = new Map()
    this.kills = 0
    this.ffa = false
    this.ffaRun = 0
    this.targetId = -1
    this.mode = "hold"
    this.loseT = -99
    this.lastHitT = -99
    this.lastNpcHitT = -99
    this.npcBear = 0
    this.killSpot = null
    this.path = null
    this.pathGoal = null
    this.pathT = -99
    this.pi = 0
    this.stuckT = -99
    this.unstick = null
    this.posLog = []
    this.side = this.rand() < 0.5 ? 1 : -1
    this.sideT = 0
    this.scanPhase = this.rand() * TAU
    this.losT = -99
    this.lastAimTgt = null
    this.shortUntil = -99
    this.targetT = -99
  }

  // ------------------------------------------------------------ main
  act(o) {
    this.o = o
    this.t = o.t
    this.me = o.self
    this.deadline = now() + 30
    this.ingest(o)
    const A = { move: [0, 0], boost: false, jump: false, aim: [this.me.aim[0], 0], fire: [false, false] }
    if (o.offer) A.pick = this.pickUpgrade(o.offer)
    this.decide()
    this.moveFor(A)
    this.aimFire(A)
    this.takeNearby(A)
    return A
  }

  // ------------------------------------------------------------ perception
  ingest(o) {
    const t = this.t
    const me = this.me
    const [x, y] = me.pos
    this.R = 2.5 * (1 + 0.05 * (me.cubes || 0))
    this.H = 9 * (1 + 0.05 * (me.cubes || 0))
    this.reqR = this.R + 0.6
    this.walk = me.stats?.walk_speed || 11.7
    this.boostV = me.stats?.boost_speed || 19.5
    this.slots = {}
    for (let i = 0; i < 2; i++) if (me.weapons?.[i]) this.slots[me.weapons[i].kind] = i
    this.gun = this.slots.gun != null ? me.weapons[this.slots.gun] : null
    this.laser = this.slots.laser != null ? me.weapons[this.slots.laser] : null
    this.zap = this.slots.lightning != null ? me.weapons[this.slots.lightning] : null
    this.hpS = me.hp / (me.max_hp || 1400)
    for (const f of this.foes.values()) f.inView = false
    for (const m of o.mechs || []) {
      if (m.kind === "npc") {
        this.npcs.set(m.id, { id: m.id, pos: m.pos, vel: m.vel, hp: m.hp ?? 350, t })
        continue
      }
      let f = this.foes.get(m.id)
      if (!f) this.foes.set(m.id, (f = new Foe(m.id)))
      const d = hyp(m.pos[0] - x, m.pos[1] - y)
      if (t - f.t < 1) f.closing = f.closing * 0.6 + (((f.dist - d) / Math.max(0.05, t - f.t)) * 0.4)
      else f.closing = 0
      const bear = Math.atan2(y - m.pos[1], x - m.pos[0])
      f.aimOn = Math.abs(wrap(m.aim[0] - bear)) < 0.2
      f.pos = m.pos
      f.vel = m.vel
      f.aim = m.aim
      if (m.hp != null) f.hp = m.hp
      f.maxHp = m.max_hp || f.maxHp
      f.cubes = m.cubes || 0
      f.weapons = m.weapons || f.weapons
      f.charging = !!m.charging
      f.dist = d
      f.t = t
      f.inView = true
    }
    for (const f of this.foes.values()) if (!f.inView) f.dist = hyp(f.pos[0] - x, f.pos[1] - y)
    for (const [id, n] of this.npcs) if (t - n.t > 8) this.npcs.delete(id)
    for (const p of o.pickups || []) this.picks.set(p.id, { id: p.id, kind: p.kind, pos: p.pos, t })
    for (const ev of o.events || []) {
      if (ev.type === "damaged") {
        if (ev.by != null && ev.by < 100) {
          this.lastHitT = t
          let f = this.foes.get(ev.by)
          if (!f) this.foes.set(ev.by, (f = new Foe(ev.by)))
          if (t - f.t > 2 && ev.bearing != null) {
            // unseen shooter: place it along the bearing
            const D = ev.weapon === "lightning" ? 35 : ev.weapon === "laser" ? 130 : 90
            f.pos = [x + Math.cos(ev.bearing) * D, y + Math.sin(ev.bearing) * D, me.pos[2]]
            f.vel = [0, 0, 0]
            f.dist = D
            f.t = t - 1.5 // known, but older than a sighting
          }
          f.hitMeT = t
          f.dmgToMe += ev.amount || 0
        } else if (ev.weapon === "npc") {
          this.lastNpcHitT = t
          if (ev.bearing != null) this.npcBear = ev.bearing
        }
      } else if (ev.type === "hit") {
        const f = this.foes.get(ev.target)
        if (f) f.myHitT = t
      } else if (ev.type === "kill") {
        this.kills++
        const f = this.foes.get(ev.target)
        if (f) this.killSpot = { pos: f.pos.slice(), t }
        this.foes.delete(ev.target)
        if (this.targetId === ev.target) this.targetId = -1
      } else if (ev.type === "took" || (ev.type === "take_failed" && ev.reason === "gone")) {
        this.picks.delete(ev.id)
      } else if (ev.type === "effect" && ev.effect === "short") {
        this.shortUntil = t + (this.cfg.weapons?.lightning?.short_s ?? 2)
      } else if (ev.type === "dropped") {
        this.picks.set(ev.id, { id: ev.id, kind: ev.kind, pos: me.pos.slice(), t })
      }
    }
    for (const [id, f] of this.foes) if (t - f.t > 20 && t - f.hitMeT > 20) this.foes.delete(id)
    // practice vs free-for-all: house bots never kill each other
    const others = (this.cfg.match?.mechs ?? 16) - (o.alive ?? 16) - this.kills
    this.ffaRun = others >= P.ffaDead ? this.ffaRun + 1 : 0
    if (this.ffaRun >= P.ffaObs) this.ffa = true
    // stuck detection
    this.posLog.push([t, x, y])
    while (this.posLog.length && t - this.posLog[0][0] > 1.2) this.posLog.shift()
    // zone
    const z = o.zone
    this.nc = z.next_center
    this.nr = z.next_radius
    this.safeR = Math.max(0, this.nr - clamp(this.nr * 0.12, 3, 25))
    const dn = hyp(x - this.nc[0], y - this.nc[1])
    const travel = (Math.max(0, dn - this.safeR) * 1.45) / this.walk
    const left = (t < z.shrink_start ? z.shrink_start - t : 0) + (z.shrink_end - Math.max(t, z.shrink_start)) * 0.5
    this.zoneUrgent = me.in_zone === false || (dn > this.safeR && travel + 6 > left)
    this.finale = this.nr < 30 && z.radius < 45
  }

  attackers(window = 3) {
    const out = []
    for (const f of this.foes.values()) if (this.t - f.hitMeT < window) out.push(f)
    return out
  }
  nearCount(r) {
    let n = 0
    for (const f of this.foes.values()) if (this.t - f.t < 3 && f.dist < r) n++
    return n
  }

  // ------------------------------------------------------------ decisions
  engageable(f) {
    const t = this.t
    if (t - f.t > 4) return false
    const hit = t - f.hitMeT < P.engageHitS
    if (this.finale) return true
    if (this.ffa) {
      // free-for-all: answer attackers and very close or nearly dead mechs only
      return hit || f.dist < 50 || (f.hpS < 0.3 && f.dist < 140 && this.hpS > 0.5)
    }
    if (P.noFirstNoLaser && !this.laser && !hit && !(f.closing > 3 || f.aimOn) && f.hpS > 0.35 && (f.has("laser") || f.dist > 55)) return false
    if (P.selective) return hit || f.dist < P.engageNear || f.hpS < 0.35 || (f.aimOn && f.dist < 150)
    return (
      f.dist < P.engageNear ||
      hit ||
      (f.closing > 3 && f.dist < P.engageClose) ||
      (f.hpS < 0.4 && f.dist < P.engageLow) ||
      (P.engageAim > 0 && f.aimOn && f.dist < P.engageAim)
    )
  }
  targetScore(f) {
    // lower is better
    const t = this.t
    let s = f.dist + 0.2 * f.hp
    if (f.hpS <= 0.3) s -= 100
    if (f.id === this.targetId && t - this.targetT < 2.5) s -= 120
    if (t - f.hitMeT < 4) s -= 40
    if (f.closing > 3) s -= 15
    if (!f.inView) s += 60
    return s
  }
  losing(target) {
    const n = this.nearCount(160)
    const h = this.hpS
    let lose = (n >= 2 && h < 0.55) || (n >= 3 && h < 0.8) || (h < 0.35 && target && target.hpS > h + 0.1)
    if (this.ffa) lose = lose || (h < 0.45 && this.attackers(3).length >= 1 && !(target && target.hpS < 0.25))
    if (target && target.hpS < 0.25 && h > 0.2 && n <= 2) lose = false
    return lose
  }

  decide() {
    const t = this.t
    const me = this.me
    let target = this.targetId >= 0 ? this.foes.get(this.targetId) : null
    if (target && t - target.t > 4) target = null
    // pick the best engageable mech
    let best = null,
      bs = Infinity
    for (const f of this.foes.values()) {
      if (!this.engageable(f)) continue
      const s = this.targetScore(f)
      if (s < bs) {
        bs = s
        best = f
      }
    }
    if (best) {
      if (best.id !== this.targetId) this.targetId = best.id
      this.targetT = t
      target = best
    } else if (!target || !this.engageable(target)) {
      target = null
      this.targetId = -1
    }
    this.target = target
    this.calm = t - this.lastHitT > 4 && !target
    this.goal = null

    if (this.zoneUrgent && !(target && me.in_zone !== false && target.dist < 60)) return this.setMode("zone")
    // short break-offs only while plainly losing
    if (this.losing(target)) {
      this.loseT = t
      return this.setMode("retreat")
    }
    if (this.mode === "retreat" && t - this.loseT < P.pulseS) return
    // a better weapon close by, even mid-fight
    const g = this.weaponGoal(target ? P.grabR : this.laser ? P.grabR : t - this.lastHitT < 4 ? P.laserSeekHot : P.laserSeek)
    if (g && (!target || g.d < P.grabR)) {
      this.goal = g
      return this.setMode("loot")
    }
    // cubes in reach mid-fight
    if (target) {
      const c = this.cubeGoal(P.cubeFightR)
      if (c && target.dist > 35) {
        this.goal = c
        return this.setMode("loot")
      }
      return this.setMode("fight")
    }
    // calm: drops, cubes, farming
    const d = P.drops ? this.dropGoal() : null
    if (d) {
      this.goal = d
      return this.setMode("loot")
    }
    const c = this.cubeGoal(this.calm ? P.cubeR : 60)
    if (c) {
      this.goal = c
      return this.setMode("loot")
    }
    if (this.calm && t < P.farmUntil && this.hpS > 0.6) {
      const f = this.farmGoal()
      if (f) {
        this.goal = f
        return this.setMode("farm")
      }
    }
    this.setMode("hold")
  }
  setMode(m) {
    this.mode = m
  }

  okSpot(p, d) {
    const z = this.o.zone
    if (hyp(p[0] - z.center[0], p[1] - z.center[1]) > z.radius - 6) return false
    if (hyp(p[0] - this.nc[0], p[1] - this.nc[1]) > this.nr + 10 && d / this.walk + 10 > z.shrink_end - this.t) return false
    if (this.w && Math.abs(this.w.standZ(p[0], p[1], this.me.pos[2] + 1.5) - p[2]) > 3.2) return false // up on a roof
    return true
  }
  contested(p, myD, pad = 25) {
    for (const f of this.foes.values()) {
      if (this.t - f.t > 8) continue
      const d = hyp(p[0] - f.pos[0], p[1] - f.pos[1])
      if (d < pad || d < myD - 30) return true
    }
    return false
  }
  weaponGoal(maxD) {
    const me = this.me
    const [x, y] = me.pos
    const s1 = me.weapons?.[1]
    const s0 = me.weapons?.[0]
    const have1 = s1 ? RANK[s1.kind] ?? 0 : -1
    let best = null,
      bd = maxD
    for (const p of this.picks.values()) {
      const r = RANK[p.kind] ?? 0
      if (this.slots[p.kind] != null) continue
      if (p.kind === "mortar" && !(P.takeMortar && !s1)) continue
      const useful = (s1 ? r > have1 : r >= 0) || (!s0 && p.kind === "gun")
      if (!useful || (r <= 1 && s1)) continue
      const d = hyp(p.pos[0] - x, p.pos[1] - y)
      if (d >= bd || !this.okSpot(p.pos, d) || this.contested(p.pos, d)) continue
      // a laser is worth a longer walk than a lightning or a mortar
      const eff = p.kind === "laser" ? d : d * 1.6
      if (eff < bd) {
        bd = eff
        best = { pos: p.pos, d, kind: "pick", id: p.id }
      }
    }
    return best
  }
  cubeGoal(maxD) {
    const me = this.me
    if ((me.cubes || 0) >= P.cubeCap) return null
    const [x, y] = me.pos
    let best = null,
      bd = maxD
    for (const c of this.o.cubes || []) {
      const d = hyp(c.pos[0] - x, c.pos[1] - y)
      if (d < bd && this.okSpot(c.pos, d) && !this.contested(c.pos, d, 20)) {
        bd = d
        best = { pos: c.pos, d, kind: "cube" }
      }
    }
    if (!best && this.killSpot && this.t - this.killSpot.t < 20) {
      const d = hyp(this.killSpot.pos[0] - x, this.killSpot.pos[1] - y)
      if (d < maxD && d > 3 && !this.contested(this.killSpot.pos, d, 20)) best = { pos: this.killSpot.pos, d, kind: "cube" }
      else if (d <= 3) this.killSpot = null
    }
    return best
  }
  dropGoal() {
    const me = this.me
    if (this.hpS > 0.7 && (me.cubes || 0) >= P.cubeCap) return null
    const [x, y] = me.pos
    for (const dr of this.o.drops || []) {
      if (dr.holder != null && dr.holder !== me.id) continue
      const d = hyp(dr.pos[0] - x, dr.pos[1] - y)
      if (d > 220 || dr.lands_in > d / this.walk + 10) continue
      if (!this.okSpot(dr.pos, d) || this.contested(dr.pos, d, 70)) continue
      return { pos: dr.pos, d, kind: "drop" }
    }
    return null
  }
  farmGoal() {
    const [x, y] = this.me.pos
    for (const f of this.foes.values()) if (this.t - f.t < 6 && f.dist < 170) return null
    let best = null,
      bd = 130
    for (const c of this.o.crates || []) {
      const d = hyp(c.pos[0] - x, c.pos[1] - y)
      if (d < bd && this.okSpot(c.pos, d)) {
        bd = d
        best = { pos: c.pos, d, kind: "crate", id: c.id }
      }
    }
    if (!best && P.farmDrones && this.hpS > 0.8)
      for (const n of this.npcs.values())
        if (this.t - n.t < 2) {
          const d = hyp(n.pos[0] - x, n.pos[1] - y)
          if (d < bd) {
            bd = d
            best = { pos: n.pos, d, kind: "npc", id: n.id }
          }
        }
    return best
  }

  // ------------------------------------------------------------ movement
  moveFor(A) {
    const m = this.mode
    if (m === "zone") this.goZone(A)
    else if (m === "retreat") this.doRetreat(A)
    else if (m === "fight") this.doFight(A)
    else if (m === "loot") this.goPoint(A, this.goal.pos, 1)
    else if (m === "farm") this.doFarm(A)
    else this.doHold(A)
    this.dodge(A)
    this.antiStuck(A)
  }
  node(x, y, z, cells = 10) {
    return this.w ? this.w.nearestNode(x, y, z, this.reqR, this.H + 0.3, cells) : -1
  }
  goPoint(A, p, speed = 1, boost = false) {
    const me = this.me
    const [x, y, z] = me.pos
    const d = hyp(p[0] - x, p[1] - y)
    if (d < 1.2) return true
    const w = this.w
    if (!w || (d < 25 && w.walkLine(x, y, z, p[0], p[1], this.reqR - 0.4, this.H))) {
      A.move = [((p[0] - x) / d) * Math.min(speed, Math.max(0.3, d / 5)), ((p[1] - y) / d) * Math.min(speed, Math.max(0.3, d / 5))]
      if (boost && me.energy > 15) A.boost = true
      return false
    }
    const key = `${Math.round(p[0] / 4)},${Math.round(p[1] / 4)}`
    if (!this.path || this.pathGoal !== key || this.t - this.pathT > 2) {
      const s = this.node(x, y, z)
      const g = this.node(p[0], p[1], p[2] ?? w.ground(p[0], p[1]), 14)
      this.path = s >= 0 && g >= 0 ? w.search(s, g, { reqR: this.reqR, myH: this.H + 0.3, allowJet: false, maxExp: 30000, deadline: this.deadline }) : null
      this.pathGoal = key
      this.pathT = this.t
      this.pi = 0
    }
    const path = this.path
    if (!path || !path.length) {
      A.move = [(p[0] - x) / d, (p[1] - y) / d]
      return false
    }
    // advance along the path, then aim at the furthest node we can walk straight to
    let bi = this.pi,
      bd = Infinity
    for (let k = this.pi; k < Math.min(path.length, this.pi + 12); k++) {
      const dk = hyp(w.nodeX(path[k]) - x, w.nodeY(path[k]) - y)
      if (dk < bd) {
        bd = dk
        bi = k
      }
    }
    this.pi = bi
    let tgt = Math.min(path.length - 1, bi + 8)
    while (tgt > bi + 1 && !w.walkLine(x, y, z, w.nodeX(path[tgt]), w.nodeY(path[tgt]), this.reqR - 0.4, this.H)) tgt--
    const tx = w.nodeX(path[tgt]) - x,
      ty = w.nodeY(path[tgt]) - y,
      td = hyp(tx, ty) || 1
    A.move = [(tx / td) * speed, (ty / td) * speed]
    if (boost && me.energy > 15) A.boost = true
    return false
  }
  goZone(A) {
    const [x, y] = this.me.pos
    const d = hyp(x - this.nc[0], y - this.nc[1])
    const r = this.nr < 30 ? 0 : Math.max(0, this.safeR * 0.6)
    const k = d > 1 ? Math.min(1, r / d) : 0
    const p = [this.nc[0] + (x - this.nc[0]) * k, this.nc[1] + (y - this.nc[1]) * k]
    this.goPoint(A, [p[0], p[1], this.w ? this.w.ground(p[0], p[1]) : 0], 1, this.me.in_zone === false || this.o.zone.dps >= 60)
  }
  doHold(A) {
    const [x, y] = this.me.pos
    const d = hyp(x - this.nc[0], y - this.nc[1])
    if (d > this.safeR * 0.85) return this.goZone(A)
    // standing still is silent; drift only to keep a good spot
    A.move = [0, 0]
  }
  doRetreat(A) {
    const me = this.me
    const [x, y, z] = me.pos
    let cx = 0,
      cy = 0,
      n = 0
    for (const f of this.foes.values())
      if (this.t - f.t < 4 && f.dist < 220) {
        const wgt = 1 + (this.t - f.hitMeT < 3 ? 1 : 0)
        cx += (f.pos[0] - x) * wgt
        cy += (f.pos[1] - y) * wgt
        n += wgt
      }
    if (!n) return this.doHold(A)
    let ax = -cx,
      ay = -cy
    // lean toward the next circle
    const dn = hyp(this.nc[0] - x, this.nc[1] - y) || 1
    const al = hyp(ax, ay) || 1
    ax = ax / al + ((this.nc[0] - x) / dn) * 0.4
    ay = ay / al + ((this.nc[1] - y) / dn) * 0.4
    const base = Math.atan2(ay, ax)
    const w = this.w
    let best = null
    for (const off of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const a = base + off
      const mv = [Math.cos(a), Math.sin(a)]
      if (!w || w.walkLine(x, y, z, x + mv[0] * 8, y + mv[1] * 8, this.reqR - 0.4, this.H)) {
        best = mv
        break
      }
    }
    A.move = best || [Math.cos(base), Math.sin(base)]
    if (me.energy > 20) A.boost = true
  }
  doFarm(A) {
    const g = this.goal
    const [x, y] = this.me.pos
    const d = hyp(g.pos[0] - x, g.pos[1] - y)
    if (d > 70) this.goPoint(A, g.pos, 1)
    else A.move = [0, 0]
    this.farmTgt = g
  }
  doFight(A) {
    const t = this.t
    const me = this.me
    const e = this.target
    const w = this.w
    const [x, y, z] = me.pos
    if (!e.inView || t - e.t > 1) {
      // lost sight: walk to where it was
      this.goPoint(A, e.pos, 1)
      return
    }
    let pr = this.laser ? P.laserRange : P.gunRange
    if (this.zap && !this.laser && (this.hpS - e.hpS > 0.1 || e.hpS < 0.45) && !e.has("lightning")) pr = P.zapRange
    if (e.has("lightning") && !this.zap && pr < 60) pr = 70
    if (e.hpS < P.finishHp && this.hpS > P.finishMe && this.attackers(3).length <= 2) pr = P.finishR
    if (this.finale) pr = Math.min(pr, 40)
    if (t > this.sideT) {
      if (this.rand() < 0.6) this.side = -this.side
      this.sideT = t + 0.35 + this.rand() * 0.75
    }
    const ready = this.weaponReady()
    const threatLaser = e.charging && e.aimOn
    const wantLos = threatLaser ? -1.6 : ready ? 1 : -0.4
    const others = []
    for (const f of this.foes.values()) if (f !== e && this.t - f.t < 3 && f.dist < P.isoR) others.push(f)
    const ex = e.pos[0],
      ey = e.pos[1],
      ez = e.pos[2]
    const toE = Math.atan2(ey - y, ex - x)
    const zr = this.o.zone
    let best = null,
      bestS = -Infinity
    for (let k = 0; k < 17; k++) {
      const step = k === 16 ? 0 : 6
      const a = (k / 16) * TAU
      const px = x + Math.cos(a) * step,
        py = y + Math.sin(a) * step
      if (step && w && !w.walkLine(x, y, z, px, py, this.reqR - 0.4, this.H)) continue
      const pz = w ? w.standZ(px, py, z + 1.2) : z
      const dE = hyp(ex - px, ey - py)
      let s = -1.1 * Math.abs(dE - pr) - 0.4 * step
      const los = w ? w.los(px, py, pz + 7, ex, ey, ez + 4.5) : true
      if (los) s += 45 * wantLos
      for (const q of others) if (!w || w.los(q.pos[0], q.pos[1], q.pos[2] + 8, px, py, pz + 4.5)) s -= P.isoW
      if (hyp(px - zr.center[0], py - zr.center[1]) > zr.radius - 4) s -= 200
      if (step) {
        const lat = Math.sin(a - toE) // + = to the left of the line to the target
        s += 4 * lat * this.side
      }
      if (s > bestS) {
        bestS = s
        best = [px, py]
      }
      if (now() > this.deadline) break
    }
    if (best) {
      const dx = best[0] - x,
        dy = best[1] - y,
        d = hyp(dx, dy)
      A.move = d > 0.5 ? [dx / d, dy / d] : [0, 0]
    }
  }
  weaponReady() {
    const g = this.gun,
      l = this.laser
    if (l && ((l.cooldown || 0) < 0.4 || l.charge > 0)) return true
    if (g && g.ammo > 0 && !(g.reload > 0)) return true
    if (this.zap && this.me.energy > 15) return true
    return false
  }
  /** sidestep bullets that will pass within reach in the next 0.7 s */
  dodge(A) {
    const ps = this.o.projectiles
    if (!ps || !ps.length) return
    const me = this.me
    const [x, y, z] = me.pos
    const reach = this.R + 1.1
    let dx = 0,
      dy = 0,
      threat = false
    for (const p of ps) {
      if (p.kind === "mortar") continue
      const vx = p.vel[0],
        vy = p.vel[1]
      const v2 = vx * vx + vy * vy
      if (v2 < 1) continue
      const rx = x - p.pos[0],
        ry = y - p.pos[1]
      const tca = (rx * vx + ry * vy) / v2
      if (tca < 0 || tca > 0.7) continue
      const pz = p.pos[2] + p.vel[2] * tca
      if (pz < z - 1 || pz > z + this.H + 1) continue
      const cx = rx - vx * tca,
        cy = ry - vy * tca
      const miss = hyp(cx, cy)
      if (miss > reach) continue
      // push out perpendicular to the bullet, on the side we already lean to
      const v = Math.sqrt(v2)
      let nx = -vy / v,
        ny = vx / v
      if (nx * cx + ny * cy < 0) {
        nx = -nx
        ny = -ny
      }
      const wgt = (reach - miss) / reach + 0.3
      dx += nx * wgt
      dy += ny * wgt
      threat = true
    }
    if (!threat) return
    const dl = hyp(dx, dy) || 1
    let mx = A.move[0] * 0.4 + (dx / dl) * 0.9,
      my = A.move[1] * 0.4 + (dy / dl) * 0.9
    const ml = hyp(mx, my) || 1
    mx /= ml
    my /= ml
    if (this.w && !this.w.walkLine(x, y, z, x + mx * 4, y + my * 4, this.reqR - 0.4, this.H)) {
      mx = -mx
      my = -my
      if (!this.w.walkLine(x, y, z, x + mx * 4, y + my * 4, this.reqR - 0.4, this.H)) return
    }
    A.move = [mx, my]
    if (P.dodgeBoostE > 0 && me.energy > P.dodgeBoostE && !(this.laser && this.laser.charge > 0)) A.boost = true
  }
  antiStuck(A) {
    const t = this.t
    const L = this.posLog
    if (this.unstick && t < this.unstick.until) {
      A.move = this.unstick.mv
      A.jump = this.me.grounded && t - this.unstick.t0 < 0.15
      return
    }
    if (L.length < 8 || hyp(A.move[0], A.move[1]) < 0.5) return
    const moved = hyp(L[L.length - 1][1] - L[0][1], L[L.length - 1][2] - L[0][2])
    if (moved < 0.6) {
      const a = Math.atan2(A.move[1], A.move[0]) + (this.rand() < 0.5 ? 1 : -1) * (PI / 2 + this.rand() * 0.6)
      this.unstick = { mv: [Math.cos(a), Math.sin(a)], until: t + 0.7, t0: t }
      this.path = null
      A.move = this.unstick.mv
      A.jump = this.me.grounded
    }
  }

  // ------------------------------------------------------------ aiming and firing
  aimFire(A) {
    const t = this.t
    const me = this.me
    let e = this.target && this.target.inView ? this.target : null
    if (!e) {
      // shot at from view while doing something else: answer
      for (const f of this.foes.values()) if (f.inView && t - f.hitMeT < 3 && (!e || f.dist < e.dist)) e = f
    }
    const L = this.laser
    if (e) {
      this.losT = t
      this.lastAimTgt = e
      this.shoot(A, e.pos, e.vel, e.cubes, e.hp, e.dist, true)
      return
    }
    // laser charged and the target just slipped out of view: keep it a moment
    if (L && L.charge > 0 && this.lastAimTgt && t - this.losT < 1) {
      const f = this.lastAimTgt
      A.aim = [Math.atan2(f.pos[1] - me.pos[1], f.pos[0] - me.pos[0]), 0]
      A.fire[this.slots.laser] = true
      return
    }
    // drones shooting at us
    if (t - this.lastNpcHitT < 2) {
      let n = null
      for (const q of this.npcs.values()) if (t - q.t < 0.5 && (!n || hyp(q.pos[0] - me.pos[0], q.pos[1] - me.pos[1]) < hyp(n.pos[0] - me.pos[0], n.pos[1] - me.pos[1]))) n = q
      if (n) return this.shoot(A, n.pos, n.vel, 0, n.hp, hyp(n.pos[0] - me.pos[0], n.pos[1] - me.pos[1]), false, true)
      A.aim = [this.npcBear, 0]
      return
    }
    // farming
    if (this.mode === "farm" && this.goal) {
      const g = this.goal
      const d = hyp(g.pos[0] - me.pos[0], g.pos[1] - me.pos[1])
      if (g.kind === "npc") {
        const n = this.npcs.get(g.id)
        if (n) return this.shoot(A, n.pos, n.vel, 0, n.hp, d, false, true)
      } else if (d < 120) return this.shoot(A, g.pos, [0, 0, 0], 0, 300, d, false, true, 1.2)
    }
    // idle: reload, and sweep the view
    const g = this.gun
    if (g && !(g.reload > 0) && g.ammo < (g.stats?.mag || 12) * 0.6) A.reload = true
    if (L && L.charge > 0) A.fire[this.slots.laser] = false
    const mv = hyp(A.move[0], A.move[1]) > 0.3 ? Math.atan2(A.move[1], A.move[0]) : this.scanPhase
    this.scanPhase = wrap(this.scanPhase + 0.06)
    let yaw = mv + Math.sin(t * 1.3) * 1.15
    // something seen lately but out of view: look there
    let recent = null
    for (const f of this.foes.values()) if (!f.inView && t - f.t < 5 && f.dist < 200 && (!recent || f.t > recent.t)) recent = f
    if (recent) yaw = Math.atan2(recent.pos[1] - me.pos[1], recent.pos[0] - me.pos[0])
    A.aim = [yaw, 0]
  }
  /** lead, aim and pull the triggers at a point target. mech: a mech (cube scaling, laser use). */
  shoot(A, pos, vel, cubes, hp, dist, mech, gunOnly = false, height = 0) {
    const me = this.me
    const st = me.stats || {}
    const lat = 0.075
    const mx = me.pos[0] + me.vel[0] * lat,
      my = me.pos[1] + me.vel[1] * lat,
      mz = me.pos[2] + (st.muzzle_height || 7)
    const tr = 2.5 * (1 + 0.05 * (cubes || 0))
    const th = height || 9 * (1 + 0.05 * (cubes || 0))
    const cz = pos[2] + th * 0.5
    const turn = (st.turn_rate || 4) * 0.1
    const pturn = (st.pitch_rate || 3) * 0.1
    const slew = (want, cur, r) => cur + clamp(wrap(want - cur), -r, r)
    const air = Math.abs(vel[2] || 0) > 1
    // gun: iterate the lead
    let gyaw = 0,
      gpitch = 0
    const g = this.gun
    if (g) {
      const sp = g.stats?.speed || 252
      let tf = lat + Math.max(0, dist - 3) / sp
      let px = pos[0],
        py = pos[1],
        pz = cz
      for (let i = 0; i < 4; i++) {
        px = pos[0] + vel[0] * tf
        py = pos[1] + vel[1] * tf
        pz = cz + (air ? vel[2] * tf * 0.5 : 0)
        tf = lat + Math.max(0, hyp(px - mx, py - my) - 3) / sp
      }
      gyaw = Math.atan2(py - my, px - mx)
      gpitch = Math.atan2(pz - mz, hyp(px - mx, py - my))
    }
    const L = !gunOnly && mech ? this.laser : null
    let ayaw = gyaw,
      apitch = gpitch
    let lyaw = 0,
      lpitch = 0
    if (L) {
      const lx = pos[0] + vel[0] * 0.125,
        ly = pos[1] + vel[1] * 0.125
      lyaw = Math.atan2(ly - my, lx - mx)
      lpitch = Math.atan2(cz - mz, hyp(lx - mx, ly - my))
      if (L.charge > 0 || (L.cooldown || 0) < 0.3) {
        ayaw = lyaw
        apitch = lpitch
      }
    }
    if (!g && !L) {
      ayaw = Math.atan2(pos[1] - me.pos[1], pos[0] - me.pos[0])
      apitch = 0
    }
    A.aim = [ayaw, apitch]
    const yawNext = slew(ayaw, me.aim[0], turn),
      pitchNext = slew(apitch, me.aim[1], pturn)
    const w = this.w
    const clear = !w || w.los(mx, my, mz, pos[0], pos[1], cz)
    // gun
    if (g && g.ammo > 0 && !(g.reload > 0) && dist < (g.stats?.range || 230) - 5 && clear) {
      const tolY = Math.atan((0.75 * tr) / Math.max(dist, 1)),
        tolP = Math.atan((0.4 * th) / Math.max(dist, 1))
      if (Math.abs(wrap(gyaw - yawNext)) < tolY && Math.abs(gpitch - pitchNext) < tolP) A.fire[this.slots.gun] = true
    }
    // laser
    if (L) {
      const ls = this.slots.laser
      const full = L.stats?.charge ?? 0.75
      const minC = L.stats?.min_charge ?? 0.15
      const range = (L.stats?.range ?? 280) - 5
      const tol = Math.atan((0.6 * tr) / Math.max(dist, 1))
      const onLaser = Math.abs(wrap(lyaw - me.aim[0])) < tol && Math.abs(lpitch - me.aim[1]) < tol * 1.5
      const fleeing = this.mode === "retreat" || this.me.in_zone === false
      if (L.charge > 0) {
        const frac = Math.min(1, L.charge / full)
        const mult = 1 + (this.cfg.cubes?.damage_per_cube ?? 0.04) * Math.min(me.cubes || 0, this.cfg.cubes?.stat_cap ?? 10)
        const dmg = (L.stats?.damage ?? 315) * ((L.stats?.min_frac ?? 0.35) + (1 - (L.stats?.min_frac ?? 0.35)) * frac) * mult
        const lethal = L.charge >= minC && dmg * 0.8 >= hp
        const ready = L.charge >= full - 0.051
        // hold the trigger (keep charging) unless we are aimed and either full or lethal
        A.fire[ls] = !((ready || lethal) && onLaser && clear)
      } else if ((L.cooldown || 0) <= 0.1 && dist < range && clear && !fleeing && !(this.shortUntil > this.t)) {
        A.fire[ls] = true // start charging
      }
    }
    // lightning
    const Z = !gunOnly ? this.zap : null
    if (Z && dist < (Z.stats?.range ?? 45) - 3 && Math.abs(wrap(Math.atan2(pos[1] - me.pos[1], pos[0] - me.pos[0]) - me.aim[0])) < 0.22 && me.energy > 12) A.fire[this.slots.lightning] = true
  }

  takeNearby(A) {
    const me = this.me
    const [x, y, z] = me.pos
    const reach = (this.cfg.loot?.pickup_radius ?? 4) - 0.3
    const s0 = me.weapons?.[0],
      s1 = me.weapons?.[1]
    let best = null,
      br = -1
    for (const p of this.o.pickups || []) {
      if (hyp(p.pos[0] - x, p.pos[1] - y) > reach || Math.abs(p.pos[2] - z) > 3.7) continue
      if (this.slots[p.kind] != null) continue
      const r = RANK[p.kind] ?? 0
      if (p.kind === "mortar" && !(P.takeMortar && !s1)) continue
      if (r > br) {
        br = r
        best = p
      }
    }
    if (!best) return
    if (!s0 || !s1) A.take = best.id
    else if (s1 && br > (RANK[s1.kind] ?? 0) && !(s1.kind === "laser" && s1.charge > 0)) {
      A.take = best.id
      A.drop = 1
    }
  }

  pickUpgrade(offer) {
    const ids = offer.choices.map((c) => c.id)
    for (const u of UPGRADE_ORDER) {
      const i = ids.indexOf(u)
      if (i >= 0) return i
    }
    return 0
  }
}
