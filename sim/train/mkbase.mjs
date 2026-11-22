// Builds sim/train/base.mjs from sim/variants/ctrl.mjs (the 4.58 build): moves hard-coded thresholds into P so the
// trainer can tune them, and adds the two prepared experiment gates (off by default). Defaults reproduce ctrl exactly.
import fs from "node:fs"
let s = fs.readFileSync("sim/variants/ctrl.mjs", "utf8")
const rep = (a, b) => {
  const n = s.split(a).length - 1
  if (n !== 1) throw new Error(`expected exactly one match, found ${n}: ${a}`)
  s = s.replace(a, () => b)
}
const NEW = {
  finishHp: [0.35, "a target under this HP share is always attacked..."], finishMyHp: [0.3, "...while we are above this"],
  defAdvOut: [0.25, "shot first while outgunned or 2+ cubes behind: answer only with this HP lead"], defAdv: [-0.08, "shot first otherwise: answer down to this HP deficit"],
  outgunAdv: [0.2, "outgunned: start a fight only with this HP lead"], busyHp: [0.9, "a target busy with someone else is fair game under this HP share"],
  huntHp: [0.7, "a mech coming for us: shoot first when we are above this HP share..."], huntDist: [170, "...and it is within this range"],
  nearDist: [78, "too close to go unnoticed: fight inside this range..."], nearAdv: [-0.05, "...down to this HP deficit..."], nearHp: [0.6, "...when above this HP share"],
  rearDist: [150, "laser shot from behind: out to this range..."], rearHp: [0.8, "...when above this HP share"],
  raceOut: [1.12, "retreat when time-to-kill / time-to-die goes above this"], raceHurt: [0.8, "...or above this when below hideHp"],
  retAdv: [-0.2, "retreat when this far behind on HP share..."], retHp: [0.7, "...and below this HP share"],
  chaseHp: [0.4, "chase a target under this HP share..."], chaseMyHp: [0.55, "...when above this..."], chaseS: [7, "...for this many seconds out of sight"],
  startDist: [215, "start fights only inside this range"], scoreDist: [0.2, "target choice: penalty per metre of distance (100 = full HP difference)"],
  exploreHp: [0.5, "explore for farm targets only above this HP share"],
  huntUntil: [0, "before this time, attack any mech in sight within 200 m while above 60% HP (0 = off)"],
  calmAfter: [0, "after this time, start no fights unless the target is below 35% HP (0 = off)"],
}
rep("  farmUntil: 200, // ...until this match time\n", "  farmUntil: 200, // ...until this match time\n  // --- thresholds that were literals in the 4.58 build (sim/train/mkbase.mjs)\n" + Object.entries(NEW).map(([k, [v, c]]) => `  ${k}: ${v}, // ${c}\n`).join(""))
rep("  farmHard: false,\n}", "  farmHard: false, huntUntil: 0, calmAfter: 0,\n}")
rep("if (e.hpS < 0.35 && hpS > 0.3) return true\n", "if (e.hpS < P.finishHp && hpS > P.finishMyHp) return true\n    if (!defending && this.t < P.huntUntil && hpS > 0.6 && e.dist < 200 && e.los) return true\n    if (!defending && P.calmAfter > 0 && this.t > P.calmAfter && e.hpS >= 0.35) return false\n")
rep("if (outgunned || cubeDiff <= -2) return adv >= 0.25", "if (outgunned || cubeDiff <= -2) return adv >= P.defAdvOut")
rep("      return adv >= -0.08", "      return adv >= P.defAdv")
rep("if (outgunned && adv < 0.2) return false", "if (outgunned && adv < P.outgunAdv) return false")
rep("if (this.t - e.busyT < 3 && e.hpS < 0.9) return true", "if (this.t - e.busyT < 3 && e.hpS < P.busyHp) return true")
rep("if (e.hunt >= 2 && hpS >= 0.7 && e.dist < 170) return true", "if (e.hunt >= 2 && hpS >= P.huntHp && e.dist < P.huntDist) return true")
rep("if (e.los && e.dist < 78 && adv >= -0.05 && hpS >= 0.6) return true", "if (e.los && e.dist < P.nearDist && adv >= P.nearAdv && hpS >= P.nearHp) return true")
rep("e.dist > 45 && e.dist < 150 && hpS > 0.8) return true", "e.dist > 45 && e.dist < P.rearDist && hpS > P.rearHp) return true")
rep("if (race > 1.12 && e.hpS > 0.18) retreat = true", "if (race > P.raceOut && e.hpS > 0.18) retreat = true")
rep("else if (race > 0.8 && hpS < P.hideHp && adv < 0.2) retreat = true", "else if (race > P.raceHurt && hpS < P.hideHp && adv < 0.2) retreat = true")
rep("else if (adv < -0.2 && hpS < 0.7) retreat = true", "else if (adv < P.retAdv && hpS < P.retHp) retreat = true")
rep("const chase = target.hpS < 0.4 && hpS > 0.55 &&", "const chase = target.hpS < P.chaseHp && hpS > P.chaseMyHp &&")
rep("if (lost < (chase ? 7 : 2.5) && t - this.fightStartT < 60) return", "if (lost < (chase ? P.chaseS : 2.5) && t - this.fightStartT < 60) return")
rep("if (e.dist > 215) continue", "if (e.dist > P.startDist) continue")
rep("const s = (1 - e.hpS) * 100 - e.dist * 0.2 + (this.rearOf(e) ? 15 : 0)", "const s = (1 - e.hpS) * 100 - e.dist * P.scoreDist + (this.rearOf(e) ? 15 : 0)")
rep("t < P.farmUntil && hpS > 0.5 && this.zoneSlack > 25", "t < P.farmUntil && hpS > P.exploreHp && this.zoneSlack > 25")
fs.writeFileSync("sim/train/base.mjs", s)
console.log("wrote sim/train/base.mjs,", Object.keys(NEW).length, "new parameters")
