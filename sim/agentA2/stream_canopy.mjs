// Real stream: for static items (pickups, crates) with a known position, in the view wedge at 45-195 m with building line of sight:
// how often does the server list them when a crown cylinder is / is not on the line, and by chord length through crowns?
import fs from "node:fs"
import { World } from "../../src/world.mjs"
const dir = new URL("../../arena", import.meta.url).pathname
const w = new World(dir)
const wj = JSON.parse(fs.readFileSync(dir + "/v2/world.json", "utf8"))
const F = wj.trees.fields, T = wj.trees.data, NF = F.length, N = T.length / NF
const g = (n) => F.indexOf(n)
const ix = g("x"), iy = g("y"), iz = g("z"), ih = g("height"), ir = g("crownR"), ib = g("crownBase"), it = g("trunkR"), icx = g("crownX"), icy = g("crownY")
// chord length (3D) of the segment inside crown cylinders; trunk = true if a trunk is crossed
const chord = (ax, ay, az, bx, by, bz) => {
  const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy, len = Math.hypot(dx, dy, dz)
  let sum = 0, trunk = false
  const seg = (cx, cy, r, zlo, zhi) => {
    const fx = ax - cx, fy = ay - cy, b = fx * dx + fy * dy, disc = b * b - l2 * (fx * fx + fy * fy - r * r)
    if (disc <= 0) return 0
    const sq = Math.sqrt(disc)
    let u0 = Math.max(0, (-b - sq) / l2), u1 = Math.min(1, (-b + sq) / l2)
    if (u0 >= u1) return 0
    if (Math.abs(dz) > 1e-9) { const ua = (zlo - az) / dz, ub = (zhi - az) / dz; u0 = Math.max(u0, Math.min(ua, ub)); u1 = Math.min(u1, Math.max(ua, ub)) } else if (az <= zlo || az >= zhi) return 0
    return u1 > u0 ? (u1 - u0) * len : 0
  }
  for (let k = 0; k < N; k++) {
    const o = k * NF
    sum += seg(T[o + icx], T[o + icy], T[o + ir], T[o + iz] + T[o + ib], T[o + iz] + T[o + ih])
    if (seg(T[o + ix], T[o + iy], T[o + it], T[o + iz], T[o + iz] + T[o + ib]) > 0) trunk = true
  }
  return [sum, trunk]
}
const L = fs.readFileSync(new URL("./stream.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const obs = L.filter((m) => m.type === "obs")
const items = new Map()
for (const o of obs) { for (const p of o.pickups || []) items.set(p.id, { pos: p.pos, zo: 0.5, first: o.t }); for (const c of o.crates || []) items.set(c.id, { pos: c.pos, zo: 1.2, first: o.t }) }
const lastListed = new Map()
for (const o of obs) for (const p of [...(o.pickups || []), ...(o.crates || [])]) lastListed.set(p.id, o.t)
const ang = (a) => { a %= 2 * Math.PI; if (a > Math.PI) a -= 2 * Math.PI; else if (a < -Math.PI) a += 2 * Math.PI; return a }
const bins = [[0, 0.01], [0.01, 2], [2, 4], [4, 8], [8, 1e9]]
const tab = bins.map(() => [0, 0]), trunkTab = [0, 0]
for (const o of obs) {
  const [x, y, z] = o.self.pos
  const listed = new Set([...(o.pickups || []), ...(o.crates || [])].map((p) => p.id))
  for (const [id, it2] of items) {
    if (o.t > lastListed.get(id)) continue // may have been taken after its last listing
    const d = Math.hypot(it2.pos[0] - x, it2.pos[1] - y)
    if (d < 47 || d > 195) continue
    if (Math.abs(ang(Math.atan2(it2.pos[1] - y, it2.pos[0] - x) - o.self.aim[0])) > 0.95) continue
    if (!w.los(x, y, z + 8, it2.pos[0], it2.pos[1], it2.pos[2] + it2.zo)) continue
    const [c, tr] = chord(x, y, z + 8, it2.pos[0], it2.pos[1], it2.pos[2] + it2.zo)
    if (tr) { trunkTab[listed.has(id) ? 0 : 1]++; continue }
    const bi = bins.findIndex((b) => c >= b[0] && c < b[1])
    tab[bi][listed.has(id) ? 0 : 1]++
  }
}
console.log("metres of sight line inside crown cylinders -> [listed by the server, not listed]")
bins.forEach((b, i) => console.log(`  ${b[0]}-${b[1] > 1e8 ? "inf" : b[1]} m`.padEnd(14), tab[i], tab[i][0] + tab[i][1] ? (100 * tab[i][0] / (tab[i][0] + tab[i][1])).toFixed(0) + "% listed" : ""))
console.log("  trunk on line ", trunkTab)
