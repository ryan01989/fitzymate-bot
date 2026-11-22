#!/usr/bin/env python3
"""Build sim/variants/sq2-move.mjs from sim/variants/gb11-dropall.mjs.

sqMove: fight movement by position sampling (new-idea.md 5.1-5.5, clean-room from the prose).
Every edit is an exact-string replacement asserted to match exactly once.
Run from the fitzymate-bot directory:  python3 sim/agentTalk/build_sq2.py [src] [dst]
"""
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "sim/variants/gb11-dropall.mjs"
DST = sys.argv[2] if len(sys.argv) > 2 else "sim/variants/sq2-move.mjs"
s = open(SRC).read()


def rep(old, new):
    global s
    n = s.count(old)
    assert n == 1, f"anchor found {n} times: {old[:80]!r}"
    s = s.replace(old, new)


# ---------------------------------------------------------------- params (P defaults)
rep(
    "  bandRange: 14, // dead band around the preferred range\n",
    "  bandRange: 14, // dead band around the preferred range\n"
    "  // --- sq2-move: fight movement by position sampling (sim/agentTalk/build_sq2.py)\n"
    "  sqMove: 0, // 1 = in a fight with the target in sight, score 17 spots (stand + 16 x 6 m) each tick on range error, the line of sight we want (gun only: out of it while reloading), other mechs that could see the spot, wall clearance, cube pull and strafe side; then blend in a bullet / aimed-laser sidestep (0 = the old band-and-strafe)\n"
    "  sqRange: 0, // with sqMove: 0 = our preferred ranges (104 gun / 112 laser and the usual modifiers, finishRange included), 1 = the reference table (a squad finish range, this.sqFinish, overrides it) (85 gun, 120 laser, 28 with lightning, floors 64 / 80 against lightning / mortar)\n"
    "  sqExpo: 30, // with sqMove: points off a spot for each other mech (seen in the last 3 s, within 170 m, nearest 5) whose eye sees our body there\n"
    "  sqWall: 4, // with sqMove: wall clearance (m, centre to wall, scaled to a base-size mech) below which a spot loses 2.5 points per m\n"
    "  sqDuck: 1, // with sqMove: reloading (gun only) and no spot of the ring out of the target's sight: walk to the nearest hidden node (duck())\n"
    "  sqMpc: 1, // with sqMove: when bullets are in the air, check the blended move against the bullet prediction (missDist) and take a better-clearing top-ranked spot instead\n"
    "  sqCubes: 0, // with sqMove: 1 = cubes only pull through the spot score (+1.5 per m closer, within 40 m) instead of fightCube taking over the legs\n"
    "  sqHold: 3, // with sqMove: s the scorer keeps working on a target out of our sight (seen this recently): we may have stepped out on purpose, and the shot line is scored from where it was last seen; after that the old chase\n"
    "  sqAim: 0, // 1 = aim at 85% of the target's height when its centre is blocked from our muzzle\n",
)

# ---------------------------------------------------------------- P_FFA resets
rep("export const P_FFA = {\n", "export const P_FFA = {\n  sqMove: 0, sqAim: 0,\n")

# ---------------------------------------------------------------- settings line after the dropAll line
key = '"dropAll":1'
lines = s.split("\n")
idx = [i for i, l in enumerate(lines) if key in l]
assert len(idx) == 1, idx
lines.insert(idx[0] + 1, 'Object.assign(P, {"sqMove":1,"sqAim":1}) // sq2-move: gb11 + fight movement by position sampling (new-idea 5.1-5.5), our ranges kept (sqRange 0); aim drops to 85% height when the centre is blocked')
s = "\n".join(lines)

