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
const UPSETS = [null,
  ["laser_damage", "laser_charge", "gun_damage", "gun_rate", "plating", "armor", "gun_mag", "nanites", "laser_pierce", "capacitor", "servos", "gyros", "gun_velocity", "sensors", "reactor", "jets", "lightning_range", "lightning_chain", "lightning_efficiency", "mortar_reload", "mortar_velocity", "mortar_splash"],
  ["armor", "plating", "nanites", "laser_charge", "laser_damage", "gun_damage", "gun_rate", "capacitor", "servos", "gun_velocity", "sensors", "gyros", "reactor", "gun_mag", "jets", "lightning_range", "lightning_chain", "laser_pierce", "lightning_efficiency", "mortar_reload", "mortar_velocity", "mortar_splash"],
  ["gun_damage", "gun_rate", "gun_mag", "plating", "armor", "laser_charge", "laser_damage", "gun_velocity", "nanites", "capacitor", "servos", "sensors", "gyros", "reactor", "jets", "lightning_range", "lightning_chain", "laser_pierce", "lightning_efficiency", "mortar_reload", "mortar_velocity", "mortar_splash"],
  ["sensors", "gyros", "plating", "armor", "laser_charge", "laser_damage", "nanites", "gun_damage", "gun_rate", "capacitor", "servos", "gun_velocity", "reactor", "gun_mag", "jets", "lightning_range", "lightning_chain", "laser_pierce", "lightning_efficiency", "mortar_reload", "mortar_velocity", "mortar_splash"],
  // 5: the organiser's probe-astra bots (replays): gun_mag, plating, gun_damage, armor first. Two gun_mag = 28 rounds and a 1.5 s reload: +49% sustained gun damage
  ["gun_mag", "plating", "gun_damage", "armor", "laser_damage", "laser_charge", "gun_rate", "nanites", "servos", "capacitor", "gun_velocity", "sensors", "gyros", "reactor", "jets", "laser_pierce", "lightning_range", "lightning_chain", "lightning_efficiency", "mortar_reload", "mortar_velocity", "mortar_splash"],
  // 6: the current order with nanites moved up to third. Two nanites turn a 40% -> 80% heal from 17 s into 7 s (regen 115 HP/s after 2 s), and retreats are what keeps this bot alive
  ["plating", "armor", "nanites", "laser_charge", "laser_damage", "gun_damage", "gun_rate", "capacitor", "servos", "gun_velocity", "sensors", "gyros", "reactor", "gun_mag", "jets", "lightning_range", "lightning_chain", "laser_pierce", "lightning_efficiency", "mortar_reload", "mortar_velocity", "mortar_splash"],
]
const WEAPON_RANK = { laser: 3, lightning: 2, gun: 1, mortar: 0 }

