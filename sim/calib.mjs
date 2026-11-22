// Search pack settings that reproduce the real practice scores of our six submitted builds.
//   node sim/calib.mjs '<json array of pack objects>' [n]
import { execFileSync } from "node:child_process"
const REAL = [
  ["starter", "starter", "{}", 1.15],
  ["v1", "sim/variants/v1.mjs", "{}", 3.42],
  ["v2", "sim/variants/v2.mjs", "{}", 3.75],
  ["v3-farm", "sim/variants/v3-farm.mjs", "{}", 4.58],
  ["v4-merge", "sim/variants/v4-merge.mjs", "{}", 4.48],
  ["farm-all", "sim/variants/v3-farm.mjs", '{"farmUntil":420}', 4.4],
]
const packs = JSON.parse(process.argv[2])
const n = +(process.argv[3] || 32)
for (const pk of packs) {
  const row = []
  for (const [name, brain, fm, real] of REAL) {
    const out = execFileSync("node", ["sim/eval.mjs", "--brain", brain, "--n", String(n), "--seed", "1", "--quiet", "--pack", JSON.stringify(pk)], { env: { ...process.env, FM_P: fm }, encoding: "utf8" })
    const m = out.match(/pts ([\d.]+) ±([\d.]+)/)
    const acc = out.match(/pack ([\d.]+)/)
    row.push({ name, sim: +m[1], real, acc: acc ? +acc[1] : null })
  }
  // fit: ignore a constant scale? report raw error and the v2->v3 jump the sim gives
  const err = Math.sqrt(row.reduce((s, r) => s + (r.sim - r.real) ** 2, 0) / row.length)
  const jump = row[3].sim - row[2].sim
  console.log(`${JSON.stringify(pk)}  rmse ${err.toFixed(2)}  jump v2->v3 ${jump.toFixed(2)} (real 0.83)  packAcc ${row[1].acc}  | ` + row.map((r) => `${r.name} ${r.sim.toFixed(2)}/${r.real}`).join("  "))
}
