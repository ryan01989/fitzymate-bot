// Scratch wrapper brain: logs economy stats per match to $FM_LOG (one JSON line per checkpoint).
import fs from "node:fs"
import { Brain as B } from "./bot.mjs"
const LOG = process.env.FM_LOG || "/tmp/probe.log"
export class Brain extends B {
  constructor(h, w) {
    super(h, w)
    this._seed = h.seed
    this._marks = [60, 120, 180, 240]
    this._drops = 0
    this._laserT = null
    this._modeT = {}
  }
  act(o) {
    const A = super.act(o)
    for (const ev of o.events || []) if (ev.type === "drop") this._drops++
    if (this._laserT == null && this.laser) this._laserT = Math.round(o.t)
    this._modeT[this.mode] = (this._modeT[this.mode] || 0) + 0.1
    if (this._marks.length && o.t >= this._marks[0]) {
      const m = this._marks.shift()
      fs.appendFileSync(LOG, JSON.stringify({ s: this._seed, t: m, cubes: o.self.cubes, hp: Math.round(this.hpS * 100), kills: this.myKills || 0, drops: this._drops, laserT: this._laserT, w: (o.self.weapons || []).filter(Boolean).map((q) => q.kind).join("+"), modes: Object.fromEntries(Object.entries(this._modeT).map(([k, v]) => [k, Math.round(v)])) }) + "\n")
    }
    return A
  }
}
