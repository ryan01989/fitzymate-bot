import sys
p = sys.argv[1]
s = open(p).read()
def rep(old, new, n=1):
    global s
    c = s.count(old)
    assert c == n, (c, old[:80])
    s = s.replace(old, new)

# ---- P tunables
rep('''  focusLow: 0, // in a fight, switch to a mech in sight this much lower in HP share (0 = off)
}''', '''  focusLow: 0, // in a fight, switch to a mech in sight this much lower in HP share (0 = off)
  // --- sim/variants/gd-policy.mjs: three lessons, rebuilt on our own signals (all off by default; see sim/agentG/NOTES.txt)
  firstShot: 0, // lesson A: a mech in sight inside huntDist that is coming for us now (aimOn, or closing > 3.5 m/s inside 140 m) and has been for this many s of e.hunt: start the fight even past the crowd / HP-lead / cube / outgunned vetoes, while we are at hideHp or above (0 = off)
  shortRetreat: 0, // lesson B: leave a retreat this many s after its last trigger once we are not swamped (< 3 attackers), not out-traded (race() <= raceOut) and not low and under fire, instead of holding to resumeHp; and shoot any threat in sight while retreating (0 = off)
  retarget: 0, // lesson C: in a fight, switch to a mech whose start-of-fight score beats the target's by this many points (100 = full HP share) (0 = off)
  retargetHold: 1.5, // ...but only after this many s on the current target, never off a target we are finishing, never past half a laser charge
}''')
rep('''  upSet: 0, chaseHp: 0.4, chaseMyHp: 0.55, chaseS: 7, farmBoost: 0,
}''', '''  upSet: 0, chaseHp: 0.4, chaseMyHp: 0.55, chaseS: 7, farmBoost: 0,
  firstShot: 0, shortRetreat: 0, retarget: 0, // gd-policy lessons: practice only
}''')
# ---- counters (verification only, no effect on play)
rep('''    this.deadline = Infinity
    this.spots = null''', '''    this.deadline = Infinity
    this.gst = { fs: 0, fsNew: 0, srExit: 0, srShoot: 0, rt: 0 } // gd-policy: how often each lesson acted (read by sim/agentG/fires.mjs)
    this.spots = null''')
# ---- ingest: keep the closing speed (lesson A)
rep('''        e.hunt = clamp(e.hunt + dt * (hunting ? 1 : -0.6), 0, 6)''', '''        e.hunt = clamp(e.hunt + dt * (hunting ? 1 : -0.6), 0, 6)
        e.closeV = closing // firstShot''')
rep('''      } else {
        e.vAvg[0] = m.vel[0]
        e.vAvg[1] = m.vel[1]
      }''', '''      } else {
        e.vAvg[0] = m.vel[0]
        e.vAvg[1] = m.vel[1]
        e.closeV = 0 // firstShot
      }''')
# ---- wantFight: firstShot before the vetoes
rep('''    if (!defending && this.t < P.huntUntil && this.huntOk() && hpS > 0.6 && e.dist < 200 && e.los) return true''', '''    // --- firstShot (lesson A): a mech coming for us has already started this fight; declining only hands it the first shot
    if (!defending && P.firstShot > 0 && this.firstShotOk(e)) return true
    // --- end firstShot
    if (!defending && this.t < P.huntUntil && this.huntOk() && hpS > 0.6 && e.dist < 200 && e.los) return true''')
rep('''  /**
   * laserRun: should the opening laser run take over''', '''  // --- firstShot (lesson A)
  /** e is coming for us right now: in sight inside huntDist, its hunting signal on this tick (the same test ingest() feeds e.hunt with) and held for P.firstShot s, us not below hideHp */
  firstShotOk(e) {
    return e.los && !e.phantom && e.dist < P.huntDist && e.hunt >= P.firstShot && (e.aimOn || (e.closeV > 3.5 && e.dist < 140)) && this.hpS >= P.hideHp
  }
  // --- shortRetreat (lesson B)
  /** stay in the retreat? Only for P.shortRetreat s after its last trigger, while 3+ mechs hit us in the last 3 s, while low and hit within regenDelay, or while an attacker out-trades us */
  srStay(atk) {
    const t = this.t
    if (t - this.recoverT < P.shortRetreat) return true
    if (atk.length >= 3) return true
    if (this.hpS < P.hideHp && t - this.lastMechDmgT < this.regenDelay) return true
    for (const e of atk) {
      const r = this.race(e)
      if (r != null && r > P.raceOut) return true
    }
    return false
  }
  // --- retarget (lesson C)
  /** the start-of-fight score of decide() (higher is better) */
  fightScore(e) {
    return (1 - e.hpS) * 100 - e.dist * P.scoreDist + (this.rearOf(e) ? P.rearBonus : 0)
  }
  // --- end gd-policy helpers

  /**
   * laserRun: should the opening laser run take over''')
