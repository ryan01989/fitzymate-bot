// paired difference vs the baseline dump: node sim/agentG/paired.mjs base.json other.json...
import fs from "node:fs"
const load = (f) => new Map(JSON.parse(fs.readFileSync(f)).map((r) => [r.seed, r]))
const B = load(process.argv[2])
for (const f of process.argv.slice(3)) {
  const O = load(f)
  for (const k of ["pts", "surv"]) {
    const d = [...B.keys()].filter((s) => O.has(s)).map((s) => O.get(s)[k] - B.get(s)[k])
    const m = d.reduce((a, b) => a + b, 0) / d.length
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (d.length - 1))
    process.stdout.write(`${f.split("/").pop()} ${k}: diff ${m >= 0 ? "+" : ""}${m.toFixed(2)} ±${(sd / Math.sqrt(d.length)).toFixed(2)} (n=${d.length})   `)
  }
  console.log()
}
