// How much of the walk graph stays usable as the mech grows (+5% size per cube, no cap)?
import { World } from "../../src/world.mjs"
const w = new World(new URL("../../arena", import.meta.url).pathname)
const c0 = [41.3, -72.8]
const start0 = w.nearestNode(c0[0], c0[1], w.ground(c0[0], c0[1]), 3.2, 9.5, 60)
w.search(start0, -1, { allowJet: false, reqR: 3.0, myH: 9.2, maxExp: 1e9 })
const base = w.nVisited
const baseSet = new Uint8Array(2 * w.NC)
for (let k = 0; k < w.nVisited; k++) baseSet[w.visited[k]] = 1
let maxWd = 0
for (let n = 0; n < 2 * w.NC; n++) if (w.wd[n] > maxWd) maxWd = w.wd[n]
console.log("largest wall distance stored in the nav grid (wd cap):", maxWd, " main component nodes at 0 cubes:", base)
for (const cubes of [0, 3, 6, 8, 10, 12, 15, 18, 21, 24, 27, 30, 32, 33, 36]) {
  const sc = 1 + 0.05 * cubes
  const R = 2.5 * sc, Hh = 9 * sc, reqR = R + 0.45
  const s = w.nearestNode(c0[0], c0[1], w.ground(c0[0], c0[1]), reqR, Hh + 0.3, 60)
  let comp = 0
  if (s >= 0) { w.search(s, -1, { allowJet: false, reqR, myH: Hh + 0.3, maxExp: 1e9 }); comp = w.nVisited }
  let ok = 0
  for (let n = 0; n < 2 * w.NC; n++) if (baseSet[n] && w.wd[n] >= reqR && w.clr[n] >= Hh + 0.3) ok++
  console.log(`cubes ${String(cubes).padStart(2)}  R ${R.toFixed(2)} reqR ${reqR.toFixed(2)} H ${Hh.toFixed(1)}  nodes we may stand on: ${(100 * ok / base).toFixed(1)}% of main  connected from the zone centre: ${(100 * comp / base).toFixed(1)}%`)
}
