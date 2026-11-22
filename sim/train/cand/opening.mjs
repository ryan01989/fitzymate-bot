// FitzyMate brain: survive first, pick uneven fights, hold cover inside the next circle.
// One instance per match. act(obs) -> action (without tick; the runner adds it).

const PI = Math.PI
const TAU = 2 * PI
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const angNorm = (a) => {
  a %= TAU
  if (a > PI) a -= TAU
  else if (a < -PI) a += TAU
  return a
}
const hyp = Math.hypot
const now = () => performance.now()
function mulberry(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Upgrade preference, best first (survivability, then laser, then gun).
const UPGRADES = [
  "plating", "armor", "laser_charge", "laser_damage", "nanites", "gun_damage", "gun_rate", "capacitor",
  "servos", "gun_velocity", "sensors", "gyros", "reactor", "gun_mag", "jets", "lightning_range",
  "lightning_chain", "laser_pierce", "lightning_efficiency", "mortar_reload", "mortar_velocity", "mortar_splash",
]
const WEAPON_RANK = { laser: 3, lightning: 2, gun: 1, mortar: 0 }

// Tunables (see README "Tuning").
export const P = {
  hideHp: 0.4, // below this HP share: stop trading, go regenerate
  resumeHp: 0.8, // leave cover when back above this
  initHpLow: 0.75, // a target under this HP share is fair game
  initAdv: 0.2, // or when our HP share is this much higher
  vetoAdv: -0.12, // never start a fight this far behind
  vetoCubes: -5,
  crowd: 90, // other mechs this close to us veto a fight
  openingS: 45, // extra-passive until then
  farm: true, // shoot crates / NPC drones when nobody is around
  calmS: 4, // seconds without contact before looting
  zoneMarginFrac: 0.14,
  silentNear: 70, // walk silently when an unseen mech is this close
  // --- v3 strategy switches (tested in sim/eval.mjs; FM_P env overrides them in the simulator only)
  healBelow: 0, // out of a fight below this HP share: break line of sight and regenerate first
  healTo: 0.9, // ...until back at this share
  killLoot: true, // after a kill, collect the dropped cubes when nobody is in sight
  dropHeal: false, // go for supply drops (full repair) whenever hurt and nobody is close
  fightRange: 0, // preferred fight range in m (0 = 104, or 112 with a laser)
  bandRange: 14, // dead band around the preferred range
  noRetreat: false, // stand and fight against one or two attackers whatever the HP
  berserk: false, // attack anything in sight
  zapRange: 0, // with lightning: close to this range for the arc + gun burst (0 = only when ahead)
  preferZap: false, // rank lightning above the laser when picking up weapons
  farmHard: true, // farm crates / drones / cubes far and wide, and explore to find them
  farmUntil: 200, // ...until this match time
  // --- thresholds that were literals in the 4.58 build (sim/train/mkbase.mjs)
  finishHp: 0.35, // a target under this HP share is always attacked...
  finishMyHp: 0.3, // ...while we are above this
  defAdvOut: 0.25, // shot first while outgunned or 2+ cubes behind: answer only with this HP lead
  defAdv: -0.08, // shot first otherwise: answer down to this HP deficit
  outgunAdv: 0.2, // outgunned: start a fight only with this HP lead
  busyHp: 0.9, // a target busy with someone else is fair game under this HP share
  huntHp: 0.7, // a mech coming for us: shoot first when we are above this HP share...
  huntDist: 170, // ...and it is within this range
  nearDist: 78, // too close to go unnoticed: fight inside this range...
  nearAdv: -0.05, // ...down to this HP deficit...
  nearHp: 0.6, // ...when above this HP share
  rearDist: 150, // laser shot from behind: out to this range...
  rearHp: 0.8, // ...when above this HP share
  raceOut: 1.12, // retreat when time-to-kill / time-to-die goes above this
  raceHurt: 0.8, // ...or above this when below hideHp
  retAdv: -0.2, // retreat when this far behind on HP share...
  retHp: 0.7, // ...and below this HP share
  chaseHp: 0.4, // chase a target under this HP share...
  chaseMyHp: 0.55, // ...when above this...
  chaseS: 7, // ...for this many seconds out of sight
  startDist: 215, // start fights only inside this range
  scoreDist: 0.2, // target choice: penalty per metre of distance (100 = full HP difference)
  exploreHp: 0.5, // explore for farm targets only above this HP share
  huntUntil: 0, // before this time, attack any mech in sight within 200 m while above 60% HP (0 = off)
  calmAfter: 0, // after this time, start no fights unless the target is below 35% HP (0 = off)
  // --- opening (sim/train/cand/opening.mjs)
  laserFirst: 0, // until this match time, without a laser: a known laser we reach before any mech is the first objective, ahead of farming and of starting a fight (0 = off)
  laserInit: 0, // holding a laser against a mech in sight that has none: take the first shot inside this range in m (0 = off)
  laserInitUntil: 0, // ...only until this match time (0 = the whole match)
}
// Free-for-all profile (qualifying and the final): the survival-first settings of the first two submissions.
// Applied once, the moment the bot sees mechs dying that it did not kill (see ingest()).
export const P_FFA = {
  hideHp: 0.4, resumeHp: 0.8, initHpLow: 0.75, initAdv: 0.2, vetoAdv: -0.12, vetoCubes: -5, crowd: 90, openingS: 45, calmS: 4,
  healBelow: 0, killLoot: false, dropHeal: false, fightRange: 0, bandRange: 14, noRetreat: false, berserk: false, zapRange: 0,
  farmHard: false, huntUntil: 0, calmAfter: 0, laserFirst: 0, laserInit: 0, laserInitUntil: 0,
}
if (typeof process !== "undefined" && process.env && process.env.FM_P) Object.assign(P, JSON.parse(process.env.FM_P))
if (typeof process !== "undefined" && process.env && process.env.FM_PFFA) Object.assign(P_FFA, JSON.parse(process.env.FM_PFFA))
if (P.preferZap) {
  WEAPON_RANK.laser = 2
  WEAPON_RANK.lightning = 3
}

class Enemy {
  constructor(id) {
    this.id = id
    this.pos = [0, 0, 0]
    this.vel = [0, 0, 0]
    this.vAvg = [0, 0]
    this.aim = [0, 0]
    this.hp = 1400
    this.maxHp = 1400
    this.cubes = 0
    this.weapons = ["gun"]
    this.charging = false
    this.t = -99 // last time listed in obs
    this.firstT = -99
    this.phantom = false
    this.hitMeT = -99
    this.myHitT = -99
    this.busyT = -99 // last time it was seen fighting someone else
    this.hunt = 0
    this.dist = 999
    this.los = false
    this.retreats = 0
  }
  get hpS() {
    return this.maxHp > 0 ? this.hp / this.maxHp : 1
  }
  has(k) {
    return this.weapons.indexOf(k) >= 0
  }
}

export class Brain {
  constructor(hello, world) {
    this.cfg = hello.config
    this.w = world
    this.slot = hello.slot
    this.rand = mulberry((hello.seed ^ 0x9e3779b9) + hello.slot * 7919)
    this.name = "FitzyMate"
    this.en = new Map()
    this.npcs = new Map()
    this.crates = new Map()
    this.picks = new Map()
    this.cubes = new Map()
    this.sounds = []
    this.dmgLog = []
    this.hitLog = []
    this.noCoverT = -99
    this.t = 0
    this.lastDamagedT = -99
    this.lastMechDmgT = -99
    this.lastNpcDmgT = -99
    this.lastDealtT = -99
    this.lastContactT = -99
    this.mode = "hold"
    this.targetId = -1
    this.fightStartT = -99
    this.lostT = -99
    this.cover = null
    this.coverT = -99
    this.recoverT = -99
    this.spot = -1
    this.spotT = -99
    this.badSpots = new Map()
    this.path = null
    this.plink = null
    this.pi = 0
    this.pathGoal = -1
    this.planT = -99
    this.jet = null
    this.posHist = []
    this.unstuckUntil = -99
    this.unstuckDir = [0, 0]
    this.tmpPens = []
    this.strafeSide = this.rand() < 0.5 ? 1 : -1
    this.strafeFlipT = 0
    this.scanYaw = this.rand() * TAU
    this.lastAim = [0, 0]
    this.loot = null
    this.lootT = -99
    this.killLoot = null
    this.shortUntil = -99
    this.charging = false
    this.takeTryT = -99
    this.farmTarget = null
    this.lastMoveCmd = 0
    this.deadline = Infinity
    this.spots = null
    if (world) this._precomputeSpots()
  }

  // ------------------------------------------------------------------ setup
  _precomputeSpots() {
    const w = this.w
    if (w._spots) {
      // computed once per map and shared (the warm-up brain builds it first)
      this.spots = w._spots
      this.main = w._main
      return
    }
    const c = this.cfg.zone?.start_center || [0, 0]
    const start = w.nearestNode(c[0], c[1], w.ground(c[0], c[1]), 3.2, 9.5, 60)
    w.search(start, -1, { allowJet: false, reqR: 3.0, myH: 9.2, maxExp: 1e9 })
    const main = (this.main = new Uint8Array(2 * w.NC))
    for (let k = 0; k < w.nVisited; k++) main[w.visited[k]] = 1
    const sx = [],
      sy = [],
      sz = [],
      sn = [],
      sc = [],
      so = []
    const RAYS = 16,
      LEN = 60
    const slo = [],
      shi = []
    for (let L = 0; L < 2; L++)
      for (let J = 1; J < w.NY - 1; J += 3)
        for (let I = 1; I < w.NX - 1; I += 3) {
          const n = L * w.NC + J * w.NX + I
          if (!main[n] || w.wd[n] < 3.6 || w.clr[n] < 14) continue
          const x = w.nodeX(n),
            y = w.nodeY(n),
            z = w.surf[n]
          let blocked = 0,
            ox = 0,
            oy = 0
          const open = []
          for (let r = 0; r < RAYS; r++) {
            const a = (r / RAYS) * TAU
            const f = w.ray(x, y, z + 8, x + Math.cos(a) * LEN, y + Math.sin(a) * LEN, z + 8)
            open.push(f >= 0.55)
            if (f < 0.55) blocked += 1
            else {
              ox += Math.cos(a)
              oy += Math.sin(a)
            }
          }
          // widest blocked run -> the open sector is its complement
          let bestLen = 0,
            bestStart = 0
          for (let r = 0; r < RAYS; r++) {
            if (open[r]) continue
            let len = 0
            while (len < RAYS && !open[(r + len) % RAYS]) len++
            if (len > bestLen) {
              bestLen = len
              bestStart = r
            }
          }
          const step = TAU / RAYS
          slo.push(bestLen ? (bestStart + bestLen - 0.5) * step : 0)
          shi.push(bestLen ? (bestStart + RAYS - 0.5) * step : TAU)
          sx.push(x)
          sy.push(y)
          sz.push(z)
          sn.push(n)
          sc.push(blocked / RAYS)
          so.push(Math.atan2(oy, ox))
        }
    this.spots = { x: Float32Array.from(sx), y: Float32Array.from(sy), z: Float32Array.from(sz), n: Int32Array.from(sn), cov: Float32Array.from(sc), open: Float32Array.from(so), lo: Float32Array.from(slo), hi: Float32Array.from(shi), count: sx.length }
    w._spots = this.spots
    w._main = this.main
  }

  // ------------------------------------------------------------------ main
  act(o) {
    this.deadline = now() + 16
    const T0 = now()
    this.ingest(o)
    const T1 = now()
    const A = { move: [0, 0], boost: false, jump: false, aim: [this.lastAim[0], this.lastAim[1]], fire: [false, false] }
    this.handleOffer(o, A)
    this.zoneInfo()
    this.decide()
    const T2 = now()
    this.aimTarget = null
    this.prof = { ingest: +(T1 - T0).toFixed(1), decide: +(T2 - T1).toFixed(1), mode: this.mode }
    switch (this.mode) {
      case "zone":
        this.doZone(A)
        break
      case "retreat":
        this.doRetreat(A)
        break
      case "recover":
        this.doRecover(A)
        break
      case "fight":
        this.doFight(A)
        break
      case "loot":
        this.doLoot(A)
        break
      case "explore":
        this.doExplore(A)
        break
      default:
        this.doHold(A)
    }
    const T3 = now()
    this.dodgeShells(A)
    this.unstick(A)
    this.doAimFire(A)
    this.doTake(A)
    this.prof.modeMs = +(T3 - T2).toFixed(1)
    this.prof.tail = +(now() - T3).toFixed(1)
    A.aim[0] = angNorm(A.aim[0])
    A.aim[1] = clamp(A.aim[1], this.minPitch, this.maxPitch)
    this.lastAim = A.aim
    this.lastMoveCmd = hyp(A.move[0], A.move[1])
    if (!(A.move[0] === A.move[0]) || !(A.move[1] === A.move[1])) A.move = [0, 0]
    A.move[0] = +A.move[0].toFixed(3)
    A.move[1] = +A.move[1].toFixed(3)
    A.aim[0] = +A.aim[0].toFixed(4)
    A.aim[1] = +A.aim[1].toFixed(4)
    A.debug = { label: `${this.mode}${this.targetId >= 0 ? " " + this.targetId : ""} hp${Math.round(this.hpS * 100)}` }
    return A
  }

  // ------------------------------------------------------------------ memory
  ingest(o) {
    const me = (this.me = o.self)
    const cfg = this.cfg
    const t = (this.t = o.t)
    this.o = o
    const st = me.stats || {}
    const sc = 1 + (cfg.cubes?.size_per_cube ?? 0.05) * (me.cubes || 0)
    this.R = Math.max(st.radius || 0, (cfg.mech.radius || 2.5) * sc)
    this.Hh = Math.max(st.height || 0, (cfg.mech.height || 9) * sc)
    this.eyeH = st.eye_height || 8 * sc
    this.muzH = st.muzzle_height || 7 * sc
    this.walk = st.walk_speed || 11.7
    this.boostV = st.boost_speed || 19.5
    this.turn = st.turn_rate || 4
    this.pitchRate = st.pitch_rate || 3
    this.minPitch = st.min_pitch ?? -0.7
    this.maxPitch = st.max_pitch ?? 1.3
    this.regenDelay = st.regen_delay ?? 5
    this.reqR = this.R + 0.45
    this.hpS = me.hp / Math.max(1, me.max_hp)
    this.gun = null
    this.laser = null
    this.lightning = null
    this.mortar = null
    this.slotOf = {}
    for (let i = 0; i < 2; i++) {
      const wpn = me.weapons?.[i]
      if (!wpn) continue
      this[wpn.kind] = wpn
      this.slotOf[wpn.kind] = i
    }
    this.myRank = this.laser ? 2 : this.lightning ? 1 : 0
    const [x, y, z] = me.pos

    // mechs & drones
    for (const m of o.mechs || []) {
      if (m.kind === "npc") {
        this.npcs.set(m.id, { id: m.id, pos: m.pos, vel: m.vel, hp: m.hp ?? 350, t })
        continue
      }
      let e = this.en.get(m.id)
      if (!e) {
        e = new Enemy(m.id)
        e.firstT = t
        this.en.set(m.id, e)
      }
      const fresh = t - e.t > 1.5 || e.phantom
      const d = hyp(m.pos[0] - x, m.pos[1] - y)
      if (m.hp != null) {
        if (!fresh && m.hp < e.hp - 1 && t - e.myHitT > 0.35) e.busyT = t
        e.hp = m.hp
        e.maxHp = m.max_hp || e.maxHp
      }
      // closing speed / aimed at us -> it is hunting us
      const bearToMe = Math.atan2(y - m.pos[1], x - m.pos[0])
      const aimOn = Math.abs(angNorm(m.aim[0] - bearToMe)) < 0.22
      if (!fresh) {
        const dt = Math.max(0.05, t - e.t)
        const closing = (e.dist - d) / dt
        const hunting = (closing > 3.5 && d < 140) || (aimOn && d < 210)
        e.hunt = clamp(e.hunt + dt * (hunting ? 1 : -0.6), 0, 6)
        e.vAvg[0] += (m.vel[0] - e.vAvg[0]) * 0.12
        e.vAvg[1] += (m.vel[1] - e.vAvg[1]) * 0.12
      } else {
        e.vAvg[0] = m.vel[0]
        e.vAvg[1] = m.vel[1]
      }
      // aimed elsewhere while firing -> busy with someone else
      e.aimOn = aimOn
      e.pos = m.pos
      e.vel = m.vel
      e.aim = m.aim
      e.cubes = m.cubes || 0
      e.weapons = m.weapons || e.weapons
      e.charging = !!m.charging
      e.dist = d
      e.t = t
      e.phantom = false
    }
    for (const b of o.beams || []) {
      const e = this.en.get(b.by)
      if (!e || !b.path || b.path.length < 2) continue
      const end = b.path[b.path.length - 1]
      if (hyp(end[0] - x, end[1] - y) > 12) e.busyT = t
    }
    // events
    for (const ev of o.events || []) {
      switch (ev.type) {
        case "damaged": {
          this.lastDamagedT = t
          if (ev.by != null && ev.by < 100) {
            this.lastMechDmgT = t
            this.lastContactT = t
            let e = this.en.get(ev.by)
            if (!e) {
              e = new Enemy(ev.by)
              e.firstT = t
              this.en.set(ev.by, e)
            }
            if (t - e.t > 2.5 && ev.bearing != null) {
              // unseen attacker: place a phantom along the bearing
              const D = ev.weapon === "lightning" ? 30 : ev.weapon === "laser" ? 120 : 90
              e.pos = [x + Math.cos(ev.bearing) * D, y + Math.sin(ev.bearing) * D, z]
              e.vel = [0, 0, 0]
              e.phantom = true
              e.t = t
              e.dist = D
              e.aim = [angNorm(ev.bearing + PI), 0]
              if (ev.weapon && ev.weapon !== "gun" && !e.has(ev.weapon)) e.weapons = ["gun", ev.weapon]
            }
            e.hitMeT = t
            e.hunt = Math.max(e.hunt, 2.5)
            this.dmgLog.push([t, ev.amount, ev.by])
          } else if (ev.weapon === "npc") {
            this.lastNpcDmgT = t
            this.npcBearing = ev.bearing
          }
          break
        }
        case "hit": {
          this.lastDealtT = t
          const e = this.en.get(ev.target)
          if (e) {
            e.myHitT = t
            this.lastContactT = t
            this.hitLog.push([t, ev.amount, ev.target])
          }
          break
        }
        case "kill": {
          this.myKills = (this.myKills || 0) + 1
          const e = this.en.get(ev.target)
          if (e) {
            this.killLoot = { pos: e.pos.slice(), t }
            this.en.delete(ev.target)
          }
          if (this.targetId === ev.target) this.targetId = -1
          break
        }
        case "effect":
          if (ev.effect === "short") this.shortUntil = t + (cfg.weapons?.lightning?.short_s ?? 2)
          break
        case "take_failed":
          if (ev.reason === "gone" || ev.reason === "have") this.picks.delete(ev.id)
          break
        case "took":
          this.picks.delete(ev.id)
          break
      }
    }
    while (this.dmgLog.length && this.dmgLog[0][0] < t - 6) this.dmgLog.shift()
    while (this.hitLog.length && this.hitLog[0][0] < t - 6) this.hitLog.shift()
    // forget stale mechs
    for (const [id, e] of this.en) if (t - e.t > 14) this.en.delete(id)
    for (const [id, n] of this.npcs) if (t - n.t > 20 || n.hp <= 0) this.npcs.delete(id)
    // sounds -> rough positions
    for (const s of o.sounds || []) {
      if (s.kind === "death" || s.kind === "drop" || s.kind === "crate" || s.kind === "npc_gun") continue
      const D = s.dist === "near" ? 35 : s.dist === "mid" ? 105 : 230
      this.sounds.push({ kind: s.kind, x: x + Math.cos(s.bearing) * D, y: y + Math.sin(s.bearing) * D, bearing: s.bearing, D, t: t - (s.age || 0) })
    }
    while (this.sounds.length && this.sounds[0].t < t - 8) this.sounds.shift()
    if (this.sounds.length > 80) this.sounds.splice(0, this.sounds.length - 80)
    // items
    this._remember(this.crates, o.crates, 1.2)
    this._remember(this.picks, o.pickups, 0.5)
    this._remember(this.cubes, o.cubes, 0.5)
    // contact bookkeeping + line of sight
    this.vis = []
    for (const e of this.en.values()) {
      e.cur = e.t === t && !e.phantom
      e.los = false
      if (!e.cur) continue
      const es = 1 + 0.05 * e.cubes
      e.cz = e.pos[2] + 4.5 * es
      e.R = 2.5 * es
      e.dist = hyp(e.pos[0] - x, e.pos[1] - y)
      e.los = this.w ? this.w.los(x, y, z + this.eyeH, e.pos[0], e.pos[1], e.cz) || this.w.los(x, y, z + this.eyeH, e.pos[0], e.pos[1], e.pos[2] + 8.6 * es) : true
      if (e.los) {
        e.losT = t
        if (e.dist < 200) this.lastContactT = Math.max(this.lastContactT, t - 2)
      }
      this.vis.push(e)
    }
    // free-for-all or a house squad? In a squad the others never kill each other, so every death
    // other than ours is a kill of ours. Two or more deaths we did not cause means free-for-all.
    const othersDead = (this.cfg.match?.mechs ?? 16) - (o.alive ?? 16) - (this.myKills || 0)
    if (othersDead >= 2 && !this.ffa) {
      this.ffa = true
      if (!(typeof process !== "undefined" && process.env && process.env.FM_NOSWITCH)) Object.assign(P, P_FFA)
    }
    this.posHist.push([x, y, z, t])
    if (this.posHist.length > 14) this.posHist.shift()
    this.myNode = this.w ? this.w.nearestNode(x, y, z, this.reqR, this.Hh) : -1
    this.tmpPens = this.tmpPens.filter((p) => p[4] > t)
  }

  _remember(map, list, zoff) {
    const t = this.t
    const [x, y, z] = this.me.pos
    for (const it of list || []) map.set(it.id, { id: it.id, pos: it.pos, kind: it.kind, hp: it.hp, t })
    if (!this.w) return
    for (const [id, it] of map) {
      if (it.t === t) continue
      const d = hyp(it.pos[0] - x, it.pos[1] - y)
      // somewhere we can plainly see (proximity sensors, or well inside the view wedge) and still not listed: it is gone
      const inWedge = d < 185 && Math.abs(angNorm(Math.atan2(it.pos[1] - y, it.pos[0] - x) - this.me.aim[0])) < 0.85
      if ((d < 38 || inWedge) && this.w.los(x, y, z + this.eyeH, it.pos[0], it.pos[1], it.pos[2] + zoff)) {
        it.miss = (it.miss || 0) + 1
        if (it.miss >= 3) map.delete(id)
      }
    }
  }

  handleOffer(o, A) {
    const of = o.offer
    if (!of || !of.choices?.length) return
    let best = 0,
      bestR = 1e9
    for (let i = 0; i < of.choices.length; i++) {
      let r = UPGRADES.indexOf(of.choices[i].id)
      if (r < 0) r = 50
      if (r < bestR) {
        bestR = r
        best = i
      }
    }
    A.pick = best
  }

  // ------------------------------------------------------------------ zone
  zoneAt(tau) {
    const z = this.o.zone
    const t = this.t
    if (tau <= Math.max(t, z.shrink_start) || z.shrink_end <= z.shrink_start) return [z.center[0], z.center[1], z.radius]
    const t0 = Math.max(t, z.shrink_start)
    const f = clamp((tau - t0) / Math.max(0.01, z.shrink_end - t0), 0, 1)
    return [z.center[0] + (z.next_center[0] - z.center[0]) * f, z.center[1] + (z.next_center[1] - z.center[1]) * f, z.radius + (z.next_radius - z.radius) * f]
  }
  zoneInfo() {
    const z = this.o.zone
    const [x, y] = this.me.pos
    const t = this.t
    const nr = z.next_radius
    this.nc = z.next_center
    this.nr = nr
    this.margin = clamp(P.zoneMarginFrac * nr, 3, 28)
    this.safeR = Math.max(0, nr - this.margin)
    const dn = hyp(x - this.nc[0], y - this.nc[1])
    this.dNext = dn - this.safeR // > 0: outside the safe part of the next circle
    // when does the edge pass over us if we stand still
    let tCross = Infinity
    if (dn > nr - 2) {
      let lo = Math.max(t, z.shrink_start),
        hi = z.shrink_end
      const out = (tau) => {
        const c = this.zoneAt(tau)
        return hyp(x - c[0], y - c[1]) > c[2] - 3
      }
      if (out(lo)) tCross = lo
      else if (out(hi)) {
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) / 2
          if (out(mid)) hi = mid
          else lo = mid
        }
        tCross = hi
      }
    }
    this.tCross = tCross
    const travel = (Math.max(0, this.dNext) * 1.4) / this.walk
    this.zoneSlack = tCross - t - travel
    this.inZone = this.me.in_zone !== false
    this.zoneUrgent = !this.inZone || this.zoneSlack < 7
    this.finalPhase = nr <= 0.5 && z.radius < 40
  }

  // ------------------------------------------------------------------ decisions
  attackers(window = 3) {
    const t = this.t
    const out = []
    for (const e of this.en.values()) if (t - e.hitMeT < window) out.push(e)
    return out
  }
  others(e, radius) {
    let n = 0
    for (const q of this.en.values()) if (q !== e && !q.phantom && this.t - q.t < 3 && q.dist < radius) n++
    return n
  }
  theirRank(e) {
    return e.has("laser") ? 2 : e.has("lightning") ? 1 : 0
  }
  rearOf(e) {
    // are we outside its front arc
    const [x, y] = this.me.pos
    const b = Math.atan2(y - e.pos[1], x - e.pos[0])
    return Math.abs(angNorm(e.aim[0] - b)) > PI / 2
  }
  wantFight(e, defending) {
    const me = this.me
    const hpS = this.hpS
    const adv = hpS - e.hpS
    const cubeDiff = (me.cubes || 0) - (e.cubes || 0)
    if (this.finalPhase) return true
    if (e.hpS < P.finishHp && hpS > P.finishMyHp) return true
    // opening: a laser is a few seconds away and this mech is not on top of us yet -> pick it up first (see pickLoot)
    const lg = this.lasGoal
    if (!defending && lg && this.t - lg.t < 0.3 && lg.d < 70 && e.dist > lg.d + 40) return false
    if (!defending && this.t < P.huntUntil && hpS > 0.6 && e.dist < 200 && e.los) return true
    if (!defending && P.calmAfter > 0 && this.t > P.calmAfter && e.hpS >= 0.35) return false
    if (this.others(e, P.crowd) >= 1) return false
    if (cubeDiff <= P.vetoCubes) return false
    if (adv <= P.vetoAdv) return false
    if (hpS < P.hideHp) return false
    const mine = this.myRank,
      theirs = this.theirRank(e)
    const outgunned = (e.has("laser") && !this.laser) || (e.has("lightning") && !this.lightning && !this.laser && e.dist < 60)
    if (defending) {
      // shot first: answer only when not at a disadvantage; the damage race decides after a few seconds
      if (this.t - this.noCoverT < 4) return true
      if (e.hpS < P.initHpLow) return true
      if (outgunned || cubeDiff <= -2) return adv >= P.defAdvOut
      return adv >= P.defAdv
    }
    if (outgunned && adv < P.outgunAdv) return false
    if (e.hpS < P.initHpLow) return true
    if (adv >= P.initAdv) return true
    if (this.t - e.busyT < 3 && e.hpS < P.busyHp) return true
    if (e.hunt >= 2 && hpS >= P.huntHp && e.dist < P.huntDist) return true // it is coming for us: take the first shot
    if (e.los && e.dist < P.nearDist && adv >= P.nearAdv && hpS >= P.nearHp) return true // too close to go unnoticed
    if (this.t > P.openingS && mine === 2 && theirs < 2 && this.rearOf(e) && e.dist > 45 && e.dist < P.rearDist && hpS > P.rearHp) return true
    // laser against no laser: the side that shoots first wins most of these, so do not wait to be shot
    if (P.laserInit > 0 && mine === 2 && theirs < 2 && e.los && e.dist < P.laserInit && hpS >= 0.6 && (P.laserInitUntil <= 0 || this.t < P.laserInitUntil)) return true
    return false
  }

  /** time-to-kill over time-to-die against e, from the last few seconds of trading. <1 = we are winning. */
  race(e) {
    const t = this.t
    const span = Math.min(5, t - this.fightStartT)
    if (span < 2.5) return null
    let dealt = 0,
      taken = 0
    for (const h of this.hitLog) if (h[2] === e.id && t - h[0] <= span) dealt += h[1]
    for (const d of this.dmgLog) if (t - d[0] <= span) taken += d[1]
    if (dealt + taken < 150) return null
    const ttk = e.hp / Math.max(dealt / span, 8)
    const ttd = this.me.hp / Math.max(taken / span, 8)
    return ttk / ttd
  }

  decide() {
    const t = this.t
    const hpS = this.hpS
    const atk = this.attackers(3)
    const losE = this.vis.filter((e) => e.los)
    let target = this.targetId >= 0 ? this.en.get(this.targetId) : null
    if (target && (t - target.t > 6 || target.phantom)) target = null
    this.calm = t - this.lastContactT > P.calmS && t - this.lastMechDmgT > P.calmS

    // final circle: nowhere left to hide, everything is a fight
    if (this.finalPhase && losE.length) {
      let best = null
      for (const e of losE) if (!best || e.hp < best.hp) best = e
      this.setFight(best)
      return
    }
    if (this.zoneUrgent && !(this.mode === "fight" && this.inZone && this.zoneSlack > 2)) {
      this.mode = "zone"
      return
    }
    // --- cornered: running is not working (a pursuer keeps hitting us), so turn and make it pay
    if (this.mode === "retreat" && atk.length && t - (this.retreatT ?? t) > 3.5 && t - this.lastMechDmgT < 0.8) {
      const close = atk.filter((e) => e.los && e.dist < 120)
      // against three or more there is nothing to win by turning around: keep running
      if (close.length && atk.length <= 2) this.corneredUntil = t + 10
    }
    if (t < (this.corneredUntil ?? -99) && atk.length <= 2) {
      let best = target && target.los ? target : null
      if (!best) for (const e of losE) if (e.dist < 220 && (!best || e.hp < best.hp)) best = e
      if (best) {
        this.setFight(best)
        return
      }
    }
    if (P.berserk && losE.length && !(this.zoneUrgent && !this.inZone)) {
      let best = target && target.los ? target : null
      if (!best) for (const e of losE) if (e.dist < 230 && (!best || e.hp + e.dist * 3 < best.hp + best.dist * 3)) best = e
      if (best) {
        this.setFight(best)
        return
      }
    }
    // --- retreat triggers
    let retreat = false
    if (atk.length >= 2) retreat = true
    else if (atk.length === 1) {
      const e = atk[0]
      if (this.mode === "fight" && target === e) {
        const adv = hpS - e.hpS
        const race = this.race(e)
        this.lastRace = race
        if (this.others(e, P.crowd) >= 1 && e.hpS > 0.22 && t - this.fightStartT > 1) retreat = true
        else if (race != null) {
          // cut losses when out-traded; press on when clearly ahead, even hurt
          if (race > P.raceOut && e.hpS > 0.18) retreat = true
          else if (race > P.raceHurt && hpS < P.hideHp && adv < 0.2) retreat = true
        } else if (hpS < P.hideHp && !(e.hpS < 0.25 && adv > -0.05) && adv < 0.2) retreat = true
        else if (adv < P.retAdv && hpS < P.retHp) retreat = true
      } else if (this.mode === "retreat" && t - (this.retreatT ?? -99) < 2.5 && !(e.hpS < 0.2)) retreat = true
      else if (!this.wantFight(e, true)) retreat = true
      else {
        this.setFight(e)
        return
      }
    } else if (hpS < P.hideHp && losE.length && !(this.mode === "fight" && target && target.hpS < 0.25)) retreat = true
    if (retreat && P.noRetreat && atk.length <= 2 && (target || atk.length)) {
      const e = target && target.los ? target : atk.find((q) => q.los) || null
      if (e) {
        this.setFight(e)
        return
      }
    }
    if (retreat) {
      if (this.mode !== "retreat") {
        this.cover = null
        this.coverT = -99
        this.retreatT = t
        for (const e of atk) e.retreats++
      }
      this.mode = "retreat"
      this.recoverT = t
      this.targetId = -1
      return
    }
    // --- keep retreating / recovering until safe
    if (this.mode === "retreat") {
      const sinceHit = t - this.lastMechDmgT
      const exposed = losE.filter((e) => e.dist < 230)
      if (exposed.length === 1 && sinceHit > 1.5 && hpS >= 0.7 && this.wantFight(exposed[0], false)) {
        this.setFight(exposed[0])
        return
      }
      const healed = hpS >= P.resumeHp || (sinceHit > this.regenDelay + 2 && hpS >= 0.7 && !exposed.length)
      if (!(healed && sinceHit > 2.5) && t - this.recoverT < 40) return
      this.mode = "hold"
      this.spotT = -99
    }
    // --- heal before the next fight (hunters arrive one after another)
    if (P.healBelow > 0 && this.mode !== "fight" && atk.length === 0) {
      const weakInSight = losE.some((e) => e.hpS < 0.3 && e.dist < 200)
      if (!weakInSight && (hpS < P.healBelow || (this.mode === "recover" && hpS < P.healTo))) {
        if (this.mode !== "recover") {
          this.cover = null
          this.coverT = -99
        }
        this.mode = "recover"
        return
      }
      if (this.mode === "recover") this.mode = "hold"
    }
    // --- continue a fight
    if (this.mode === "fight" && target) {
      const lost = t - (target.losT ?? -99)
      const chase = target.hpS < P.chaseHp && hpS > P.chaseMyHp && this.others(target, P.crowd) === 0
      if (lost < (chase ? P.chaseS : 2.5) && t - this.fightStartT < 60) return
      this.mode = "hold"
      this.targetId = -1
    }
    // --- start a fight
    let best = null,
      bestScore = -1e9
    for (const e of losE) {
      if (e.dist > P.startDist) continue
      if (!this.wantFight(e, false)) continue
      const s = (1 - e.hpS) * 100 - e.dist * P.scoreDist + (this.rearOf(e) ? 15 : 0)
      if (s > bestScore) {
        bestScore = s
        best = e
      }
    }
    if (best) {
      this.setFight(best)
      return
    }
    // --- grab the cubes a kill dropped while the coast is clear
    if (P.killLoot && this.killLoot && t - this.killLoot.t < 30 && !losE.some((e) => e.dist < 160)) {
      const [x, y] = this.me.pos
      const d = hyp(this.killLoot.pos[0] - x, this.killLoot.pos[1] - y)
      if (d < 130) {
        this.loot = { type: "cube", id: -7, pos: this.killLoot.pos }
        this.mode = "loot"
        return
      }
    }
    // --- loot when quiet
    this.loot = this.pickLoot()
    this.mode = this.loot ? "loot" : P.farmHard && t < P.farmUntil && hpS > P.exploreHp && this.zoneSlack > 25 && t - this.lastMechDmgT > 4 ? "explore" : "hold"
  }

  setFight(e) {
    if (this.mode !== "fight" || this.targetId !== e.id) this.fightStartT = this.t
    this.mode = "fight"
    this.targetId = e.id
  }

  // ------------------------------------------------------------------ navigation
  pens(extra) {
    const out = []
    const t = this.t
    for (const e of this.en.values()) {
      if (t - e.t > 8) continue
      if (this.mode === "fight" && e.id === this.targetId) continue
      out.push(e.pos[0], e.pos[1], 70, 2.5)
    }
    if (!(this.loot && this.loot.type === "npc"))
      for (const n of this.npcs.values()) if (t - n.t < 15) out.push(n.pos[0], n.pos[1], 52, 2)
    for (const p of this.tmpPens) out.push(p[0], p[1], p[2], p[3])
    if (extra) out.push(...extra)
    return out
  }
  searchOpts(more) {
    const z = this.o.zone
    return Object.assign(
      {
        reqR: this.reqR,
        myH: this.Hh + 0.3,
        maxEnergy: this.me.max_energy,
        pens: this.pens(),
        zone: [z.center[0], z.center[1], Math.max(0, z.radius - 4), 3],
        deadline: Math.min(this.deadline, now() + 10),
        maxExp: 60000,
        tNow: this.t,
        allowJet: false,
      },
      more,
    )
  }
  setPath(p, goal) {
    const w = this.w
    this.path = p
    this.pathGoal = goal
    this.planT = this.t
    this.pi = 0
    this.jet = null
    if (!p) {
      this.plink = null
      return
    }
    const pl = (this.plink = new Int32Array(p.length).fill(-1))
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i],
        b = p[i + 1]
      const adj = Math.abs(w.nodeX(a) - w.nodeX(b)) <= 2.01 && Math.abs(w.nodeY(a) - w.nodeY(b)) <= 2.01
      if (!adj || Math.abs(w.surf[a] - w.surf[b]) > 3.6) pl[i] = w.linkBetween(a, b)
    }
  }
  /** plan (or keep) a path to a node. Returns false when no route exists. */
  goTo(goal, o = {}) {
    const w = this.w
    if (!w || goal < 0 || this.myNode < 0) return false
    const age = this.t - this.planT
    const need = !this.path || this.pathGoal !== goal || age > (o.replan ?? 5) || this.pathPartial
    if (need && (age > 0.35 || this.pathGoal !== goal)) {
      if (now() > this.deadline - 6 && this.path && this.pathGoal === goal) return true
      const walkable = this.main && this.main[this.myNode] && this.main[goal]
      const p = w.search(this.myNode, goal, this.searchOpts(Object.assign({ allowJet: !walkable }, o.search)))
      this.pathPartial = w.partial
      this.setPath(p, goal)
      if (!p) this.planT = this.t
    }
    return !!this.path
  }
  /** steer along the current path. Returns true when the end is reached. */
  follow(A, speed = 1, boost = false) {
    const w = this.w,
      me = this.me,
      p = this.path
    if (!p || !p.length) return true
    const [x, y, z] = me.pos
    const last = p.length - 1
    let i = Math.min(this.pi, last)
    // advance to the closest upcoming walk node (never past a link)
    let lim = i
    while (lim < last && lim < i + 10 && this.plink[lim] < 0) lim++
    let bi = i,
      bd = 1e18
    for (let k = i; k <= lim; k++) {
      const d = hyp(w.nodeX(p[k]) - x, w.nodeY(p[k]) - y) + Math.abs(w.surf[p[k]] - z) * 2
      if (d < bd - 0.01) {
        bd = d
        bi = k
      }
    }
    i = bi
    if (i < last && this.plink[i] >= 0) {
      const b = p[i + 1]
      if (me.grounded && hyp(w.nodeX(b) - x, w.nodeY(b) - y) < 3.2 && Math.abs(z - w.surf[b]) < 1.6) {
        i++
        this.jet = null
      }
    }
    this.pi = i
    const steer = (tx, ty, sp) => {
      const dx = tx - x,
        dy = ty - y,
        d = hyp(dx, dy)
      if (d < 1e-3) return
      A.move = [(dx / d) * sp, (dy / d) * sp]
    }
    if (i >= last) {
      const gx = w.nodeX(p[last]),
        gy = w.nodeY(p[last])
      const d = hyp(gx - x, gy - y)
      if (d < 1.1) return true
      steer(gx, gy, Math.min(speed, Math.max(0.25, d / 4)))
      return false
    }
    if (this.plink[i] >= 0) {
      const rise = w.lkRise[this.plink[i]]
      if (rise > 0) this.doJet(A, i, rise, steer)
      else {
        steer(w.nodeX(p[i + 1]), w.nodeY(p[i + 1]), 1)
      }
      return false
    }
    let target = Math.min(lim, i + 9)
    if (target <= i) target = i + 1
    while (target > i + 1 && !w.walkLine(x, y, z, w.nodeX(p[target]), w.nodeY(p[target]), this.reqR - 0.35, this.Hh)) target--
    // slow into a link start so we stop on it
    let sp = speed
    if (this.plink[target] >= 0 && w.lkRise[this.plink[target]] > 0) {
      const d = hyp(w.nodeX(p[target]) - x, w.nodeY(p[target]) - y)
      sp = Math.min(speed, Math.max(0.3, d / 4))
    }
    steer(w.nodeX(p[target]), w.nodeY(p[target]), sp)
    this.steerTarget = [w.nodeX(p[target]), w.nodeY(p[target])]
    if (boost && me.energy > 12) A.boost = true
    return false
  }
  doJet(A, i, rise, steer) {
    const w = this.w,
      me = this.me,
      p = this.path
    const a = p[i],
      b = p[i + 1]
    const [x, y, z] = me.pos
    const zb = w.surf[b]
    const da = hyp(w.nodeX(a) - x, w.nodeY(a) - y)
    if (!this.jet || this.jet.i !== i) this.jet = { i, phase: "prep", fails: 0, t0: this.t }
    const st = this.jet
    const drain = (me.stats?.jet_drain || 15) / 15
    const need = Math.min(me.max_energy - 1, rise * 1.5 * drain + 16)
    if (st.phase === "prep") {
      if (da > 1.7 || !me.grounded) {
        steer(w.nodeX(a), w.nodeY(a), Math.min(1, Math.max(0.3, da / 3)))
        return
      }
      if (me.energy < need) {
        A.move = [0, 0]
        this.waitingJet = this.t
        return
      }
      A.jump = true
      A.boost = true
      steer(w.nodeX(b), w.nodeY(b), 1)
      st.phase = "air"
      st.t0 = this.t
      return
    }
    steer(w.nodeX(b), w.nodeY(b), 1)
    A.boost = z < zb + 1.3
    if (me.grounded && this.t - st.t0 > 0.5 && z < zb - 0.9) {
      st.fails++
      st.phase = "prep"
      if (st.fails >= 2) {
        w.banLink(this.plink[i], this.t + 40)
        this.path = null
        this.jet = null
      }
    }
  }
  /** straight-line fallback when there is no map or no route */
  steerTo(A, tx, ty, speed = 1) {
    const [x, y] = this.me.pos
    const dx = tx - x,
      dy = ty - y,
      d = hyp(dx, dy)
    if (d < 1) return true
    A.move = [(dx / d) * speed, (dy / d) * speed]
    return false
  }
  moveToPoint(A, px, py, pz, speed = 1, boost = false, o) {
    if (!this.w) return this.steerTo(A, px, py, speed)
    const goal = this.w.nearestNode(px, py, pz ?? this.w.ground(px, py), this.reqR, this.Hh + 0.3, 16)
    if (goal < 0 || !this.goTo(goal, o)) return this.steerTo(A, px, py, speed)
    return this.follow(A, speed, boost)
  }
  unstick(A) {
    const t = this.t
    const w = this.w
    if (this.escape) {
      // boxed in somewhere the mesh does not cover: jet up and over toward open ground
      const E = this.escape
      const [x, y, z] = this.me.pos
      const d = hyp(E.x - x, E.y - y)
      if (t > E.until || (this.me.grounded && d < 2.5 && Math.abs(z - E.z) < 2) || (this.me.grounded && w && w.nodeAt(x, y, z, 1.5) >= 0 && w.wd[w.nodeAt(x, y, z, 1.5)] >= this.reqR && t - E.t0 > 1)) {
        this.escape = null
        this.path = null
        this.stuckSince = t
      } else {
        A.move = d > 0.5 ? [(E.x - x) / d, (E.y - y) / d] : [0, 0]
        if (this.me.grounded && this.me.energy > 30) A.jump = true
        A.boost = !this.me.grounded && z < E.top + 1.5
        return
      }
    }
    if (t < this.unstuckUntil) {
      A.move = [this.unstuckDir[0], this.unstuckDir[1]]
      A.jump = this.me.grounded
      return
    }
    const h = this.posHist
    if (this.lastMoveCmd < 0.3 || h.length < 12 || this.charging || (this.jet && this.jet.phase === "air")) {
      this.stuckSince = t
      return
    }
    const a = h[h.length - 12],
      b = h[h.length - 1]
    const moved = hyp(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    if (moved > 1.3) this.stuckSince = t
    if (t - (this.stuckSince ?? t) > 0.7) {
      this.stuckCount = t - (this.lastStuckT ?? -99) < 4 ? (this.stuckCount || 0) + 1 : 1
      this.lastStuckT = t
      if (w && this.stuckCount >= 3 && this.me.energy > 40) {
        // repeatedly stuck: find open ground nearby and go over whatever is in the way
        const [x, y, z] = this.me.pos
        let best = -1,
          bd = 1e18
        for (let dj = -10; dj <= 10; dj++)
          for (let di = -10; di <= 10; di++) {
            const I = Math.round((x - w.minX) / 2) + di,
              J = Math.round((y - w.minY) / 2) + dj
            if (I < 0 || J < 0 || I >= w.NX || J >= w.NY) continue
            for (let L = 0; L < 2; L++) {
              const n = L * w.NC + J * w.NX + I
              if (!(this.main && this.main[n]) || w.wd[n] < this.reqR + 0.5) continue
              const dd = di * di + dj * dj + (w.surf[n] > z + 30 ? 1e6 : 0)
              if (dd > 2 && dd < bd) {
                bd = dd
                best = n
              }
            }
          }
        if (best >= 0) {
          const bx = w.nodeX(best),
            by = w.nodeY(best)
          // clear the tallest thing between here and there
          let top = w.surf[best]
          for (let k = 0; k <= 10; k++) top = Math.max(top, Math.min(z + 45, w.topZ(x + ((bx - x) * k) / 10, y + ((by - y) * k) / 10)))
          this.escape = { x: bx, y: by, z: w.surf[best], top, until: t + 8, t0: t }
          this.stuckCount = 0
          return
        }
      }
      const ang = this.rand() * TAU
      this.unstuckDir = [Math.cos(ang), Math.sin(ang)]
      this.unstuckUntil = t + 0.45
      this.stuckSince = t + 0.45
      if (this.steerTarget) this.tmpPens.push([this.steerTarget[0], this.steerTarget[1], 6, 6, t + 12])
      this.path = null
    }
  }

  // ------------------------------------------------------------------ modes
  /** best standable node inside a small next circle: ground if there is any, otherwise a roof */
  zoneNode() {
    const w = this.w
    if (!w) return -1
    const nc = this.nc
    const key = `${Math.round(nc[0])},${Math.round(nc[1])},${Math.round(this.nr)},${Math.round(this.R * 10)}`
    if (this.zoneNodeKey === key) return this.zoneNodeVal
    const rad = Math.min(34, Math.max(8, this.nr))
    const I0 = Math.round((nc[0] - w.minX) / 2),
      J0 = Math.round((nc[1] - w.minY) / 2)
    const rc = Math.ceil(rad / 2)
    let best = -1,
      bs = 1e18
    for (let dj = -rc; dj <= rc; dj++)
      for (let di = -rc; di <= rc; di++) {
        const I = I0 + di,
          J = J0 + dj
        if (I < 0 || J < 0 || I >= w.NX || J >= w.NY) continue
        for (let L = 0; L < 2; L++) {
          const n = L * w.NC + J * w.NX + I
          const sf = w.surf[n]
          if (sf !== sf || w.wd[n] < this.reqR || w.clr[n] < this.Hh + 0.3) continue
          const d = hyp(w.nodeX(n) - nc[0], w.nodeY(n) - nc[1])
          const sc = d + (this.main && this.main[n] ? 0 : 6 + (sf - w.ground(w.nodeX(n), w.nodeY(n))) * 0.4)
          if (sc < bs) {
            bs = sc
            best = n
          }
        }
      }
    this.zoneNodeKey = key
    this.zoneNodeVal = best
    return best
  }
  /** walk (or jet) to the middle of a small next circle */
  goZoneCore(A, boost) {
    const n = this.zoneNode()
    if (n < 0 || !this.goTo(n, { search: { zone: null, maxExp: 120000 } })) return this.moveToPoint(A, this.nc[0], this.nc[1], undefined, 1, boost)
    return this.follow(A, 1, boost)
  }

  doZone(A) {
    const [x, y] = this.me.pos
    const nc = this.nc
    if (this.nr <= 34) {
      this.goZoneCore(A, !this.inZone || this.zoneSlack < 2)
      this.scan(A, null)
      return
    }
    // aim for a point just inside the safe ring on our side
    const d = hyp(x - nc[0], y - nc[1])
    const r = Math.max(0, this.safeR - 6)
    const k = d > 1 ? Math.min(1, r / d) : 0
    const tx = nc[0] + (x - nc[0]) * k,
      ty = nc[1] + (y - nc[1]) * k
    const hurry = !this.inZone || this.zoneSlack < 2
    this.moveToPoint(A, tx, ty, undefined, 1, hurry, { search: { zone: null } })
    this.scan(A, null)
  }

  pickSpot() {
    const S = this.spots
    if (!S) return -1
    const t = this.t
    const [x, y] = this.me.pos
    const z = this.o.zone
    const nc = this.nc
    const safeR = this.safeR
    const threats = []
    for (const e of this.en.values()) if (t - e.t < 15) threats.push([e.pos[0], e.pos[1], e.pos[2], 1 - (t - e.t) / 20])
    const snd = this.sounds.filter((s) => t - s.t < 6 && s.kind !== "step" && s.kind !== "boost" && s.kind !== "jet" && s.kind !== "reload")
    const top = []
    const ringLo = this.nr > 60 ? 0.45 : 0
    for (let k = 0; k < S.count; k++) {
      const sx = S.x[k],
        sy = S.y[k]
      const dc = hyp(sx - nc[0], sy - nc[1])
      if (dc > safeR) continue
      if (hyp(sx - z.center[0], sy - z.center[1]) > z.radius - 5) continue
      const d = hyp(sx - x, sy - y)
      if (d > 380) continue
      const until = this.badSpots.get(k)
      if (until && until > t) continue
      let s = 46 * S.cov[k] - 0.13 * d
      if (this.nr > 1) {
        const rr = dc / this.nr
        if (rr < ringLo) s -= 30 * (ringLo - rr)
      }
      for (const th of threats) {
        const de = hyp(sx - th[0], sy - th[1])
        if (de < 170) s -= 0.3 * (170 - de) * th[3]
      }
      for (const q of snd) {
        const ds = hyp(sx - q.x, sy - q.y)
        if (ds < 110) s -= 0.07 * (110 - ds)
      }
      for (const n of this.npcs.values()) if (hyp(sx - n.pos[0], sy - n.pos[1]) < 58) s -= 22
      if (k === this.spot) s += 14
      if (top.length < 8) {
        top.push([s, k])
        top.sort((a, b) => b[0] - a[0])
      } else if (s > top[7][0]) {
        top[7] = [s, k]
        top.sort((a, b) => b[0] - a[0])
      }
    }
    let best = -1,
      bestS = -1e9
    for (const [s0, k] of top) {
      let s = s0
      for (const th of threats) {
        if (hyp(S.x[k] - th[0], S.y[k] - th[1]) > 260) continue
        if (this.w.los(th[0], th[1], th[2] + 8, S.x[k], S.y[k], S.z[k] + 4.5)) s -= 28 * th[3]
      }
      if (s > bestS) {
        bestS = s
        best = k
      }
    }
    return best
  }

  doHold(A) {
    const t = this.t
    const me = this.me
    const [x, y, z] = me.pos
    if (!this.spots) {
      // no map: drift to the safe ring
      if (this.dNext > 0) this.steerTo(A, this.nc[0], this.nc[1], 1)
      this.scan(A)
      return
    }
    const S = this.spots
    let invalid = this.spot < 0
    if (!invalid) {
      const dc = hyp(S.x[this.spot] - this.nc[0], S.y[this.spot] - this.nc[1])
      if (dc > this.safeR + 1) invalid = true
    }
    if (invalid || t - this.spotT > 1.5) {
      const k = this.pickSpot()
      this.spotT = t
      if (k >= 0) this.spot = k
      else if (invalid) this.spot = -1
    }
    if (this.spot < 0) {
      // nothing scored (tiny final circle, roof, ...): go to the middle of the next circle
      this.goZoneCore(A, false)
      this.scan(A, null)
      return
    }
    const sx = S.x[this.spot],
      sy = S.y[this.spot]
    const d = hyp(sx - x, sy - y)
    if (d < 1.6 && Math.abs(z - S.z[this.spot]) < 2) {
      A.move = [0, 0]
      this.scan(A, this.spot)
      return
    }
    if (!this.goTo(S.n[this.spot])) {
      this.badSpots.set(this.spot, t + 25)
      this.spot = -1
      this.spotT = -99
      this.scan(A)
      return
    }
    if (this.pathPartial && this.path && this.path.length < 6) this.badSpots.set(this.spot, t + 25)
    // silent approach when someone unseen is close
    let speed = 1
    for (const e of this.en.values()) if (t - e.t < 6 && e.dist < P.silentNear && !e.los) speed = 0.4
    for (const q of this.sounds) if (t - q.t < 3 && q.D < 60 && (q.kind === "step" || q.kind === "boost")) speed = 0.4
    if (this.zoneSlack < 25) speed = 1
    this.follow(A, speed, false)
    this.scan(A, null)
  }

  hiddenFrom(threats, mx, my, mz) {
    const w = this.w
    const ch = 4.5 * (this.Hh / 9)
    for (const th of threats) {
      if (w.los(th[0], th[1], th[2] + 8, mx, my, mz + ch) || w.los(th[0], th[1], th[2] + 8, mx, my, mz + this.Hh - 0.3)) return false
    }
    return true
  }
  /** nearest spot out of every threat's sight, weighted toward distance from them */
  findCover(threats) {
    const w = this.w
    if (!w || this.myNode < 0) return null
    const t = this.t
    const [x, y] = this.me.pos
    const pens = []
    let curD = 1e9
    for (const th of threats) {
      pens.push(th[0], th[1], 80, 3)
      curD = Math.min(curD, hyp(x - th[0], y - th[1]))
    }
    const zc = this.zoneAt(t + 8)
    w.search(this.myNode, -1, this.searchOpts({ maxCost: 150, maxExp: 12000, pens: this.pens(pens), zone: [zc[0], zc[1], Math.max(0, zc[2] - 6), 4] }))
    const n = w.nVisited
    const vis = w.visited
    const floor = Math.min(curD - 4, 42)
    let best = -1,
      bestScore = 1e18
    for (let k = 0; k < n; k++) {
      const m = vis[k]
      const c = m % w.NC
      if ((c % w.NX) % 3 || ((c / w.NX) | 0) % 3) continue
      const g = w.gS[m]
      if (g * 0.55 - 112 > bestScore) break
      if ((k & 127) === 0 && now() > this.deadline) break
      const mx = w.nodeX(m),
        my = w.nodeY(m),
        mz = w.surf[m]
      if (hyp(mx - zc[0], my - zc[1]) > zc[2] - 4) continue
      let dmin = 1e9
      for (const th of threats) {
        const de = hyp(mx - th[0], my - th[1])
        if (de < dmin) dmin = de
      }
      if (dmin < floor) continue
      const score = g * 0.55 - Math.min(dmin, 160) * 0.7
      if (score >= bestScore) continue
      if (!this.hiddenFrom(threats, mx, my, mz)) continue
      bestScore = score
      best = m
    }
    if (best < 0) return null
    const path = w.pathTo(best)
    return { node: best, path, x: w.nodeX(best), y: w.nodeY(best), z: w.surf[best] }
  }

  threatList() {
    const t = this.t
    const list = []
    for (const e of this.en.values()) {
      if (t - e.t > 7) continue
      const w = (t - e.hitMeT < 4 ? 3 : 0) + (e.los ? 2 : 0) + (e.dist < 120 ? 1 : 0) + (e.phantom ? -1 : 0)
      list.push([e.pos[0], e.pos[1], e.pos[2], w, e])
    }
    list.sort((a, b) => b[3] - a[3])
    return list.slice(0, 3)
  }

  doRetreat(A) {
    const t = this.t
    const me = this.me
    const [x, y, z] = me.pos
    const threats = this.threatList()
    const main = threats[0]?.[4]
    const exposed = threats.some((th) => th[4].los)
    const underFire = t - this.lastMechDmgT < 1.2
    if (threats.length && this.w && t - this.coverT > 0.45) {
      this.coverT = t
      let keep = false
      if (this.cover) {
        // still out of sight, and the pursuer is not about to walk onto it
        let dmin = 1e9
        for (const th of threats) dmin = Math.min(dmin, hyp(this.cover.x - th[0], this.cover.y - th[1]))
        keep = dmin > 48 && this.hiddenFrom(threats, this.cover.x, this.cover.y, this.cover.z)
      }
      if (!keep) {
        const c = this.findCover(threats)
        if (c) {
          this.cover = c
          this.setPath(c.path, c.node)
        } else {
          this.cover = null
          this.noCoverT = t
        }
      }
    }
    if (this.cover) {
      if (this.pathGoal !== this.cover.node || !this.path) this.goTo(this.cover.node, { search: { zone: null } })
      const close = main && main.dist < 75
      const arrived = this.follow(A, 1, exposed || underFire || close)
      if (arrived) A.move = [0, 0]
    } else if (main) {
      // nowhere to hide: run from the threat, bending toward the zone
      let dx = x - main.pos[0],
        dy = y - main.pos[1]
      const d = hyp(dx, dy) || 1
      dx /= d
      dy /= d
      const cx = this.nc[0] - x,
        cy = this.nc[1] - y,
        cd = hyp(cx, cy) || 1
      const zw = this.dNext > -10 ? 1.2 : 0.3
      this.moveToPoint(A, x + (dx + (cx / cd) * zw) * 40, y + (dy + (cy / cd) * zw) * 40, undefined, 1, true, { replan: 1 })
      A.boost = me.energy > 10
    } else {
      this.doHold(A)
      return
    }
    // face the attacker (rear armor); shooting back is handled in doAimFire
    if (main) {
      this.aimTarget = main.los ? main : null
      if (!main.los) A.aim = [Math.atan2(main.pos[1] - y, main.pos[0] - x) + (exposed ? 0 : 0.5 * Math.sin(t * 1.9)), 0]
    } else this.scan(A)
  }

  /** out of combat but hurt: get out of everyone's sight and regenerate */
  doRecover(A) {
    const t = this.t
    const threats = []
    for (const e of this.en.values()) if (t - e.t < 20) threats.push([e.pos[0], e.pos[1], e.pos[2], 1, e])
    threats.sort((a, b) => a[4].dist - b[4].dist)
    if (!threats.length || !this.w) {
      this.doHold(A)
      return
    }
    const th = threats.slice(0, 4)
    if (t - this.coverT > 0.8) {
      this.coverT = t
      const keep = this.cover && this.hiddenFrom(th, this.cover.x, this.cover.y, this.cover.z) && th.every((q) => hyp(this.cover.x - q[0], this.cover.y - q[1]) > 50)
      if (!keep) {
        const c = this.findCover(th)
        this.cover = c
        if (c) this.setPath(c.path, c.node)
      }
    }
    if (!this.cover) {
      this.doHold(A)
      return
    }
    if (this.pathGoal !== this.cover.node || !this.path) this.goTo(this.cover.node, { search: { zone: null } })
    if (this.follow(A, 1, false)) A.move = [0, 0]
    const near = th[0][4]
    A.aim = [Math.atan2(near.pos[1] - this.me.pos[1], near.pos[0] - this.me.pos[0]) + 0.4 * Math.sin(t * 1.7), 0]
    this.aimTarget = near.los ? near : null
  }

  /** farming phase with nothing known to farm: walk to the nearest unvisited part of the circle */
  doExplore(A) {
    const t = this.t
    const [x, y] = this.me.pos
    const C = 60
    const vis = (this.visitedCells ??= new Map())
    vis.set(`${Math.round(x / C)},${Math.round(y / C)}`, t)
    const zc = this.o.zone
    const need = !this.exploreGoal || hyp(this.exploreGoal[0] - x, this.exploreGoal[1] - y) < 12 || t - this.exploreT > 25 || vis.has(this.exploreGoal[2])
    if (need) {
      let best = null,
        bs = 1e18
      const r = Math.max(60, this.nr - 10)
      for (let gx = Math.round((this.nc[0] - r) / C); gx <= Math.round((this.nc[0] + r) / C); gx++)
        for (let gy = Math.round((this.nc[1] - r) / C); gy <= Math.round((this.nc[1] + r) / C); gy++) {
          const k = `${gx},${gy}`
          if (vis.has(k)) continue
          const px = gx * C,
            py = gy * C
          if (hyp(px - this.nc[0], py - this.nc[1]) > r || hyp(px - zc.center[0], py - zc.center[1]) > zc.radius - 15) continue
          if (this.w && this.w.nearestNode(px, py, this.w.ground(px, py), this.reqR, this.Hh + 0.3, 8) < 0) continue
          let d = hyp(px - x, py - y)
          for (const e of this.en.values()) if (t - e.t < 15 && hyp(px - e.pos[0], py - e.pos[1]) < 120) d += 200
          if (d < bs) {
            bs = d
            best = [px, py, k]
          }
        }
      this.exploreGoal = best
      this.exploreT = t
    }
    if (!this.exploreGoal) {
      this.doHold(A)
      return
    }
    if (this.moveToPoint(A, this.exploreGoal[0], this.exploreGoal[1], undefined, 1, false)) vis.set(this.exploreGoal[2], t)
    this.scan(A, null)
  }

  doFight(A) {
    const t = this.t
    const me = this.me
    const e = this.en.get(this.targetId)
    if (!e) {
      this.doHold(A)
      return
    }
    const [x, y, z] = me.pos
    this.aimTarget = e
    if (!e.los) {
      // chase / re-acquire through cover toward where it is
      const lead = Math.min(2, t - e.t)
      this.moveToPoint(A, e.pos[0] + e.vel[0] * lead, e.pos[1] + e.vel[1] * lead, e.pos[2], 1, false, { replan: 1.2 })
      A.aim = [Math.atan2(e.pos[1] - y, e.pos[0] - x), 0]
      return
    }
    const dx = e.pos[0] - x,
      dy = e.pos[1] - y
    const d = hyp(dx, dy) || 1
    const ux = dx / d,
      uy = dy / d
    if (this.duck(A, e)) return
    this.path = null
    // preferred range by loadout: far enough that bullets can be side-stepped
    let pr = P.fightRange > 0 ? P.fightRange + (this.laser ? 8 : 0) : this.laser ? 112 : 104
    if (this.lightning && !this.laser && (this.hpS - e.hpS > 0.1 || e.hpS < 0.45) && !e.has("lightning")) pr = 34
    if (P.zapRange > 0 && this.lightning && this.me.energy > 22 && !(e.has("lightning") && this.hpS < e.hpS)) pr = P.zapRange
    if (this.finalPhase) pr = Math.min(pr, 45)
    const maxR = (this.gun?.stats?.range || 230) - 30
    pr = Math.min(pr, maxR)
    let radial = clamp((d - pr) / P.bandRange, -1, 1)
    if (e.hpS < 0.3 && this.hpS > 0.4 && d > 60) radial = Math.max(radial, 0.5)
    if (t > this.strafeFlipT) {
      this.strafeSide = -this.strafeSide
      this.strafeFlipT = t + 0.3 + this.rand() * 0.65
    }
    let zx = 0,
      zy = 0
    if (this.dNext > -8) {
      // stay inside the circle
      const cx = this.nc[0] - x,
        cy = this.nc[1] - y,
        cd = hyp(cx, cy) || 1
      zx = (cx / cd) * 0.8
      zy = (cy / cd) * 0.8
    }
    const mk = (side, rad) => {
      const mx = -uy * side + ux * rad + zx,
        my = ux * side + uy * rad + zy
      const m = hyp(mx, my) || 1
      return [mx / m, my / m]
    }
    const w = this.w
    const onMesh = !w || (w.nodeAt(x, y, z, 1.8) >= 0 && w.wd[w.nodeAt(x, y, z, 1.8)] >= this.reqR - 0.35)
    const free = (mv) => !w || w.walkLine(x, y, z, x + mv[0] * 5, y + mv[1] * 5, this.reqR - 0.3, this.Hh)
    if (!onMesh && this.myNode >= 0) {
      // pressed against a wall: step back into the open first
      this.steerTo(A, w.nodeX(this.myNode), w.nodeY(this.myNode), 1)
      return
    }
    const s0 = this.strafeSide
    // candidates, planned one first; the dodge picks whichever clears the bullets in the air
    const cands = [mk(s0, radial * 0.75), mk(-s0, radial * 0.75), mk(s0, -1), mk(-s0, -1), mk(s0, 1), mk(-s0, 1), [0, 0]]
    let best = null,
      bestScore = -1e9
    const need = this.R + 1.3
    for (let k = 0; k < cands.length; k++) {
      const mv = cands[k]
      if (k < 6 && !free(mv)) continue
      const miss = Math.min(this.missDist(mv), need)
      const score = miss * 10 - k * 0.6 - (k === 6 ? 3 : 0)
      if (score > bestScore) {
        bestScore = score
        best = mv
        if (k === 0 && miss >= need) break
      }
    }
    if (!best) best = [-ux, -uy]
    if (best === cands[1] || best === cands[3] || best === cands[5]) {
      this.strafeSide = -s0
      this.strafeFlipT = t + 0.25 + this.rand() * 0.5
    }
    A.move = best
    // a lightning carrier inside its reach: open the range fast
    if (e.has("lightning") && d < 52 && this.me.energy > 25 && !(this.lightning && this.hpS > e.hpS)) {
      A.move = mk(s0 * 0.35, -1)
      if (free(A.move)) A.boost = true
    }
  }

  /**
   * With the magazine empty and nothing else to shoot with, step behind the nearest corner for the
   * reload instead of standing in the open, then come back out.
   */
  duck(A, e) {
    const w = this.w
    const gun = this.gun
    if (!w || !gun || this.myNode < 0) return false
    const t = this.t
    const reloading = gun.reload > 0.55 || (gun.ammo === 0 && !(gun.reload > 0))
    const laserBusy = this.laser && (this.charging || (this.laser.cooldown || 0) < 0.5) && t >= this.shortUntil
    const zap = this.lightning && e.dist < (this.lightning.stats.range ?? 45) && this.me.energy > 15
    if (!reloading || laserBusy || zap || e.hpS < 0.12) {
      this.duckSpot = null
      return false
    }
    if (!this.duckSpot || t - this.duckT > 0.4) {
      this.duckT = t
      const th = [[e.pos[0], e.pos[1], e.pos[2]]]
      const reach = Math.max(6, (gun.reload > 0 ? gun.reload : gun.stats.reload ?? 2.4) * this.walk * 0.42)
      w.search(this.myNode, -1, this.searchOpts({ maxCost: reach, maxExp: 1500, pens: null, zone: null }))
      let best = -1
      for (let k = 0; k < w.nVisited; k++) {
        const m = w.visited[k]
        if (this.hiddenFrom(th, w.nodeX(m), w.nodeY(m), w.surf[m])) {
          best = m
          break
        }
      }
      this.duckSpot = best >= 0 ? { node: best, path: w.pathTo(best) } : null
      if (this.duckSpot) this.setPath(this.duckSpot.path, best)
    }
    if (!this.duckSpot) return false
    if (this.pathGoal !== this.duckSpot.node || !this.path) this.setPath(this.duckSpot.path, this.duckSpot.node)
    if (this.follow(A, 1, false)) A.move = [0, 0]
    return true
  }

  /** smallest miss distance of visible incoming bullets if we steer along mv (accel-limited) */
  missDist(mv) {
    const ps = this.o.projectiles
    if (!ps || !ps.length) return 99
    const me = this.me
    const [x, y, z] = me.pos
    let best = 99
    const sp = this.walk * (this.charging ? 0.5 : 1)
    const acc = me.stats?.ground_accel || 58.5
    const tvx = mv[0] * sp,
      tvy = mv[1] * sp
    const dvx = tvx - me.vel[0],
      dvy = tvy - me.vel[1]
    const dv = hyp(dvx, dvy)
    const t1 = dv / acc
    for (const p of ps) {
      if (p.kind === "mortar") continue
      const v2 = p.vel[0] * p.vel[0] + p.vel[1] * p.vel[1]
      if (v2 < 1) continue
      // time the bullet is level with us (it barely matters where we end up along its path)
      const tca = ((x - p.pos[0]) * p.vel[0] + (y - p.pos[1]) * p.vel[1]) / v2
      if (tca < -0.02 || tca > 1.6) continue
      const T = Math.max(0, tca) + 0.05
      let fx, fy
      if (T <= t1 && dv > 1e-6) {
        fx = x + me.vel[0] * T + ((0.5 * dvx) / dv) * acc * T * T
        fy = y + me.vel[1] * T + ((0.5 * dvy) / dv) * acc * T * T
      } else {
        fx = x + me.vel[0] * t1 + 0.5 * dvx * t1 + tvx * (T - t1)
        fy = y + me.vel[1] * t1 + 0.5 * dvy * t1 + tvy * (T - t1)
      }
      const pz = p.pos[2] + p.vel[2] * T
      if (pz < z - 1.5 || pz > z + this.Hh + 1.5) continue
      // perpendicular distance from our future center to the bullet line
      const rx = fx - p.pos[0],
        ry = fy - p.pos[1]
      const m = Math.abs(rx * p.vel[1] - ry * p.vel[0]) / Math.sqrt(v2)
      if (m < best) best = m
    }
    return best
  }

  dodgeShells(A) {
    const ps = this.o.projectiles
    if (!ps || !ps.length) return
    const [x, y, z] = this.me.pos
    const g = this.cfg.weapons?.mortar?.gravity ?? 22
    const rad = (this.cfg.weapons?.mortar?.splash_radius ?? 7) + this.R + 1.5
    for (const p of ps) {
      if (p.kind !== "mortar") continue
      // time to come down to our feet
      const dz = p.pos[2] - z
      const vz = p.vel[2]
      const disc = vz * vz + 2 * g * dz
      if (disc < 0) continue
      const tt = (vz + Math.sqrt(disc)) / g
      if (tt > 2.5) continue
      const ix = p.pos[0] + p.vel[0] * tt,
        iy = p.pos[1] + p.vel[1] * tt
      const d = hyp(x - ix, y - iy)
      if (d > rad) continue
      let dx = x - ix,
        dy = y - iy
      if (d < 0.5) {
        dx = -p.vel[1]
        dy = p.vel[0]
      }
      const m = hyp(dx, dy) || 1
      A.move = [dx / m, dy / m]
      A.boost = this.me.energy > 8
      return
    }
  }

  // ------------------------------------------------------------------ loot
  pickLoot() {
    const t = this.t
    const me = this.me
    if (P.dropHeal && this.hpS < 0.85 && this.zoneSlack > 10) {
      const [x, y] = me.pos
      let best = null
      for (const dr of this.o.drops || []) {
        if (dr.holder != null && dr.holder !== me.id) continue
        const d = hyp(dr.pos[0] - x, dr.pos[1] - y)
        if (d > 230 || dr.lands_in > d / this.walk + 8) continue
        let crowded = false
        for (const e of this.en.values()) if (t - e.t < 8 && hyp(dr.pos[0] - e.pos[0], dr.pos[1] - e.pos[1]) < 70) crowded = true
        if (!crowded && (!best || d < best.d)) best = { type: "drop", id: dr.id, pos: dr.pos, d }
      }
      if (best) return best
    }
    const farming = P.farmHard && t < P.farmUntil
    // opening: the laser run is not called off just because a mech is in sight
    const lasFirst = t < P.laserFirst && !this.laser && this.hpS >= 0.45
    let gated = false
    if (farming) {
      if (this.hpS < 0.45 || t - this.lastMechDmgT < 4 || this.vis.some((e) => e.los && e.dist < 170)) gated = true
    } else if (!this.calm || this.hpS < 0.6) gated = true
    if (gated && !lasFirst) return null
    if (this.zoneSlack < 14) return null
    const [x, y, z] = me.pos
    const zc = this.o.zone
    const insideNow = (p) => hyp(p[0] - zc.center[0], p[1] - zc.center[1]) < zc.radius - 8
    const insideNext = (p) => hyp(p[0] - this.nc[0], p[1] - this.nc[1]) < this.nr - 2
    const okPlace = (p, d) => insideNow(p) && (insideNext(p) || this.zoneSlack > d / this.walk + 25)
    const reachableZ = (p) => !this.w || Math.abs(this.w.standZ(p[0], p[1], z + 1.5) - p[2]) < 3.2 || (this.w.nodeAt(p[0], p[1], p[2], 3) >= 0 && this.main && this.main[this.w.nodeAt(p[0], p[1], p[2], 3)])
    const nearEnemy = (p) => {
      for (const e of this.en.values()) if (t - e.t < 12 && hyp(p[0] - e.pos[0], p[1] - e.pos[1]) < 110) return true
      return false
    }
    if (lasFirst) {
      // nearest known laser; the usual "no loot within 110 m of a mech" rule gives way when we are the closer one
      let goal = null,
        gd = t - this.lastMechDmgT < 4 ? 60 : 300
      for (const p of this.picks.values()) {
        if (p.kind !== "laser") continue
        const d = hyp(p.pos[0] - x, p.pos[1] - y)
        if (d >= gd || !okPlace(p.pos, d) || !reachableZ(p.pos) || (this.badLoot && this.badLoot.get(p.id) > t)) continue
        let lost = false
        for (const e of this.en.values()) {
          if (t - e.t > 12) continue
          const de = hyp(p.pos[0] - e.pos[0], p.pos[1] - e.pos[1])
          if (de < 40 || (de < 110 && de < d)) lost = true
        }
        if (lost) continue
        gd = d
        goal = p
      }
      this.lasGoal = goal ? { d: gd, t } : null
      if (goal) return { type: "pick", id: goal.id, pos: goal.pos, kind: goal.kind }
      if (gated) return null
    }
    let best = null,
      bestV = 0
    const consider = (type, it, value, maxD) => {
      const d = hyp(it.pos[0] - x, it.pos[1] - y)
      if (d > maxD || !okPlace(it.pos, d) || nearEnemy(it.pos)) return
      if (this.badLoot && this.badLoot.get(it.id) > t) return
      let v = value - d * 0.35
      if (this.loot && this.loot.id === it.id) v += 12
      if (v > bestV) {
        bestV = v
        best = { type, id: it.id, pos: it.pos, kind: it.kind }
      }
    }
    // supply drops: 3 cubes + full repair, only when nobody is around
    for (const dr of this.o.drops || []) {
      const d = hyp(dr.pos[0] - x, dr.pos[1] - y)
      if (dr.holder != null && dr.holder !== me.id) continue
      if (dr.lands_in > d / this.walk + 12) continue
      consider("drop", { id: dr.id, pos: dr.pos }, 150, 260)
    }
    const slot1 = me.weapons?.[1]
    for (const p of this.picks.values()) {
      if (!reachableZ(p.pos)) continue
      if (P.preferZap) {
        if (p.kind === "lightning" && !this.lightning) consider("pick", p, 140, 300)
        else if (p.kind === "laser" && !slot1) consider("pick", p, 60, 130)
      } else if (p.kind === "laser" && !this.laser) consider("pick", p, 140, 300)
      else if (p.kind === "lightning" && !slot1) consider("pick", p, 60, 130)
      else if (p.kind === "gun" && !this.gun) consider("pick", p, 120, 250)
    }
    const cubes = me.cubes || 0
    const th = this.cfg.cubes?.upgrade_thresholds || []
    const nextTh = th.find((v) => v > cubes) ?? 1e9
    let cubeVal = cubes < (this.cfg.cubes?.stat_cap ?? 10) ? 34 : nextTh - cubes <= 2 ? 16 : 0
    if (farming && cubeVal === 0 && nextTh - cubes <= 6) cubeVal = 20
    const reach = farming ? 2.4 : 1
    if (cubeVal > 0) for (const c of this.cubes.values()) if (reachableZ(c.pos)) consider("cube", c, cubeVal * (farming ? 1.6 : 1), 90 * reach)
    if (this.killLoot && t - this.killLoot.t < 25) consider("cube", { id: -7, pos: this.killLoot.pos }, 60, 140 * (farming ? 1.5 : 1))
    if (P.farm && cubeVal > 0) {
      const quiet = farming || !this.sounds.some((s) => t - s.t < 5 && s.D < 160 && (s.kind === "gun" || s.kind === "laser" || s.kind === "lightning" || s.kind === "laser_charge"))
      if (quiet) {
        for (const c of this.crates.values()) if (reachableZ(c.pos)) consider("crate", c, farming ? 55 : 30, 110 * reach)
        if (this.hpS > (farming ? 0.6 : 0.8) && t - this.lastMechDmgT > (farming ? 5 : 12))
          for (const n of this.npcs.values()) if (t - n.t < (farming ? 6 : 2)) consider("npc", n, farming ? 80 : 44, 120 * reach)
      }
    }
    return best
  }

  doLoot(A) {
    const L = this.loot
    const t = this.t
    if (this.lootId !== L.id) {
      this.lootId = L.id
      this.lootSince = t
    }
    if (t - this.lootSince > (L.type === "drop" ? 60 : 30)) {
      // not getting anywhere with this one
      ;(this.badLoot ??= new Map()).set(L.id, t + 45)
      this.loot = null
      this.lootId = null
      this.doHold(A)
      return
    }
    const [x, y, z] = this.me.pos
    const d = hyp(L.pos[0] - x, L.pos[1] - y)
    const fail = () => {
      ;(this.badLoot ??= new Map()).set(L.id, t + 30)
      this.loot = null
    }
    if (L.type === "crate" || L.type === "npc") {
      const tgt = L.type === "crate" ? this.crates.get(L.id) : this.npcs.get(L.id)
      if (!tgt) {
        this.loot = null
        this.scan(A)
        return
      }
      const tz = tgt.pos[2] + (L.type === "crate" ? 1.2 : 1.8)
      const los = !this.w || this.w.ray(x, y, z + this.muzH, tgt.pos[0], tgt.pos[1], tz, 2) >= 1
      const want = L.type === "crate" ? 38 : 72
      if (!los || d > want + 8) {
        if (!this.moveToPoint(A, tgt.pos[0], tgt.pos[1], tgt.pos[2], 1, false) && this.pathPartial && this.path && this.path.length < 5) fail()
      } else if (L.type === "npc") {
        // keep the drone at arm's length and sidestep its slow bullets
        const ux = (tgt.pos[0] - x) / (d || 1),
          uy = (tgt.pos[1] - y) / (d || 1)
        if (t > this.strafeFlipT) {
          this.strafeSide = -this.strafeSide
          this.strafeFlipT = t + 0.6 + this.rand() * 0.8
        }
        const r = d < 55 ? -0.8 : 0
        let mv = [-uy * this.strafeSide + ux * r, ux * this.strafeSide + uy * r]
        const m = hyp(mv[0], mv[1]) || 1
        mv = [mv[0] / m, mv[1] / m]
        if (this.w && !this.w.walkLine(x, y, z, x + mv[0] * 5, y + mv[1] * 5, this.reqR - 0.3, this.Hh)) {
          this.strafeSide = -this.strafeSide
          mv = [0, 0]
        }
        A.move = mv
        this.path = null
      } else {
        A.move = [0, 0]
        this.path = null
      }
      this.farmTarget = los ? { pos: tgt.pos, z: tz, vel: tgt.vel || [0, 0, 0], r: L.type === "crate" ? 1.2 : 1.6, d, npc: L.type === "npc" } : null
      if (!this.farmTarget) this.scan(A, null)
      return
    }
    // walk onto it
    if (L.type === "drop") {
      const arrived = this.moveToPoint(A, L.pos[0], L.pos[1], L.pos[2], 1, false)
      if (d < 3) A.move = [0, 0]
      this.scan(A, null)
      return
    }
    if (d < 1.2) {
      if (L.id === -7) this.killLoot = null
      this.lootStuck = (this.lootStuck || 0) + 1
      if (this.lootStuck > 15) {
        fail()
        this.lootStuck = 0
        if (L.type === "cube") this.cubes.delete(L.id)
      }
    } else this.lootStuck = 0
    const arrived = this.moveToPoint(A, L.pos[0], L.pos[1], L.pos[2], 1, false)
    if (!arrived && this.pathPartial && this.path && this.path.length < 5) fail()
    this.scan(A, null)
  }

  doTake(A) {
    const me = this.me
    const [x, y, z] = me.pos
    const reach = (this.cfg.loot?.pickup_radius ?? 4) - 0.3
    const slot1 = me.weapons?.[1]
    const slot0 = me.weapons?.[0]
    let best = null,
      bestRank = -1
    for (const p of this.o.pickups || []) {
      if (hyp(p.pos[0] - x, p.pos[1] - y) > reach || Math.abs(p.pos[2] - z) > 3.7) continue
      if (this[p.kind]) continue // already hold one
      const r = WEAPON_RANK[p.kind] ?? 0
      if (r <= 0) continue
      if (r > bestRank) {
        bestRank = r
        best = p
      }
    }
    if (!best) return
    if (!slot0) A.take = best.id
    else if (!slot1) A.take = best.id
    else {
      const cur = WEAPON_RANK[slot1.kind] ?? 0
      if (bestRank > cur && !(slot1.kind === "laser" && slot1.charge > 0) && slot0.kind === "gun") {
        A.take = best.id
        A.drop = 1
      } else if (slot0.kind !== "gun" && bestRank > (WEAPON_RANK[slot0.kind] ?? 0)) {
        A.take = best.id
        A.drop = 0
      }
    }
  }

  // ------------------------------------------------------------------ aiming
  /**
   * Where to look when nobody needs shooting. The view wedge covers a third of the horizon and tracked
   * mechs stay known for a few seconds, so keep the torso turning like a radar and only dwell on a
   * mech that is close, aimed at us, or about to drop out of memory.
   */
  scan(A, base, sweep) {
    const t = this.t
    const [x, y] = this.me.pos
    let focus = null,
      urgency = 0
    for (const e of this.en.values()) {
      if (e.phantom) {
        if (t - e.t < 2.5 && urgency < 3) {
          urgency = 3
          focus = Math.atan2(e.pos[1] - y, e.pos[0] - x)
        }
        continue
      }
      if (!e.cur) continue
      const b = Math.atan2(e.pos[1] - y, e.pos[0] - x)
      const offView = Math.abs(angNorm(b - this.me.aim[0])) > 0.9
      let u = 0
      if (e.los && e.dist < 230 && (e.aimOn || e.hunt >= 1.5) && e.dist < 160) u = 2.5
      else if (e.los && e.dist < 90) u = 2
      if (u > urgency) {
        urgency = u
        focus = b
      }
    }
    if (focus == null) {
      // a fresh loud noise nearby deserves a look
      let ft = -99
      for (const s of this.sounds)
        if (t - s.t < 1.2 && s.t > ft && s.D < 110 && s.kind !== "explosion") {
          ft = s.t
          focus = s.bearing
          urgency = 1
        }
    }
    // dwell on the focus about two thirds of the time, sweep the rest
    const dwell = focus != null && (urgency >= 2.5 ? (t % 3.2) < 2.3 : (t % 3.0) < 1.4)
    if (dwell) {
      A.aim = [focus, 0]
      this.scanYaw = focus
      return
    }
    if (typeof base === "number" && this.spots && base >= 0 && sweep === undefined) {
      // parked at a hold spot: sweep only the sector that is not a wall
      const S = this.spots
      const lo = S.lo[base],
        hi = S.hi[base]
      const span = hi - lo
      if (span < 4.6) {
        const half = 1.0 // half of the view wedge, with a little overlap
        if (span <= 2 * half) A.aim = [lo + span / 2 + 0.25 * Math.sin(t * 1.3), 0]
        else {
          const a0 = lo + half * 0.9,
            a1 = hi - half * 0.9
          const period = Math.max(1.6, ((a1 - a0) * 2) / 2.2)
          const ph = (t % period) / period
          const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2
          A.aim = [a0 + (a1 - a0) * tri, 0]
        }
        this.scanYaw = A.aim[0]
        return
      }
    }
    this.scanYaw = angNorm(this.scanYaw + 0.1 * 2.6)
    A.aim = [this.scanYaw, 0]
  }

  /** the drone most likely shooting at us */
  pestNpc() {
    const [x, y, z] = this.me.pos
    let best = null,
      bd = 110
    for (const n of this.npcs.values()) {
      if (this.t - n.t > 0.6) continue
      const d = hyp(n.pos[0] - x, n.pos[1] - y)
      if (d < bd && (!this.w || this.w.ray(x, y, z + this.muzH, n.pos[0], n.pos[1], n.pos[2] + 1.8, 2.5) >= 1)) {
        bd = d
        best = n
      }
    }
    return best
  }

  /** intercept solution for a constant-velocity target */
  lead(pos, vel, cz, speed, latency) {
    const me = this.me
    const mx = me.pos[0],
      my = me.pos[1],
      mz = me.pos[2] + this.muzH
    let px = pos[0],
      py = pos[1],
      pz = cz
    let tof = 0
    for (let k = 0; k < 4; k++) {
      const T = tof + latency
      px = pos[0] + vel[0] * T
      py = pos[1] + vel[1] * T
      pz = cz + (vel[2] || 0) * T * 0.4
      const d = hyp(px - mx, py - my, pz - mz)
      tof = speed > 0 ? Math.max(0, d - 3) / speed : 0
    }
    const dh = hyp(px - mx, py - my)
    return { yaw: Math.atan2(py - my, px - mx), pitch: Math.atan2(pz - mz, dh), dist: hyp(dh, pz - mz), px, py, pz }
  }
  /** will the torso be on the solution during the next tick */
  onTarget(sol, tolR, tolV) {
    const me = this.me
    const ey = Math.max(0, Math.abs(angNorm(sol.yaw - me.aim[0])) - this.turn * 0.045)
    const ep = Math.max(0, Math.abs(sol.pitch - me.aim[1]) - this.pitchRate * 0.045)
    return ey * sol.dist < tolR && ep * sol.dist < tolV
  }
  clearShot(sol, slack) {
    if (!this.w) return true
    const me = this.me
    const f = this.w.ray(me.pos[0], me.pos[1], me.pos[2] + this.muzH, sol.px, sol.py, sol.pz, 2.5)
    return f >= 1 || f * sol.dist > sol.dist - slack
  }

  doAimFire(A) {
    const t = this.t
    const me = this.me
    const gun = this.gun,
      laser = this.laser,
      lightning = this.lightning
    const fire = [false, false]
    this.charging = !!(laser && laser.charge > 0)
    let e = this.aimTarget
    // not in a fight but being shot by someone in view: face them and answer
    if (!e) {
      let cand = null
      for (const q of this.vis) if (q.los && t - q.hitMeT < 2.5 && (!cand || q.hitMeT > cand.hitMeT)) cand = q
      if (cand) e = cand
    }
    // never let a charged laser go to waste / fire wild: keep tracking someone
    if (!e && this.charging) {
      for (const q of this.vis) if (q.los && (!e || q.dist < e.dist)) e = q
    }
    if (e && e.los) {
      const vel = e.dist > 45 ? [(e.vel[0] + e.vAvg[0]) / 2, (e.vel[1] + e.vAvg[1]) / 2, e.vel[2]] : e.vel
      const gunSol = gun ? this.lead(e.pos, vel, e.cz, gun.stats.speed, 0.075) : null
      const lasSol = laser ? this.lead(e.pos, e.vel, e.cz, 0, 0.09) : null
      const tolR = e.R * 0.75,
        tolV = 3.2 * (1 + 0.05 * e.cubes)
      let sol = gunSol || lasSol
      // laser: charge while the gun keeps working, then put the beam on the body and let go
      if (laser && lasSol) {
        const ls = this.slotOf.laser
        const full = laser.stats.charge ?? 0.75
        const inRange = lasSol.dist < (laser.stats.range ?? 280) - 6
        const shorted = t < this.shortUntil
        const clear = this.clearShot(lasSol, e.R + 1)
        if (this.charging) {
          const ready = laser.charge >= full - 0.051
          if (ready || laser.charge >= full * 0.5) sol = lasSol
          const good = inRange && clear && this.onTarget(lasSol, tolR * 0.9, tolV)
          // let go when full and on target; hold a full charge a little for a better line
          if (ready && good) fire[ls] = false
          else if (ready && laser.charge > full + (laser.stats.hold_s ?? 2) - 0.35) fire[ls] = false
          else if (!ready && !clear && laser.charge > full * 0.6 && good) fire[ls] = false
          else fire[ls] = true
        } else if ((laser.cooldown || 0) <= 0.11 && inRange && clear && !shorted && !(e.has("lightning") && e.dist < 40)) {
          fire[ls] = true
        }
      }
      if (lightning) {
        const rg = (lightning.stats.range ?? 45) - 2.5
        const cone = (((lightning.stats.cone_deg ?? 30) / 2) * PI) / 180 - 0.04
        const b = Math.atan2(e.pos[1] - me.pos[1], e.pos[0] - me.pos[0])
        const d3 = hyp(e.dist, e.cz - (me.pos[2] + this.muzH))
        if (d3 < rg && Math.abs(angNorm(b - me.aim[0])) < cone + this.turn * 0.04 && me.energy > (e.hpS < 0.3 ? 4 : 12)) {
          fire[this.slotOf.lightning] = true
          // inside arc range the arc cannot miss: point straight at the body
          if (!(laser && this.charging)) sol = { yaw: b, pitch: gunSol ? gunSol.pitch : 0, dist: d3, px: e.pos[0], py: e.pos[1], pz: e.cz }
        }
      }
      if (gun && gunSol) {
        const gs = this.slotOf.gun
        const inRange = gunSol.dist < (gun.stats.range ?? 230) - 4
        if (gun.ammo > 0 && !(gun.reload > 0) && inRange && this.onTarget(gunSol, tolR, tolV) && this.clearShot(gunSol, e.R + 1.5)) fire[gs] = true
      }
      if (sol) A.aim = [sol.yaw, sol.pitch]
    } else if (!this.farmTarget && gun && t - this.lastNpcDmgT < 2.5 && this.pestNpc()) {
      const n = this.pestNpc()
      const sol = this.lead(n.pos, n.vel || [0, 0, 0], n.pos[2] + 1.8, gun.stats.speed, 0.075)
      A.aim = [sol.yaw, sol.pitch]
      if (gun.ammo > 0 && !(gun.reload > 0) && sol.dist < gun.stats.range - 4 && this.onTarget(sol, 1.3, 1.1) && this.clearShot(sol, 2.5)) fire[this.slotOf.gun] = true
      if (lightning && sol.dist < (lightning.stats.range ?? 45) - 3 && Math.abs(angNorm(sol.yaw - me.aim[0])) < 0.2 && me.energy > 30) fire[this.slotOf.lightning] = true
    } else if (this.farmTarget && this.mode === "loot" && gun) {
      const f = this.farmTarget
      const sol = this.lead(f.pos, f.vel, f.z, gun.stats.speed, 0.075)
      A.aim = [sol.yaw, sol.pitch]
      if (gun.ammo > 0 && !(gun.reload > 0) && sol.dist < gun.stats.range - 4 && this.onTarget(sol, f.r * 0.8, 1.0)) fire[this.slotOf.gun] = true
      if (lightning && f.d < (lightning.stats.range ?? 45) - 3 && Math.abs(angNorm(sol.yaw - me.aim[0])) < 0.2 && me.energy > 40) fire[this.slotOf.lightning] = true
    }
    this.farmTarget = null
    // reload in the quiet moments
    if (gun) {
      const mag = gun.stats.mag ?? 12
      const quiet = !this.vis.some((q) => q.los && q.dist < 240) && t - this.lastContactT > 3.5 && t - this.lastMechDmgT > 3.5
      const lull = this.mode === "retreat" && !this.vis.some((q) => q.los) && t - this.lastMechDmgT > 1 && gun.ammo <= mag * 0.5
      if (!(gun.reload > 0) && (gun.ammo === 0 || lull || (quiet && gun.ammo <= mag - 3 && this.mode !== "loot") || (quiet && gun.ammo <= mag * 0.5))) A.reload = true
    }
    A.fire = fire
  }
}

