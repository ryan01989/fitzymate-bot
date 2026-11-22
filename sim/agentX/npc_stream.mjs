// Real stream: how are NPC drones listed? gaps between listings, distance, and how long the bot keeps them in its farm list (t - n.t < 6)
import fs from "node:fs"
const L = fs.readFileSync(new URL("../agentA2/stream.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const obs = L.filter((m) => m.type === "obs")
const seen = new Map() // id -> [[t, d, hp]...]
let hits = 0
for (const o of obs) {
  const [x, y] = o.self.pos
  for (const m of o.mechs || []) if (m.kind === "npc") {
    if (!seen.has(m.id)) seen.set(m.id, [])
    seen.get(m.id).push([o.t, Math.hypot(m.pos[0] - x, m.pos[1] - y), m.hp, m.pos])
  }
  for (const e of o.events || []) if (e.type === "hit" || e.type === "damaged") hits++
}
console.log("obs", obs.length, "t", obs[0].t, "->", obs.at(-1).t, "self id", obs[0].self.id, "weapons", JSON.stringify(obs[0].self.weapons.map((w) => w && w.kind)))
for (const [id, a] of seen) {
  const gaps = []
  for (let i = 1; i < a.length; i++) if (a[i][0] - a[i - 1][0] > 0.15) gaps.push(`${a[i - 1][0]}-${a[i][0]} (${a[i - 1][1].toFixed(0)}m->${a[i][1].toFixed(0)}m)`)
  const home = a[0][3]
  const span = Math.max(...a.map((r) => Math.hypot(r[3][0] - home[0], r[3][1] - home[1])))
  console.log(`npc ${id}: listed ${a.length}x from ${a[0][0]} to ${a.at(-1)[0]}, dist ${a[0][1].toFixed(0)}..${a.at(-1)[1].toFixed(0)}, wander span ${span.toFixed(0)} m, gaps: ${gaps.join(", ")}`)
}
console.log("events", hits)
