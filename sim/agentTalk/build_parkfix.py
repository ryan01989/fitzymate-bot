#!/usr/bin/env python3
"""parkfix: the loot-parking bug fix, live whenever P.fixLootReach > 0 (no new switch).
usage: python3 sim/agentTalk/build_parkfix.py src dst [tag]
In gb11 (and every build on it) the fixLootReach block sits inside `if (d < 1.2) { ... if (this.lootStuck > 15) {` (a bad merge),
so its `d >= 1.2` test never holds and it is dead code. When the path to a cube / kill spot (-7) ends 1.2-3 m short, the bot stood
with move [0,0] until doLoot's 30 s timeout (long pack seed 1303 on wv1: kill spot -7 at 1.7 m, 195-223 s).
This adds the same rule, live, right after the walk: a kill spot counts as reached (its cubes stay ordinary cube targets);
an item gets a straight step at it and is given up after P.fixLootReach s without progress.
Exact-string replacements, each asserted to match exactly once."""
import sys

src, dst = sys.argv[1], sys.argv[2]
tag = sys.argv[3] if len(sys.argv) > 3 else "parkfix"
s = open(src).read()
assert "parkfix:" not in s, "already applied"


def rep(old, new):
    global s
    n = s.count(old)
    assert n == 1, (n, old[:80])
    s = s.replace(old, new)


rep(
    "    if (!arrived && this.pathPartial && this.path && this.path.length < 5) fail()\n",
    "    if (!arrived && this.pathPartial && this.path && this.path.length < 5) fail()\n"
    "    if (P.fixLootReach > 0 && this.loot && d >= 1.2 && !this.jet && (arrived || hyp(A.move[0], A.move[1]) < 0.05)) {\n"
    "      // parkfix: the walk is over and the item is not ours (the fixLootReach block above is nested under d < 1.2 and never runs)\n"
    "      if (L.id === -7) {\n"
    "        // a spot, not an item: as near as the walk graph goes; the cubes lying there are ordinary cube targets for pickLoot()\n"
    "        this.killLoot = null\n"
    "        this.loot = null\n"
    "      } else {\n"
    "        if (this.pkReachId !== L.id || t - (this.pkReachSeenT ?? -99) > 1) {\n"
    "          this.pkReachId = L.id\n"
    "          this.pkReachT = t\n"
    "          this.pkReachD = d\n"
    "        }\n"
    "        this.pkReachSeenT = t\n"
    "        if (d < this.pkReachD - 0.3) {\n"
    "          this.pkReachD = d\n"
    "          this.pkReachT = t\n"
    "        }\n"
    "        if (t - this.pkReachT > P.fixLootReach) {\n"
    "          fail()\n"
    "          if (L.id <= -100) this.kcRun = null\n"
    "          this.pkReachId = null\n"
    "        } else if (Math.abs(L.pos[2] - z) < 2.5) {\n"
    "          const k = Math.min(1, Math.max(0.35, d / 3))\n"
    "          A.move = [((L.pos[0] - x) / d) * k, ((L.pos[1] - y) / d) * k]\n"
    "        }\n"
    "      }\n"
    "    }\n",
)

# settings comment line right after the dropAll line (no new switch; documents the build)
i = s.index('Object.assign(P, {"dropAll":1})')
j = s.index("\n", i) + 1
s = s[:j] + "// " + tag + ": + parkfix (sim/agentTalk/build_parkfix.py): the dead fixLootReach block made live after the loot walk\n" + s[j:]

open(dst, "w").write(s)
print("wrote", dst)
