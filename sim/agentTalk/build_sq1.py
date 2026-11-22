#!/usr/bin/env python3
"""sq1-squad: gb11-dropall + the reference bot's practice decision layer as one mode (P.squad).

usage: python3 sim/agentTalk/build_sq1.py [src] [dst]
  default src sim/variants/gb11-dropall.mjs, dst sim/variants/sq1-squad.mjs

Exact-string replacements, each anchor must match exactly once. doFight's body is not edited:
the squad fight goes through doSqFight(), which does the cube detour and then calls doFight()
with the finish range passed in through P (restored afterwards).
"""
import sys

src = sys.argv[1] if len(sys.argv) > 1 else "sim/variants/gb11-dropall.mjs"
dst = sys.argv[2] if len(sys.argv) > 2 else "sim/variants/sq1-squad.mjs"
s = open(src).read()


def rep(old, new):
    global s
    n = s.count(old)
    assert n == 1, f"anchor found {n} times: {old[:70]!r}"
    s = s.replace(old, new)


# 1. P switches (all off by default)
rep("}\n// Free-for-all profile", """  // --- sim/variants/sq1-squad.mjs: the reference bot's practice decision layer as one mode (new-idea.md 3, 4, 7, 9)
  squad: 0, // 1 = practice from sqFrom s: engage filter, target re-scored every tick, 1.5 s retreat pulses, no chasing, cube detour, finish close-in, lethal release (0 = off; P_FFA resets it)
  sqFrom: 20, // ...from this match time (the reference plays its cautious profile before)
  sqPulse: 1.5, // retreat lasts this many s after the last "losing" tick
  sqLethal: 0.7, // lethal partial laser release factor while squad is on
  sqCube: 70, // a remembered cube within this many m takes over the fight legs while we keep shooting...
  sqCubeLow: 40, // ...this many m at 50% HP or less
  sqFinish: 20, // fight range on a target under 38% HP while we are over 42% and at most 2 mechs are engaged
  sqLasSeek: 240, // without a laser: walk to a known laser within this many m all match (past laserFirst)
  sqLootReach: 1.4, // loot radius factor in squad (cubes 126 m, crates 154 m, drones 168 m)
  sqQuiet: 0, // 1 = before sqFrom, out of danger and not hit for 6 s: walk under 4.6 m/s (no footstep sound) (0 = off)
}
// Free-for-all profile""")

# 2. P_FFA: free-for-all never runs the squad layer
rep("  firstShot: 0, shortRetreat: 0, retarget: 0, // gd-policy lessons: practice only\n",
    "  firstShot: 0, shortRetreat: 0, retarget: 0, // gd-policy lessons: practice only\n  squad: 0, sqQuiet: 0, // sq1-squad: practice only\n")

# 3. settings line right after the dropAll line
i = s.index('"dropAll":1})')
j = s.index("\n", i) + 1
s = s[:j] + 'Object.assign(P, {"squad":1}) // sq1-squad: gb11 + the reference practice decision layer as one mode (engage filter, per-tick target score, 1.5 s retreat pulses, no chase, cube detour 70/40 m, finish close-in 20 m, lethal release 0.7, laser seek 240 m)\n' + s[j:]

# 4. debug counters (FM_SQDBG=1 prints them to stderr when the process exits)
rep("\nclass Enemy {\n", """
// sq1-squad debug counters: FM_SQDBG=1 prints the totals of this process to stderr on exit
const SQD = typeof process !== "undefined" && process.env && process.env.FM_SQDBG ? { ticks: 0, eng: { near: 0, hit: 0, late: 0, close: 0, low: 0, aim: 0 }, tgtTicks: 0, picks: 0, switches: 0, pulses: 0, pulseTicks: 0, finishBlock: 0, finishClose: 0, fightCube: 0, retFight: 0, lethal: 0, lasSeek: 0, idleFace: 0, zoneShoot: 0, quiet: 0 } : null
if (SQD) process.on("exit", () => process.stderr.write("SQD " + JSON.stringify(SQD) + "\\n"))

class Enemy {
""")

# 5. decide(): sense every tick, then take the squad decision after the zone check
rep("    this.calm = t - this.lastContactT > P.calmS && t - this.lastMechDmgT > P.calmS\n",
    "    this.calm = t - this.lastContactT > P.calmS && t - this.lastMechDmgT > P.calmS\n"
    "    this.sqOn = P.squad > 0 && !this.ffa && t >= P.sqFrom\n"
    "    this.sqTarget = null\n"
    "    if (this.sqOn) this.sqSense()\n")
