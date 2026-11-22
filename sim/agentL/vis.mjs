// For each observer case: which lasers lying on the ground within 200 m are in sight (buildings via world.mjs,
// tree crowns beyond 45 m, trunks always), from standing eye height and from a jet hop A m higher.
import fs from "node:fs"
import { World } from "../../src/world.mjs"
const w = new World(new URL("../../arena", import.meta.url).pathname)
const wj = JSON.parse(fs.readFileSync(new URL("../../arena/v2/world.json", import.meta.url), "utf8"))
const F = wj.trees.fields, NF = F.length, D = wj.trees.data, n = D.length / NF
const col = (nm) => Float32Array.from({ length: n }, (_, k) => D[k * NF + F.indexOf(nm)])
const T = { n, x: col("x"), y: col("y"), z: col("z"), h: col("height"), cr: col("crownR"), cb: col("crownBase"), tr: col("trunkR"), cx: col("crownX"), cy: col("crownY") }
function treeHides(ax, ay, az, bx, by, bz, crowns) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by)
  const cyl = (cx, cy, r, zlo, zhi) => { const fx = ax - cx, fy = ay - cy, b = fx * dx + fy * dy, disc = b * b - l2 * (fx * fx + fy * fy - r * r); if (disc <= 0) return false; const sq = Math.sqrt(disc), u0 = Math.max(0, (-b - sq) / l2), u1 = Math.min(1, (-b + sq) / l2); if (u0 >= u1) return false; const za = az + dz * u0, zb = az + dz * u1; return Math.max(za, zb) > zlo && Math.min(za, zb) < zhi }
  for (let k = 0; k < T.n; k++) {
    const r = T.cr[k], cx = T.cx[k], cy = T.cy[k]
    const far = cx < x0 - r || cx > x1 + r || cy < y0 - r || cy > y1 + r
    if (crowns && !far && cyl(cx, cy, r, T.z[k] + T.cb[k], T.z[k] + T.h[k])) return true
    const tr = T.tr[k]
    if (T.x[k] < x0 - tr || T.x[k] > x1 + tr || T.y[k] < y0 - tr || T.y[k] > y1 + tr) continue
    if (cyl(T.x[k], T.y[k], tr, T.z[k] - 1, T.z[k] + Math.max(T.cb[k], 1))) return true
  }
  return false
}
const cases = JSON.parse(fs.readFileSync(new URL("cases.json", import.meta.url)))
const HOPS = [0, 6, 10, 14, 20]
const agg = {}
for (const c of cases) {
  const [x, y, z] = c.p
  const res = HOPS.map((A) => {
    const ez = z + 8 + A
    let best = Infinity, bestRoof = false
    for (const L of c.las) {
      const d = Math.hypot(L[0] - x, L[1] - y)
      if (d > 200) continue
      if (!w.los(x, y, ez, L[0], L[1], L[2] + 0.5)) continue
      if (treeHides(x, y, ez, L[0], L[1], L[2] + 0.5, d >= 45)) continue
      if (d < best) { best = d; bestRoof = L[2] - w.ground(L[0], L[1]) > 3 }
    }
    return [best, bestRoof]
  })
  const any200 = c.las.some((L) => Math.hypot(L[0] - x, L[1] - y) < 200)
  const a = (agg[c.T] ??= { n: 0, any200: 0, seen: HOPS.map(() => 0), roof: HOPS.map(() => 0), dsum: HOPS.map(() => []), gain: HOPS.map(() => 0) })
  a.n++; a.any200 += any200
  res.forEach(([b, r], i) => { if (b < Infinity) { a.seen[i]++; a.roof[i] += r; a.dsum[i].push(b) } if (b < Infinity && res[0][0] === Infinity) a.gain[i]++ })
}
for (const [Tm, a] of Object.entries(agg)) {
  console.log(`T=${Tm}s cases ${a.n} (spawns at T=0, else laserless mechs): a laser lying within 200 m ${(100 * a.any200 / a.n).toFixed(0)}%`)
  HOPS.forEach((A, i) => { const ds = a.dsum[i].sort((p, q) => p - q); console.log(`  eye +${A} m: one in sight ${(100 * a.seen[i] / a.n).toFixed(0)}% (nearest is on a roof ${a.roof[i]}), newly in sight vs standing ${(100 * a.gain[i] / a.n).toFixed(0)}%, median dist ${ds[ds.length >> 1]?.toFixed(0)}`) })
}
