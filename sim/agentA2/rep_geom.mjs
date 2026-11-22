// Real replays vs the bot's world model (world.mjs): (1) do real laser beams that hit a mech pass the bot's ray test?
// (2) do beams that hit nothing end where the bot's ray says the wall is? (3) do real mechs stand where the walk graph says no mech fits?
import fs from "node:fs"
import { World } from "../../src/world.mjs"
const w = new World(new URL("../../arena", import.meta.url).pathname)
const D = JSON.parse(fs.readFileSync("/Users/dylanryan/Desktop/BuildersMech/mechrec-export-2026-11-21T1927.json", "utf8"))
let hitN = 0, hitBlocked = 0, hitBlockedFar = 0, missN = 0, missShort = 0, missLong = 0, missOk = 0
let losN = 0, losFalse = 0
let standN = 0, noNode = 0, thin = 0, thin2 = 0
const exShort = []
for (const key of Object.keys(D.raw)) {
  const lines = D.raw[key].split("\n").filter(Boolean).map((l) => JSON.parse(l))
  let M = {}
  for (const f of lines) {
    if (f.type || !f.m) continue
    for (const m of f.m) M[m[0]] = m
    for (const e of f.ev || []) {
      if (e.e !== "laser") continue
      const [ax, ay, az] = e.from, [bx, by, bz] = e.to
      const len = Math.hypot(bx - ax, by - ay, bz - az)
      const mechHits = (e.hits || []).filter((h) => h < 100)
      if (mechHits.length) {
        // the beam reached the first mech hit: the bot's clearShot() would need ray >= to that mech
        const tg = M[mechHits[0]]
        if (!tg) continue
        const dT = Math.hypot(tg[1] - ax, tg[2] - ay)
        const fr = w.ray(ax, ay, az, bx, by, bz, 0)
        hitN++
        if ((1 - fr) * len > 1.5) { hitBlocked++; if ((1 - fr) * len > 10) hitBlockedFar++ }
        // and the bot's e.los test from the shooter's eye to the target centre / top
        const sh = M[e.id]
        if (sh) {
          const es = 1 + 0.05 * tg[9], ss = 1 + 0.05 * sh[9]
          losN++
          if (!(w.los(sh[1], sh[2], sh[3] + 8 * ss, tg[1], tg[2], tg[3] + 4.5 * es) || w.los(sh[1], sh[2], sh[3] + 8 * ss, tg[1], tg[2], tg[3] + 8.6 * es))) losFalse++
        }
      } else if (!(e.hits || []).length && len < 270) {
        // stopped by geometry before its range: extend the bot's ray 30 m past the real end point
        const ux = (bx - ax) / len, uy = (by - ay) / len, uz = (bz - az) / len
        const L2 = len + 30
        const fr = w.ray(ax, ay, az, ax + ux * L2, ay + uy * L2, az + uz * L2, 0)
        const dBot = fr * L2
        missN++
        if (dBot < len - 3) { missShort++; if (exShort.length < 4) exShort.push([len.toFixed(0), dBot.toFixed(0)]) } else if (dBot > len + 3) missLong++
        else missOk++
      }
    }
    if (f.t % 20 === 0)
      for (const m of f.m) {
        if (!(m[8] & 1)) continue // grounded only
        const sc = 1 + 0.05 * m[9], R = 2.5 * sc
        standN++
        const n = w.nodeAt(m[1], m[2], m[3], 1.6)
        if (n < 0) { noNode++; continue }
        if (w.wd[n] < R - 1.0) thin2++
        if (w.wd[n] < R + 0.45 - 1.0) thin++ // node centre is up to 1.41 m from the mech, so allow 1 m
      }
  }
}
console.log(`laser beams that hit a mech: ${hitN}; the bot's ray from the real muzzle point stops > 1.5 m before the real end of the beam in ${hitBlocked} (${(100 * hitBlocked / hitN).toFixed(1)}%), > 10 m short in ${hitBlockedFar}`)
console.log(`same shots, the bot's e.los test (eye -> centre or top) says "no line of sight": ${losFalse} of ${losN} (${(100 * losFalse / losN).toFixed(1)}%)`)
console.log(`laser beams stopped by geometry (no hit, shorter than range): ${missN}; bot ray agrees within 3 m: ${missOk}; bot wall is nearer: ${missShort}; bot sees no wall there (ray runs on > 3 m): ${missLong}`, JSON.stringify(exShort))
console.log(`grounded real mechs sampled once a second: ${standN}; no nav node within 1.6 m of their height: ${noNode} (${(100 * noNode / standN).toFixed(1)}%); standing where the stored wall distance is under R - 1: ${thin2} (${(100 * thin2 / standN).toFixed(1)}%); under the bot's own requirement R + 0.45 - 1: ${thin} (${(100 * thin / standN).toFixed(1)}%)`)