rep("""    if (this.zoneUrgent && !(this.mode === "fight" && this.inZone && this.zoneSlack > 2)) {
      this.mode = "zone"
      return
    }
""", """    if (this.zoneUrgent && !(this.mode === "fight" && this.inZone && this.zoneSlack > 2)) {
      this.mode = "zone"
      return
    }
    if (this.sqOn) return this.sqDecide()
""")

# 6. the squad methods, before setFight()
rep("  setFight(e) {\n", r"""  // ------------------------------------------------------------------ sq1-squad (new-idea.md 3.1, 3.2, 4.1, 4.2, 4.3, 9.1)
  /** engage flags, the per-tick target, danger / crowd / finishing and the losing pulse */
  sqSense() {
    const t = this.t,
      me = this.me
    const [x, y] = me.pos
    const z = this.o.zone
    const late = (z && z.next_radius <= 70) || (this.o.alive ?? 16) <= 3
    this.sqLate = late
    let best = null,
      bs = 1e18,
      face = null,
      fd = 1e9,
      danger = false,
      crowd = 0,
      near = 0
    for (const e of this.en.values()) {
      e.sqEng = 0
      if (e.phantom || t - e.t > 2.5) continue
      const d = e.dist
      // it is closing: its own velocity toward us
      const ux = (x - e.pos[0]) / (d || 1),
        uy = (y - e.pos[1]) / (d || 1)
      const close = (e.vel[0] || 0) * ux + (e.vel[1] || 0) * uy
      e.sqClose = close
      let why = 0
      if (d < 60) why = 1
      else if (t - e.hitMeT < 6) why = 2
      else if (late) why = 3
      else if (close > 3 && d < 180) why = 4
      else if (e.hpS < 0.4 && d < 160) why = 5
      else if (e.aimOn && d < 190) why = 6
      e.sqEng = why
      if (why || t - e.hitMeT < 4) danger = true
      if ((why || t - e.hitMeT < 6) && d < fd) {
        fd = d
        face = e
      }
      if (!e.cur) continue
      if (d < 160) near++
      if (why || (e.los && d < 150)) crowd++
      if (!why || !e.los || d > 240) continue
      if (SQD) SQD.eng[["", "near", "hit", "late", "close", "low", "aim"][why]]++
      let sc = d + 0.18 * e.hp
      if (e.hpS <= 0.3) sc -= 200
      if (e.id === this.sqTid && t - this.sqTidT < 2) sc -= 200
      if (t - e.hitMeT < 4) sc -= 40
      if (close > 3) sc -= 15
      if (sc < bs) {
        bs = sc
        best = e
      }
    }
    if (!face) for (const e of this.en.values()) if (e.phantom && t - e.hitMeT < 2.5 && e.dist < fd) (fd = e.dist), (face = e)
    this.sqFace = face
    this.sqDanger = danger
    this.sqCrowd = crowd
    this.sqNear = near
    if (best) {
      if (SQD) {
        SQD.tgtTicks++
        if (best.id !== this.sqTid) {
          SQD.picks++
          if (this.sqTid >= 0 && t - this.sqTidT < 2) SQD.switches++
        }
      }
      this.sqTid = best.id
      this.sqTidT = t
    }
    this.sqTarget = best
    // losing: a 1.5 s pulse, re-checked every tick
    const hpS = this.hpS
    let losing = (near >= 2 && hpS < 0.55) || (near >= 3 && hpS < 0.8)
    if (best) {
      if (hpS < 0.35 && best.hpS > hpS + 0.1) losing = true
      if (best.hpS < 0.25 && hpS > 0.2 && near <= 2) losing = false
    }
    if (losing) this.sqLoseT = t
    const finishing = !!best && best.dist < 120 && (best.hp < 200 || best.hp < me.hp / 2)
    this.sqFinishing = finishing
    this.sqRet = t - (this.sqLoseT ?? -99) < P.sqPulse && !finishing && !late
    if (SQD) {
      SQD.ticks++
      if (t - (this.sqLoseT ?? -99) < P.sqPulse && finishing) SQD.finishBlock++
    }
  }
  /** the squad decision (after the zone check): retreat pulse, fight the target, or loot / hold */
  sqDecide() {
    const t = this.t
    const tgt = this.sqTarget
    this.lootHeld = false
    if (this.sqRet) {
      if (this.mode !== "retreat") {
        this.cover = null
        this.coverT = -99
        this.retreatT = t
        if (SQD) SQD.pulses++
      }
      if (SQD) SQD.pulseTicks++
      this.mode = "retreat"
      this.recoverT = t
      this.targetId = tgt ? tgt.id : -1
      return
    }
    if (tgt) {
      this.setFight(tgt)
      return
    }
    // no target with a shot line: no foe, no chase
    if (this.mode === "fight" || this.mode === "retreat" || this.mode === "recover") {
      this.mode = "hold"
      this.spotT = -99
    }
    this.targetId = -1
    if (P.cubeRun > 0 && this.kcRun && this.cubeRunNow(null)) {
      this.loot = { type: "cube", id: this.kcRun.id, pos: this.kcRun.pos }
      this.mode = "loot"
      return
    }
    const losE = this.vis.filter((e) => e.los)
    if (P.killLoot && this.killLoot && t - this.killLoot.t < 30 && !losE.some((e) => e.dist < 160)) {
      const [x, y] = this.me.pos
      if (hyp(this.killLoot.pos[0] - x, this.killLoot.pos[1] - y) < 130) {
        this.loot = { type: "cube", id: -7, pos: this.killLoot.pos }
        this.mode = "loot"
        return
      }
    }
    this.loot = this.pickLoot()
    if (SQD && this.loot && this.loot.kind === "laser" && t >= P.laserFirst) SQD.lasSeek++
    this.mode = this.loot ? "loot" : "hold"
  }
  /** run fn with some P fields replaced, then put them back */
  sqWith(over, fn) {
    const save = {}
    for (const k in over) save[k] = P[k]
    Object.assign(P, over)
    try {
      return fn()
    } finally {
      Object.assign(P, save)
    }
  }
  /** a known laser within the fightPick reach (doFight's fightPick takes the legs for it, ahead of any cube) */
  sqLaserNear() {
    if (!(P.fightPick > 0) || this.laser) return false
    const [x, y, z] = this.me.pos
    const zc = this.o.zone
    const bl = this.hpS < 0.5 ? P.fightPick * 0.5 : P.fightPick
    for (const q of this.picks.values()) {
      if (q.kind !== "laser" || hyp(q.pos[0] - x, q.pos[1] - y) >= bl || Math.abs(q.pos[2] - z) > 4) continue
      if (hyp(q.pos[0] - zc.center[0], q.pos[1] - zc.center[1]) > zc.radius - 4) continue
      if (this.badLoot && this.badLoot.get(q.id) > this.t) continue
      return true
    }
    return false
  }
  /** squad fight: a remembered cube within sqCube m (sqCubeLow at <= 50% HP) takes the legs while we keep shooting; else doFight, with the finish range */
  doSqFight(A) {
    const t = this.t
    const e = this.en.get(this.targetId)
    const [x, y, z] = this.me.pos
    if (e && this.inZone && !this.zoneUrgent && !this.sqLaserNear()) {
      const zc = this.o.zone
      let bc = null,
        bd = this.hpS <= 0.5 ? P.sqCubeLow : P.sqCube
      for (const c of this.cubes.values()) {
        const dc = hyp(c.pos[0] - x, c.pos[1] - y)
        if (dc >= bd || Math.abs(c.pos[2] - z) > 4) continue
        if (hyp(c.pos[0] - zc.center[0], c.pos[1] - zc.center[1]) > zc.radius - 4) continue
        if (this.badLoot && this.badLoot.get(c.id) > t) continue
        bd = dc
        bc = c
      }
      if (bc) {
        if (this.sqCubeId !== bc.id) {
          this.sqCubeId = bc.id
          this.sqCubeT = t
        }
        if (t - this.sqCubeT > 12) (this.badLoot ??= new Map()).set(bc.id, t + 30)
        else {
          this.aimTarget = e
          this.moveToPoint(A, bc.pos[0], bc.pos[1], bc.pos[2], 1, false, { replan: 1.2 })
          if (SQD) SQD.fightCube++
          return
        }
      }
    }
    // finish close-in: target under 38%, us over 42%, at most 2 mechs engaged; floors against lightning / mortar
    let fr = 0
    if (e && P.sqFinish > 0 && e.hpS < 0.38 && this.hpS > 0.42 && this.sqCrowd <= 2) {
      fr = P.sqFinish
      if (!this.lightning && e.has("lightning")) fr = Math.max(fr, 64)
      if (!this.lightning && e.has("mortar")) fr = Math.max(fr, 80)
      if (SQD) SQD.finishClose++
    }
    this.sqFinish = fr
    this.sqWith(fr > 0 ? { finishRange: fr, finishHp: 1.01, finishMyHp: -1 } : { finishRange: 0 }, () => this.doFight(A))
  }
  /** squad retreat pulse: cover from the threats; with no cover and a target in sight, fight-move instead; keep shooting the target */
  doSqRetreat(A) {
    const e = this.sqTarget
    this.doRetreat(A)
    if (!this.cover && e && e.los && this.targetId === e.id) {
      A.boost = false
      this.sqFinish = 0
      this.sqWith({ finishRange: 0, fightCube: 0, fightPick: 0 }, () => this.doFight(A))
      if (SQD) SQD.retFight++
    }
    if (e && e.los) this.aimTarget = e
  }
  /** after the mode ran: walking to the zone still shoots the target; idle aim faces the nearest engaged / recent attacker */
  sqAfterMode(A) {
    if (this.mode === "fight" || this.mode === "retreat") return
    const e = this.sqTarget
    if (e && e.los) {
      this.aimTarget = e
      if (SQD) SQD.zoneShoot++
      return
    }
    if (this.aimTarget || this.farmTarget) return
    const f = this.sqFace
    if (f) {
      A.aim = [Math.atan2(f.pos[1] - this.me.pos[1], f.pos[0] - this.me.pos[0]), 0]
      if (SQD) SQD.idleFace++
    }
  }
  /** quiet opening (P.sqQuiet): before sqFrom, calm walks stay under the 5 m/s footstep threshold */
  sqQuietStep(A) {
    const t = this.t
    if (this.mode === "fight" || this.mode === "retreat" || this.mode === "zone" || this.zoneUrgent) return
    if (t - this.lastDamagedT < 6 || this.vis.some((e) => e.los && (e.dist < 60 || t - e.hitMeT < 4))) return
    const k = Math.min(1, 4.6 / (this.walk || 11.7))
    const m = hyp(A.move[0], A.move[1])
    if (m > k) {
      A.move = [(A.move[0] / m) * k, (A.move[1] / m) * k]
      A.boost = false
      if (SQD) SQD.quiet++
    }
  }

  setFight(e) {
""")

