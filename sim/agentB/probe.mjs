// run dbg-like match and print retreat cover decisions
const B = await import("./bot.mjs")
const orig = B.Brain.prototype.findCover
B.Brain.prototype.findCover = function (th) {
  const c = orig.call(this, th)
  if (this.t > 100 && this.t < 116) console.log("findCover", this.t.toFixed(1), "nth", th.length, th.map((q) => Math.round(Math.hypot(q[0] - this.me.pos[0], q[1] - this.me.pos[1]))).join(","), "->", c ? Math.round(Math.hypot(c.x - this.me.pos[0], c.y - this.me.pos[1])) : null, "cover", this.cover && Math.round(Math.hypot(this.cover.x - this.me.pos[0], this.cover.y - this.me.pos[1])))
  return c
}