// Tunables (see README "Tuning").
export const P = {
  ffaN: 2, // free-for-all detection: switch to P_FFA once this many mechs died that we did not kill (practice squads never kill each other)
  gunMax: 0, // do not fire the gun beyond this many m at a target above 25% HP (0 = off; sim hit rate falls to about 26% past 140 m)
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
  // --- sim/train/cand/lootfix.mjs
  lootFix: 0, // 1 = drop the kill-loot spot once the path to it has ended, it proved unreachable, or we stood still for 2 s on the way (0 = off: keep returning to it for 30 s)
  // --- sim/train/cand/laser2.mjs
  laserRoof: 0, // laserFirst also runs to a laser on a roof (off the walk graph) when it lies at most this many m above our feet and a jet route to it exists (0 = off: roof lasers are skipped)
  // --- sim/train/cand/laser3.mjs
  laserRun: 0, // laserFirst: a laser goal within this many m (a) keeps us from starting a fight with a mech more than 60 m away, (b) ends a fight gone quiet (not hit for 4 s, no hit of ours for 2 s, target beyond 60 m) and (c) ends a retreat once not hit for 4 s at 60%+ HP with no mech in sight inside 120 m (0 = off)
  laserAway: 0, // laserFirst: a mech nearer to the laser than we are (but not within 40 m of it) no longer cancels the run while it moves away from the laser faster than this many m/s (0 = off)
  // --- sim/train/cand/early.mjs
  oneFront: 0, // never open a second front: a mech that has not hit us for this many s (and is not our fight target, and not under finishHp) is not shot at while retreating / recovering, is not picked as the cornered target, and makes us hold fire while it stands in our line of fire (0 = off)
  // --- sim/train/cand/guard.mjs: out of a chosen fight, keep every recent attacker inside the front arc
  guard: 0, // seconds a mech that hit us stays guarded against (0 = off)
  guardArc: 0.25, // keep attackers this far (rad) inside the edge of the 180 deg front arc
  guardFire: 0.25, // keep shooting a target in sight below this HP share instead of turning to cover another attacker
  // --- sim/train/cand/squeeze.mjs: get set for the 240 -> 140 m shrink
  sqzAt: 0, // from this match time until the 70 m circle is announced: stop farming / exploring and hold in the next circle (0 = off)
  sqzAway: 0, // ...and prefer hold spots on the side of the next circle away from recently seen mechs (score points, 0 = off)
  sqzHp: 0, // ...and below this HP share start no fight: break line of sight and regenerate to healTo first (0 = off)
  // --- sim/train/cand/dither.mjs
  lootHold: 0, // a mech in sight has just called off looting: stay off the loot for this many seconds after it was last in sight (0 = off)
  lootHoldRe: 0, // ...only when looting was already called off this many seconds or less before (0 = on every call-off)
  // --- sim/train/cand/dodge.mjs
  weave: 0, // running in the open with a shooter on us (retreat): swing the heading +-this many rad around the path so a leading shooter never gets a straight line, and let bullets in the air pick the side (0 = off)
  weaveAll: 0, // ...1 = also while looting / exploring / holding / moving to the zone (0 = retreat only)
  // --- sim/train/cand/cubes.mjs: collect the cubes our own kills drop
  cubeRun: 0, // after our kill, a committed walk to its cubes when they lie within this many m (half that past the stat cap unless they reach the next upgrade threshold); it overrides fights and retreats, mechs in view or not (0 = off)
  cubeHit: 2.5, // ...but not while a mech hit us in the last this many s, nor while a mech in sight is within 50 m of us, or a mech is within 50 m of the cubes, nearer to them than we are (inside 110 m), or within 25 m of the line to them
  cubeHp: 0.4, // ...nor below this HP share
  cubeRunS: 20, // ...and for at most this many s after the kill
  // --- sim/train/cand/rush.mjs: early cube rush
  rushUntil: 0, // until this match time crates / drones / cubes come first: a mech in view no longer calls farming off, fights start only with a mech that hit us in the last rushHit s, is inside rushNear m or is nearly dead, a fight gone quiet ends, crates are shot from range (gun + laser), also while walking to cubes (0 = off)
  rushNear: 70, // ...a mech in sight this close still calls the rush off / may be fought
  rushHit: 4, // ...and so does being hit by a mech in the last this many s
  rushVeto: 0, // ...1 = also start no fight with a mech beyond rushNear that has not hit us for rushHit s (unless nearly dead), and end such a fight gone quiet (0 = fights as usual)
  // --- sim/train/cand/late.mjs: outlast the squad when the zone closes
  lateAt: 0, // from this match time, once the next circle is 70 m or less: start no fight (and drop a fight with a mech not shooting us) unless the target is under lateFin; in the final circle answer only mechs shooting us or under lateFin instead of fighting everything in sight (0 = off)
  lateFin: 0.35, // ...HP share under which a mech is still worth attacking late
  lateHeal: 0, // ...and out of a fight with nobody shooting us, below this HP share break line of sight and regenerate up to it; supply drops are taken whenever hurt (0 = off)
  lateCore: 0, // ...and hold spots are pulled toward the centre of the next circle by this many score points at its edge (no outer-ring preference) (0 = off)
  // --- sim/variants/rad.mjs: radical switches (all off by default)
  upSet: 0, // upgrade order: 0 current, 1 offense (laser/gun dmg first), 2 tank (armor/plating/nanites), 3 gun, 4 sensors+gyros first, 5 probe-astra (gun_mag, plating, gun_damage, armor)
  fBoost: 0, // in a fight, boost-strafe while energy is above this (0 = off)
  noRetAll: 0, // 1 = never retreat from mechs in sight, whatever their number
  cubeGoal: 0, // the rush ends early once we hold this many cubes (0 = off)
  seekUntil: 0, // until this time, out of a fight and above seekHp: walk toward the last known mech (0 = off)
  seekHp: 0.75,
  rearBonus: 15, // target score bonus for a mech facing away from us
  dropAll: 0, // 1 = go for every supply drop (3 cubes + full repair) when nobody is within dropCrowd m of it
  dropCrowd: 70,
  huntFrom: 0, // huntUntil / seekUntil apply only from this time...
  huntCubes: 0, // ...or once we hold this many cubes, whichever comes first (0 = no gate)
  rangeLas: 0, // fight range while holding a laser (0 = fightRange rule)
  rangeGun: 0, // fight range without a laser (0 = fightRange rule)
  lasLock: 0, // laserFirst: with a laser goal inside this many m, the run comes before every fight and retreat (0 = off)
  lasLockHit: 70, // ...but once a mech hit us in the last 2 s, only while the laser is inside this many m
  lasBoost: 0, // ...and boost to the laser while energy is above this (0 = off)
  farmBoost: 0, // walking to loot or exploring with no mech in sight within 150 m: boost while energy is above this, down to 15 (0 = off)
  farmBoostUntil: 420, // ...until this match time
  // --- lessons from a stronger bot's play style (new-idea.md), built in our own terms
  lethalRelease: 0, // laser: let a partial charge go as soon as this fraction of its damage already kills the target (0 = off). 0.75 leaves room for three armor upgrades (-24%) on the target
  fightCube: 0, // in a fight, a remembered cube within this many m takes over the legs while we keep shooting; half that below 50% HP (0 = off). 55 m is under 5 s of walking
  finishRange: 0, // in a fight, close to this range on a target under finishHp while we are above finishMyHp and at most 2 mechs are shooting us (0 = off). 55 m: our gun hits 88% inside 60 m and lightning reaches 45 m
  fightPick: 0, // in a fight without a laser: a known laser on the ground within this many m takes over the legs like a fightCube cube, while we keep shooting; half that below 50% HP (0 = off). Dead mechs drop their weapons next to their cubes
  fightCubeCap: 0, // 1 = fightCube ignores cubes once we hold the stat cap (10), unless they reach the next upgrade threshold: past the cap a cube only makes us bigger
  fightHide: 0, // in a fight with other mechs around (seen in the last 3 s, within 170 m): score points taken off a move for each of them that could see us where it leads, and 1.5x that for losing the shot at the target; eight compass moves join the candidates (0 = off). A full bullet dodge is worth about 38 points
  cautR: 0, // practice: once the next circle is this many m or smaller, switch to the cautious free-for-all profile for the rest of the match (0 = off). 140 m is announced at about 195 s
  dieAt: 0, // probe: stand idle from this match time, so the score is our kills before it (0 = off)
  endRush: 0, // from this match time: never retreat from mechs in sight and switch to a mech in sight 25 points lower in HP share. Real probe: we earn nothing after 240 s, so the last seconds are better spent on damage than on running (0 = off)
  noExplore: 0, // 1 = with nothing to loot, hold a covered spot inside the next circle instead of exploring for more; hunters come to us (0 = off)
  noChase: 0, // 1 = a target out of sight ends the fight after 0.6 s instead of being chased around cover (0 = off)
  focusLow: 0, // in a fight, switch to a mech in sight this much lower in HP share (0 = off)
  // --- sim/variants/gd-policy.mjs: three lessons, rebuilt on our own signals (all off by default; see sim/agentG/NOTES.txt)
  firstShot: 0, // lesson A: a mech in sight inside huntDist that is coming for us now (aimOn, or closing > 3.5 m/s inside 140 m) and has been for this many s of e.hunt: start the fight even past the crowd / HP-lead / cube / outgunned vetoes, while we are at hideHp or above (0 = off)
  shortRetreat: 0, // lesson B: leave a retreat this many s after its last trigger once we are not swamped (< 3 attackers), not out-traded (race() <= raceOut) and not low and under fire, instead of holding to resumeHp; and shoot any threat in sight while retreating (0 = off)
  shortRetreatHp: 0, // ...and stay while below this HP share (0 = no floor; regen is 45 HP/s after 5 s untouched, so each 0.1 costs about 3 s)
  shortRetreatFire: 1, // ...0 = keep the old retreat aim (diagnostic: the exit rule alone)
  retarget: 0, // lesson C: in a fight, switch to a mech whose start-of-fight score beats the target's by this many points (100 = full HP share) (0 = off)
  retargetHold: 1.5, // ...but only after this many s on the current target, never off a target we are finishing, never past half a laser charge
}
// Free-for-all profile (qualifying and the final): the survival-first settings of the first two submissions.
// Applied once, the moment the bot sees mechs dying that it did not kill (see ingest()).
export const P_FFA = {
  hideHp: 0.4, resumeHp: 0.8, initHpLow: 0.75, initAdv: 0.2, vetoAdv: -0.12, vetoCubes: -5, crowd: 90, openingS: 45, calmS: 4,
  healBelow: 0, killLoot: false, dropHeal: false, fightRange: 0, bandRange: 14, noRetreat: false, berserk: false, zapRange: 0,
  farmHard: false, huntUntil: 0, calmAfter: 0, laserFirst: 0, laserInit: 0, laserInitUntil: 0, lootFix: 0, laserRoof: 0, laserRun: 0, laserAway: 0, oneFront: 0,
  guard: 0, guardArc: 0.25, guardFire: 0.25, sqzAt: 0, sqzAway: 0, sqzHp: 0, lootHold: 0, lootHoldRe: 0, weave: 0, weaveAll: 0, cubeRun: 0,
  rushUntil: 0, gunMax: 0, lateAt: 0, lateFin: 0.35, lateHeal: 0, lateCore: 0,
  fBoost: 0, noRetAll: 0, cubeGoal: 0, seekUntil: 0, rearBonus: 15, dropAll: 0, focusLow: 0, lasLock: 0, lasBoost: 0,
  upSet: 0, chaseHp: 0.4, chaseMyHp: 0.55, chaseS: 7, farmBoost: 0, lethalRelease: 0, fightCube: 0, finishRange: 0, noChase: 0, fightHide: 0, noExplore: 0, cautR: 0, endRush: 0, fightPick: 0, fightCubeCap: 0,
  firstShot: 0, shortRetreat: 0, retarget: 0, // gd-policy lessons: practice only
}
Object.assign(P, {"laserFirst":90,"noRetreat":true,"cubeRun":130,"rushUntil":120,"ffaN":3,"lateAt":330,"lateFin":1.01,"lateCore":40}) // baked by sim/train/train.mjs from sim/train/cand/late.mjs
Object.assign(P, {"huntFrom":90,"huntUntil":420,"seekUntil":420,"fightCube":55,"weave":0.6,"weaveAll":1,"cubeHit":1,"upSet":6,"fightCube":80,"cubeRun":180,"cubeRunS":30}) // t33a-cubes-more: t31 + push the cube lever further: mid-fight cubes within 80 m (40 m below half HP), kill-cube runs out to 180 m for 30 s (sim/variants/rad8.mjs)
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
    this.weaveSide = 1
    this.weaveFlipT = 0
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
    this.gst = { fs: 0, fsNew: 0, srExit: 0, srShoot: 0, rt: 0 } // gd-policy: how often each lesson acted (read by sim/agentG/fires.mjs)
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
    if (P.dieAt > 0 && this.t >= P.dieAt) return A
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
      case "seek":
        this.moveToPoint(A, this.seekGoal[0], this.seekGoal[1], this.seekGoal[2], 1, false)
        this.scan(A, null)
        break
      default:
        this.doHold(A)
    }
    const T3 = now()
    if (P.weave > 0 && (this.mode === "retreat" || (P.weaveAll && this.mode !== "fight"))) this.weave(A)
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
        e.closeV = closing // firstShot
        e.vAvg[0] += (m.vel[0] - e.vAvg[0]) * 0.12
        e.vAvg[1] += (m.vel[1] - e.vAvg[1]) * 0.12
      } else {
        e.vAvg[0] = m.vel[0]
        e.vAvg[1] = m.vel[1]
        e.closeV = 0 // firstShot
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
            if (ev.bearing != null) e.hitBear = ev.bearing
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
            if (P.cubeRun > 0) this.kcRun = { p0: e.pos.slice(), pos: e.pos.slice(), t, id: -100 - this.myKills, n: (e.cubes || 0) + 2, seen: false }
            this.en.delete(ev.target)
          }
          if (this.sqzSeen) this.sqzSeen.delete(ev.target)
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
    if (P.cautR > 0 && !this.ffa && o.zone && o.zone.next_radius <= P.cautR) {
      this.ffa = true
      Object.assign(P, P_FFA)
    }
    if (othersDead >= (P.ffaN || 2) && !this.ffa) {
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
    const UL = UPSETS[P.upSet] || UPGRADES
    for (let i = 0; i < of.choices.length; i++) {
      let r = UL.indexOf(of.choices[i].id)
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
    // squeeze prep (P.sqzAt): active while the next circle is the 240 m or the 140 m one
    this.sqz = P.sqzAt > 0 && t >= P.sqzAt && nr >= 100
    // late plan (P.lateAt): from lateAt once the next circle is 70 m or less
    this.lateOn = P.lateAt > 0 && t >= P.lateAt && nr <= 70
    if (P.sqzAt > 0 && P.sqzAway > 0) {
      // where each mech was last seen, kept longer than the 14 s enemy table
      const seen = (this.sqzSeen ??= new Map())
      for (const e of this.vis) seen.set(e.id, [e.pos[0], e.pos[1], t])
    }
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
  /** oneFront: e is leaving us alone - it has not hit us for P.oneFront s, is not the mech we are fighting and is not nearly dead */
  neutral(e) {
    return this.t - e.hitMeT >= P.oneFront && !(this.mode === "fight" && e.id === this.targetId) && e.hpS >= P.finishHp
  }
  wantFight(e, defending) {
    const me = this.me
    const hpS = this.hpS
    const adv = hpS - e.hpS
    const cubeDiff = (me.cubes || 0) - (e.cubes || 0)
    // late plan: start nothing new unless it finishes a mech (answering a mech that shoots us is decided by the caller)
    if (this.lateOn && !defending && !(e.hpS < P.lateFin)) return false
    if (this.finalPhase) return true
    if (e.hpS < P.finishHp && hpS > P.finishMyHp) return true
    // opening: a laser is a few seconds away and this mech is not on top of us yet -> pick it up first (see pickLoot)
    const lg = this.lasGoal
    if (!defending && lg && this.t - lg.t < 0.3 && ((lg.d < 70 && e.dist > lg.d + 40) || (lg.d < P.laserRun && e.dist > 60))) return false
    // --- firstShot (lesson A): a mech coming for us has already started this fight; declining only hands it the first shot
    if (!defending && P.firstShot > 0 && this.firstShotOk(e)) return true
    // --- end firstShot
    if (!defending && this.t < P.huntUntil && this.huntOk() && hpS > 0.6 && e.dist < 200 && e.los) return true
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

  // --- firstShot (lesson A)
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
    if (this.hpS < P.shortRetreatHp) return true
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
  /** a clearly better fight target than `target` (in sight), or null: beats its score by P.retarget, after P.retargetHold s on it, never off a target we are finishing or past half a laser charge */
  rtAlt(target, losE) {
    const t = this.t
    if (!target.los || t - this.fightStartT < P.retargetHold) return null
    if (target.hpS < P.finishHp && t - (target.myHitT ?? -99) < 2) return null
    if (this.charging && this.laser && this.laser.charge >= (this.laser.stats.charge ?? 0.75) * 0.5) return null
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
    if (alt) this.gst.rt++
    return alt
  }
  // --- end gd-policy helpers

  /**
   * laserRun: should the opening laser run take over from the fight with e (or, e = null, from a retreat)? Only when we were not hit in
   * the last 4 s, e is beyond 60 m, not being hit by us and not a finishing target, and pickLoot() has a laser goal inside P.laserRun m.
   */
  lasRunNow(e) {
    const t = this.t
    if (!(P.laserRun > 0) || !(t < P.laserFirst) || this.laser || this.finalPhase || this.hpS < (e ? 0.45 : 0.6) || t - this.lastMechDmgT < 4) return false
    if (e ? e.dist < 60 || t - (e.myHitT ?? -99) < 2 || (e.hpS < P.finishHp && this.hpS > P.finishMyHp) : this.vis.some((q) => q.los && q.dist < 120)) return false
    const L = this.pickLoot()
    return !!(L && L.kind === "laser" && this.lasGoal && this.lasGoal.d < P.laserRun)
  }

  huntOk() {
    if (!(P.huntFrom > 0 || P.huntCubes > 0)) return true
    return (P.huntFrom > 0 && this.t >= P.huntFrom) || (P.huntCubes > 0 && (this.me.cubes || 0) >= P.huntCubes)
  }
  /** farmBoost: boost on the way to loot / while exploring (hysteresis on energy; never with a mech in sight within 150 m) */
  fbGo() {
    if (!(P.farmBoost > 0) || this.t >= P.farmBoostUntil || this.charging) return false
    if (this.vis.some((e) => e.los && e.dist < 150)) return (this.fbFarm = false)
    if (this.me.energy > P.farmBoost) this.fbFarm = true
    else if (this.me.energy < 15) this.fbFarm = false
    return !!this.fbFarm
  }
  /** rush: is the early cube rush on this tick (P.rushUntil)? */
  rushOn() {
    return P.rushUntil > 0 && this.t < P.rushUntil && !this.finalPhase && !this.sqz && !(P.cubeGoal > 0 && (this.me.cubes || 0) >= P.cubeGoal)
  }
  /** rush: a mech that is not on us (beyond P.rushNear, no hit on us for P.rushHit s, not nearly dead) is no reason to start a fight */
  rushSkip(e) {
    return P.rushVeto > 0 && this.rushOn() && e.dist > P.rushNear && this.t - e.hitMeT >= P.rushHit && !(e.hpS < P.finishHp && this.hpS > P.finishMyHp)
  }
  /** rush: end a fight with e gone quiet (as lasRunNow(): not hit for 4 s, no hit of ours for 2 s, e beyond rushNear), or (e = null) a retreat */
  rushQuiet(e) {
    const t = this.t
    if (!(P.rushVeto > 0) || !this.rushOn() || this.hpS < (e ? 0.45 : 0.6) || t - this.lastMechDmgT < Math.max(4, P.rushHit)) return false
    if (e) return e.dist > P.rushNear && t - (e.myHitT ?? -99) >= 2 && !(e.hpS < P.finishHp && this.hpS > P.finishMyHp)
    return !this.vis.some((q) => q.los && q.dist < 120)
  }

  /**
   * cubeRun: should the walk to our last kill's cubes take over this tick? It follows the cubes seen near the kill spot (their centre),
   * ends once we stand on them, they are seen to be gone, the path fails, or P.cubeRunS has passed, and it pauses while we were hit in
   * the last P.cubeHit s or are below P.cubeHp, a mech blocks the way (see P.cubeHit), we are finishing a target, or the zone is near.
   */
  cubeRunNow(target) {
    const R = this.kcRun,
      t = this.t,
      me = this.me
    const cubes = me.cubes || 0,
      cap = this.cfg.cubes?.stat_cap ?? 10
    const nextTh = (this.cfg.cubes?.upgrade_thresholds || []).find((v) => v > cubes)
    if (t - R.t > P.cubeRunS || (cubes >= cap && nextTh === undefined) || (this.badLoot && this.badLoot.get(R.id) > t)) return !!(this.kcRun = null)
    let sx = 0,
      sy = 0,
      sz = 0,
      n = 0
    for (const c of this.cubes.values())
      if (hyp(c.pos[0] - R.p0[0], c.pos[1] - R.p0[1]) < 4.5 && Math.abs(c.pos[2] - R.p0[2]) < 4) {
        sx += c.pos[0]
        sy += c.pos[1]
        sz += c.pos[2]
        n++
      }
    if (n) {
      R.seen = true
      R.pos = [sx / n, sy / n, sz / n]
    } else if (R.seen) return !!(this.kcRun = null) // seen there before, now gone (taken, or picked up)
    const [x, y] = me.pos
    const dx = R.pos[0] - x,
      dy = R.pos[1] - y,
      d = hyp(dx, dy)
    if (d < 2) {
      if (this.killLoot && hyp(this.killLoot.pos[0] - R.p0[0], this.killLoot.pos[1] - R.p0[1]) < 1) this.killLoot = null
      return !!(this.kcRun = null)
    }
    if (d > P.cubeRun * (cubes >= cap && cubes + R.n < (nextTh ?? 1e9) ? 0.5 : 1)) return false
    const zc = this.o.zone
    if (this.zoneSlack < 14 || hyp(R.pos[0] - zc.center[0], R.pos[1] - zc.center[1]) > zc.radius - 4) return false
    if (t - this.lastMechDmgT < P.cubeHit || this.hpS < P.cubeHp) return false
    if (this.mode === "fight" && target && target.los && target.hpS < P.finishHp && t - (target.myHitT ?? -99) < 2) return false
    for (const e of this.en.values()) {
      if (e.phantom || t - e.t > 3) continue
      const de = hyp(e.pos[0] - R.pos[0], e.pos[1] - R.pos[1])
      if (de < 50 || (de < d && de < 110) || (e.los && e.dist < 50)) return false
      const wx = e.pos[0] - x,
        wy = e.pos[1] - y,
        pr = (wx * dx + wy * dy) / d
      if (pr > 0 && pr < d && Math.abs(wx * dy - wy * dx) / d < 25) return false
    }
    return true
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
    // (late plan: only mechs shooting us or nearly dead; the zone kills the rest before us if we keep our HP)
    if (this.finalPhase && losE.length) {
      let best = null
      for (const e of losE) if ((!this.lateOn || t - e.hitMeT < 3 || e.hpS < P.lateFin) && (!best || e.hp < best.hp)) best = e
      if (best) {
        this.setFight(best)
        return
      }
    }
    if (this.zoneUrgent && !(this.mode === "fight" && this.inZone && this.zoneSlack > 2)) {
      this.mode = "zone"
      return
    }
    // --- lasLock: the opening laser run comes before every fight
    if (P.lasLock > 0 && t < P.laserFirst && !this.laser && hpS >= 0.45) {
      const L = this.pickLoot()
      if (L && L.type === "pick" && L.kind === "laser" && this.lasGoal && this.lasGoal.d < (t - this.lastMechDmgT < 2 ? P.lasLockHit : P.lasLock)) {
        this.loot = L
        this.mode = "loot"
        this.targetId = -1
        return
      }
    }
    // --- cubeRun: walk to the cubes our kill dropped, ahead of fights and retreats (see cubeRunNow())
    if (P.cubeRun > 0 && this.kcRun && this.cubeRunNow(target)) {
      this.loot = { type: "cube", id: this.kcRun.id, pos: this.kcRun.pos }
      this.mode = "loot"
      this.targetId = -1
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
      // oneFront: turn on a mech that is shooting us, never on a bystander
      if (!best) for (const e of losE) if (e.dist < 220 && (!best || e.hp < best.hp) && !(P.oneFront > 0 && this.neutral(e))) best = e
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
    const allIn = P.noRetAll || (P.endRush > 0 && t >= P.endRush)
    if (retreat && P.noRetreat && (atk.length <= 2 || allIn) && (target || atk.length || (allIn && losE.length))) {
      let e = target && target.los ? target : atk.find((q) => q.los) || (allIn ? losE.reduce((b, q) => (!b || q.hp < b.hp ? q : b), null) : null)
      if (P.retarget > 0 && e && e === target && this.mode === "fight") e = this.rtAlt(target, losE) || e // --- retarget (lesson C): also when two attackers keep us fighting
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
      if (P.shortRetreat > 0) {
        // --- shortRetreat (lesson B): leave as soon as the reason to run is gone, not once healed
        if (this.srStay(atk) && t - this.recoverT < 40 && !this.lasRunNow(null) && !this.rushQuiet(null)) return
        this.gst.srExit++
        // --- end shortRetreat
      } else {
        const healed = hpS >= P.resumeHp || (sinceHit > this.regenDelay + 2 && hpS >= 0.7 && !exposed.length)
        if (!(healed && sinceHit > 2.5) && t - this.recoverT < 40 && !this.lasRunNow(null) && !this.rushQuiet(null)) return
      }
      this.mode = "hold"
      this.spotT = -99
    }
    // --- late plan: a fight with a mech that is not shooting us and is not nearly dead is over
    if (this.lateOn && this.mode === "fight" && target && t - target.hitMeT >= 3 && !(target.hpS < P.lateFin)) {
      this.mode = "hold"
      this.targetId = -1
    }
    // --- heal before the next fight (hunters arrive one after another)
    const lateHeal = this.lateOn ? P.lateHeal : 0
    const healBelow = Math.max(this.sqz ? Math.max(P.healBelow, P.sqzHp) : P.healBelow, lateHeal)
    if (healBelow > 0 && this.mode !== "fight" && atk.length === 0) {
      const weakInSight = losE.some((e) => e.hpS < (lateHeal > 0 ? P.lateFin : 0.3) && e.dist < 200)
      if (!weakInSight && (hpS < healBelow || (this.mode === "recover" && hpS < Math.max(P.healTo, lateHeal)))) {
        if (this.sqz && this.dNext > 0) {
          // squeeze prep, not yet inside the next circle: regenerate on the way to the hold spot, not behind the nearest cover
          this.mode = "hold"
          return
        }
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
    const fLow = P.focusLow > 0 ? P.focusLow : P.endRush > 0 && t >= P.endRush ? 0.25 : 0
    if (fLow > 0 && this.mode === "fight" && target) {
      let lo = null
      for (const e of losE) if (e !== target && e.dist < 200 && e.hpS < target.hpS - fLow && (!lo || e.hpS < lo.hpS)) lo = e
      if (lo) {
        this.setFight(lo)
        return
      }
    }
    // --- retarget (lesson C): re-score the fight each tick with the start-of-fight score, switch only on a clear margin
    if (P.retarget > 0 && this.mode === "fight" && target) {
      const alt = this.rtAlt(target, losE)
      if (alt) {
        this.setFight(alt)
        return
      }
    }
    // --- end retarget
    if (this.mode === "fight" && target) {
      const lost = t - (target.losT ?? -99)
      const chase = target.hpS < P.chaseHp && hpS > P.chaseMyHp && this.others(target, P.crowd) === 0
      if (lost < (P.noChase ? 0.6 : chase ? P.chaseS : 2.5) && t - this.fightStartT < 60 && !this.lasRunNow(target) && !this.rushQuiet(target)) return
      this.mode = "hold"
      this.targetId = -1
    }
    // --- start a fight
    let best = null,
      bestScore = -1e9
    for (const e of losE) {
      if (e.dist > P.startDist) continue
      if (P.rushUntil > 0 && this.rushSkip(e)) continue
      if (!this.wantFight(e, false)) continue
      const s = (1 - e.hpS) * 100 - e.dist * P.scoreDist + (this.rearOf(e) ? P.rearBonus : 0)
      if (s > bestScore) {
        bestScore = s
        best = e
      }
    }
    if (best) {
      if (P.firstShot > 0 && this.firstShotOk(best) && !(this.mode === "fight" && this.targetId === best.id)) {
        this.gst.fs++
        if (best.hunt < 2 || this.others(best, P.crowd) >= 1 || this.hpS < P.huntHp || this.hpS - best.hpS <= P.vetoAdv) this.gst.fsNew++ // the old rules would most likely have waited
      }
      this.setFight(best)
      return
    }
    // --- sight-line hysteresis (P.lootHold): looting was called off by a mech in sight -> no turning back the moment it drops out of view.
    // Without it the bot steps to the loot, sees the mech, steps back, loses it, and repeats every 0.4 s on the same spot.
    const wasLoot = this.mode === "loot"
    const held = P.lootHold > 0 && t - (this.lootBlockT ?? -99) < P.lootHold
    this.lootHeld = held
    // --- grab the cubes a kill dropped while the coast is clear
    if (!held && P.killLoot && this.killLoot && t - this.killLoot.t < 30 && !losE.some((e) => e.dist < (P.rushUntil > 0 && this.rushOn() ? P.rushNear : 160))) {
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
    // start the hold when a mech in sight ends a loot run (with lootHoldRe: the second time in a row), and extend it while that mech stays in sight
    if (P.lootHold > 0 && !this.loot && (wasLoot || held) && losE.some((e) => e.dist < 170)) {
      if (held || P.lootHoldRe <= 0 || t - (this.lootOffT ?? -99) <= P.lootHoldRe) this.lootBlockT = t
      if (wasLoot) this.lootOffT = t
    }
    if (!this.loot && P.seekUntil > 0 && t < P.seekUntil && this.huntOk() && hpS > P.seekHp && this.zoneSlack > 20) {
      let g = null
      for (const e of this.en.values()) if (!e.phantom && t - e.t < 20 && (!g || e.t > g.t)) g = e
      if (g) {
        this.seekGoal = [g.pos[0], g.pos[1], g.pos[2]]
        this.mode = "seek"
        return
      }
    }
    this.mode = this.loot ? "loot" : !P.noExplore && P.farmHard && t < P.farmUntil && !this.sqz && hpS > P.exploreHp && this.zoneSlack > 25 && t - this.lastMechDmgT > 4 ? "explore" : "hold"
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
    // squeeze prep: unit vector from the next centre toward where the mechs were seen in the last minute
    let ax = 0,
      ay = 0
    if (this.sqz && P.sqzAway > 0 && this.sqzSeen) {
      let wx = 0,
        wy = 0,
        ws = 0
      for (const [id, q] of this.sqzSeen) {
        const w = 1 - (t - q[2]) / 60
        if (w <= 0) {
          this.sqzSeen.delete(id)
          continue
        }
        wx += q[0] * w
        wy += q[1] * w
        ws += w
      }
      const dx = wx / (ws || 1) - nc[0],
        dy = wy / (ws || 1) - nc[1],
        dl = hyp(dx, dy)
      if (ws > 0.3 && dl > 25) {
        // one sighting counts half, so a single mech does not send us across the whole circle
        const conf = Math.min(1, ws / 2)
        ax = (dx / dl) * conf
        ay = (dy / dl) * conf
      }
    }
    const top = []
    const late = this.lateOn && P.lateCore > 0
    const ringLo = this.nr > 60 && !late ? 0.45 : 0
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
      if (late) s -= (P.lateCore * dc) / Math.max(this.nr, 1)
      if (ax || ay) s -= (P.sqzAway * ((sx - nc[0]) * ax + (sy - nc[1]) * ay)) / Math.max(dc, 0.5 * this.nr)
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
      // --- shortRetreat (lesson B): the main threat is out of sight, but another one is in it: shoot that one (most recent attacker, then nearest)
      if (P.shortRetreat > 0 && P.shortRetreatFire && !main.los) {
        let q = null
        for (const e of this.vis) if (e.los && e.dist < 230 && (!q || e.hitMeT > q.hitMeT || (e.hitMeT === q.hitMeT && e.dist < q.dist))) q = e
        if (q) {
          this.aimTarget = q
          this.gst.srShoot++
        }
      }
      // --- end shortRetreat
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
    if (this.moveToPoint(A, this.exploreGoal[0], this.exploreGoal[1], undefined, 1, this.fbGo())) vis.set(this.exploreGoal[2], t)
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
    // fightCube: a remembered cube close by takes over the legs; aim and fire stay on the target (doAimFire)
    if ((P.fightCube > 0 || P.fightPick > 0) && this.inZone && !this.zoneUrgent) {
      const reach = this.hpS < 0.5 ? P.fightCube * 0.5 : P.fightCube
      const zc = this.o.zone
      let bc = null,
        bd = reach
      // fightPick: without a laser, a laser on the ground comes before any cube
      if (P.fightPick > 0 && !this.laser) {
        let bl = this.hpS < 0.5 ? P.fightPick * 0.5 : P.fightPick
        for (const q of this.picks.values()) {
          if (q.kind !== "laser") continue
          const dq = hyp(q.pos[0] - x, q.pos[1] - y)
          if (dq >= bl || Math.abs(q.pos[2] - z) > 4) continue
          if (hyp(q.pos[0] - zc.center[0], q.pos[1] - zc.center[1]) > zc.radius - 4) continue
          if (this.badLoot && this.badLoot.get(q.id) > t) continue
          bl = dq
          bc = q
        }
      }
      const cubesNow = me.cubes || 0,
        capC = this.cfg.cubes?.stat_cap ?? 10
      const nextTh = (this.cfg.cubes?.upgrade_thresholds || []).find((v) => v > cubesNow)
      const skipCubes = bc || !(P.fightCube > 0) || (P.fightCubeCap > 0 && cubesNow >= capC && !(nextTh !== undefined && nextTh - cubesNow <= 2))
      if (!skipCubes) for (const c of this.cubes.values()) {
        const dc = hyp(c.pos[0] - x, c.pos[1] - y)
        if (dc >= bd || Math.abs(c.pos[2] - z) > 4) continue
        if (hyp(c.pos[0] - zc.center[0], c.pos[1] - zc.center[1]) > zc.radius - 4) continue
        if (this.badLoot && this.badLoot.get(c.id) > t) continue
        bd = dc
        bc = c
      }
      if (bc) {
        if (this.gCubeId !== bc.id) {
          this.gCubeId = bc.id
          this.gCubeT = t
        }
        // not getting there (unreachable, or someone took it and we cannot see the spot): give this one up for a while
        if (t - this.gCubeT > 12) (this.badLoot ??= new Map()).set(bc.id, t + 30)
        else {
          this.moveToPoint(A, bc.pos[0], bc.pos[1], bc.pos[2], 1, false, { replan: 1.2 })
          return
        }
      }
    }
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
    if (this.laser && P.rangeLas > 0) pr = P.rangeLas
    if (!this.laser && P.rangeGun > 0) pr = P.rangeGun
    if (this.lightning && !this.laser && (this.hpS - e.hpS > 0.1 || e.hpS < 0.45) && !e.has("lightning")) pr = 34
    if (P.zapRange > 0 && this.lightning && this.me.energy > 22 && !(e.has("lightning") && this.hpS < e.hpS)) pr = P.zapRange
    if (this.finalPhase) pr = Math.min(pr, 45)
    // finishRange: close in on a weak target to raise the hit rate and cut its escape time
    if (P.finishRange > 0 && e.hpS < P.finishHp && this.hpS > P.finishMyHp && this.attackers(3).length <= 2) pr = Math.min(pr, P.finishRange)
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
    // fightHide: the other mechs around; a move is worth less for each of them that sees us where it leads
    const watchers = []
    if (P.fightHide > 0 && w) {
      for (const q of this.en.values()) if (q !== e && !q.phantom && t - q.t < 3 && hyp(q.pos[0] - x, q.pos[1] - y) < 170) watchers.push(q)
      if (watchers.length) for (let a = 0; a < 8; a++) cands.push([Math.cos((a * PI) / 4), Math.sin((a * PI) / 4)])
    }
    let best = null,
      bestScore = -1e9
    const need = this.R + 1.3
    for (let k = 0; k < cands.length; k++) {
      const mv = cands[k]
      if (k !== 6 && !free(mv)) continue
      const miss = Math.min(this.missDist(mv), need)
      let score = miss * 10 - Math.min(k, 7) * 0.6 - (k === 6 ? 3 : 0)
      if (watchers.length) {
        const px = x + mv[0] * 6,
          py = y + mv[1] * 6
        for (const q of watchers) if (w.los(q.pos[0], q.pos[1], q.pos[2] + 8 * (1 + 0.05 * (q.cubes || 0)), px, py, z + this.Hh * 0.6)) score -= P.fightHide
        if (!w.los(px, py, z + this.muzH, e.pos[0], e.pos[1], e.cz)) score -= P.fightHide * 1.5
      }
      if (score > bestScore) {
        bestScore = score
        best = mv
        if (k === 0 && miss >= need && !watchers.length) break
      }
    }
    if (!best) best = [-ux, -uy]
    if (best === cands[1] || best === cands[3] || best === cands[5]) {
      this.strafeSide = -s0
      this.strafeFlipT = t + 0.25 + this.rand() * 0.5
    }
    A.move = best
    if (P.fBoost > 0 && !this.charging && hyp(best[0], best[1]) > 0.5) {
      if (this.me.energy > P.fBoost) this.fbOn = true
      else if (this.me.energy < 12) this.fbOn = false
      if (this.fbOn) A.boost = true
    }
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
  missDist(mv, spd) {
    const ps = this.o.projectiles
    if (!ps || !ps.length) return 99
    const me = this.me
    const [x, y, z] = me.pos
    let best = 99
    const sp = spd || this.walk * (this.charging ? 0.5 : 1)
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

  /**
   * P.weave. Running along a path with a shooter on us is a straight line at constant speed: whoever leads on our
   * current velocity hits. A bullet takes dist/252 s; turning the whole way through its flight moves us up to
   * accel*tof^2/2 off the predicted point (4.7 m at 100 m, hit radius 2.8 m). So swing the heading +-weave rad around
   * the planned one, reversing as soon as each turn is complete, and when bullets are in the air take whichever of
   * {swing, counter-swing, planned, brake} clears them. Only on open walkable ground, never on a link or the last metres.
   */
  weave(A) {
    const me = this.me
    const w = this.w
    const t = this.t
    const ml = hyp(A.move[0], A.move[1])
    if (ml < 0.95 || !me.grounded || A.jump || this.charging) return
    if (this.path && (this.plink[Math.min(this.pi, this.path.length - 1)] >= 0 || (this.jet && this.jet.phase === "air"))) return
    let hot = false
    for (const e of this.vis) if (e.los && e.dist < 235 && e.dist > 45 && (e.aimOn || t - e.hitMeT < 2.5)) hot = true
    const sp = A.boost && me.energy > 2 ? me.stats?.boost_speed || 19.5 : this.walk
    const need = this.R + 1.3
    const mv0 = [A.move[0] / ml, A.move[1] / ml]
    if (!hot && this.missDist(mv0, sp) >= need) return
    const [x, y, z] = me.pos
    if (t > this.weaveFlipT) {
      this.weaveSide = -this.weaveSide
      // one full swing takes 2*v*sin(a)/accel; reverse right after it, with jitter so the rhythm cannot be learned
      this.weaveFlipT = t + ((2 * sp * Math.sin(P.weave)) / (me.stats?.ground_accel || 58.5)) * (0.8 + this.rand() * 0.7)
    }
    const rot = (s) => {
      const c = Math.cos(P.weave * s),
        sn = Math.sin(P.weave * s)
      return [mv0[0] * c - mv0[1] * sn, mv0[0] * sn + mv0[1] * c]
    }
    const s0 = this.weaveSide
    const cands = [rot(s0), rot(-s0), mv0, [mv0[0] * 0.15, mv0[1] * 0.15]]
    let best = null,
      bestScore = -1e9,
      bk = 2
    for (let k = 0; k < 4; k++) {
      const mv = cands[k]
      if (k < 2 && w && !w.walkLine(x, y, z, x + mv[0] * 6, y + mv[1] * 6, this.reqR - 0.3, this.Hh)) continue
      const miss = Math.min(this.missDist(mv, k === 3 ? sp * 0.15 : sp), need)
      const score = miss * 10 - k * 0.6
      if (score > bestScore) {
        bestScore = score
        best = mv
        bk = k
        if (k === 0 && miss >= need) break
      }
    }
    if (bk === 1) {
      this.weaveSide = -s0
      this.weaveFlipT = t + ((2 * sp * Math.sin(P.weave)) / (me.stats?.ground_accel || 58.5)) * (0.8 + this.rand() * 0.7)
    }
    A.move = best
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
    if ((P.dropHeal || P.dropAll || (this.lateOn && P.lateHeal > 0)) && (this.hpS < 0.85 || P.dropAll) && this.zoneSlack > 10) {
      const [x, y] = me.pos
      let best = null
      for (const dr of this.o.drops || []) {
        if (dr.holder != null && dr.holder !== me.id) continue
        const d = hyp(dr.pos[0] - x, dr.pos[1] - y)
        if (d > 230 || dr.lands_in > d / this.walk + 8) continue
        let crowded = false
        for (const e of this.en.values()) if (t - e.t < 8 && hyp(dr.pos[0] - e.pos[0], dr.pos[1] - e.pos[1]) < (P.dropAll ? P.dropCrowd : 70)) crowded = true
        if (!crowded && (!best || d < best.d)) best = { type: "drop", id: dr.id, pos: dr.pos, d }
      }
      if (best) return best
    }
    const rush = P.rushUntil > 0 && this.rushOn()
    const farming = (P.farmHard && t < P.farmUntil && !this.sqz) || rush
    // opening: the laser run is not called off just because a mech is in sight
    const lasFirst = t < P.laserFirst && !this.laser && this.hpS >= 0.45
    let gated = false
    if (rush) {
      // rush: only a mech on us calls it off
      if (this.hpS < 0.45 || t - this.lastMechDmgT < P.rushHit || this.vis.some((e) => e.los && e.dist < P.rushNear)) gated = true
    } else if (farming) {
      if (this.hpS < 0.45 || t - this.lastMechDmgT < 4 || this.vis.some((e) => e.los && e.dist < 170)) gated = true
    } else if (!this.calm || this.hpS < 0.6) gated = true
    if (this.lootHeld) gated = true // P.lootHold, see decide()
    if (gated && !lasFirst) return null
    if (this.zoneSlack < 14) return null
    const [x, y, z] = me.pos
    const zc = this.o.zone
    const insideNow = (p) => hyp(p[0] - zc.center[0], p[1] - zc.center[1]) < zc.radius - 8
    const insideNext = (p) => hyp(p[0] - this.nc[0], p[1] - this.nc[1]) < this.nr - 2
    const okPlace = (p, d) => insideNow(p) && (insideNext(p) || (!this.sqz && this.zoneSlack > d / this.walk + 25))
    const reachableZ = (p) => !this.w || Math.abs(this.w.standZ(p[0], p[1], z + 1.5) - p[2]) < 3.2 || (this.w.nodeAt(p[0], p[1], p[2], 3) >= 0 && this.main && this.main[this.w.nodeAt(p[0], p[1], p[2], 3)])
    const nearEnemy = (p) => {
      for (const e of this.en.values()) if (t - e.t < 12 && hyp(p[0] - e.pos[0], p[1] - e.pos[1]) < (rush ? 80 : 110)) return true
      return false
    }
    if (lasFirst) {
      // nearest known laser; the usual "no loot within 110 m of a mech" rule gives way when we are the closer one
      let goal = null,
        gd = t - this.lastMechDmgT < 4 ? 60 : 300
      for (const p of this.picks.values()) {
        if (p.kind !== "laser") continue
        const d = hyp(p.pos[0] - x, p.pos[1] - y)
        const roof = !reachableZ(p.pos) // laserRoof: not on the walk graph; taken only when roofRoute() finds a jet route (asked last: it can cost a search)
        if (d >= gd || !okPlace(p.pos, d) || (roof && !(P.laserRoof > 0)) || (this.badLoot && this.badLoot.get(p.id) > t)) continue
        let lost = false
        for (const e of this.en.values()) {
          if (t - e.t > 12) continue
          const de = hyp(p.pos[0] - e.pos[0], p.pos[1] - e.pos[1])
          if (de < 40 || (de < 110 && de < d)) {
            // laserAway: it is walking away from the laser, so it is not the one that takes it
            if (P.laserAway > 0 && de >= 40 && !e.phantom && e.vel && (e.vel[0] * (e.pos[0] - p.pos[0]) + e.vel[1] * (e.pos[1] - p.pos[1])) / de > P.laserAway) continue
            lost = true
          }
        }
        if (lost) continue
        if (roof && !this.roofRoute(p)) continue
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
        // drones hit back and pin us for seconds: in the rush they keep the old farming rule (no mech in sight inside 170 m)
        if (this.hpS > (farming ? 0.6 : 0.8) && t - this.lastMechDmgT > (farming ? 5 : 12) && !(rush && this.vis.some((e) => e.los && e.dist < 170)))
          for (const n of this.npcs.values()) if (t - n.t < (farming ? 6 : 2)) consider("npc", n, farming ? 80 : 44, 120 * reach)
      }
    }
    return best
  }

  /**
   * laserRoof: can we get to this roof laser? Yes when it lies at most P.laserRoof m above our feet, a mesh node sits under it, and one
   * path search with jets allowed finds a complete route from where we stand. The answer is kept per laser (yes for 6 s, no for 8 s),
   * and at most one search runs per tick; in the air, or with a search already spent this tick, the last answer stands.
   */
  roofRoute(p) {
    const w = this.w,
      t = this.t
    if (!w || p.pos[2] - this.me.pos[2] > P.laserRoof) return false
    const c = (this.roofOk ??= new Map()).get(p.id)
    if (c && t < c.until) return c.ok
    if (this.myNode < 0 || !this.me.grounded || this.roofT === t) return c ? c.ok : false
    this.roofT = t
    const g = w.nearestNode(p.pos[0], p.pos[1], p.pos[2], this.reqR, this.Hh + 0.3, 16) // the node doLoot() will walk to
    let ok = false
    if (g >= 0 && Math.abs(w.surf[g] - p.pos[2]) < 2 && hyp(w.nodeX(g) - p.pos[0], w.nodeY(g) - p.pos[1]) < 2.5)
      ok = !!w.search(this.myNode, g, this.searchOpts({ allowJet: true, noPartial: true, maxExp: 30000 }))
    this.roofOk.set(p.id, { ok, until: t + (ok ? 6 : 8) })
    return ok
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
      const want = L.type === "crate" ? (P.rushUntil > 0 && this.rushOn() ? 90 : 38) : 72
      if (!los || d > want + 8) {
        if (!this.moveToPoint(A, tgt.pos[0], tgt.pos[1], tgt.pos[2], 1, this.fbGo()) && this.pathPartial && this.path && this.path.length < 5) fail()
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
    const arrived = this.moveToPoint(A, L.pos[0], L.pos[1], L.pos[2], 1, (P.lasBoost > 0 && L.kind === "laser" && !this.laser && this.me.energy > P.lasBoost) || this.fbGo())
    if (!arrived && this.pathPartial && this.path && this.path.length < 5) fail()
    if (P.rushUntil > 0 && this.rushOn() && this.w && !this.vis.some((e) => e.los && e.dist < 170)) {
      // rush: shoot the nearest crate in view on the way (not with a mech in sight: we would turn our back to it) (it does not move; the cubes wait for us)
      let bc = null,
        bd = 90
      for (const c of this.crates.values()) {
        if (c.t !== t) continue
        const dc = hyp(c.pos[0] - x, c.pos[1] - y)
        if (dc < bd && this.w.ray(x, y, z + this.muzH, c.pos[0], c.pos[1], c.pos[2] + 1.2, 2) >= 1) {
          bd = dc
          bc = c
        }
      }
      if (bc) this.farmTarget = { pos: bc.pos, z: bc.pos[2] + 1.2, vel: [0, 0, 0], r: 1.2, d: bd, npc: false }
    }
    if (P.lootFix && L.id === -7 && this.killLoot) {
      // The kill spot is a guess, not a cube: the nearest mesh node can be more than 1.2 m from it, so the d < 1.2 test above may never pass
      // and decide() would send us back here every tick for 30 s. Done once the path has ended, the spot was given up as unreachable, or
      // we have not moved for 2 s. Cubes still lying there are ordinary cube targets for pickLoot().
      const K = this.killLoot
      if (K.at === undefined || t - K.seenT > 0.5 || hyp(x - K.at[0], y - K.at[1]) > 1.5) {
        K.at = [x, y]
        K.atT = t
      }
      K.seenT = t
      if (arrived || !this.loot || t - K.atT > 2) {
        this.killLoot = null
        this.loot = null
        if (this.badLoot) this.badLoot.delete(-7)
      }
    }
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
    // guard: fighting a mech that is not shooting at us (cornered / final circle pick the weakest in sight) while
    // another one in sight is, from outside the front arc that aiming at the target gives us: answer that one
    if (P.guard > 0 && e && this.mode === "fight" && t - e.hitMeT >= P.guard && e.hpS >= P.guardFire && !this.charging) {
      const b0 = Math.atan2(e.pos[1] - me.pos[1], e.pos[0] - me.pos[0])
      let q = null
      for (const c of this.vis)
        if (c.los && t - c.hitMeT < P.guard && (!q || c.hitMeT > q.hitMeT) && Math.abs(angNorm(Math.atan2(c.pos[1] - me.pos[1], c.pos[0] - me.pos[0]) - b0)) > PI / 2 - P.guardArc) q = c
      if (q) {
        e = q
        this.guardT = t
      }
    }
    // never let a charged laser go to waste / fire wild: keep tracking someone
    if (!e && this.charging && !(P.rushUntil > 0 && this.mode === "loot" && this.rushOn())) {
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
          // lethalRelease: a partial charge that already kills is let go now (cube scaling and mortar cook-off counted)
          let lethal = false
          if (P.lethalRelease > 0 && !ready && laser.charge >= (laser.stats.min_charge ?? 0.15) && inRange && clear) {
            const mf = laser.stats.min_frac ?? 0.35
            const cc = this.cfg.cubes || {}
            const est = (laser.stats.damage ?? 315) * (mf + (1 - mf) * Math.min(1, laser.charge / full)) * (1 + (cc.damage_per_cube ?? 0.04) * Math.min(me.cubes || 0, cc.stat_cap ?? 10)) * (e.has("mortar") ? 1 + (laser.stats.cookoff ?? 0.6) : 1)
            if (P.lethalRelease * est >= e.hp) {
              sol = lasSol
              lethal = good
            }
          }
          // let go when full and on target; hold a full charge a little for a better line
          if (lethal) fire[ls] = false
          else if (ready && good) fire[ls] = false
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
        const inRange = gunSol.dist < (gun.stats.range ?? 230) - 4 && !(P.gunMax > 0 && gunSol.dist > P.gunMax && e.hpS > 0.25)
        if (gun.ammo > 0 && !(gun.reload > 0) && inRange && this.onTarget(gunSol, tolR, tolV) && this.clearShot(gunSol, e.R + 1.5)) fire[gs] = true
      }
      if (P.oneFront > 0 && !this.charging && (fire[0] || fire[1])) {
        // do not open a second front: no shots at a bystander on the run, and none through a bystander standing in the line of fire
        let hold = this.mode !== "fight" && this.neutral(e)
        if (!hold) {
          const s0 = gunSol || lasSol
          const dx = (s0 ? s0.px : e.pos[0]) - me.pos[0],
            dy = (s0 ? s0.py : e.pos[1]) - me.pos[1],
            d = hyp(dx, dy) || 1
          for (const q of this.vis) {
            if (q === e || !q.los || q.dist >= e.dist || !this.neutral(q)) continue
            const qx = q.pos[0] - me.pos[0],
              qy = q.pos[1] - me.pos[1]
            if (qx * dx + qy * dy > 0 && Math.abs(qx * dy - qy * dx) / d < q.R + 2.5) {
              hold = true
              break
            }
          }
        }
        if (hold) fire[0] = fire[1] = false
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
      if (P.rushUntil > 0 && laser && this.rushOn()) {
        // rush: the laser too (hitscan, so no lead for a crate): charge, put the beam on it, let go
        const ls = this.slotOf.laser
        const full = laser.stats.charge ?? 0.75
        const lsol = this.lead(f.pos, f.vel, f.z, 0, 0.09)
        const inRange = lsol.dist < (laser.stats.range ?? 280) - 6
        if (this.charging) {
          const ready = laser.charge >= full - 0.051
          if (ready || laser.charge >= full * 0.5) A.aim = [lsol.yaw, lsol.pitch]
          fire[ls] = !((ready && this.onTarget(lsol, f.r * 0.8, 1.0)) || (ready && laser.charge > full + (laser.stats.hold_s ?? 2) - 0.35))
        } else if ((laser.cooldown || 0) <= 0.11 && inRange && !(t < this.shortUntil)) fire[ls] = true
      }
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
    // not in a fight, or in one but not shooting at a mech that is shooting at us: mind the rear arc
    if (P.guard > 0 && !(this.mode === "fight" && e && e.los && t - e.hitMeT < P.guard)) this.guardAim(A, fire, e && e.los ? e : null)
  }

  /**
   * Rear armor (P.guard): a hit from outside the 180 deg arc around our aim does x1.5. Unless we are shooting at a
   * mech that is shooting at us, keep the torso turned so that every mech that hit us in the last P.guard seconds
   * stays inside that arc. The aim the
   * mode asked for (shot solution, scan, phantom) is kept whenever it already covers them. Otherwise turn to the
   * yaw that covers the most recent damage (both of two attackers when they fit, else the one that hurts more),
   * and among those the one that keeps most of them in view, then the squarest one.
   * Unseen attackers are placed by the bearing of their last hit, which is the direction the rule tests.
   */
  guardAim(A, fire, tgt) {
    const t = this.t
    const [x, y] = this.me.pos
    const win = Math.min(P.guard, 6)
    let B = [] // [bearing, damage in the window]
    for (const e of this.en.values()) {
      if (t - e.hitMeT >= win) continue
      let w = 1
      for (const d of this.dmgLog) if (d[2] === e.id && t - d[0] < win) w += d[1]
      const seen = !e.phantom && e.t >= e.hitMeT
      B.push([seen || e.hitBear == null ? Math.atan2(e.pos[1] - y, e.pos[0] - x) : e.hitBear, w])
    }
    if (!B.length) return
    // a laser charge in progress, or a nearly dead target in sight, is worth more than the arc
    if (this.charging || (tgt && tgt.hpS < P.guardFire)) return
    B = B.sort((a, b) => b[1] - a[1]).slice(0, 4)
    const half = PI / 2 - P.guardArc
    const view = (((this.cfg.vision?.fov_deg ?? 120) / 2) * PI) / 180 - 0.08
    const want = A.aim[0]
    // [covered damage, tie-break cost: attackers out of view, then the widest angle] of a yaw
    const cover = (yaw) => {
      let s = 0,
        cost = 0,
        worst = 0
      for (const b of B) {
        const d = Math.abs(angNorm(b[0] - yaw))
        if (d < half) s += b[1]
        if (d > view) cost += 10
        if (d > worst) worst = d
      }
      return [s, cost + worst]
    }
    let best = want,
      bc = cover(want)
    bc[0] *= 1.2 // leave the aim alone unless turning covers clearly more
    bc[1] = -1
    const tryYaw = (yaw) => {
      const c = cover(yaw)
      if (c[0] > bc[0] + 1e-6 || (c[0] > bc[0] - 1e-6 && c[1] < bc[1])) {
        best = yaw
        bc = c
      }
    }
    for (let i = 0; i < B.length; i++) {
      tryYaw(B[i][0])
      tryYaw(B[i][0] + half - 0.01)
      tryYaw(B[i][0] - half + 0.01)
      for (let j = 0; j < i; j++) tryYaw(B[j][0] + angNorm(B[i][0] - B[j][0]) / 2)
    }
    if (best === want) return
    A.aim = [best, A.aim[1]]
    if (this.laser) fire[this.slotOf.laser] = false // not charging: do not start a charge we cannot aim
    this.guardT = t
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