# ---- decide: retreat exit
rep('''      const healed = hpS >= P.resumeHp || (sinceHit > this.regenDelay + 2 && hpS >= 0.7 && !exposed.length)
      if (!(healed && sinceHit > 2.5) && t - this.recoverT < 40 && !this.lasRunNow(null) && !this.rushQuiet(null)) return
      this.mode = "hold"''', '''      if (P.shortRetreat > 0) {
        // --- shortRetreat (lesson B): leave as soon as the reason to run is gone, not once healed
        if (this.srStay(atk) && t - this.recoverT < 40 && !this.lasRunNow(null) && !this.rushQuiet(null)) return
        this.gst.srExit++
        // --- end shortRetreat
      } else {
        const healed = hpS >= P.resumeHp || (sinceHit > this.regenDelay + 2 && hpS >= 0.7 && !exposed.length)
        if (!(healed && sinceHit > 2.5) && t - this.recoverT < 40 && !this.lasRunNow(null) && !this.rushQuiet(null)) return
      }
      this.mode = "hold"''')
# ---- decide: retarget before "continue a fight"
rep('''    if (this.mode === "fight" && target) {
      const lost = t - (target.losT ?? -99)''', '''    // --- retarget (lesson C): re-score the fight each tick with the start-of-fight score, switch only on a clear margin
    if (P.retarget > 0 && this.mode === "fight" && target && target.los && t - this.fightStartT >= P.retargetHold) {
      const fin = target.hpS < P.finishHp && t - (target.myHitT ?? -99) < 2
      const midCharge = this.charging && this.laser && this.laser.charge >= (this.laser.stats.charge ?? 0.75) * 0.5
      if (!fin && !midCharge) {
        let alt = null,
          sa = this.fightScore(target) + P.retarget
        for (const e of losE) {
          if (e === target || e.dist > P.startDist) continue
          if (!(t - e.hitMeT < 3 || this.wantFight(e, false))) continue
          const s = this.fightScore(e)
          if (s > sa) {
            sa = s
            alt = e
          }
        }
        if (alt) {
          this.gst.rt++
          this.setFight(alt)
          return
        }
      }
    }
    // --- end retarget
    if (this.mode === "fight" && target) {
      const lost = t - (target.losT ?? -99)''')
# ---- decide: count firstShot fight starts
rep('''    if (best) {
      this.setFight(best)
      return
    }
    // --- sight-line hysteresis''', '''    if (best) {
      if (P.firstShot > 0 && this.firstShotOk(best) && !(this.mode === "fight" && this.targetId === best.id)) {
        this.gst.fs++
        if (best.hunt < 2 || this.others(best, P.crowd) >= 1 || this.hpS < P.huntHp || this.hpS - best.hpS <= P.vetoAdv) this.gst.fsNew++ // the old rules would most likely have waited
      }
      this.setFight(best)
      return
    }
    // --- sight-line hysteresis''')
# ---- doRetreat: shoot a threat in sight
rep('''    if (main) {
      this.aimTarget = main.los ? main : null
      if (!main.los)''', '''    if (main) {
      this.aimTarget = main.los ? main : null
      // --- shortRetreat (lesson B): the main threat is out of sight, but another one is in it: shoot that one (most recent attacker, then nearest)
      if (P.shortRetreat > 0 && !main.los) {
        let q = null
        for (const e of this.vis) if (e.los && e.dist < 230 && (!q || e.hitMeT > q.hitMeT || (e.hitMeT === q.hitMeT && e.dist < q.dist))) q = e
        if (q) {
          this.aimTarget = q
          this.gst.srShoot++
        }
      }
      // --- end shortRetreat
      if (!main.los)''')
open(p, 'w').write(s)
print("ok")
