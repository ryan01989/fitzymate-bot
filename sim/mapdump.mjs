// dev tool: dump nav layers as a PPM to eyeball the map model
import fs from "node:fs"
import { World } from "../src/world.mjs"
const t0 = performance.now()
const w = new World(process.argv[2] || "arena")
console.log("build ms", (performance.now() - t0).toFixed(0), "nav", w.NX, w.NY, "links", w.nLinks)
const { NX, NY, NC } = w
// flood from a central open node
const start = w.nearestNode(41, -72, w.ground(41, -72))
w.search(start, -1, { allowJet: false })
console.log("walk-reachable nodes", w.nVisited)
const reach = new Uint8Array(2 * NC)
for (let k = 0; k < w.nVisited; k++) reach[w.visited[k]] = 1
let valid = 0
for (let n = 0; n < 2 * NC; n++) if (w.surf[n] === w.surf[n] && w.wd[n] >= 3 && w.clr[n] >= 9) valid++
console.log("valid nodes", valid)
const out = Buffer.alloc(NX * NY * 3)
for (let J = 0; J < NY; J++)
  for (let I = 0; I < NX; I++) {
    const n = J * NX + I
    const o = ((NY - 1 - J) * NX + I) * 3
    let r = 0, g = 0, b = 0
    const s = w.surf[n]
    if (s !== s) { r = g = b = 0 }
    else if (!w.isT[n]) { const h = Math.min(255, 60 + (s + 10) * 4); r = h; g = h * 0.5; b = 40; if (reach[n]) { g = 255 } }
    else if (w.wd[n] < 3 || w.clr[n] < 9) { r = 90; g = 90; b = 90 }
    else if (reach[n]) { const h = Math.max(0, Math.min(255, 120 + s * 8)); r = 30; g = h; b = 60 }
    else { r = 200; g = 0; b = 200 }
    if (w.surf[NC + n] === w.surf[NC + n]) { b = 255 }
    out[o] = r; out[o + 1] = g; out[o + 2] = b
  }
fs.writeFileSync(process.argv[3] || "/tmp/map.ppm", Buffer.concat([Buffer.from(`P6\n${NX} ${NY}\n255\n`), out]))