/** Minimal brain used when the map cannot be loaded or the main brain keeps failing. */
export class SimpleBrain {
  constructor(hello) {
    this.cfg = hello.config
    this.name = "FitzyMate"
  }
  act(o) {
    const me = o.self
    const [x, y, z] = me.pos
    const g = o.zone.next_center
    const yaw = Math.atan2(g[1] - y, g[0] - x)
    const far = hyp(g[0] - x, g[1] - y) > Math.max(5, o.zone.next_radius * 0.7)
    const A = { move: far ? [Math.cos(yaw), Math.sin(yaw)] : [0, 0], aim: [yaw + Math.sin(o.t), 0], boost: me.in_zone === false, jump: far && o.tick % 30 === 0, fire: [false, false] }
    if (o.offer) A.pick = 0
    let best = null,
      bd = 1e9
    for (const m of o.mechs || []) {
      if (m.kind !== "mech") continue
      const d = hyp(m.pos[0] - x, m.pos[1] - y)
      if (d < bd) {
        bd = d
        best = m
      }
    }
    if (best && bd < 200) {
      const tof = bd / 252
      const px = best.pos[0] + best.vel[0] * tof,
        py = best.pos[1] + best.vel[1] * tof
      A.aim = [Math.atan2(py - y, px - x), Math.atan2(best.pos[2] + 4.5 - (z + 7), bd)]
      A.fire = [true, true]
    }
    return A
  }
}
