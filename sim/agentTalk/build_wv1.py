#!/usr/bin/env python3
"""wv1-wave: gb11-dropall + P.wave (mid-game hunter-wave cycle: seek / hold / regeneration / late preparation only).
usage: python3 sim/agentTalk/build_wv1.py [src] [dst] [settings-json]
Exact-string replacements, each asserted to match exactly once. Every anchor is kept intact (text is inserted
before or after it), so other agents' scripts that use the same anchors still match once.
Counters: FM_WVC=1 in the environment makes the bot keep this.wvc (seconds / counts per new rule)."""
import sys

src = sys.argv[1] if len(sys.argv) > 1 else "sim/variants/gb11-dropall.mjs"
dst = sys.argv[2] if len(sys.argv) > 2 else "sim/variants/wv1b-wave.mjs"
# v2 (wv1b) = {"wave":1,"wvLane":135}; v1 (wv1-wave.mjs) behaviour = {"wave":1} (v1 file itself was built by sim/agentWave/build_wv1_v1.py)
settings = sys.argv[3] if len(sys.argv) > 3 else '{"wave":1,"wvLane":135}'
s = open(src).read()


def rep(old, new):
    global s
    n = s.count(old)
    assert n == 1, (n, old[:80])
    s = s.replace(old, new)


def after(anchor, add):
    rep(anchor, anchor + add)


def before(anchor, add):
    rep(anchor, add + anchor)


# 1. defaults in P (all off) and the reset in P_FFA
before(
    "  // --- sim/agentA2 audit fixes",
    "  // --- sim/agentWave: the hunter-wave cycle (90-240 s); kill cycle = no-contact search + fight + loot + regeneration\n"
    "  wave: 0, // 1 = (a) out of a fight below seekHp, keep seeking a known mech when our regeneration (5 s delay, then regen_per_s) gets us above seekHp by the time we are within 110 m of it, else wait; (b) with no mech in the 14 s table, seek the freshest sighting of the last wvMem s (each forgotten once we stand within 25 m of it), then, instead of standing at a hold spot, walk toward the next circle's centre; (c) from wvLate s until the 70 m circle: no (b) seeking, and out of a fight with nobody shooting us below wvLateHp break line of sight and regenerate to healTo (on the way when outside the next circle) (0 = off)\n"
    "  wvHurt: 0.5, // ...(a) never below this HP share\n"
    "  wvMem: 45, // ...(b) seconds a sighting stays a seek goal\n"
    "  wvLate: 215, // ...(c) start of the late preparation (match time)\n"
    "  wvLateHp: 0.7, // ...(c) below this HP share regenerate (up to healTo) before the mass hunt\n"
    "  wvLane: 0, // seeking: a mech listed but out of our line of sight, 50 m to this many m away and coming for us (hunt signal >= 1.5): stop and face its bearing so it walks into our view at our range instead of us walking into it round a corner; for at most wvLaneS s per approach (0 = off)\n"
    "  wvLaneS: 6,\n",
)
after(
    "firstShot: 0, shortRetreat: 0, retarget: 0, // gd-policy lessons: practice only\n",
    "  wave: 0, // sim/agentWave: practice only\n",
)

# 2. module-level counter switch
before(
    "/**\n * fixTreeMem: the trees of v2/world.json",
    'const WVC = typeof process !== "undefined" && process.env && process.env.FM_WVC ? 1 : 0 // wave counters (sim only)\n\n',
)

# 3. zoneInfo: long sighting memory (every tick)
before(
    "    if (P.sqzAt > 0 && P.sqzAway > 0) {\n",
    "    if (P.wave > 0) {\n"
    "      // wave: where each mech was last seen, kept for P.wvMem s (the enemy table forgets after 14 s)\n"
    "      const ws = (this.wvSeen ??= new Map())\n"
    "      this.wvDt = Math.min(1, Math.max(0, t - (this.wvT ?? t)))\n"
    "      this.wvT = t\n"
    "      if (WVC && !this.wvc) this.wvc = { seekHurt: 0, hurtWait: 0, seekMem: 0, seekCentre: 0, memDone: 0, lateHeal: 0, lateHealMove: 0, baseSeek: 0, lane: 0, laneN: 0 }\n"
    "      for (const e of this.vis) if (e.cur) ws.set(e.id, [e.pos[0], e.pos[1], e.pos[2], t])\n"
    "      const [mx, my] = this.me.pos\n"
    "      for (const [id, q] of ws)\n"
    "        if (t - q[3] > P.wvMem) ws.delete(id)\n"
    "        else if (t - q[3] > 1 && hyp(q[0] - mx, q[1] - my) < 25) {\n"
    "          ws.delete(id) // we stood there and nobody is in view: forget it\n"
    "          if (this.wvc) this.wvc.memDone++\n"
    "        }\n"
    "    }\n",
)

