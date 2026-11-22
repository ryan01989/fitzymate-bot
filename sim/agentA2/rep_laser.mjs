// Real replays: laser damage as a function of ticks between the charge start and the beam.
import fs from "node:fs"
const D = JSON.parse(fs.readFileSync("/Users/dylanryan/Desktop/BuildersMech/mechrec-export-2026-11-21T1927.json", "utf8"))
const tab = {}
for (const key of Object.keys(D.raw)) {
  const lines = D.raw[key].split("\n").filter(Boolean).map((l) => JSON.parse(l))
  const fr = lines.filter((l) => !l.type && l.m)
  const ups = {}, chargeT = {}, chargeFull = {}
  let M = {}
  for (const f of fr) {
    for (const m of f.m) M[m[0]] = m
    const evs = f.ev || []
    for (const e of evs) {
      if (e.e === "upgrade") (ups[e.id] ??= {})[e.up] = ((ups[e.id] ??= {})[e.up] || 0) + 1
      else if (e.e === "charge") { chargeT[e.id] = e.t; chargeFull[e.id] = e.full }
      else if (e.e === "laser") {
        const dt = e.t - (chargeT[e.id] ?? -999)
        const sh = M[e.id]
        if (!sh || dt < 0 || dt > 80) continue
        for (const h of evs) {
          if (h.e !== "hit" || h.t !== e.t || h.src !== e.id || h.w !== "laser" || h.dst >= 100 || h.rear || h.fx) continue
          const tg = M[h.dst]
          if (!tg) continue
          if ((ups[e.id]?.laser_damage || 0) > 0 || (ups[h.dst]?.armor || 0) > 0 || tg[11] === 1 || tg[12] === 1) continue
          const mul = 1 + 0.04 * Math.min(10, sh[9])
          const frac = h.amt / (315 * mul)
          const k = `${chargeFull[e.id]}|${dt}`
          ;(tab[k] ??= []).push(frac)
        }
      }
    }
  }
}
const keys = Object.keys(tab).sort((a, b) => { const [fa, da] = a.split("|").map(Number), [fb, db] = b.split("|").map(Number); return fb - fa || da - db })
console.log("full-charge time | ticks from charge start to beam | n | damage / (315 x cube bonus): min median max   [expected at c = ticks/20: 0.35+0.65*min(1,c/full)]")
for (const k of keys) { const v = tab[k].sort((a, b) => a - b); if (v.length < 3 && +k.split("|")[1] > 20) continue; const [full, dt] = k.split("|").map(Number); console.log(k.padEnd(10), String(v.length).padStart(4), v[0].toFixed(3), v[v.length >> 1].toFixed(3), v[v.length - 1].toFixed(3), "  expected", (0.35 + 0.65 * Math.min(1, dt / 20 / full)).toFixed(3)) }