# ---------------------------------------------------------------- doFight hooks
rep(
    "  doFight(A) {\n    const t = this.t\n    const me = this.me\n    const e = this.en.get(this.targetId)\n",
    "  doFight(A) {\n    const t = this.t\n    const me = this.me\n    const e = this.en.get(this.targetId)\n"
    "    if (SQDBG) this.sqTick(e)\n",
)
rep(
    "    if (!e.los) {\n      // chase / re-acquire through cover toward where it is\n",
    "    if (!e.los && !(P.sqMove > 0 && t - e.t < P.sqHold)) {\n      // chase / re-acquire through cover toward where it is\n",
)
rep(
    "      const skipCubes = bc || !(P.fightCube > 0) ||",
    "      const skipCubes = bc || !(P.fightCube > 0) || (P.sqMove > 0 && P.sqCubes > 0) ||",
)
rep(
    "    if (this.duck(A, e)) return\n    this.path = null\n",
    "    if (!(P.sqMove > 0)) {\n      if (this.duck(A, e)) return\n      this.path = null\n    }\n",
)
rep(
    "    pr = Math.min(pr, maxR)\n    let radial = clamp((d - pr) / P.bandRange, -1, 1)\n",
    "    pr = Math.min(pr, maxR)\n"
    "    if (P.sqMove > 0) return this.sqFight(A, e, P.sqRange > 0 ? Math.min(this.sqOn && this.sqFinish > 0 ? this.sqFinish : this.sqPrefRange(e), maxR) : pr, d, ux, uy)\n"
    "    let radial = clamp((d - pr) / P.bandRange, -1, 1)\n",
)

