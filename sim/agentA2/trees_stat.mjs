import fs from "node:fs"
import { World } from "../../src/world.mjs"
const dir = new URL("../../arena", import.meta.url).pathname
const w = new World(dir)
const wj = JSON.parse(fs.readFileSync(dir + "/v2/world.json", "utf8"))
console.log("rules", JSON.stringify(wj.rules), "tree fields", wj.trees.fields, "n", wj.trees.data.length / wj.trees.fields.length)
const F = wj.trees.fields, D = wj.trees.data, NF = F.length, N = D.length / NF
const ix = F.indexOf("x"), iy = F.indexOf("y"), iz = F.indexOf("z"), ih = F.indexOf("height"), ir = F.indexOf("crownR"), ib = F.indexOf("crownBase"), it = F.indexOf("trunkR")
let sr = 0, sh = 0, sb = 0
for (let k = 0; k < N; k++) { sr += D[k * NF + ir]; sh += D[k * NF + ih]; sb += D[k * NF + ib] }
console.log("mean crownR", (sr / N).toFixed(1), "height", (sh / N).toFixed(1), "crownBase", (sb / N).toFixed(1), "sample", D.slice(0, NF))
const hid = (ax, ay, az, bx, by, bz) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
  for (let k = 0; k < N; k++) {
    const o = k * NF, tx = D[o + ix], ty = D[o + iy]
    let u = ((tx - ax) * dx + (ty - ay) * dy) / l2
    u = u < 0 ? 0 : u > 1 ? 1 : u
    const d = Math.hypot(ax + dx * u - tx, ay + dy * u - ty)
    if (d >= D[o + ir]) continue
    const pz = az + (bz - az) * u, tz = D[o + iz]
    if (pz > tz + D[o + ib] && pz < tz + D[o + ih]) return true
    if (d < D[o + it] && pz < tz + D[o + ib]) return true
  }
  return false
}
// random eye -> ground item lines inside the starting zone, with building line of sight
let seed = 7
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const bins = [[45, 80], [80, 130], [130, 185]]
for (const [lo, hi] of bins) {
  let n = 0, h = 0
  while (n < 4000) {
    const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 380
    const x = 41.3 + Math.cos(a) * r, y = -72.8 + Math.sin(a) * r
    const na = w.nearestNode(x, y, w.ground(x, y), 3, 9.5, 4)
    if (na < 0 || w.surf[na] - w.ground(x, y) > 1) continue
    const b = rnd() * 6.283, d = lo + rnd() * (hi - lo)
    const x2 = w.nodeX(na) + Math.cos(b) * d, y2 = w.nodeY(na) + Math.sin(b) * d
    const nb = w.nearestNode(x2, y2, w.ground(x2, y2), 3, 9.5, 2)
    if (nb < 0 || w.surf[nb] - w.ground(x2, y2) > 1) continue
    const A = [w.nodeX(na), w.nodeY(na), w.surf[na] + 8], B = [w.nodeX(nb), w.nodeY(nb), w.surf[nb] + 0.5]
    if (!w.los(...A, ...B)) continue
    n++
    if (hid(...A, ...B)) h++
  }
  console.log(`eye -> item on the ground at ${lo}-${hi} m, buildings clear: a tree crown or trunk is on the line in ${(100 * h / n).toFixed(0)}% of ${n} random pairs`)
}
