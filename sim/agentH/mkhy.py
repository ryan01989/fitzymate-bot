# builds sim/variants/hy.mjs from sim/variants/rad8.mjs (agent H: supply-drop engine). Run from fitzymate-bot/.
import sys
src = open("sim/variants/rad8.mjs").read()
def rep(old, new, cnt=1):
    global src
    n = src.count(old)
    if n != cnt: sys.exit(f"anchor count {n} != {cnt}: {old[:60]!r}")
    src = src.replace(old, new)

# 1. switches in P
rep("""  retargetHold: 1.5, // ...but only after this many s on the current target, never off a target we are finishing, never past half a laser charge
}""", """  retargetHold: 1.5, // ...but only after this many s on the current target, never off a target we are finishing, never past half a laser charge
  // --- sim/variants/hy.mjs (agent H): supply drops as heal + cube engine (all off by default). A capture = 3 cubes + full HP + full energy for 4 s alone in an 8 m ring
  dropGo: 0, // out of a fight: a supply drop within this many m becomes the goal once it lands before we could arrive (+dropEarly s), so we stand at the ring when it lands; we hold the ring until captured (0 = off)
  dropEarly: 8, // ...head out this many s before it lands
  dropNear: 30, // a drop is skipped while a mech seen in the last 3 s is within this many m of it and nearer to it than we are, or any mech is inside its ring (9 m): two in the ring freeze the clock
  dropFight: 0, // in a fight: a qualifying drop within this many m takes the legs (like fightCube) while aim and fire stay on the target; inside the ring we circle at 3 m (0 = off)
  dropRet: 0, // in a retreat: run to a qualifying drop within this many m that has landed (or lands as we get there) instead of to cover; aim and fire stay as the retreat sets them (0 = off)
}""")
# 2. reset in P_FFA
rep("""  firstShot: 0, shortRetreat: 0, retarget: 0, // gd-policy lessons: practice only
}""", """  firstShot: 0, shortRetreat: 0, retarget: 0, // gd-policy lessons: practice only
  dropGo: 0, dropFight: 0, dropRet: 0, // agent H drop engine: practice only
}""")
# 3. counters
rep("""    this.gst = { fs: 0, fsNew: 0, srExit: 0, srShoot: 0, rt: 0 }""", """    this.hst = { go: 0, fight: 0, ret: 0, ring: 0, caps: 0 } // agent H: ticks each drop rule acted, ticks inside a ring, captures (from the drop event)
    this.gst = { fs: 0, fsNew: 0, srExit: 0, srShoot: 0, rt: 0 }""")
# 4. leg override after the mode switch (fight / retreat)
rep("""    const T3 = now()
    if (P.weave > 0""", """    if ((P.dropFight > 0 && this.mode === "fight") || (P.dropRet > 0 && this.mode === "retreat")) this.dropLegs(A)
    const T3 = now()
    if (P.weave > 0""")
# 5. out-of-fight hook in decide(): after "start a fight", before kill loot / loot / seek
rep("""    // --- sight-line hysteresis (P.lootHold)""", """    // --- agent H dropGo: a supply drop that lands about when we get there comes before kill loot, loot, seek and explore
    if (P.dropGo > 0 && !this.zoneUrgent && this.zoneSlack > 8) {
      const g = this.dropFor(P.dropGo, P.dropEarly)
      if (g) {
        this.loot = { type: "drop", id: g.dr.id, pos: g.dr.pos }
        this.mode = "loot"
        this.hst.go++
        return
      }
    }
    // --- sight-line hysteresis (P.lootHold)""")
# 6. helpers, before doFight
rep("""  doFight(A) {""", """  // --- agent H drop engine
  /** worth a capture: below the stat cap, hurt, or 3 cubes reach the next upgrade */
  dropWorth() {
    const c = this.me.cubes || 0
    const cap = this.cfg.cubes?.stat_cap ?? 10
    const nextTh = (this.cfg.cubes?.upgrade_thresholds || []).find((v) => v > c) ?? 1e9
    return c < cap || this.hpS < 0.9 || nextTh - c <= 3
  }
  /** nearest drop within maxD that is on the ground before we reach it (+slack s), well inside the zone, not held by someone else, not contested; {dr, d} or null */
  dropFor(maxD, slack) {
    if (!this.dropWorth()) return null
    const t = this.t
    const [x, y] = this.me.pos
    const zc = this.o.zone
    let best = null
    for (const dr of this.o.drops || []) {
      if (dr.holder != null && dr.holder !== this.me.id) continue
      if (this.badLoot && this.badLoot.get(dr.id) > t) continue
      const d = hyp(dr.pos[0] - x, dr.pos[1] - y)
      if (d > maxD || dr.lands_in > d / this.walk + slack) continue
      if (hyp(dr.pos[0] - zc.center[0], dr.pos[1] - zc.center[1]) > zc.radius - 10) continue
      let busy = false
      for (const e of this.en.values()) {
        if (e.phantom || t - e.t > 3) continue
        const de = hyp(e.pos[0] - dr.pos[0], e.pos[1] - dr.pos[1])
        if (de < 9 || (de < P.dropNear && de < d)) busy = true
      }
      if (busy) continue
      if (!best || d < best.d) best = { dr, d }
    }
    return best
  }
  /** fight / retreat: the legs go to a qualifying drop and circle inside its ring; aim and fire are left as the mode set them */
  dropLegs(A) {
    if (this.zoneUrgent || !this.inZone) return
    const fight = this.mode === "fight"
    const g = this.dropFor(fight ? (this.hpS < 0.5 ? P.dropFight * 0.6 : P.dropFight) : P.dropRet, fight ? 2 : 1)
    if (!g) return
    const t = this.t
    if (this.hDropId !== g.dr.id) {
      this.hDropId = g.dr.id
      this.hDropT = t
    }
    // 25 s on one drop without the capture: give it up for a minute
    if (t - this.hDropT > 25 && g.dr.lands_in <= 0) {
      ;(this.badLoot ??= new Map()).set(g.dr.id, t + 60)
      return
    }
    const [x, y, z] = this.me.pos
    const p = g.dr.pos
    if (fight) this.hst.fight++
    else this.hst.ret++
    if (g.d < 5) {
      // inside the ring: circle at about 3 m so we are not a standing target
      this.hst.ring++
      const rx = (x - p[0]) / (g.d || 1),
        ry = (y - p[1]) / (g.d || 1)
      const sg = Math.floor(t / 1.6) % 2 ? 1 : -1
      const inw = g.d > 3 ? -0.8 : 0.3
      const mx = -ry * sg + rx * inw,
        my = rx * sg + ry * inw
      const m = hyp(mx, my) || 1
      A.move = [mx / m, my / m]
      A.boost = false
      return
    }
    const aim = A.aim
    this.moveToPoint(A, p[0], p[1], p[2], 1, !fight && this.me.energy > 30, { replan: 1.2 })
    A.aim = aim
  }
  // --- end agent H

  doFight(A) {""")
rep("""    for (const ev of o.events || []) {
      switch (ev.type) {""", """    for (const ev of o.events || []) {
      if (ev.type === "drop") this.hst.caps++ // agent H: a supply drop captured
      switch (ev.type) {""")
open("sim/variants/hy.mjs", "w").write(src)
print("ok")