# 4. kill: forget the dead mech's sighting
after(
    "          if (this.sqzSeen) this.sqzSeen.delete(ev.target)\n",
    "          if (this.wvSeen) this.wvSeen.delete(ev.target)\n",
)

# 5. late preparation: heal before the mass hunt (regeneration block of decide())
rep(
    "    const healBelow = Math.max(this.sqz ? Math.max(P.healBelow, P.sqzHp) : P.healBelow, lateHeal)\n",
    "    const wvH = P.wave > 0 && P.wvLate > 0 && t >= P.wvLate && this.nr >= 100 && !this.finalPhase ? P.wvLateHp : 0 // wave (c)\n"
    "    const healBelow = Math.max(this.sqz ? Math.max(P.healBelow, P.sqzHp) : P.healBelow, lateHeal, wvH)\n",
)
rep(
    "        if (this.sqz && this.dNext > 0) {\n",
    "        if (wvH > 0 && this.wvc) this.wvc[this.dNext > 0 ? \"lateHealMove\" : \"lateHeal\"] += this.wvDt\n"
    "        if ((this.sqz || wvH > 0) && this.dNext > 0) {\n",
)

# 6. seek: after the old seek branch, before explore / hold
before(
    '    this.mode = this.loot ? "loot" : !P.noExplore',
    "    if (P.wave > 0 && !this.loot && this.wvSeek()) return\n",
)
# count the old seek branch too (counters only)
rep(
    "        this.seekGoal = [g.pos[0], g.pos[1], g.pos[2]]\n        this.mode = \"seek\"\n        return\n",
    "        this.seekGoal = [g.pos[0], g.pos[1], g.pos[2]]\n        this.mode = \"seek\"\n        if (this.wvc) this.wvc.baseSeek += this.wvDt\n        return\n",
)

# 7. the wave seek helper
before(
    "  setFight(e) {\n",
    "  /**\n"
    "   * wave: seek when decide()'s own seek did not (see P.wave). (a) a known mech while hurt, only when regeneration gets us above\n"
    "   * seekHp by the time we are within 110 m of it; (b) the freshest remembered sighting; (c) the next circle's centre in place of a hold\n"
    "   * spot. Returns true when it set mode seek.\n"
    "   */\n"
    "  wvSeek() {\n"
    "    const t = this.t,\n"
    "      me = this.me\n"
    "    const [x, y] = me.pos\n"
    "    if (!(P.seekUntil > 0 && t < P.seekUntil && this.huntOk()) || this.zoneSlack <= 20 || this.finalPhase || this.lateOn) return false\n"
    "    if (t - this.lastMechDmgT < 3 || this.hpS < P.wvHurt) return false\n"
    "    const late = P.wvLate > 0 && t >= P.wvLate\n"
    "    const c = this.wvc,\n"
    "      dt = this.wvDt || 0\n"
    "    const regenIn = Math.max(0, this.regenDelay - (t - Math.max(this.lastDamagedT, this.lastDealtT)))\n"
    "    const rps = me.stats?.regen_per_s ?? this.cfg.mech?.regen_per_s ?? 45\n"
    "    // HP share when we get within 110 m of a point d m away (the fight starts there)\n"
    "    const arrive = (d) => Math.min(me.max_hp, me.hp + rps * Math.max(0, Math.max(0, d - 110) / this.walk - regenIn)) / Math.max(1, me.max_hp)\n"
    "    const zc = this.o.zone\n"
    "    const inside = (p) => hyp(p[0] - zc.center[0], p[1] - zc.center[1]) < zc.radius - 10\n"
    "    let goal = null,\n"
    "      kind = null\n"
    "    // (a) a mech in the 14 s table (decide() seeks it itself above seekHp)\n"
    "    let g = null\n"
    "    for (const e of this.en.values()) if (!e.phantom && (!g || e.t > g.t)) g = e\n"
    "    if (g) {\n"
    "      if (this.hpS > P.seekHp) return false\n"
    "      if (arrive(hyp(g.pos[0] - x, g.pos[1] - y)) < P.seekHp) {\n"
    "        if (c) c.hurtWait += dt\n"
    "        return false\n"
    "      }\n"
    "      goal = g.pos\n"
    "      kind = \"seekHurt\"\n"
    "    } else if (!late) {\n"
    "      // (b) the freshest sighting of the last P.wvMem s (reached sooner = better)\n"
    "      let bs = -1e9\n"
    "      if (this.wvSeen)\n"
    "        for (const q of this.wvSeen.values()) {\n"
    "          if (!inside(q)) continue\n"
    "          const d = hyp(q[0] - x, q[1] - y)\n"
    "          const sc = -(t - q[3]) - d / this.walk\n"
    "          if (sc > bs && arrive(d) >= P.seekHp) {\n"
    "            bs = sc\n"
    "            goal = q\n"
    "          }\n"
    "        }\n"
    "      if (goal) kind = \"seekMem\"\n"
    "      else if (this.nr > 60 && hyp(this.nc[0] - x, this.nc[1] - y) > Math.max(40, 0.35 * this.nr) && this.hpS > P.seekHp) {\n"
    "        // (c) nothing known: hunters and wanderers meet in the next circle, so wait for them nearer its middle; only where we would stand at a hold spot\n"
    "        const explore = !P.noExplore && P.farmHard && t < P.farmUntil && !this.sqz && this.hpS > P.exploreHp && this.zoneSlack > 25 && t - this.lastMechDmgT > 4\n"
    "        if (!explore) {\n"
    "          const gz = this.w ? this.w.ground(this.nc[0], this.nc[1]) : me.pos[2]\n"
    "          goal = [this.nc[0], this.nc[1], gz]\n"
    "          kind = \"seekCentre\"\n"
    "        }\n"
    "      }\n"
    "    }\n"
    "    if (!goal) return false\n"
    "    if (c) c[kind] += dt\n"
    "    this.seekGoal = [goal[0], goal[1], goal[2]]\n"
    "    this.mode = \"seek\"\n"
    "    return true\n"
    "  }\n\n",
)

