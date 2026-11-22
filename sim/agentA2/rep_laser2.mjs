import fs from "node:fs"
const D = JSON.parse(fs.readFileSync("/Users/dylanryan/Desktop/BuildersMech/mechrec-export-2026-11-21T1927.json", "utf8"))
const par = { charge: [0, 0], laser: [0, 0], fireGun: [0, 0], frame: [0, 0] }
const byName = {}
for (const key of Object.keys(D.raw)) {
  const lines = D.raw[key].split("\n").filter(Boolean).map((l) => JSON.parse(l))
  const h = lines.find((l) => l.type === "header")
  const name = {}; for (const m of h.mechs) name[m.id] = m.name
  const chargeT = {}
  for (const f of lines) {
    if (f.type || !f.m) continue
    par.frame[f.t & 1]++
    for (const e of f.ev || []) {
      if (e.e === "charge") { par.charge[e.t & 1]++; chargeT[e.id] = e.t }
      else if (e.e === "laser") { par.laser[e.t & 1]++; const dt = e.t - (chargeT[e.id] ?? -999); if (dt >= 0 && dt < 40) { const r = (byName[name[e.id]] ??= {}); r[dt] = (r[dt] || 0) + 1 } }
      else if (e.e === "fire" && e.w === "gun") par.fireGun[e.t & 1]++
    }
  }
}
console.log("tick parity [even, odd]:", JSON.stringify(par))
for (const n of Object.keys(byName)) { const tot = Object.values(byName[n]).reduce((a, b) => a + b, 0); if (tot >= 25) console.log(n.padEnd(22), JSON.stringify(byName[n])) }
