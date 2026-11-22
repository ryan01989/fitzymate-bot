#!/usr/bin/env python3
"""Build sim/variants/sq12c-stack.mjs from the coordinator's sim/variants/sq12b-stack.mjs (sq1 squad + sq2 v1 move,
both held until sqMoveAt / sqFrom 30 s and never in a free-for-all).

sq12c = sq12b + the sq2 v2 movement changes (the same edits build_sq2b.py makes over build_sq2.py):
  sqRing2 1: a second ring of 16 candidate spots at 12 m (33 in all; move cost 0.4 per m)
  sqRetLos 1: fight movement called from a retreat with no cover (sq1 doSqRetreat) always wants the shot line
Both only act while sqMove is on, which the sq12b gate turns on at 30 s outside a free-for-all; P_FFA resets them too.
usage: python3 sim/agentTalk/build_sq2c.py [src] [dst]   (exact-string replacements, each must match once)
"""
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "sim/variants/sq12b-stack.mjs"
DST = sys.argv[2] if len(sys.argv) > 2 else "sim/variants/sq12c-stack.mjs"
s = open(SRC).read()


def rep(old, new):
    global s
    n = s.count(old)
    assert n == 1, f"anchor found {n} times: {old[:80]!r}"
    s = s.replace(old, new)


rep("  sqMove: 0, sqAim: 0,\n", "  sqMove: 0, sqAim: 0, sqRing2: 0, sqRetLos: 0,\n")
lines = s.split("\n")
idx = [i for i, l in enumerate(lines) if '"sqMoveAt":30' in l and l.startswith("Object.assign(P,")]
assert len(idx) == 1, idx
lines.insert(idx[0] + 1, 'Object.assign(P, {"sqRing2":1,"sqRetLos":1}) // sq12c-stack: sq12b + sq2 v2 movement (second ring of spots at 12 m; a retreat with no cover fight-moves wanting the shot line)')
s = "\n".join(lines)
rep(
    "  sqHold: 3, // with sqMove: s the scorer keeps working on a target out of our sight (seen this recently): we may have stepped out on purpose, and the shot line is scored from where it was last seen; after that the old chase\n  sqAim: 0, // 1 = aim at 85% of the target's height when its centre is blocked from our muzzle\n",
    "  sqHold: 3, // with sqMove: s the scorer keeps working on a target out of our sight (seen this recently): we may have stepped out on purpose, and the shot line is scored from where it was last seen; after that the old chase\n  sqRing2: 0, // with sqMove: 1 = a second ring of 16 spots at 12 m (move cost 0.4 per m), so cover a little farther away is found\n  sqRetLos: 0, // with sqMove: 1 = fight movement called from a retreat (no cover found) always wants the shot line\n  sqAim: 0, // 1 = aim at 85% of the target's height when its centre is blocked from our muzzle\n",
)
rep(
    '    }\n    const want = this.sqWantLos(e, d)\n    // 5.4 strafe timer: 0.3-1.0 s, flip side with 60% on expiry\n',
    '    }\n    const want = P.sqRetLos > 0 && this.mode === "retreat" ? 1 : this.sqWantLos(e, d)\n    // 5.4 strafe timer: 0.3-1.0 s, flip side with 60% on expiry\n',
)
rep(
    '    }\n    const STEP = 6,\n      NR = 16\n    // scratch buffers kept on the instance (no garbage per tick)\n',
    '    }\n    const NR = 16,\n      NC = P.sqRing2 > 0 ? 2 * NR : NR\n    const ang = (k) => (((k - 1) % NR) * TAU) / NR,\n      stp = (k) => (k > NR ? 12 : 6)\n    // scratch buffers kept on the instance (no garbage per tick)\n',
)
rep(
    '    // scratch buffers kept on the instance (no garbage per tick)\n    const B = (this.sqBuf ??= { cx: new Float64Array(NR + 1), cy: new Float64Array(NR + 1), cz: new Float64Array(NR + 1), ok: new Uint8Array(NR + 1), sc: new Float64Array(NR + 1), exp: new Uint8Array(NR + 1), losAt: new Uint8Array(NR + 1) })\n    const { cx, cy, cz, ok, sc, exp, losAt } = B\n',
    '    // scratch buffers kept on the instance (no garbage per tick)\n    const B = (this.sqBuf ??= { cx: new Float64Array(2 * NR + 1), cy: new Float64Array(2 * NR + 1), cz: new Float64Array(2 * NR + 1), ok: new Uint8Array(2 * NR + 1), sc: new Float64Array(2 * NR + 1), exp: new Uint8Array(2 * NR + 1), losAt: new Uint8Array(2 * NR + 1) })\n    const { cx, cy, cz, ok, sc, exp, losAt } = B\n',
)
rep(
    '    ok[0] = 1\n    for (let k = 1; k <= NR; k++) {\n      const a = ((k - 1) * TAU) / NR\n      cx[k] = x + Math.cos(a) * STEP\n      cy[k] = y + Math.sin(a) * STEP\n      cz[k] = z\n',
    '    ok[0] = 1\n    for (let k = 1; k <= NC; k++) {\n      const a = ang(k)\n      cx[k] = x + Math.cos(a) * stp(k)\n      cy[k] = y + Math.sin(a) * stp(k)\n      if (k > NR && !ok[k - NR]) continue\n      cz[k] = z\n',
)
rep(
    '    let anyHidden = false\n    for (let k = 0; k <= NR; k++) {\n      if (!ok[k]) continue\n',
    '    let anyHidden = false\n    for (let k = 0; k <= NC; k++) {\n      if (!ok[k]) continue\n',
)
rep(
    '      let v = -1.1 * Math.abs(hyp(e.pos[0] - px, e.pos[1] - py) - pr)\n      if (k > 0) v -= 0.4 * STEP\n      const los = !w || w.los(px, py, pz + this.muzH, e.pos[0], e.pos[1], e.cz)\n',
    '      let v = -1.1 * Math.abs(hyp(e.pos[0] - px, e.pos[1] - py) - pr)\n      if (k > 0) v -= 0.4 * stp(k)\n      const los = !w || w.los(px, py, pz + this.muzH, e.pos[0], e.pos[1], e.cz)\n',
)
rep(
    '      if (k > 0 && want > 0) {\n        const a = ((k - 1) * TAU) / NR\n        v += 9 * (Math.cos(a) * sx + Math.sin(a) * sy)\n',
    '      if (k > 0 && want > 0) {\n        const a = ang(k)\n        v += 9 * (Math.cos(a) * sx + Math.sin(a) * sy)\n',
)
rep(
    '    let bk = 0\n    for (let k = 1; k <= NR; k++) if (sc[k] > sc[bk]) bk = k\n    const S = this.sqS\n',
    '    let bk = 0\n    for (let k = 1; k <= NC; k++) if (sc[k] > sc[bk]) bk = k\n    const S = this.sqS\n',
)
rep(
    '    this.path = null\n    let mv = bk === 0 ? [0, 0] : [Math.cos(((bk - 1) * TAU) / NR), Math.sin(((bk - 1) * TAU) / NR)]\n    // 5.5 sidestep: bullets about to pass within our radius + 1.1 m in the next 0.7 s, and lasers charging on us\n',
    '    this.path = null\n    let mv = bk === 0 ? [0, 0] : [Math.cos(ang(bk)), Math.sin(ang(bk))]\n    // 5.5 sidestep: bullets about to pass within our radius + 1.1 m in the next 0.7 s, and lasers charging on us\n',
)
rep(
    '        const fd = this.sqFreeDir(mv[0], mv[1])\n        mv = fd || (bk === 0 ? [0, 0] : [Math.cos(((bk - 1) * TAU) / NR), Math.sin(((bk - 1) * TAU) / NR)])\n      }\n',
    '        const fd = this.sqFreeDir(mv[0], mv[1])\n        mv = fd || (bk === 0 ? [0, 0] : [Math.cos(ang(bk)), Math.sin(ang(bk))])\n      }\n',
)
rep(
    '        const order = []\n        for (let k = 0; k <= NR; k++) if (ok[k]) order.push(k)\n        order.sort((a, b) => sc[b] - sc[a])\n',
    '        const order = []\n        for (let k = 0; k <= NC; k++) if (ok[k]) order.push(k)\n        order.sort((a, b) => sc[b] - sc[a])\n',
)
rep(
    '          const k = order[i]\n          const c = k === 0 ? [0, 0] : [Math.cos(((k - 1) * TAU) / NR), Math.sin(((k - 1) * TAU) / NR)]\n          const v = Math.min(this.missDist(c, k === 0 ? 0.01 : 0), need) * 10 + 0.25 * (sc[k] - sc[bk])\n',
    '          const k = order[i]\n          const c = k === 0 ? [0, 0] : [Math.cos(ang(k)), Math.sin(ang(k))]\n          const v = Math.min(this.missDist(c, k === 0 ? 0.01 : 0), need) * 10 + 0.25 * (sc[k] - sc[bk])\n',
)
# ---------------------------------------------------------------- P is module state: a new match (new Brain) starts with the rework off again
rep(
    "    this.weaveSide = 1\n",
    "    this.weaveSide = 1\n"
    "    if (P.sqMoveAt > 0) {\n"
    "      // sq12c: P outlives a match in a long-running process; the rework waits for sqMoveAt again\n"
    "      P.sqMove = 0\n"
    "      P.sqAim = 0\n"
    "    }\n",
)
open(DST, "w").write(s)
print("wrote", DST, len(s), "bytes")
