// Does damage dealt to a crate / NPC drone restart the 5 s regeneration timer? (real replays)
import fs from "node:fs"
const D = JSON.parse(fs.readFileSync("/Users/dylanryan/Desktop/BuildersMech/mechrec-export-2026-11-21T1927.json", "utf8"))
const bins = {} // key: which clock is recent -> [regen frames, flat frames]
const add = (k, up) => { bins[k] ??= [0, 0]; bins[k][up ? 0 : 1]++ }
const objKind = { crate: [0, 0], npc: [0, 0] }
for (const key of Object.keys(D.raw)) {
  const lines = D.raw[key].split("\n").filter(Boolean).map((l) => JSON.parse(l))
  const fr = lines.filter((l) => !l.type && l.m)
  const lastTaken = {}, lastDealtMech = {}, lastCrate = {}, lastNpc = {}, prevHp = {}, prevMax = {}, ups = {}, outT = {}
  for (const f of fr) {
    const t = f.t / 20
    for (const e of f.ev || []) {
      const te = e.t / 20
      if (e.e === "hit") {
        if (e.dst < 100) lastTaken[e.dst] = te
        if (e.src < 100) { if (e.dst < 100) lastDealtMech[e.src] = te; else if (e.dst >= 1000) lastCrate[e.src] = te; else lastNpc[e.src] = te }
      } else if (e.e === "upgrade" && e.up === "nanites") ups[e.id] = (ups[e.id] || 0) + 1
    }
    for (const m of f.m) {
      const id = m[0], hp = m[6], mx = m[10]
      const inZ = Math.hypot(m[1] - f.z[0], m[2] - f.z[1]) < f.z[2] - 1
      if (!inZ) outT[id] = t
      if (prevHp[id] != null && mx === prevMax[id] && hp < mx - 0.5 && !ups[id] && t - (outT[id] ?? -99) > 5.3) {
        const up = hp > prevHp[id] + 0.5
        const flat = hp === prevHp[id]
        if (up || flat) {
          const sT = t - (lastTaken[id] ?? -99), sM = t - (lastDealtMech[id] ?? -99), sC = t - (lastCrate[id] ?? -99), sN = t - (lastNpc[id] ?? -99)
          const q = sT > 5.3 && sM > 5.3
          if (q && sC > 5.3 && sN > 5.3) add("quiet on every clock", up)
          else if (q && sC < 4.7 && sN > 5.3) { add("only a crate hit in the last 4.7 s", up) }
          else if (q && sN < 4.7 && sC > 5.3) add("only an NPC hit in the last 4.7 s", up)
          else if (sT < 4.7 && sM > 5.3 && sC > 5.3 && sN > 5.3) add("only damage taken in the last 4.7 s", up)
          else if (sM < 4.7 && sT > 5.3 && sC > 5.3 && sN > 5.3) add("only a hit on a mech in the last 4.7 s", up)
        }
      }
      prevHp[id] = hp; prevMax[id] = mx
    }
  }
}
console.log("hurt mech, inside the zone for 5.3 s, no nanites; frames [HP rising, HP flat]:")
for (const k of Object.keys(bins)) console.log("  ", k.padEnd(42), bins[k])
