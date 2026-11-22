// Constructed observations: upgrade offers, take / drop, kill-event bookkeeping.
import fs from "node:fs"
import { World } from "../../src/world.mjs"
const { Brain, P } = await import(new URL(process.argv[2] || "../variants/t36-fixes.mjs", import.meta.url).href)
const L = fs.readFileSync(new URL("./stream.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const hello = L[0], obs = L.filter((m) => m.type === "obs")
const w = new World(new URL("../../arena", import.meta.url).pathname)
const clone = (o) => JSON.parse(JSON.stringify(o))
const base = clone(obs[0])
const mk = (f) => { const o = clone(base); o.mechs = []; o.events = []; f(o); return o }
// 1. offers
{
  const b = new Brain(hello, w)
  const a = b.act(mk((o) => { o.offer = { id: 1, expires: 5, choices: [{ id: "gun_rate" }, { id: "nanites" }, { id: "plating" }] } }))
  const a2 = b.act(mk((o) => { o.tick = 2; o.t = 0.1; o.offer = { id: 2, expires: 5, choices: [{ id: "sensors" }, { id: "mortar_splash" }, { id: "brand_new_upgrade" }] } }))
  const a3 = b.act(mk((o) => { o.tick = 4; o.t = 0.2; o.offer = null }))
  console.log("offer [gun_rate, nanites, plating] -> pick", a.pick, "(upSet", P.upSet + ": plating first)   offer with an unknown id -> pick", a2.pick, "  no offer -> pick", a3.pick)
}
// 2. take / drop
{
  const [x, y, z] = base.self.pos
  const gun = base.self.weapons[0]
  const las = { kind: "laser", cooldown: 0, charge: 0, stats: { ...hello.config.weapons.laser } }
  const ltn = { kind: "lightning", cooldown: 0, stats: { ...hello.config.weapons.lightning } }
  const run = (name, weapons, pickups) => { const b = new Brain(hello, w); const a = b.act(mk((o) => { o.self.weapons = weapons; o.pickups = pickups })); console.log(`  ${name}: take ${a.take} drop ${a.drop}`) }
  console.log("take / drop:")
  run("gun + empty, laser 3 m away", [gun, null], [{ id: 8001, kind: "laser", pos: [x + 3, y, z] }])
  run("gun + empty, laser 3.9 m away (inside the 4 m rule, outside our 3.7 m reach)", [gun, null], [{ id: 8001, kind: "laser", pos: [x + 3.9, y, z] }])
  run("gun + empty, mortar 2 m away", [gun, null], [{ id: 8002, kind: "mortar", pos: [x + 2, y, z] }])
  run("gun + lightning, laser 2 m away", [gun, ltn], [{ id: 8003, kind: "laser", pos: [x + 2, y, z] }])
  run("gun + laser, lightning 2 m away", [gun, las], [{ id: 8004, kind: "lightning", pos: [x + 2, y, z] }])
  run("gun + laser charging, lightning 2 m away", [gun, { ...las, charge: 0.3 }], [{ id: 8004, kind: "lightning", pos: [x + 2, y, z] }])
  run("gun + lightning, laser 2 m away but 3.9 m up", [gun, ltn], [{ id: 8005, kind: "laser", pos: [x + 2, y, z + 3.9] }])
}
// 3. a kill event that sits in a skipped observation
{
  const b = new Brain(hello, w)
  b.act(mk((o) => {}))
  // observation A (skipped by main.mjs): kill of mech 5, alive 15. observation B (answered): alive 15, no event.
  for (let k = 0; k < 3; k++) b.act(mk((o) => { o.tick = 10 + 2 * k; o.t = 1 + 0.1 * k; o.alive = 15 - k }))
  console.log("three deaths whose kill events never reached ingest(): ffa =", !!b.ffa, "(ffaN", P.ffaN + ")")
}