# ---------------------------------------------------------------- new methods, placed before duck()
NEW = r'''
  /** new-idea 5.1: the reference preferred range table (sqRange 1); NPC targets never reach doFight */
  sqPrefRange(e) {
    let pr = this.laser ? 120 : 85
    if (this.lightning && this.me.energy > 12) pr = 28
    if (!this.lightning && e.has("lightning")) pr = Math.max(pr, 64)
    if (!this.lightning && e.has("mortar")) pr = Math.max(pr, 80)
    return pr
  }

  /** new-idea 5.2: +1 = we want a shot line to the target, -1 = we want to be out of it (gun only, reloading) */
  sqWantLos(e, d) {
    if (this.laser || this.lightning) return 1
    const gun = this.gun
    if (!gun) return -1
    const rl = gun.reload > 0 ? gun.reload : 0
    const loaded = (gun.ammo > 0 && rl <= 0.25) || (rl > 0 && rl <= 0.25)
    return loaded && d < (gun.stats.range ?? 230) - 10 ? 1 : -1
  }

  /** other mechs that could see us in this fight: seen in the last 3 s, within 170 m, the nearest 5 */
  sqWatchers(e) {
    const t = this.t
    const [x, y] = this.me.pos
    const out = []
    for (const q of this.en.values()) {
      if (q === e || q.phantom || t - q.t >= 3) continue
      const dq = hyp(q.pos[0] - x, q.pos[1] - y)
      if (dq < 170) out.push([dq, q])
    }
    out.sort((a, b) => a[0] - b[0])
    return out.slice(0, 5).map((a) => a[1])
  }

  /** how many watchers' eyes see our body (60% height) standing at (px, py, pz) */
  sqExposure(watchers, px, py, pz) {
    const w = this.w
    if (!w) return 0
    let n = 0
    const bz = pz + this.Hh * 0.6
    for (const q of watchers) if (w.los(q.pos[0], q.pos[1], q.pos[2] + 8 * (1 + 0.05 * (q.cubes || 0)), px, py, bz)) n++
    return n
  }

  /**
   * P.sqMove (new-idea 5.3-5.5). Score the spot we stand on and 16 headings x 6 m, keep the best as a unit
   * direction (re-picked every tick), then blend in a sidestep from bullets about to pass through us and from a
   * mech holding a charging laser on us: move = 0.4 x planned + 0.9 x dodge. Gun only and reloading, the shot line
   * counts against a spot, so we step out of sight and come back for the next magazine.
   */
  sqFight(A, e, pr, d, ux, uy) {
    const t = this.t
    const me = this.me
    const w = this.w
    const [x, y, z] = me.pos
    if (w && this.myNode >= 0) {
      const n0 = w.nodeAt(x, y, z, 1.8)
      if (n0 < 0 || w.wd[n0] < this.reqR - 0.35) {
        // pressed against a wall: step back into the open first
        this.steerTo(A, w.nodeX(this.myNode), w.nodeY(this.myNode), 1)
        return
      }
    }
    const want = this.sqWantLos(e, d)
    // 5.4 strafe timer: 0.3-1.0 s, flip side with 60% on expiry
    if (!(t < this.sqFlipT)) {
      if (this.rand() < 0.6) this.strafeSide = -this.strafeSide
      this.sqFlipT = t + 0.3 + this.rand() * 0.7
    }
    const STEP = 6,
      NR = 16
    // scratch buffers kept on the instance (no garbage per tick)
    const B = (this.sqBuf ??= { cx: new Float64Array(NR + 1), cy: new Float64Array(NR + 1), cz: new Float64Array(NR + 1), ok: new Uint8Array(NR + 1), sc: new Float64Array(NR + 1), exp: new Uint8Array(NR + 1), losAt: new Uint8Array(NR + 1) })
    const { cx, cy, cz, ok, sc, exp, losAt } = B
    ok.fill(0)
    exp.fill(0)
    losAt.fill(0)
    cx[0] = x
    cy[0] = y
    cz[0] = z
    ok[0] = 1
    for (let k = 1; k <= NR; k++) {
      const a = ((k - 1) * TAU) / NR
      cx[k] = x + Math.cos(a) * STEP
      cy[k] = y + Math.sin(a) * STEP
      cz[k] = z
      if (!w) {
        ok[k] = 1
        continue
      }
      if (!w.walkLine(x, y, z, cx[k], cy[k], this.reqR - 0.3, this.Hh)) continue
      const m = w.nodeAt(cx[k], cy[k], z, 3.2)
      if (m < 0) continue
      cz[k] = w.surf[m]
      ok[k] = 1
    }
    // a blocked spot within ~26 deg of the strafe side: flip now and hold the new side 0.5 s
    let s = this.strafeSide
    {
      const sa = Math.atan2(ux * s, -uy * s)
      for (let k = 1; k <= NR; k++) {
        if (ok[k]) continue
        if (Math.abs(angNorm(((k - 1) * TAU) / NR - sa)) < 0.46) {
          this.strafeSide = s = -s
          this.sqFlipT = t + 0.5
          break
        }
      }
    }
    const sx = -uy * s,
      sy = ux * s
    const watchers = this.sqWatchers(e)
    // nearest remembered cube within 40 m (4 m vertically) pulls the spot toward it
    let cube = null
    {
      let bd = 40
      for (const c of this.cubes.values()) {
        const dc = hyp(c.pos[0] - x, c.pos[1] - y)
        if (dc < bd && Math.abs(c.pos[2] - z) <= 4) {
          bd = dc
          cube = c
        }
      }
    }
    const cubeD0 = cube ? hyp(cube.pos[0] - x, cube.pos[1] - y) : 0
    const wallRef = P.sqWall + (this.R - 2.5)
    const zoneOn = this.dNext > -8
    sc.fill(-1e9)
    let anyHidden = false
    for (let k = 0; k <= NR; k++) {
      if (!ok[k]) continue
      const px = cx[k],
        py = cy[k],
        pz = cz[k]
      let v = -1.1 * Math.abs(hyp(e.pos[0] - px, e.pos[1] - py) - pr)
      if (k > 0) v -= 0.4 * STEP
      const los = !w || w.los(px, py, pz + this.muzH, e.pos[0], e.pos[1], e.cz)
      losAt[k] = los ? 1 : 0
      if (!los) anyHidden = true
      if (los) v += 45 * want
      const n = watchers.length ? this.sqExposure(watchers, px, py, pz) : 0
      exp[k] = n
      v -= P.sqExpo * n
      if (zoneOn) {
        const out = hyp(px - this.nc[0], py - this.nc[1]) - this.safeR
        if (out > -8) v -= 1.5 * (out + 8)
      }
      if (cube) v += 1.5 * (cubeD0 - hyp(cube.pos[0] - px, cube.pos[1] - py))
      if (w) {
        const m = k === 0 ? w.nodeAt(px, py, pz, 1.8) : w.nodeAt(px, py, pz, 1.0)
        const wd = m >= 0 ? w.wd[m] : 0
        if (wd < wallRef) v -= 2.5 * (wallRef - wd)
      }
      if (k > 0 && want > 0) {
        const a = ((k - 1) * TAU) / NR
        v += 9 * (Math.cos(a) * sx + Math.sin(a) * sy)
      }
      if (k === 0) v += want < 0 && !los ? 14 : -8
      sc[k] = v
    }
    let bk = 0
    for (let k = 1; k <= NR; k++) if (sc[k] > sc[bk]) bk = k
    const S = this.sqS
    // gun reloading and every spot of the ring in the target's sight: walk to the nearest hidden node instead
    if (want < 0 && !anyHidden && P.sqDuck > 0 && this.duck(A, e)) {
      if (S) S.duck++
      return
    }
    this.path = null
    let mv = bk === 0 ? [0, 0] : [Math.cos(((bk - 1) * TAU) / NR), Math.sin(((bk - 1) * TAU) / NR)]
    // 5.5 sidestep: bullets about to pass within our radius + 1.1 m in the next 0.7 s, and lasers charging on us
    let ddx = 0,
      ddy = 0,
      lasDodge = false
    const ps = this.o.projectiles
    const ccz = z + this.Hh * 0.56
    if (ps && ps.length) {
      for (const p of ps) {
        if (p.kind === "mortar") continue
        const vx = p.vel[0],
          vy = p.vel[1],
          vz = p.vel[2] || 0
        const v2 = vx * vx + vy * vy + vz * vz
        if (v2 < 1) continue
        const rx = x - p.pos[0],
          ry = y - p.pos[1],
          rz = ccz - p.pos[2]
        const tca = (rx * vx + ry * vy + rz * vz) / v2
        if (!(tca > 0 && tca < 0.7)) continue
        const mx = rx - vx * tca,
          my = ry - vy * tca
        const md = hyp(mx, my)
        if (md >= this.R + 1.1) continue
        if (md > 0.05) {
          ddx += mx / md
          ddy += my / md
        } else {
          const hv = hyp(vx, vy) || 1
          ddx += (-vy / hv) * s
          ddy += (vx / hv) * s
        }
      }
    }
    for (const q of this.vis) {
      if (!q.charging || !q.los || !q.aim) continue
      const bx = x - q.pos[0],
        by = y - q.pos[1]
      const bd = hyp(bx, by) || 1
      if (Math.abs(angNorm(q.aim[0] - Math.atan2(by, bx))) >= 0.15) continue
      ddx += 1.5 * (-by / bd) * s
      ddy += 1.5 * (bx / bd) * s
      lasDodge = true
    }
    const dodged = ddx !== 0 || ddy !== 0
    if (dodged) {
      const bx = 0.4 * mv[0] + 0.9 * ddx,
        by = 0.4 * mv[1] + 0.9 * ddy
      const bm = hyp(bx, by)
      if (bm > 1e-6) mv = [bx / bm, by / bm]
      if (bm > 1e-6 && w && !w.walkLine(x, y, z, x + mv[0] * 4, y + mv[1] * 4, this.reqR - 0.3, this.Hh)) {
        // the sidestep runs into a wall: the nearest walkable heading to it, else the plan
        const fd = this.sqFreeDir(mv[0], mv[1])
        mv = fd || (bk === 0 ? [0, 0] : [Math.cos(((bk - 1) * TAU) / NR), Math.sin(((bk - 1) * TAU) / NR)])
      }
    }
    // our bullet prediction: if the move still leaves a bullet on us, a top-ranked spot that clears it better wins
    let mpcSw = false
    if (P.sqMpc > 0 && ps && ps.length) {
      const need = this.R + 1.3
      let bestV = Math.min(this.missDist(mv), need) * 10
      if (bestV < need * 10) {
        const order = []
        for (let k = 0; k <= NR; k++) if (ok[k]) order.push(k)
        order.sort((a, b) => sc[b] - sc[a])
        for (let i = 0; i < Math.min(5, order.length); i++) {
          const k = order[i]
          const c = k === 0 ? [0, 0] : [Math.cos(((k - 1) * TAU) / NR), Math.sin(((k - 1) * TAU) / NR)]
          const v = Math.min(this.missDist(c, k === 0 ? 0.01 : 0), need) * 10 + 0.25 * (sc[k] - sc[bk])
          if (v > bestV + 0.5) {
            bestV = v
            mv = c
            mpcSw = true
          }
        }
      }
    }
    A.move = mv
    if (lasDodge && me.energy > 25) A.boost = true
    if (this.lightning && pr < 50 && d > 50 && me.energy > 55 && want > 0) A.boost = true
    // a lightning carrier inside its reach: open the range fast (kept from the old fight movement)
    if (e.has("lightning") && d < 52 && me.energy > 25 && !(this.lightning && this.hpS > e.hpS)) {
      const m0 = [-uy * s * 0.35 - ux, ux * s * 0.35 - uy]
      const mm = hyp(m0[0], m0[1]) || 1
      const m1 = [m0[0] / mm, m0[1] / mm]
      if (!w || w.walkLine(x, y, z, x + m1[0] * 5, y + m1[1] * 5, this.reqR - 0.3, this.Hh)) {
        A.move = m1
        A.boost = true
      }
    }
    if (S) {
      S.sq++
      S.expSum += exp[bk]
      if (want < 0) S.wantOut++
      if (dodged) S.dodge++
      if (lasDodge) S.lasDodge++
      if (mpcSw) S.mpc++
      if (bk === 0) S.stand++
    }
  }

  /** FM_SQDBG: fight bookkeeping, comparable between sqMove on and off; totals per process go to stderr on exit */
  sqTick(e) {
    const t = this.t
    const me = this.me
    let S = this.sqS
    if (!S) {
      S = this.sqS = { matches: 1, fightS: 0, dmg: 0, losTicks: 0, relTicks: 0, relHid: 0, curExpSum: 0, curExpN: 0, sq: 0, expSum: 0, wantOut: 0, dodge: 0, lasDodge: 0, mpc: 0, stand: 0, duck: 0, shellRot: 0 }
      const G = globalThis.__sqTot
      if (!G) {
        globalThis.__sqTot = []
        process.on("exit", () => {
          const T = {}
          for (const q of globalThis.__sqTot) for (const k in q) T[k] = (T[k] || 0) + q[k]
          process.stderr.write("SQDBG " + JSON.stringify(T) + "\n")
        })
      }
      globalThis.__sqTot.push(S)
    }
    if (this.sqPrevT !== undefined && t - this.sqPrevT < 0.25) {
      S.fightS += t - this.sqPrevT
      if (this.sqPrevHp > me.hp) S.dmg += this.sqPrevHp - me.hp
    }
    this.sqPrevT = t
    this.sqPrevHp = me.hp
    if (!e || !this.w || (!e.los && !(t - e.t < 3))) return
    const [x, y, z] = me.pos
    if (e.los) S.losTicks++
    const losNow = this.w.los(x, y, z + this.muzH, e.pos[0], e.pos[1], e.cz)
    if (this.sqWantLos(e, e.dist) < 0) {
      S.relTicks++
      if (!losNow) S.relHid++
    }
    const wt = this.sqWatchers(e)
    S.curExpSum += wt.length ? this.sqExposure(wt, x, y, z) : 0
    S.curExpN++
  }

  /** a unit direction near (dx, dy) with 6 m of walkable line: rotated 0, +-0.7, +-1.4 rad (null if none) */
  sqFreeDir(dx, dy) {
    const w = this.w
    if (!w) return [dx, dy]
    const [x, y, z] = this.me.pos
    for (const r of [0, 0.7, -0.7, 1.4, -1.4]) {
      const c = Math.cos(r),
        sn = Math.sin(r)
      const mx = dx * c - dy * sn,
        my = dx * sn + dy * c
      if (w.walkLine(x, y, z, x + mx * 6, y + my * 6, this.reqR - 0.3, this.Hh)) return [mx, my]
    }
    return null
  }

  /** P.sqAim: the centre of the target, or 85% of its height when the centre is blocked from our muzzle */
  sqAimZ(e) {
    const w = this.w
    if (!w) return e.cz
    const me = this.me
    const mz = me.pos[2] + this.muzH
    if (w.ray(me.pos[0], me.pos[1], mz, e.pos[0], e.pos[1], e.cz, 2.5) >= 1) return e.cz
    const z85 = e.pos[2] + 0.85 * 9 * (1 + 0.05 * (e.cubes || 0))
    return w.ray(me.pos[0], me.pos[1], mz, e.pos[0], e.pos[1], z85, 2.5) >= 1 ? z85 : e.cz
  }

  /**
   * With the magazine empty and nothing else to shoot with, step behind the nearest corner for the
'''
rep(
    "\n  /**\n   * With the magazine empty and nothing else to shoot with, step behind the nearest corner for the\n",
    NEW,
)

