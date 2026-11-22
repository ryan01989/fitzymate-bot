// Trace position / nav state of one sim match: node strand.mjs <brain> <seed> <t0> <t1> [packJson]
import fs from "node:fs"
import zlib from "node:zlib"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "../..")
performance.now = () => 1e6
const { World } = await import(path.join(ROOT, "src/world.mjs"))
const { Sim } = await import(path.join(ROOT, "sim/sim.mjs"))
const { Dummy, setPack } = await import(path.join(ROOT, "sim/dummy.mjs"))
const [brain, seedS, t0S, t1S, packS, everyS] = process.argv.slice(2)
const pack = { noise: 1.5, react: 2, every: 300, perKill: 0.5, share: 10, near: 0, ...JSON.parse(packS || '{"base":0,"every":100000,"perKill":0,"tAll":240,"retaliate":0,"ff":0,"near":0}') }
setPack(pack)
const world = new World(path.join(ROOT, "arena"))
const cfg = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "check/stream.jsonl.gz"))).toString().split("\n")[0]).config
const Mine = (await import(pathToFileURL(path.resolve(brain)).href)).Brain
const seed = +seedS, T0 = +t0S, T1 = +t1S, every = +(everyS || 10)
const mineSlot = (seed * 7) % 16
const bots = [], order = []
const skills = Array(4).fill("easy").concat(Array(4).fill("medium"), Array(4).fill("hard"), Array(3).fill("expert"))
const squad = { prey: mineSlot, shared: null, near: pack.near ?? 30 }
let k = 0
for (let i = 0; i < 16; i++) {
  if (i === mineSlot) bots.push({ label: "mine", make: (h) => new Mine(h, world) })
  else { const sk = skills[k++]; order.push(i); bots.push({ label: sk, make: (h) => new Dummy(h, world, sk, squad) }) }
}
squad.order = order
const sim = new Sim(world, cfg, seed, bots)
if (pack.ff === 0) sim.noFF = new Set(order)
const base = pack.base ?? 1, perKill = pack.perKill ?? 1, ev = pack.every ?? 90, tAll = pack.tAll ?? 300
squad.count = (t) => { const dead = order.filter((q) => !sim.mechs[q].alive).length; return t > tAll ? 15 : base + dead * perKill + Math.floor(t / ev) }
squad.active = (id, t) => { const alive = order.filter((q) => sim.mechs[q].alive); const i = alive.indexOf(id); return i >= 0 && i < squad.count(t) }
const m = sim.mechs[mineSlot], b = m.bot
let n = 0, lastL = null
while (sim.step() && m.alive) {
  if (sim.t < T0 || sim.t > T1) continue
  if (n++ % every) continue
  const a = m.action
  if (process.env.STANDDBG) { const L = b.loot; console.log(`${sim.t.toFixed(1)} ${b.mode} loot ${L ? L.type + ':' + L.id + ' d ' + Math.hypot(L.pos[0] - m.pos[0], L.pos[1] - m.pos[1]).toFixed(1) + ' dz ' + (L.pos[2] - m.pos[2]).toFixed(1) : '-'} kill ${b.killLoot ? (sim.t - b.killLoot.t).toFixed(0) + 's' : '-'} kc ${b.kcRun ? 1 : 0} path ${b.path ? b.path.length + '@' + b.pi : 'null'} partial ${b.pathPartial ? 1 : 0} mv ${a.move.map((v) => v.toFixed(1))} pos ${m.pos.map((v) => v.toFixed(1))} cubes ${m.cubes} hp ${m.hp.toFixed(0)}/${m.maxHp.toFixed(0)} lootSince ${b.lootSince?.toFixed(0)} knownCubes ${b.cubes.size} vis ${b.vis.map((e) => e.id + (e.los ? 'L' : '') + ':' + e.dist.toFixed(0)).join(',')}`); continue }
  if (process.env.LOOTDBG) { const L = b.loot || lastL; if (b.loot) lastL = b.loot; if (L) { const zc = b.o.zone, d = Math.hypot(L.pos[0] - m.pos[0], L.pos[1] - m.pos[1]); console.log(`${sim.t.toFixed(1)} ${b.mode} loot ${b.loot ? b.loot.type + ':' + b.loot.id : 'null (last ' + L.type + ':' + L.id + ')'} d ${d.toFixed(0)} insideNext ${Math.hypot(L.pos[0] - b.nc[0], L.pos[1] - b.nc[1]) < b.nr - 2 ? 1 : 0} zoneSlack ${b.zoneSlack.toFixed(1)} need ${(d / b.walk + 25).toFixed(1)} stillKnown ${(b.crates.has(L.id) || b.cubes.has(L.id) || b.picks.has(L.id) || b.npcs.has(L.id)) ? 1 : 0} mv ${a.move.map((v) => v.toFixed(1))}`) } continue }
  const [x, y, z] = m.pos
  const nd = b.myNode
  console.log(`${sim.t.toFixed(1)} ${b.mode} pos ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)} gnd ${world.ground(x, y).toFixed(1)} grounded ${m.grounded ? 1 : 0} cubes ${m.cubes} R ${b.R.toFixed(2)} reqR ${b.reqR.toFixed(2)} Hh ${b.Hh.toFixed(1)} myNode ${nd}${nd >= 0 ? ` (wd ${world.wd[nd].toFixed(1)} clr ${world.clr[nd].toFixed(0)} surf ${world.surf[nd].toFixed(1)} main ${b.main[nd]})` : ""} path ${b.path ? b.path.length + "@" + b.pi : "null"} partial ${b.pathPartial ? 1 : 0} esc ${b.escape ? 1 : 0} unst ${sim.t < b.unstuckUntil ? 1 : 0} hp ${m.hp.toFixed(0)} en ${m.energy.toFixed(0)} mv ${a.move.map((v) => v.toFixed(2))}${a.boost ? " B" : ""}${a.jump ? " J" : ""} inZ ${b.inZone ? 1 : 0} dNext ${b.dNext.toFixed(0)}`)
}
console.log("end", sim.t.toFixed(1), "alive", m.alive, "killedBy", m.killedBy, "kills", m.kills, "cubes", m.cubes)
