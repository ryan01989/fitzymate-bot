// Real replays: when mech A has building line of sight to mech B inside its view wedge at 45-200 m, how often is a tree crown / trunk
// (bounding cylinder: an upper bound, thin foliage still sees) on BOTH sight lines (to B's centre and top)? And for how long at a stretch?
import fs from "node:fs"
import { World } from "../../src/world.mjs"
const dir = new URL("../../arena", import.meta.url).pathname
const w = new World(dir)
const wj = JSON.parse(fs.readFileSync(dir + "/v2/world.json", "utf8"))
const F = wj.trees.fields, T = wj.trees.data, NF = F.length, N = T.length / NF
const ix = F.indexOf("x"), iy = F.indexOf("y"), iz = F.indexOf("z"), ih = F.indexOf("height"), ir = F.indexOf("crownR"), ib = F.indexOf("crownBase"), it = F.indexOf("trunkR"), icx = F.indexOf("crownX"), icy = F.indexOf("crownY")
const hid = (ax, ay, az, bx, by, bz) => {
  const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy
  const cyl = (cx, cy, r, zlo, zhi) => {
    const fx = ax - cx, fy = ay - cy, b = fx * dx + fy * dy, disc = b * b - l2 * (fx * fx + fy * fy - r * r)
    if (disc <= 0) return false
    const sq = Math.sqrt(disc), u0 = Math.max(0, (-b - sq) / l2), u1 = Math.min(1, (-b + sq) / l2)
    if (u0 >= u1) return false
    const za = az + dz * u0, zb = az + dz * u1
    return Math.max(za, zb) > zlo && Math.min(za, zb) < zhi
  }
  const len3 = Math.hypot(dx, dy, dz)
  const chord = (cx, cy, r, zlo, zhi) => {
    const fx = ax - cx, fy = ay - cy, b = fx * dx + fy * dy, disc = b * b - l2 * (fx * fx + fy * fy - r * r)
    if (disc <= 0) return 0
    const sq = Math.sqrt(disc)
    let u0 = Math.max(0, (-b - sq) / l2), u1 = Math.min(1, (-b + sq) / l2)
    if (u0 >= u1) return 0
    if (Math.abs(dz) > 1e-9) { const ua = (zlo - az) / dz, ub = (zhi - az) / dz; u0 = Math.max(u0, Math.min(ua, ub)); u1 = Math.min(u1, Math.max(ua, ub)) } else if (az <= zlo || az >= zhi) return 0
    return u1 > u0 ? (u1 - u0) * len3 : 0
  }
  let sum = 0
  for (let k = 0; k < N; k++) {
    const o = k * NF
    sum += chord(T[o + icx], T[o + icy], T[o + ir], T[o + iz] + T[o + ib], T[o + iz] + T[o + ih])
    if (sum >= 8) return true
    if (cyl(T[o + ix], T[o + iy], T[o + it], T[o + iz], T[o + iz] + T[o + ib])) return true
  }
  return false
}
const ang = (a) => { a %= 2 * Math.PI; if (a > Math.PI) a -= 2 * Math.PI; else if (a < -Math.PI) a += 2 * Math.PI; return a }
const bins = { "45-100": [0, 0], "100-200": [0, 0] }
let streaks = [], cur = new Map()
let keys = Object.keys(D_raw())
function D_raw() { return JSON.parse(fs.readFileSync("/Users/dylanryan/Desktop/BuildersMech/mechrec-export-2026-11-21T1927.json", "utf8")).raw }
const RAW = D_raw()
for (const key of Object.keys(RAW).slice(0, 8)) {
  cur = new Map()
  for (const line of RAW[key].split("\n")) {
    if (!line) continue
    const f = JSON.parse(line)
    if (f.type || !f.m || f.t % 20) continue
    for (const a of f.m) for (const b of f.m) {
      if (a === b) continue
      const d = Math.hypot(b[1] - a[1], b[2] - a[2])
      if (d < 45 || d > 200) continue
      if (Math.abs(ang(Math.atan2(b[2] - a[2], b[1] - a[1]) - a[4])) > Math.PI / 3) continue
      const ea = a[3] + 8 * (1 + 0.05 * a[9]), sb = 1 + 0.05 * b[9]
      const l1 = w.los(a[1], a[2], ea, b[1], b[2], b[3] + 4.5 * sb), l2 = w.los(a[1], a[2], ea, b[1], b[2], b[3] + 9 * sb)
      if (!l1 && !l2) continue
      const h = (!l1 || hid(a[1], a[2], ea, b[1], b[2], b[3] + 4.5 * sb)) && (!l2 || hid(a[1], a[2], ea, b[1], b[2], b[3] + 9 * sb))
      const bn = bins[d < 100 ? "45-100" : "100-200"]
      bn[0]++
      const k = a[0] + ">" + b[0]
      if (h) { bn[1]++; cur.set(k, (cur.get(k) || 0) + 1) } else if (cur.has(k)) { streaks.push(cur.get(k)); cur.delete(k) }
    }
  }
  for (const v of cur.values()) streaks.push(v)
}
for (const k of Object.keys(bins)) console.log(`pairs at ${k} m in the view wedge with building line of sight (sampled each second, 8 replays): ${bins[k][0]}; 8 m+ of crown or a trunk on every sight line (the real stream lists 20% / 0% of such items): ${bins[k][1]} (${(100 * bins[k][1] / bins[k][0]).toFixed(0)}%)`)
streaks.sort((a, b) => a - b)
console.log(`stretches of that state: ${streaks.length}; lasting over 5 s (so past the vision memory): ${streaks.filter((s) => s > 5).length} (${(100 * streaks.filter((s) => s > 5).length / streaks.length).toFixed(0)}%), median ${streaks[streaks.length >> 1]} s`)
