// Feed the 300 real observations to the bot and watch its item memory (_remember):
// how often does it delete a pickup / crate / cube that the server lists again later (so it was hidden, not gone)?
import fs from "node:fs"
import { World } from "../../src/world.mjs"
const brainFile = process.argv[2] || "../variants/t32-stack-pick.mjs"
const { Brain } = await import(new URL(brainFile, import.meta.url).href)
const L = fs.readFileSync(new URL("./stream.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const hello = L[0]
const w = new World(new URL("../../arena", import.meta.url).pathname)
const b = new Brain(hello, w)
// trees from the map, to see whether the lost sight lines pass a crown
const wj = JSON.parse(fs.readFileSync(new URL("../../arena/v2/world.json", import.meta.url), "utf8"))
const TF = wj.trees.fields, TD = wj.trees.data, TN = TD.length / TF.length
const fi = (n) => TF.indexOf(n)
const crownHit = (ax, ay, az, bx, by, bz) => {
  let hits = 0
  for (let k = 0; k < TN; k++) {
    const o = k * TF.length
    const tx = TD[o + fi("x")], ty = TD[o + fi("y")], tz = TD[o + fi("z")], h = TD[o + fi("height")], cr = TD[o + fi("crownR")], cb = TD[o + fi("crownBase")]
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
    let u = ((tx - ax) * dx + (ty - ay) * dy) / l2
    if (u < 0.02 || u > 0.98) continue
    const px = ax + dx * u, py = ay + dy * u, pz = az + (bz - az) * u
    if (Math.hypot(px - tx, py - ty) < cr && pz > tz + cb && pz < tz + h) hits++
  }
  return hits
}
const kinds = { picks: "pickup", crates: "crate", cubes: "cube" }
const deleted = { picks: new Map(), crates: new Map(), cubes: new Map() }
const stat = { picks: [0, 0, 0], crates: [0, 0, 0], cubes: [0, 0, 0] } // deletions, of them listed again later, of those: sight line crossed a tree crown
let errs = 0
const obs = L.filter((m) => m.type === "obs")
const lists = { picks: "pickups", crates: "crates", cubes: "cubes" }
const lastSeenLater = { picks: new Map(), crates: new Map(), cubes: new Map() }
for (let i = obs.length - 1; i >= 0; i--) for (const k of Object.keys(lists)) for (const it of obs[i][lists[k]] || []) if (!lastSeenLater[k].has(it.id)) lastSeenLater[k].set(it.id, obs[i].t)
for (const o of obs) {
  const before = {}
  for (const k of Object.keys(lists)) before[k] = new Map(b[k])
  try { b.act(o) } catch (e) { errs++; if (errs < 3) console.log("act threw", e) }
  for (const k of Object.keys(lists)) {
    for (const [id, it] of before[k]) {
      if (b[k].has(id)) continue
      // forgotten this tick (not by a take event)
      stat[k][0]++
      if ((lastSeenLater[k].get(id) ?? -1) > o.t) {
        stat[k][1]++
        const [x, y, z] = o.self.pos
        if (crownHit(x, y, z + 8, it.pos[0], it.pos[1], it.pos[2] + 0.5)) stat[k][2]++
        if (stat[k][1] <= 3) console.log(`  t=${o.t} forgot ${kinds[k]} ${id} (${it.kind || ""}) at ${Math.hypot(it.pos[0] - x, it.pos[1] - y).toFixed(0)} m; the server lists it again until t=${lastSeenLater[k].get(id)}`)
      }
    }
  }
}
console.log("act() errors on the real stream:", errs)
for (const k of Object.keys(lists)) console.log(`${kinds[k]}: forgotten ${stat[k][0]} times; ${stat[k][1]} of them were listed again later (still there); ${stat[k][2]} of those had a tree crown on the sight line`)
console.log("distinct ids ever listed:", Object.keys(lists).map((k) => kinds[k] + " " + lastSeenLater[k].size).join(", "))