# 7b. lane hold while seeking (P.wvLane)
after(
    '      case "seek":\n',
    "        if (P.wave > 0 && P.wvLane > 0 && this.wvLaneStep(A)) break\n",
)
before(
    "  setFight(e) {\n",
    "  /** wave lane: while seeking, let a mech that is coming for us (listed, out of sight, 50 m..P.wvLane) walk into our view: stand and face it (see P.wvLane) */\n"
    "  wvLaneStep(A) {\n"
    "    const t = this.t\n"
    "    const [x, y] = this.me.pos\n"
    "    let g = null\n"
    "    for (const e of this.en.values()) if (e.cur && !e.los && e.dist > 50 && e.dist < P.wvLane && e.hunt >= 1.5 && (!g || e.dist < g.dist)) g = e\n"
    "    if (!g || this.zoneSlack < 20) return false\n"
    "    if (this.wvLaneT0 == null || t - (this.wvLaneLast ?? -99) > 2) {\n"
    "      this.wvLaneT0 = t\n"
    "      if (this.wvc) this.wvc.laneN++\n"
    "    }\n"
    "    this.wvLaneLast = t\n"
    "    if (t - this.wvLaneT0 > P.wvLaneS) return false\n"
    "    if (this.wvc) this.wvc.lane += this.wvDt || 0\n"
    "    A.move = [0, 0]\n"
    "    A.aim = [Math.atan2(g.pos[1] - y, g.pos[0] - x), 0]\n"
    "    return true\n"
    "  }\n\n",
)

# 7c. only on stacks with the squad decision layer (sqDecide, build_sq*.py): it ends in loot / hold and has no seek at all, so with
# wave on, seek there as decide() does (gb11 rule: freshest mech of the 14 s table above seekHp) and then wvSeek(). Skipped when absent.
SQA = '    this.mode = this.loot ? "loot" : "hold"\n  }\n  /** run fn with some P fields replaced'
if s.count(SQA) == 1:
    before(SQA, "    if (P.wave > 0 && !this.loot && this.wvSqSeek()) return\n")
    before(
        "  setFight(e) {\n",
        "  /** wave on the squad layer: decide()'s seek (P.seekUntil / seekHp, freshest mech of the 14 s table), then wvSeek() */\n"
        "  wvSqSeek() {\n"
        "    const t = this.t\n"
        "    if (P.seekUntil > 0 && t < P.seekUntil && this.huntOk() && this.hpS > P.seekHp && this.zoneSlack > 20) {\n"
        "      let g = null\n"
        "      for (const e of this.en.values()) if (!e.phantom && t - e.t < 20 && (!g || e.t > g.t)) g = e\n"
        "      if (g) {\n"
        "        this.seekGoal = [g.pos[0], g.pos[1], g.pos[2]]\n"
        "        this.mode = \"seek\"\n"
        "        if (this.wvc) this.wvc.baseSeek += this.wvDt\n"
        "        return true\n"
        "      }\n"
        "    }\n"
        "    return this.wvSeek()\n"
        "  }\n\n",
    )
    print("squad layer found: seek added to sqDecide")

# 8. the settings line, right after the gb11 line
after(
    'Object.assign(P, {"dropAll":1}) // gb11-dropall: w03 + go for every supply drop (3 cubes + full repair + full energy) within 230 m that we can reach by landing + 8 s and that no known mech is within 70 m of; ahead of other loot\n',
    "Object.assign(P, " + settings + ") // wv1-wave / wv1b-wave: gb11 + hunter-wave cycle (seek while regenerating, long sighting memory, next-centre wait, heal before the mass hunt; wv1b adds the lane hold wvLane; sim/agentWave)\n",
)

open(dst, "w").write(s)
print("wrote", dst)