# 7. act(): squad fight / retreat wrappers, post-mode aim, lethal release while squad is on
rep("""      case "retreat":
        this.doRetreat(A)
""", """      case "retreat":
        if (this.sqOn) this.doSqRetreat(A)
        else this.doRetreat(A)
""")
rep("""      case "fight":
        this.doFight(A)
""", """      case "fight":
        if (this.sqOn) this.doSqFight(A)
        else this.doFight(A)
""")
rep("    const T3 = now()\n",
    "    if (this.sqOn) this.sqAfterMode(A)\n"
    "    else if (P.sqQuiet > 0 && P.squad > 0 && !this.ffa && this.t < P.sqFrom) this.sqQuietStep(A)\n"
    "    const T3 = now()\n")
rep("    this.doAimFire(A)\n",
    "    if (this.sqOn) this.sqWith({ lethalRelease: P.sqLethal }, () => this.doAimFire(A))\n"
    "    else this.doAimFire(A)\n")
rep("              lethal = good\n",
    "              lethal = good\n              if (SQD && good && this.sqOn) SQD.lethal++\n")

# 8. pickLoot(): laser seek all match, ungated loot (no foe already), crates / drones only out of danger above 50% HP
rep("    const lasFirst = t < P.laserFirst && !this.laser && this.hpS >= 0.45\n",
    "    const lasFirst = (t < P.laserFirst || (this.sqOn && P.sqLasSeek > 0)) && !this.laser && this.hpS >= 0.45\n")
rep("gd = t - this.lastMechDmgT < 4 ? 60 : 300",
    "gd = t - this.lastMechDmgT < 4 ? 60 : this.sqOn && t >= P.laserFirst ? P.sqLasSeek : 300")
rep("    if (this.lootHeld) gated = true // P.lootHold, see decide()\n",
    "    if (this.sqOn) gated = false // squad: pickLoot runs only with no target in sight\n"
    "    if (this.lootHeld) gated = true // P.lootHold, see decide()\n")
rep("    const farming = (P.farmHard && t < P.farmUntil && !this.sqz) || rush\n",
    "    const farming = (P.farmHard && t < P.farmUntil && !this.sqz) || rush || this.sqOn // squad: crates / drones never stop\n")
rep("    const reach = farming ? 2.4 : 1\n",
    "    const reach = this.sqOn ? P.sqLootReach : farming ? 2.4 : 1\n")
rep("    if (P.farm && cubeVal > 0) {\n",
    "    if (P.farm && cubeVal > 0 && !(this.sqOn && (this.sqDanger || this.hpS <= 0.5))) {\n")

open(dst, "w").write(s)
print(f"wrote {dst} ({len(s)} bytes)")
