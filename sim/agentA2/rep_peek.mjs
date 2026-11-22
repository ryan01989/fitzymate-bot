import fs from "node:fs"
const D = JSON.parse(fs.readFileSync("/Users/dylanryan/Desktop/BuildersMech/mechrec-export-2026-11-21T1927.json", "utf8"))
const keys = Object.keys(D.raw)
const lines = D.raw[keys[0]].split("\n").filter(Boolean).map((l) => JSON.parse(l))
const types = {}
for (const l of lines) types[l.type || "frame"] = (types[l.type || "frame"] || 0) + 1
console.log(types)
const h = lines.find((l) => l.type === "header")
console.log(Object.keys(h), JSON.stringify(h.zone), JSON.stringify(h.mechs[0]), JSON.stringify(h.fields))
const fr = lines.filter((l) => !l.type || l.type === "frame")
console.log(JSON.stringify(fr[100]).slice(0, 1500))
const evs = {}
for (const f of fr) for (const e of f.ev || []) { const k = e.type || e.k || JSON.stringify(Object.keys(e)); if (!evs[k]) evs[k] = [0, JSON.stringify(e).slice(0, 260)]; evs[k][0]++ }
console.log(evs)
