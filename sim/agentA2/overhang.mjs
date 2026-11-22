// world.mjs measures wall distance only against prisms between feet+1.25 and feet+8.5. A grown mech is taller:
// how many nodes it may use (wd >= reqR, clr >= H) have a prism underside between 8.5 m and its head within its radius?
import { World } from "../../src/world.mjs"
const w = new World(new URL("../../arena", import.meta.url).pathname)
const c0 = [41.3, -72.8]
const st = w.nearestNode(c0[0], c0[1], w.ground(c0[0], c0[1]), 3.2, 9.5, 60)
w.search(st, -1, { allowJet: false, reqR: 3.0, myH: 9.2, maxExp: 1e9 })
const main = Array.from(w.visited.slice(0, w.nVisited))
for (const cubes of [0, 5, 10, 15, 20]) {
  const sc = 1 + 0.05 * cubes, R = 2.5 * sc, H = 9 * sc, reqR = R + 0.45
  let ok = 0, bad = 0
  for (const n of main) {
    if (w.wd[n] < reqR || w.clr[n] < H + 0.3) continue
    ok++
    const s = w.surf[n], x = w.nodeX(n), y = w.nodeY(n)
    const r = Math.ceil(R)
    let hit = false
    for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.hypot(dx, dy) > R) continue
      const c = w.cell(x + dx, y + dy)
      if ((w.lo1[c] >= s + 8.5 && w.lo1[c] < s + H) || (w.lo2[c] >= s + 8.5 && w.lo2[c] < s + H && w.lo2[c] < 1e8)) { hit = true; break }
    }
    if (hit) bad++
  }
  console.log(`cubes ${String(cubes).padStart(2)} (H ${H.toFixed(1)} m): usable nodes ${ok}; with an overhang underside between 8.5 m and the head within the radius: ${bad} (${(100 * bad / ok).toFixed(2)}%)`)
}
