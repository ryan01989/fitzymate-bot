// Identity check for a candidate with its new switches off: must play exactly like sim/train/base.mjs.
//   node sim/train/same.mjs sim/train/cand/<name>.mjs
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
const seeds = "1000,1101,1202,1303,1404,1505"
const run = (f) => {
  const out = path.join(os.tmpdir(), `fm-same-${process.pid}-${path.basename(f)}.json`)
  execFileSync("node", ["sim/eval.mjs", "--brain", f, "--seedlist", seeds, "--par", "2", "--quiet", "--stop-on-death", "--frozen-clock", "--dump", out], { env: { ...process.env, FM_NOSWITCH: "1", FM_P: "{}" }, stdio: "ignore" })
  const r = JSON.parse(fs.readFileSync(out, "utf8"))
  fs.unlinkSync(out)
  return Object.fromEntries(r.map((q) => [q.seed, [q.place, q.surv, q.kills, q.killedBy, q.dmg, (q.killTs || []).join("/"), q.crashes].join(" ")]))
}
const a = run("sim/train/base.mjs"),
  b = run(process.argv[2])
let same = 0
for (const s of Object.keys(a)) {
  const ok = a[s] === b[s]
  same += ok
  if (!ok) console.log(`seed ${s}: base [${a[s]}]  candidate [${b[s]}]`)
}
console.log(`${same}/${Object.keys(a).length} seeds identical to base${same === Object.keys(a).length ? " - OK" : " - NOT IDENTICAL"}`)
