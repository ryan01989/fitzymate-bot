// Verify rule readings against the 21 recorded real replays.
import fs from "node:fs"
const D = JSON.parse(fs.readFileSync("/Users/dylanryan/Desktop/BuildersMech/mechrec-export-2026-11-21T1927.json", "utf8"))
const ang = (a) => { a %= 2 * Math.PI; if (a > Math.PI) a -= 2 * Math.PI; else if (a < -Math.PI) a += 2 * Math.PI; return a }
let regenAfterObj = [], regenTicksObjRecent = 0, noRegenObjRecent = 0, regenOk = 0
const minSinceAny = [] // at first regen tick after a pause: time since last taken / dealt-mech / dealt-object
let zapN = 0, zapMax = 0, zapOver15 = 0, zapHist = []
let deaths = { mech: 0, npc: 0, zone: 0 }
let zoneErr = 0
let d3 = [] // lightning 3D distance muzzle->target
for (const key of Object.keys(D.raw)) {
  const lines = D.raw[key].split("\n").filter(Boolean).map((l) => JSON.parse(l))
  const h = lines.find((l) => l.type === "header")
  const fr = lines.filter((l) => l.type === "frame" || (!l.type && l.m))
  const lastTaken = {}, lastDealtMech = {}, lastDealtObj = {}, prevHp = {}, prevMax = {}, lastDrop = {}
  const Z = h.zone
  for (const f of fr) {
    const t = f.t / 20
    // zone check
    if (f.z) {
      let c = Z[0].center, r = Z[0].radius
      for (let i = 1; i < Z.length; i++) {
        const p = Z[i]
        if (t >= p.shrink_end) { c = p.center; r = p.radius } else if (t > p.shrink_start) {
          const q = (t - p.shrink_start) / (p.shrink_end - p.shrink_start)
          c = [c[0] + (p.center[0] - c[0]) * q, c[1] + (p.center[1] - c[1]) * q]; r = r + (p.radius - r) * q; break
        } else break
      }
      zoneErr = Math.max(zoneErr, Math.abs(f.z[2] - r), Math.abs(f.z[0] - c[0]), Math.abs(f.z[1] - c[1]))
    }
    const M = {}
    for (const m of f.m) M[m[0]] = m
    for (const e of f.ev || []) {
      const te = e.t / 20
      if (e.e === "hit") {
        if (e.dst < 100) lastTaken[e.dst] = te
        if (e.src < 100) { if (e.dst < 100) lastDealtMech[e.src] = te; else lastDealtObj[e.src] = te }
      } else if (e.e === "death" && e.id < 100) {
        if (e.by == null) deaths.zone++; else if (e.by >= 100) deaths.npc++; else deaths.mech++
      } else if (e.e === "drop" && e.op === "take") lastDrop[e.by] = te
      else if (e.e === "zap" && e.hits && e.hits.length && M[e.id]) {
        const m = M[e.id]
        const p0 = e.path[0], p1 = e.path[1]
        const b = Math.atan2(p1[1] - m[2], p1[0] - m[1])
        const d = Math.abs(ang(b - m[4])) * 180 / Math.PI
        zapN++; zapHist.push(d); if (d > zapMax) zapMax = d; if (d > 15) zapOver15++
        d3.push([Math.hypot(p1[0] - m[1], p1[1] - m[2]), Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])])
      }
    }
    for (const m of f.m) {
      const id = m[0], hp = m[6], mx = m[10]
      // inside zone?
      const inZ = f.z ? Math.hypot(m[1] - f.z[0], m[2] - f.z[1]) < f.z[2] : true
      if (prevHp[id] != null && mx === prevMax[id] && hp > prevHp[id] + 0.5 && !(t - (lastDrop[id] ?? -99) < 0.3)) {
        // regenerating this frame
        const sT = t - (lastTaken[id] ?? -99), sM = t - (lastDealtMech[id] ?? -99), sO = t - (lastDealtObj[id] ?? -99)
        minSinceAny.push([sT, sM, sO])
        if (sO < 4.5) regenTicksObjRecent++
        regenOk++
      } else if (prevHp[id] != null && hp < mx - 1 && inZ && hp === prevHp[id]) {
        const sT = t - (lastTaken[id] ?? -99), sM = t - (lastDealtMech[id] ?? -99), sO = t - (lastDealtObj[id] ?? -99)
        if (sT > 5.3 && sM > 5.3 && sO < 4.5) noRegenObjRecent++
        if (sT > 5.3 && sM > 5.3 && sO > 5.3) regenAfterObj.push(1) // hurt, quiet >5.3 s on all counts, inside zone, and not healing (should be ~0)
      }
      prevHp[id] = hp; prevMax[id] = mx
    }
  }
}
const mn = (i) => Math.min(...minSinceAny.map((r) => r[i]))
console.log("replays", Object.keys(D.raw).length)
console.log("zone: max |frame.z - linear interpolation of header schedule| =", zoneErr.toFixed(3))
console.log("mech deaths by cause", deaths)
console.log("regen frames:", regenOk, " min time since: taken", mn(0).toFixed(2), " dealt-to-mech", mn(1).toFixed(2), " dealt-to-crate/npc", mn(2).toFixed(2))
console.log("regen frames within 4.5 s of own hit on a crate/NPC:", regenTicksObjRecent)
console.log("hurt, in zone, >5.3 s since taken and since dealt-to-mech, <4.5 s since hit on crate/NPC, HP flat:", noRegenObjRecent)
console.log("hurt, in zone, quiet >5.3 s on every count, HP flat (control, expect ~0):", regenAfterObj.length)
zapHist.sort((a, b) => a - b)
console.log("lightning zaps with a hit:", zapN, " |aim yaw - bearing to first target| max", zapMax.toFixed(1), "deg; >15 deg:", zapOver15, " p50", zapHist[zapN >> 1]?.toFixed(1), "p95", zapHist[(zapN * 0.95) | 0]?.toFixed(1), "p99", zapHist[(zapN * 0.99) | 0]?.toFixed(1))
d3.sort((a, b) => b[1] - a[1]); console.log("lightning longest first-jump (horiz from feet, 3D from muzzle):", d3.slice(0, 3).map((r) => r.map((v) => v.toFixed(1))))