# ---------------------------------------------------------------- mortar shells: a walkable way out, splash + R + 2, boost > 15
rep(
    "      const m = hyp(dx, dy) || 1\n      A.move = [dx / m, dy / m]\n      A.boost = this.me.energy > 8\n      return\n",
    "      const m = hyp(dx, dy) || 1\n"
    "      A.move = [dx / m, dy / m]\n"
    "      A.boost = this.me.energy > 8\n"
    "      if (P.sqMove > 0) {\n"
    "        const fd = this.sqFreeDir(dx / m, dy / m)\n"
    "        if (fd) A.move = fd\n"
    "        A.boost = this.me.energy > 15\n"
    "        if (this.sqS && fd && (fd[0] !== dx / m || fd[1] !== dy / m)) this.sqS.shellRot++\n"
    "      }\n"
    "      return\n",
)
rep(
    "    const rad = (this.cfg.weapons?.mortar?.splash_radius ?? 7) + this.R + 1.5\n",
    "    const rad = (this.cfg.weapons?.mortar?.splash_radius ?? 7) + this.R + (P.sqMove > 0 ? 2 : 1.5)\n",
)

# ---------------------------------------------------------------- aim: 85% height when the centre is blocked
rep(
    "      const gunSol = gun ? this.lead(e.pos, vel, e.cz, gun.stats.speed, 0.075) : null\n"
    "      const lasSol = laser ? this.lead(e.pos, e.vel, e.cz, 0, 0.09) : null\n",
    "      const aimZ = P.sqAim > 0 ? this.sqAimZ(e) : e.cz\n"
    "      const gunSol = gun ? this.lead(e.pos, vel, aimZ, gun.stats.speed, 0.075) : null\n"
    "      const lasSol = laser ? this.lead(e.pos, e.vel, aimZ, 0, 0.09) : null\n",
)

# ---------------------------------------------------------------- debug switch (module level, next to the clamp helper)
rep(
    "const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)\n",
    "const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)\n"
    'const SQDBG = typeof process !== "undefined" && !!(process.env && process.env.FM_SQDBG)\n',
)

open(DST, "w").write(s)
print("wrote", DST, len(s), "bytes")
