// Local approximation of the mechfight server, for testing bot logic offline.
// It follows protocol.md as closely as is cheap; it is NOT the real server. Mortars are not simulated.
const PI = Math.PI
const TAU = 2 * PI
const hyp = Math.hypot
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const angNorm = (a) => {
  a %= TAU
  if (a > PI) a -= TAU
  else if (a < -PI) a += TAU
  return a
}
function mulberry(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const r2 = (v) => Math.round(v * 100) / 100

export class Sim {
  /** bots: array of { make(hello) -> {act(obs)}, label } */
  constructor(world, cfg, seed, bots) {
    this.w = world
    this.cfg = cfg
    this.rand = mulberry(seed)
    this.tick = 0
    this.t = 0
    this.dt = 1 / cfg.match.tick_hz
    this.projectiles = []
    this.cubes = new Map()
    this.pickups = new Map()
    this.crates = new Map()
    this.npcs = new Map()
    this.drops = []
    this.sounds = [] // {kind,x,y,t}
    this.beams = []
    this.nextId = { cube: 5000, pick: 8000, proj: 1, drop: 20000 }
    this.log = []
    this.maxActMs = 0
    this.sumActMs = 0
    this.nAct = 0
    this._zoneInit()
    this._nodes()
    this.mechs = []
    const spawns = this._spawns(bots.length)
    for (let i = 0; i < bots.length; i++) {
      const m = {
        id: i, label: bots[i].label, alive: true, pos: spawns[i], vel: [0, 0, 0], aim: [this.rand() * TAU - PI, 0], aimCmd: null,
        hp: cfg.mech.hp, energy: cfg.mech.energy, grounded: true, cubes: 0, upgrades: [], weapons: [this._weapon("gun"), null],
        lastCombat: -99, lastSpend: -99, events: [], seen: new Map(), action: {}, offers: [], offer: null, offerId: 0,
        place: 0, kills: 0, shortUntil: -99, stepT: 0, deathT: null, dmgDealt: 0, killedBy: null, heard: [], beams: [],
      }
      this._recalc(m)
      m.hp = m.maxHp
      this.mechs.push(m)
    }
    for (let i = 0; i < bots.length; i++) {
      const hello = { type: "hello", protocol: "mechfight/1", slot: i, seed: (seed * 31 + i * 977) >>> 0, map: { dir: "arena", files: [] }, config: cfg }
      this.mechs[i].bot = bots[i].make(hello, this)
    }
    this._loot()
    this.alive = bots.length
  }

  // ---------------------------------------------------------------- setup
  _zoneInit() {
    const z = this.cfg.zone
    this.zc = z.start_center.slice()
    this.zr = z.start_radius
    this.phase = 0
    this.phaseStart = 0
    this.zFrom = { c: this.zc.slice(), r: this.zr }
    this._nextZone()
  }
  _nextZone() {
    const ph = this.cfg.zone.phases[this.phase]
    if (!ph) {
      this.zNext = { c: this.zc.slice(), r: 0 }
      this.shrinkStart = this.shrinkEnd = 1e9
      this.dps = this.cfg.zone.phases[this.cfg.zone.phases.length - 1].dps
      return
    }
    const room = Math.max(0, this.zr - ph.radius)
    const a = this.rand() * TAU,
      d = Math.sqrt(this.rand()) * room * 0.7
    this.zNext = { c: [this.zc[0] + Math.cos(a) * d, this.zc[1] + Math.sin(a) * d], r: ph.radius }
    this.zFrom = { c: this.zc.slice(), r: this.zr }
    this.shrinkStart = this.phaseStart + ph.hold_s
    this.shrinkEnd = this.shrinkStart + ph.shrink_s
    this.dps = ph.dps
  }
  _zoneStep() {
    const t = this.t
    if (t >= this.shrinkEnd) {
      this.zc = this.zNext.c.slice()
      this.zr = this.zNext.r
      this.phase++
      this.phaseStart = this.shrinkEnd
      this._nextZone()
    } else if (t > this.shrinkStart) {
      const f = (t - this.shrinkStart) / (this.shrinkEnd - this.shrinkStart)
      this.zc = [this.zFrom.c[0] + (this.zNext.c[0] - this.zFrom.c[0]) * f, this.zFrom.c[1] + (this.zNext.c[1] - this.zFrom.c[1]) * f]
      this.zr = this.zFrom.r + (this.zNext.r - this.zFrom.r) * f
    }
  }
  _nodes() {
    const w = this.w
    const c = this.cfg.zone.start_center
    const s = w.nearestNode(c[0], c[1], w.ground(c[0], c[1]), 3.2, 9.5, 60)
    w.search(s, -1, { allowJet: false, maxExp: 1e9 })
    this.ground = []
    const main = new Uint8Array(2 * w.NC)
    for (let k = 0; k < w.nVisited; k++) {
      const n = w.visited[k]
      main[n] = 1
      if (w.wd[n] >= 4) this.ground.push(n)
    }
    this.roofs = []
    for (let n = 0; n < 2 * w.NC; n++) if (!main[n] && w.surf[n] === w.surf[n] && !w.isT[n] && w.wd[n] >= 4 && w.surf[n] - w.ground(w.nodeX(n), w.nodeY(n)) < 40) this.roofs.push(n)
  }
  _randNode(roof, inside) {
    const w = this.w
    const list = roof ? this.roofs : this.ground
    for (let k = 0; k < 400; k++) {
      const n = list[(this.rand() * list.length) | 0]
      const x = w.nodeX(n),
        y = w.nodeY(n)
      if (inside && hyp(x - inside[0], y - inside[1]) > inside[2]) continue
      return [x, y, w.surf[n]]
    }
    return [this.zc[0], this.zc[1], w.ground(this.zc[0], this.zc[1])]
  }
  _spawns(n) {
    const m = this.cfg.match
    const out = []
    let sep = m.spawn_min_separation
    let guard = 0
    while (out.length < n) {
      const p = this._randNode(false, [this.zc[0], this.zc[1], this.zr * m.spawn_zone_fraction])
      if (out.every((q) => hyp(q[0] - p[0], q[1] - p[1]) >= sep)) out.push(p)
      if (++guard % 300 === 0) sep *= 0.9
    }
    return out
  }
  _loot() {
    const c = this.cfg
    const kinds = []
    for (const k of ["mortar", "laser", "lightning", "gun"]) for (let i = 0; i < (c.loot.weights[k] || 0); i++) kinds.push(k)
    for (let i = 0; i < c.loot.floor_count; i++) {
      const p = this._randNode(this.rand() < c.loot.floor_roof_fraction, [this.zc[0], this.zc[1], this.zr])
      const id = this.nextId.pick++
      this.pickups.set(id, { id, kind: kinds[(this.rand() * kinds.length) | 0], pos: p })
    }
    for (let i = 0; i < c.crates.count; i++) {
      const p = this._randNode(this.rand() < c.crates.roof_fraction, [this.zc[0], this.zc[1], this.zr])
      this.crates.set(1000 + i, { id: 1000 + i, pos: p, hp: c.crates.hp })
    }
    for (let i = 0; i < c.npc.count; i++) {
      const p = this._randNode(false, [this.zc[0], this.zc[1], this.zr])
      this.npcs.set(100 + i, { id: 100 + i, pos: p.slice(), home: p.slice(), vel: [0, 0, 0], aim: [0, 0], hp: c.npc.hp, cd: 0, target: -1, wander: 0, dir: 0 })
    }
    this.dropTimes = (c.drops?.times || []).slice()
  }
  _weapon(kind) {
    return { kind, cooldown: 0, ammo: kind === "gun" ? this.cfg.weapons.gun.mag : undefined, reload: 0, charge: 0, releasing: false, stats: { ...this.cfg.weapons[kind] } }
  }
  _recalc(m) {
    const c = this.cfg
    const st = { ...c.mech }
    const wm = { gun: { ...c.weapons.gun }, mortar: { ...c.weapons.mortar }, laser: { ...c.weapons.laser }, lightning: { ...c.weapons.lightning } }
    for (const id of m.upgrades) {
      const u = c.upgrades.find((q) => q.id === id)
      if (!u) continue
      for (const e of u.effects) {
        const parts = e.path.split(".")
        const tgt = parts[0] === "mech" ? st : wm[parts[1]]
        const key = parts[parts.length - 1]
        if (e.mul != null) tgt[key] *= e.mul
        if (e.add != null) tgt[key] += e.add
      }
    }
    const sc = 1 + c.cubes.size_per_cube * m.cubes
    st.radius = c.mech.radius * sc
    st.height = c.mech.height * sc
    st.eye_height = c.mech.eye_height * sc
    st.muzzle_height = c.mech.muzzle_height * sc
    m.stats = st
    m.wstats = wm
    const old = m.maxHp || 0
    m.maxHp = st.hp * (1 + c.cubes.hp_per_cube * Math.min(m.cubes, c.cubes.stat_cap))
    if (m.maxHp > old && old > 0) m.hp += m.maxHp - old
    m.maxEnergy = st.energy
    for (const wp of m.weapons) if (wp) wp.stats = wm[wp.kind]
  }

  // ---------------------------------------------------------------- observation
  _sees(m, x, y, z, ztop) {
    const st = m.stats
    const ex = m.pos[0],
      ey = m.pos[1],
      ez = m.pos[2] + st.eye_height
    const d = hyp(x - ex, y - ey)
    const near = this.cfg.vision.near_range + (st.near_range_bonus || 0)
    const far = this.cfg.vision.range + (st.vision_bonus || 0)
    if (d > far) return false
    if (d > near) {
      const b = Math.atan2(y - ey, x - ex)
      if (Math.abs(angNorm(b - m.aim[0])) > ((this.cfg.vision.fov_deg / 2) * PI) / 180) return false
    }
    return this.w.los(ex, ey, ez, x, y, z) || (ztop != null && this.w.los(ex, ey, ez, x, y, ztop))
  }
  obs(m) {
    const cfg = this.cfg
    const t = this.t
    const mechs = []
    for (const o of this.mechs) {
      if (o === m || !o.alive) continue
      if (this._sees(m, o.pos[0], o.pos[1], o.pos[2] + o.stats.height / 2, o.pos[2] + o.stats.height)) m.seen.set(o.id, t)
      if (t - (m.seen.get(o.id) ?? -99) <= cfg.vision.memory_s)
        mechs.push({ id: o.id, kind: "mech", pos: o.pos.map(r2), vel: o.vel.map(r2), aim: [r2(o.aim[0]), r2(o.aim[1])], hp: Math.round(o.hp), max_hp: Math.round(o.maxHp), cubes: o.cubes, weapons: o.weapons.filter(Boolean).map((q) => q.kind), charging: o.weapons.some((q) => q && q.kind === "laser" && q.charge > 0) })
    }
    for (const n of this.npcs.values()) {
      if (this._sees(m, n.pos[0], n.pos[1], n.pos[2] + 1.75, n.pos[2] + 3.5)) m.seen.set(n.id, t)
      if (t - (m.seen.get(n.id) ?? -99) <= cfg.vision.memory_s) mechs.push({ id: n.id, kind: "npc", pos: n.pos.map(r2), vel: n.vel.map(r2), aim: n.aim, hp: Math.round(n.hp), max_hp: cfg.npc.hp })
    }
    const items = (map, zo) => {
      const out = []
      for (const it of map.values()) if (hyp(it.pos[0] - m.pos[0], it.pos[1] - m.pos[1]) < 230 && this._sees(m, it.pos[0], it.pos[1], it.pos[2] + zo)) out.push({ id: it.id, pos: it.pos.map(r2), ...(it.kind && { kind: it.kind }), ...(it.hp != null && { hp: it.hp }) })
      return out
    }
    const projectiles = []
    for (const p of this.projectiles) if (p.by !== m.id && hyp(p.pos[0] - m.pos[0], p.pos[1] - m.pos[1]) < 200 && this._sees(m, p.pos[0], p.pos[1], p.pos[2])) projectiles.push({ id: p.id, kind: p.kind, pos: p.pos.map(r2), vel: p.vel.map(r2) })
    const sounds = m.heard
    m.heard = []
    const beams = m.beams
    m.beams = []
    const events = m.events
    m.events = []
    const self = {
      id: m.id, pos: m.pos.map(r2), vel: m.vel.map(r2), aim: [r2(m.aim[0]), r2(m.aim[1])], hp: r2(m.hp), max_hp: r2(m.maxHp), energy: r2(m.energy), max_energy: m.maxEnergy,
      grounded: m.grounded, cubes: m.cubes, upgrades: m.upgrades.slice(),
      weapons: m.weapons.map((q) => (q ? { kind: q.kind, cooldown: r2(Math.max(0, q.cooldown)), stats: { ...q.stats }, ...(q.kind === "gun" && { ammo: q.ammo, reload: r2(q.reload) }), ...(q.kind === "laser" && { charge: r2(q.charge) }) } : null)),
      in_zone: hyp(m.pos[0] - this.zc[0], m.pos[1] - this.zc[1]) <= this.zr, stats: { ...m.stats },
    }
    return {
      type: "obs", tick: this.tick, t: r2(t), alive: this.alive, self, mechs, projectiles, crates: items(this.crates, 1.2), cubes: items(this.cubes, 0.5), pickups: items(this.pickups, 0.5),
      sounds, beams, events,
      drops: this.drops.filter((d) => !d.taken).map((d) => ({ id: d.id, pos: d.pos, radius: cfg.drops.radius, lands_in: r2(Math.max(0, d.landT - t)), capture_s: cfg.drops.capture_s, progress: r2(d.progress), holder: d.holder })),
      zone: { center: this.zc.map(r2), radius: r2(this.zr), next_center: this.zNext.c.map(r2), next_radius: this.zNext.r, shrink_start: this.shrinkStart, shrink_end: this.shrinkEnd, dps: this.dps },
      offer: m.offer ? { id: m.offer.id, expires: m.offer.expires, choices: m.offer.choices.map((id) => { const u = cfg.upgrades.find((q) => q.id === id); return { id, name: u.name, desc: u.desc } }) } : null,
    }
  }
  sound(kind, x, y, by) {
    const range = this.cfg.sound.range[kind] ?? 100
    for (const m of this.mechs) {
      if (!m.alive || m.id === by) continue
      const d = hyp(x - m.pos[0], y - m.pos[1])
      if (d > range) continue
      const noise = ((this.cfg.sound.bearing_noise_deg * (m.stats.hearing ?? 1) * PI) / 180) * this._gauss()
      m.heard.push({ kind, bearing: r2(angNorm(Math.atan2(y - m.pos[1], x - m.pos[0]) + noise)), dist: d < this.cfg.sound.near ? "near" : d < this.cfg.sound.mid ? "mid" : "far", age: 0.05 })
    }
  }
  _gauss() {
    let u = 0
    for (let i = 0; i < 6; i++) u += this.rand()
    return (u - 3) / 0.7071
  }

  // ---------------------------------------------------------------- stepping
  /** one decision: observe, act, simulate decide_every ticks. Returns false when the match is over. */
  step() {
    for (const m of this.mechs) {
      if (!m.alive) continue
      const o = this.obs(m)
      const t0 = performance.now()
      let a
      try {
        a = m.bot.act(o) || {}
      } catch (e) {
        if (!m.crashed) console.error(`bot ${m.id} (${m.label}) threw at t=${this.t.toFixed(1)}:`, e)
        m.crashed = (m.crashed || 0) + 1
        a = {}
      }
      const ms = performance.now() - t0
      if (m.label === "mine") {
        if (ms > 25 && process.env.SLOW) console.error(`slow act ${ms.toFixed(1)}ms t=${this.t.toFixed(1)} mode=${m.bot.mode} prof=${JSON.stringify(m.bot.prof || {})}`)
        this.maxActMs = Math.max(this.maxActMs, ms)
        this.sumActMs += ms
        this.nAct++
      }
      m.action = a
      m.oneShot = true
      if (Array.isArray(a.aim)) m.aimCmd = [+a.aim[0] || 0, +a.aim[1] || 0]
    }
    for (let k = 0; k < this.cfg.match.decide_every; k++) {
      this._tick()
      if (this.alive <= 1 || this.t >= this.cfg.match.duration_s) return this._finish()
    }
    return true
  }
  _finish() {
    const left = this.mechs.filter((m) => m.alive).sort((a, b) => b.hp - a.hp)
    left.forEach((m, i) => (m.place = i + 1))
    return false
  }

  /** how many of the body's sample points sit inside a wall at this position (0 = free) */
  _overlap(m, x, y, z) {
    const w = this.w
    if (!w.inBounds(x, y)) return 99
    const R = m.stats.radius,
      H = m.stats.height
    const z0 = z + this.cfg.mech.step_up + 0.05,
      z1 = z + H - 0.05
    let n = w.blockedColumn(x, y, z0, z1) ? 4 : 0
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU
      if (w.blockedColumn(x + Math.cos(a) * R, y + Math.sin(a) * R, z0, z1)) n++
    }
    return n
  }
  _blocked(m, x, y, z) {
    const n = this._overlap(m, x, y, z)
    if (n === 0) return false
    // already overlapping (it grew next to a wall, or was pushed): let it move if that frees it up
    const cur = this._overlap(m, m.pos[0], m.pos[1], z)
    return !(cur > 0 && n < cur)
  }

  _tick() {
    const cfg = this.cfg
    const dt = this.dt
    const w = this.w
    this.t = this.tick * dt
    const t = this.t
    this._zoneStep()
    for (const m of this.mechs) {
      if (!m.alive) continue
      const a = m.action
      const st = m.stats
      // aim
      if (m.aimCmd) {
        const dy = angNorm(m.aimCmd[0] - m.aim[0])
        m.aim[0] = angNorm(m.aim[0] + clamp(dy, -st.turn_rate * dt, st.turn_rate * dt))
        const tp = clamp(m.aimCmd[1], st.min_pitch, st.max_pitch)
        m.aim[1] += clamp(tp - m.aim[1], -st.pitch_rate * dt, st.pitch_rate * dt)
      }
      // movement
      let mv = Array.isArray(a.move) ? [+a.move[0] || 0, +a.move[1] || 0] : [0, 0]
      const ml = hyp(mv[0], mv[1])
      if (ml > 1) mv = [mv[0] / ml, mv[1] / ml]
      const charging = m.weapons.some((q) => q && q.kind === "laser" && q.charge > 0)
      let cap = st.walk_speed
      let spending = false
      if (a.boost && m.grounded && ml > 0.05 && m.energy > 0) {
        cap = st.boost_speed
        m.energy -= st.boost_drain * dt
        spending = true
        if (t - m.stepT >= cfg.sound.step_every) {
          m.stepT = t
          this.sound("boost", m.pos[0], m.pos[1], m.id)
        }
      }
      if (charging) cap *= st.charge_move_mult
      const acc = (m.grounded ? st.ground_accel : st.air_accel) * dt
      const dvx = mv[0] * cap - m.vel[0],
        dvy = mv[1] * cap - m.vel[1]
      const dv = hyp(dvx, dvy)
      if (dv <= acc) {
        m.vel[0] += dvx
        m.vel[1] += dvy
      } else {
        m.vel[0] += (dvx / dv) * acc
        m.vel[1] += (dvy / dv) * acc
      }
      if (m.grounded && a.jump && m.oneShot) {
        m.vel[2] = st.jump_speed
        m.grounded = false
      }
      if (!m.grounded) {
        if (a.boost && m.energy > 0) {
          if (m.vel[2] < st.max_rise_speed) m.vel[2] = Math.min(st.max_rise_speed, m.vel[2] + st.jet_accel * dt)
          m.energy -= st.jet_drain * dt
          spending = true
        }
        m.vel[2] -= st.gravity * dt
      }
      if (spending) m.lastSpend = t
      // horizontal move with sliding
      let [x, y, z] = m.pos
      const nx = x + m.vel[0] * dt,
        ny = y + m.vel[1] * dt
      const canStand = (px, py) => {
        if (this._blocked(m, px, py, z)) return false
        if (m.grounded) {
          const g = w.ground(px, py)
          const run = hyp(px - x, py - y)
          if (g - z > run * 1.19 + 0.08 && g - z > 0.05) return false
        } else if (w.ground(px, py) > z + 0.3) return false
        return true
      }
      if (canStand(nx, ny)) {
        x = nx
        y = ny
      } else if (canStand(nx, y)) {
        x = nx
        m.vel[1] = 0
      } else if (canStand(x, ny)) {
        y = ny
        m.vel[0] = 0
      } else {
        m.vel[0] = 0
        m.vel[1] = 0
      }
      const surface = w.standZ(x, y, z, cfg.mech.step_up)
      if (m.grounded) {
        if (surface >= z - 0.7) z = surface
        else {
          m.grounded = false
          m.vel[2] = 0
        }
      }
      if (!m.grounded) {
        let nz = z + m.vel[2] * dt
        if (m.vel[2] > 0 && w.blockedColumn(x, y, z + st.height, nz + st.height + 0.1)) {
          nz = z
          m.vel[2] = 0
        }
        const s2 = w.standZ(x, y, Math.max(z, nz), 0.05)
        if (nz <= s2 && m.vel[2] <= 0) {
          nz = s2
          m.vel[2] = 0
          m.grounded = true
        }
        z = nz
      } else m.vel[2] = 0
      m.pos = [x, y, z]
      if (m.grounded && hyp(m.vel[0], m.vel[1]) > cfg.sound.step_speed && !(a.boost && spending) && t - m.stepT >= cfg.sound.step_every) {
        m.stepT = t
        this.sound("step", x, y, m.id)
      }
      if (!spending && t - m.lastSpend >= st.energy_regen_delay) m.energy = Math.min(m.maxEnergy, m.energy + st.energy_regen * dt)
      if (m.energy < 0) m.energy = 0
      this._weapons(m, a)
      if (m.oneShot) this._oneShots(m, a)
      m.oneShot = false
      // offers
      if (!m.offer && m.offers.length) {
        m.offer = { id: ++m.offerId, expires: t + cfg.bot.offer_timeout_s, choices: m.offers.shift() }
      }
    }
    this._projectiles()
    this._npcs()
    // push apart
    for (let i = 0; i < this.mechs.length; i++)
      for (let j = i + 1; j < this.mechs.length; j++) {
        const a = this.mechs[i],
          b = this.mechs[j]
        if (!a.alive || !b.alive || Math.abs(a.pos[2] - b.pos[2]) > 9) continue
        const dx = b.pos[0] - a.pos[0],
          dy = b.pos[1] - a.pos[1]
        const d = hyp(dx, dy),
          need = a.stats.radius + b.stats.radius
        if (d < need && d > 1e-3) {
          const push = (need - d) / 2
          const ux = dx / d,
            uy = dy / d
          if (!this._blocked(a, a.pos[0] - ux * push, a.pos[1] - uy * push, a.pos[2])) {
            a.pos[0] -= ux * push
            a.pos[1] -= uy * push
          }
          if (!this._blocked(b, b.pos[0] + ux * push, b.pos[1] + uy * push, b.pos[2])) {
            b.pos[0] += ux * push
            b.pos[1] += uy * push
          }
        }
      }
    // zone, regen, cubes, drops
    for (const m of this.mechs) {
      if (!m.alive) continue
      if (this.tick % 20 === 0) (m.hpHist ??= []).push([this.t, m.hp])
      const out = hyp(m.pos[0] - this.zc[0], m.pos[1] - this.zc[1]) > this.zr
      if (out) {
        m.hp -= this.dps * dt
        m.lastCombat = t
        m.zoneAcc = (m.zoneAcc || 0) + this.dps * dt
        if (m.zoneAcc >= this.dps * 0.5) {
          m.events.push({ type: "damaged", amount: r2(m.zoneAcc), weapon: "zone", bearing: null, by: null })
          m.zoneAcc = 0
        }
        if (m.hp <= 0) m.killedBy = "zone"
      } else if (t - m.lastCombat >= m.stats.regen_delay) m.hp = Math.min(m.maxHp, m.hp + m.stats.regen_per_s * dt)
    }
    for (const c of [...this.cubes.values()]) {
      let best = null,
        bd = cfg.cubes.pickup_radius
      for (const m of this.mechs) {
        if (!m.alive || Math.abs(m.pos[2] - c.pos[2]) > 4) continue
        const d = hyp(m.pos[0] - c.pos[0], m.pos[1] - c.pos[1])
        if (d < bd) {
          bd = d
          best = m
        }
      }
      if (best) {
        this.cubes.delete(c.id)
        this._giveCubes(best, 1)
        best.cubePicks = (best.cubePicks || 0) + 1
        if (this.t < 120) best.cubes120 = (best.cubes120 || 0) + 1
        best.events.push({ type: "pickup", cubes: best.cubes })
      }
    }
    this._drops()
    // deaths
    const dead = this.mechs.filter((m) => m.alive && m.hp <= 0)
    if (dead.length) {
      const place = this.alive - dead.length + 1
      for (const m of dead) {
        m.alive = false
        m.place = place
        m.deathT = t
        this.sound("death", m.pos[0], m.pos[1], m.id)
        for (let k = 0; k < m.cubes + cfg.cubes.death_drop_extra; k++) this._cube(m.pos, 4)
        for (const wp of m.weapons) if (wp && wp.kind !== "gun") this._pickup(wp.kind, m.pos)
        try {
          m.bot.end?.({ type: "end", place, kills: m.kills })
        } catch {}
      }
      this.alive -= dead.length
    }
    this.tick++
  }

  _giveCubes(m, n) {
    const th = this.cfg.cubes.upgrade_thresholds
    for (let k = 0; k < n; k++) {
      m.cubes++
      if (th.includes(m.cubes)) m.offers.push(this._drawOffer(m))
    }
    this._recalc(m)
  }
  _drawOffer(m) {
    const have = {}
    for (const u of m.upgrades) have[u] = (have[u] || 0) + 1
    const kinds = m.weapons.filter(Boolean).map((q) => q.kind)
    const pool = this.cfg.upgrades.filter((u) => (have[u.id] || 0) < u.max && (!u.requires || kinds.includes(u.requires))).map((u) => u.id)
    const out = []
    while (out.length < 3 && pool.length) out.push(pool.splice((this.rand() * pool.length) | 0, 1)[0])
    return out
  }
  _cube(pos, spread) {
    const id = this.nextId.cube++
    const x = pos[0] + (this.rand() - 0.5) * spread,
      y = pos[1] + (this.rand() - 0.5) * spread
    this.cubes.set(id, { id, pos: [x, y, pos[2]] })
  }
  _pickup(kind, pos, extra) {
    const id = this.nextId.pick++
    this.pickups.set(id, { id, kind, pos: pos.slice(), ...extra })
    return id
  }

  _oneShots(m, a) {
    const cfg = this.cfg
    const t = this.t
    if (m.offer) {
      let pick = Number.isInteger(a.pick) && a.pick >= 0 && a.pick < m.offer.choices.length ? a.pick : null
      if (pick == null && t >= m.offer.expires) pick = 0
      if (pick != null) {
        const id = m.offer.choices[pick]
        m.upgrades.push(id)
        m.offer = null
        this._recalc(m)
        m.events.push({ type: "upgrade", id })
      }
    }
    const dropSlot = a.drop === 0 || a.drop === 1 ? a.drop : null
    const doDrop = (slot) => {
      const wp = m.weapons[slot]
      if (!wp) return true
      if (wp.kind === "laser" && wp.charge > 0) return false
      const id = this._pickup(wp.kind, m.pos, { ammo: wp.ammo, reloadLeft: wp.reload, cd: wp.cooldown })
      m.weapons[slot] = null
      m.events.push({ type: "dropped", id, kind: wp.kind, slot })
      return true
    }
    if (a.take != null) {
      const p = this.pickups.get(a.take)
      const fail = (reason) => m.events.push({ type: "take_failed", id: a.take, reason })
      if (!p) fail("gone")
      else if (hyp(p.pos[0] - m.pos[0], p.pos[1] - m.pos[1]) > cfg.loot.pickup_radius || Math.abs(p.pos[2] - m.pos[2]) > 4) fail("range")
      else if (m.weapons.some((q) => q && q.kind === p.kind)) fail("have")
      else {
        let slot = m.weapons[0] == null ? 0 : m.weapons[1] == null ? 1 : -1
        if (slot < 0) {
          if (dropSlot == null) fail("full")
          else if (!doDrop(dropSlot)) fail("busy")
          else slot = dropSlot
        }
        if (slot >= 0) {
          const wp = this._weapon(p.kind)
          wp.stats = m.wstats[p.kind]
          if (p.ammo != null) wp.ammo = p.ammo
          if (p.reloadLeft) wp.reload = p.reloadLeft
          wp.cooldown = Math.max(cfg.loot.equip_s, wp.stats.cooldown, p.cd || 0)
          m.weapons[slot] = wp
          this.pickups.delete(p.id)
          m.events.push({ type: "took", id: p.id, kind: p.kind, slot })
        }
      }
    } else if (dropSlot != null) doDrop(dropSlot)
  }

  _dir(m) {
    const cp = Math.cos(m.aim[1])
    return [cp * Math.cos(m.aim[0]), cp * Math.sin(m.aim[0]), Math.sin(m.aim[1])]
  }
  _muzzle(m, dir) {
    const o = [m.pos[0], m.pos[1], m.pos[2] + m.stats.muzzle_height]
    const out = m.stats.radius + 0.5
    const f = this.w.ray(o[0], o[1], o[2], o[0] + dir[0] * out, o[1] + dir[1] * out, o[2] + dir[2] * out)
    const k = out * Math.min(1, f) * (f < 1 ? 0.8 : 1)
    return [o[0] + dir[0] * k, o[1] + dir[1] * k, o[2] + dir[2] * k]
  }
  _dmgScale(m) {
    return 1 + this.cfg.cubes.damage_per_cube * Math.min(m.cubes, this.cfg.cubes.stat_cap)
  }

  _weapons(m, a) {
    const cfg = this.cfg
    const dt = this.dt
    const t = this.t
    const fire = Array.isArray(a.fire) ? a.fire : [false, false]
    for (let s = 0; s < 2; s++) {
      const wp = m.weapons[s]
      if (!wp) continue
      wp.cooldown -= dt
      const trig = !!fire[s]
      if (wp.kind === "gun") {
        if (wp.reload > 0) {
          wp.reload -= dt
          if (wp.reload <= 0) {
            wp.reload = 0
            wp.ammo = wp.stats.mag
          }
        } else if (a.reload && m.oneShot && wp.ammo < wp.stats.mag) {
          wp.reload = wp.stats.reload
          this.sound("reload", m.pos[0], m.pos[1], m.id)
        }
        if (trig && wp.cooldown <= 0 && wp.ammo > 0 && wp.reload <= 0) {
          const sp = (wp.stats.spread_deg * PI) / 180
          const yaw = m.aim[0] + this._gauss() * sp,
            pitch = m.aim[1] + this._gauss() * sp
          const dir = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)]
          const o = this._muzzle(m, this._dir(m))
          this.projectiles.push({ id: this.nextId.proj++, kind: "gun", by: m.id, pos: o, vel: dir.map((v) => v * wp.stats.speed), left: wp.stats.range, dmg: wp.stats.damage * this._dmgScale(m), r: cfg.projectile.gun_radius })
          wp.ammo--
          m.gunFires = (m.gunFires || 0) + 1
          wp.cooldown = wp.stats.cooldown
          if (wp.ammo === 0) wp.reload = wp.stats.reload
          this.sound("gun", m.pos[0], m.pos[1], m.id)
        }
      } else if (wp.kind === "laser") {
        const full = wp.stats.charge
        if (wp.charge > 0 || wp.releasing) {
          wp.charge += dt
          const letGo = !trig || wp.releasing
          if (letGo) wp.releasing = true
          if ((wp.releasing && wp.charge >= wp.stats.min_charge) || wp.charge >= full + wp.stats.hold_s) this._laser(m, wp)
        } else if (trig && wp.cooldown <= 0 && t >= m.shortUntil) {
          wp.charge = dt
          wp.releasing = false
          this.sound("laser_charge", m.pos[0], m.pos[1], m.id)
        }
      } else if (wp.kind === "lightning") {
        if (trig && wp.cooldown <= 0 && m.energy >= wp.stats.energy) {
          m.energy -= wp.stats.energy
          m.lastSpend = t
          wp.cooldown = wp.stats.cooldown
          this._lightning(m, wp)
        }
      }
    }
  }

  _targets(excludeId) {
    const out = []
    for (const o of this.mechs) if (o.alive && o.id !== excludeId) out.push({ id: o.id, pos: o.pos, r: o.stats.radius, h: o.stats.height, mech: o })
    for (const n of this.npcs.values()) out.push({ id: n.id, pos: n.pos, r: this.cfg.npc.radius, h: this.cfg.npc.height, npc: n })
    for (const c of this.crates.values()) out.push({ id: c.id, pos: c.pos, r: this.cfg.crates.radius, h: this.cfg.crates.height, crate: c })
    return out
  }
  /** first cylinder hit along a segment: returns { s, tgt } with s in 0..1 */
  _segHit(o, d, len, by, pad) {
    let best = null
    for (const tg of this._targets(by)) {
      const r = tg.r + pad
      const ox = o[0] - tg.pos[0],
        oy = o[1] - tg.pos[1]
      const A = d[0] * d[0] + d[1] * d[1]
      if (A < 1e-9) continue
      const B = 2 * (ox * d[0] + oy * d[1])
      const C = ox * ox + oy * oy - r * r
      const disc = B * B - 4 * A * C
      if (disc < 0) continue
      const sq = Math.sqrt(disc)
      let s0 = (-B - sq) / (2 * A)
      const s1 = (-B + sq) / (2 * A)
      if (s1 < 0 || s0 > len) continue
      if (s0 < 0) s0 = 0
      // z overlap anywhere inside the horizontal overlap
      const za = o[2] + d[2] * s0,
        zb = o[2] + d[2] * Math.min(s1, len)
      const lo = Math.min(za, zb),
        hi = Math.max(za, zb)
      if (hi < tg.pos[2] - pad || lo > tg.pos[2] + tg.h + pad) continue
      if (!best || s0 < best.s) best = { s: s0, tgt: tg }
    }
    return best
  }
  damage(tg, amount, weapon, by, from) {
    const t = this.t
    const src = by != null && by < 100 ? this.mechs[by] : null
    if (tg.mech) {
      const m = tg.mech
      if (!m.alive) return
      // noFF (set by sim/eval.mjs when the opponent pack has "ff": 0): house bots never damage each other
      if (src && this.noFF && this.noFF.has(src.id) && this.noFF.has(m.id)) return
      let amt = amount
      const bearing = Math.atan2(from[1] - m.pos[1], from[0] - m.pos[0])
      const rear = Math.abs(angNorm(bearing - m.aim[0])) > ((this.cfg.mech.front_arc_deg / 2) * PI) / 180
      if (rear) amt *= m.stats.rear_mult
      amt *= 1 - (m.stats.armor || 0)
      m.hp -= amt
      m.lastCombat = t
      m.events.push({ type: "damaged", amount: r2(amt), weapon, bearing: r2(bearing), by, ...(rear && { rear: true }) })
      ;(m.dmgHist ??= []).push([t, by, amt, weapon, rear ? 1 : 0])
      if (src) {
        src.lastCombat = t
        src.dmgDealt += amt
        src.events.push({ type: "hit", target: m.id, amount: r2(amt), weapon, ...(rear && { rear: true }) })
        if (m.hp <= 0 && !m.killedBy) {
          m.killedBy = src.id
          src.kills++
          ;(src.killTs ??= []).push(t)
          src.events.push({ type: "kill", target: m.id })
        }
      } else if (m.hp <= 0 && !m.killedBy) m.killedBy = "npc"
    } else if (tg.npc) {
      const n = tg.npc
      n.hp -= amount
      if (src) {
        n.target = src.id
        src.lastCombat = t
        src.events.push({ type: "hit", target: n.id, amount: r2(amount), weapon })
      }
      if (n.hp <= 0 && this.npcs.has(n.id)) {
        if (src) src.npcKills = (src.npcKills || 0) + 1
        this.npcs.delete(n.id)
        for (let k = 0; k < this.cfg.npc.cubes; k++) this._cube(n.pos, 3)
      }
    } else if (tg.crate) {
      const c = tg.crate
      c.hp -= amount
      if (src) {
        src.lastCombat = t
        src.events.push({ type: "hit", target: c.id, amount: r2(amount), weapon })
      }
      if (c.hp <= 0 && this.crates.has(c.id)) {
        if (src) src.crateKills = (src.crateKills || 0) + 1
        this.crates.delete(c.id)
        this.sound("crate", c.pos[0], c.pos[1], -1)
        for (let k = 0; k < this.cfg.crates.cubes; k++) this._cube(c.pos, 2)
        if (this.rand() < this.cfg.loot.crate_weapon_chance) this._pickup(["mortar", "laser", "lightning"][(this.rand() * 3) | 0], c.pos)
      }
    }
  }
  _laser(m, wp) {
    const st = wp.stats
    const frac = st.min_frac + (1 - st.min_frac) * Math.min(1, wp.charge / st.charge)
    const dir = this._dir(m)
    const o = this._muzzle(m, dir)
    const end = [o[0] + dir[0] * st.range, o[1] + dir[1] * st.range, o[2] + dir[2] * st.range]
    const f = this.w.ray(o[0], o[1], o[2], end[0], end[1], end[2])
    const len = st.range * f
    const hit = this._segHit(o, dir, len, m.id, 0)
    let stop = len
    if (hit) {
      stop = hit.s
      let dmg = st.damage * frac * this._dmgScale(m)
      if (hit.tgt.mech && hit.tgt.mech.weapons.some((q) => q && q.kind === "mortar")) dmg *= 1 + st.cookoff
      this.damage(hit.tgt, dmg, "laser", m.id, o)
    }
    const path = [o.map(r2), [o[0] + dir[0] * stop, o[1] + dir[1] * stop, o[2] + dir[2] * stop].map(r2)]
    for (const q of this.mechs) if (q.alive && q !== m && (this._sees(q, path[0][0], path[0][1], path[0][2]) || this._sees(q, path[1][0], path[1][1], path[1][2]))) q.beams.push({ by: m.id, kind: "laser", path, age: 0.05 })
    this.sound("laser", m.pos[0], m.pos[1], m.id)
    wp.charge = 0
    wp.releasing = false
    wp.cooldown = st.cooldown
  }
  _lightning(m, wp) {
    const st = wp.stats
    const o = [m.pos[0], m.pos[1], m.pos[2] + m.stats.muzzle_height]
    const half = ((st.cone_deg / 2) * PI) / 180
    let cands = this._targets(m.id)
    const pick = (from, range, cone, used) => {
      let best = null,
        bd = range
      for (const tg of cands) {
        if (used.has(tg.id)) continue
        const cz = tg.pos[2] + tg.h / 2
        const d = hyp(tg.pos[0] - from[0], tg.pos[1] - from[1], cz - from[2])
        if (d >= bd) continue
        if (cone != null && Math.abs(angNorm(Math.atan2(tg.pos[1] - from[1], tg.pos[0] - from[0]) - m.aim[0])) > cone) continue
        if (!this.w.los(from[0], from[1], from[2], tg.pos[0], tg.pos[1], cz)) continue
        bd = d
        best = tg
      }
      return best
    }
    const used = new Set()
    let from = o
    let dmg = st.damage * this._dmgScale(m)
    const path = [o.map(r2)]
    let tg = pick(from, st.range, half, used)
    for (let j = 0; tg && j <= st.chain; j++) {
      used.add(tg.id)
      const p = [tg.pos[0], tg.pos[1], tg.pos[2] + tg.h / 2]
      path.push(p.map(r2))
      if (tg.mech) {
        const lz = tg.mech.weapons.find((q) => q && q.kind === "laser")
        if (lz) {
          lz.charge = 0
          lz.releasing = false
          tg.mech.shortUntil = this.t + st.short_s
          tg.mech.events.push({ type: "effect", effect: "short", by: m.id })
        }
      }
      this.damage(tg, dmg, "lightning", m.id, from)
      from = p
      dmg *= st.chain_falloff
      tg = pick(from, st.chain_range, null, used)
    }
    if (path.length > 1) for (const q of this.mechs) if (q.alive && q !== m && this._sees(q, path[0][0], path[0][1], path[0][2])) q.beams.push({ by: m.id, kind: "lightning", path, age: 0.05 })
    this.sound("lightning", m.pos[0], m.pos[1], m.id)
  }
  _projectiles() {
    const dt = this.dt
    const keep = []
    for (const p of this.projectiles) {
      const sp = hyp(p.vel[0], p.vel[1], p.vel[2])
      const len = Math.min(sp * dt, p.left)
      const d = [p.vel[0] / sp, p.vel[1] / sp, p.vel[2] / sp]
      const f = this.w.ray(p.pos[0], p.pos[1], p.pos[2], p.pos[0] + d[0] * len, p.pos[1] + d[1] * len, p.pos[2] + d[2] * len)
      const hit = this._segHit(p.pos, d, len * f, p.by, p.r)
      if (hit) {
        if (p.kind === "gun" && p.by < 16) this.mechs[p.by].gunHits = (this.mechs[p.by].gunHits || 0) + 1
        this.damage(hit.tgt, p.dmg, p.kind === "npc" ? "npc" : "gun", p.by, [p.pos[0] - d[0] * 5, p.pos[1] - d[1] * 5, p.pos[2]])
        continue
      }
      if (f < 1) continue
      p.pos = [p.pos[0] + d[0] * len, p.pos[1] + d[1] * len, p.pos[2] + d[2] * len]
      p.left -= len
      if (p.left > 0.01) keep.push(p)
    }
    this.projectiles = keep
  }
  _npcs() {
    const c = this.cfg.npc
    const dt = this.dt
    for (const n of this.npcs.values()) {
      n.cd -= dt
      let tgt = n.target >= 0 ? this.mechs[n.target] : null
      if (tgt && (!tgt.alive || hyp(tgt.pos[0] - n.pos[0], tgt.pos[1] - n.pos[1]) > c.deaggro_range)) {
        tgt = null
        n.target = -1
      }
      if (!tgt && hyp(n.pos[0] - n.home[0], n.pos[1] - n.home[1]) <= c.leash) {
        let bd = c.aggro_range
        for (const m of this.mechs) {
          if (!m.alive) continue
          const d = hyp(m.pos[0] - n.pos[0], m.pos[1] - n.pos[1])
          if (d < bd && this.w.los(n.pos[0], n.pos[1], n.pos[2] + 2.5, m.pos[0], m.pos[1], m.pos[2] + 4.5)) {
            bd = d
            tgt = m
          }
        }
      }
      // wander near home
      if ((n.wander -= dt) <= 0) {
        n.wander = 2 + this.rand() * 3
        n.dir = this.rand() * TAU
        if (hyp(n.pos[0] - n.home[0], n.pos[1] - n.home[1]) > c.leash * 0.7) n.dir = Math.atan2(n.home[1] - n.pos[1], n.home[0] - n.pos[0])
      }
      const vx = Math.cos(n.dir) * c.speed * 0.5,
        vy = Math.sin(n.dir) * c.speed * 0.5
      const nx = n.pos[0] + vx * dt,
        ny = n.pos[1] + vy * dt
      if (!this.w.blockedColumn(nx, ny, n.pos[2] + 1.3, n.pos[2] + 3.5) && this.w.inBounds(nx, ny)) {
        n.pos = [nx, ny, this.w.standZ(nx, ny, n.pos[2], 1.2)]
        n.vel = [vx, vy, 0]
      } else n.vel = [0, 0, 0]
      if (tgt) {
        const o = [n.pos[0], n.pos[1], n.pos[2] + 2.5]
        const tz = tgt.pos[2] + tgt.stats.height / 2
        n.aim = [Math.atan2(tgt.pos[1] - o[1], tgt.pos[0] - o[0]), 0]
        if (n.cd <= 0 && this.w.los(o[0], o[1], o[2], tgt.pos[0], tgt.pos[1], tz)) {
          n.cd = c.cooldown
          const d = hyp(tgt.pos[0] - o[0], tgt.pos[1] - o[1], tz - o[2])
          const sp = (c.spread_deg * PI) / 180
          const yaw = n.aim[0] + this._gauss() * sp,
            pitch = Math.asin(clamp((tz - o[2]) / d, -1, 1)) + this._gauss() * sp
          const dir = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)]
          this.projectiles.push({ id: this.nextId.proj++, kind: "npc", by: n.id, pos: [o[0] + dir[0] * 2.5, o[1] + dir[1] * 2.5, o[2] + dir[2] * 2.5], vel: dir.map((v) => v * c.projectile_speed), left: 160, dmg: c.damage, r: this.cfg.projectile.npc_radius })
          this.sound("npc_gun", n.pos[0], n.pos[1], -1)
        }
      }
    }
  }
  _drops() {
    const c = this.cfg.drops
    if (!c) return
    const t = this.t
    while (this.dropTimes.length && t >= this.dropTimes[0]) {
      this.dropTimes.shift()
      const p = this._randNode(false, [this.zNext.c[0], this.zNext.c[1], Math.max(5, this.zNext.r * c.spread)])
      this.drops.push({ id: this.nextId.drop++, pos: p.map(r2), landT: t + c.fall_s, progress: 0, holder: null, taken: false, landed: false })
    }
    for (const d of this.drops) {
      if (d.taken || t < d.landT) continue
      if (!d.landed) {
        d.landed = true
        this.sound("drop", d.pos[0], d.pos[1], -1)
      }
      const inside = this.mechs.filter((m) => m.alive && hyp(m.pos[0] - d.pos[0], m.pos[1] - d.pos[1]) <= c.radius && Math.abs(m.pos[2] - d.pos[2]) < 6)
      if (inside.length === 1) {
        if (d.holder !== inside[0].id) {
          d.holder = inside[0].id
          d.progress = 0
        }
        d.progress += this.dt
        if (d.progress >= c.capture_s) {
          const m = inside[0]
          d.taken = true
          this._giveCubes(m, c.cubes)
          m.hp = m.maxHp
          m.energy = m.maxEnergy
          m.events.push({ type: "drop", id: d.id, cubes: m.cubes })
        }
      } else if (inside.length === 0) {
        d.holder = null
        d.progress = 0
      }
    }
  }
}
