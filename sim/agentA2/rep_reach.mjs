// Real replays: where do cubes and weapon pickups lie, and how close does the bot's walk graph let it get?
// The bot walks to the nearest node with wall distance >= R + 0.45 and stops within 1.1 m of it (follow()); cube pickup radius 3.5 m, take reach 3.7 m (4 - 0.3).
import fs from "node:fs"
import { World } from "../../src/world.mjs"
const w = new World(new URL("../../arena", import.meta.url).pathname)
const D = JSON.parse(fs.readFileSync("/Users/dylanryan/Desktop/BuildersMech/mechrec-export-2026-11-21T1927.json", "utf8"))
const cubes = [], picks = []
for (const key of Object.keys(D.raw)) {
  const lines = D.raw[key].split("\n").filter(Boolean).map((l) => JSON.parse(l))
  const h = lines.find((l) => l.type === "header")
  for (const p of h.pickups || []) { const at = p.at || p.pos; if (at) picks.push({ at, kind: p.kind, src: "floor" }) }
  for (const f of lines) {
    if (f.type || !f.m) continue
    for (const e of f.ev || []) {
      if (e.e === "cube" && e.at) cubes.push({ at: e.at })
      else if (e.e === "weapon" && (e.op === "spawn" || e.op === "drop") && e.at) picks.push({ at: e.at, kind: e.kind, src: e.op })
    }
  }
}
console.log("real cubes", cubes.length, " real weapon pickups", picks.length, JSON.stringify(picks.reduce((o, p) => ((o[p.src] = (o[p.src] || 0) + 1), o), {})))
const goalDist = (at, reqR, H) => {
  // moveToPoint(): nearestNode(px, py, pz, reqR, Hh + 0.3, 16)
  const g = w.nearestNode(at[0], at[1], at[2], reqR, H + 0.3, 16)
  if (g < 0) return [99, 99]
  return [Math.hypot(w.nodeX(g) - at[0], w.nodeY(g) - at[1]), Math.abs(w.surf[g] - at[2])]
}
for (const cubesHeld of [0, 4, 8, 12, 16]) {
  const sc = 1 + 0.05 * cubesHeld, reqR = 2.5 * sc + 0.45, H = 9 * sc
  const stat = (L, reach, vreach) => {
    let far = 0, far11 = 0, ground = 0
    for (const it of L) {
      const [d, dz] = goalDist(it.at, reqR, H)
      const onGround = Math.abs(w.ground(it.at[0], it.at[1]) - it.at[2]) < 1.5
      if (!onGround) continue
      ground++
      if (d > reach || dz > vreach) far++
      if (d + 1.1 > reach || dz > vreach) far11++
    }
    return `${ground} on the ground; goal node beyond reach: ${far} (${(100 * far / ground).toFixed(1)}%); beyond reach when the bot stops 1.1 m short of the node (worst case): ${far11} (${(100 * far11 / ground).toFixed(1)}%)`
  }
  console.log(`we hold ${String(cubesHeld).padStart(2)} cubes (reqR ${reqR.toFixed(2)}):`)
  console.log("   cubes   (pickup 3.5 m): " + stat(cubes, 3.5, 4))
  console.log("   weapons (take 3.7 m):   " + stat(picks, 3.7, 3.7))
  console.log("   lasers  (take 3.7 m):   " + stat(picks.filter((p) => p.kind === "laser"), 3.7, 3.7))
}
