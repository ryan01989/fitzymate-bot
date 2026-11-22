// Reward and paired statistics for the training loop.
//   fitness = mean(16 - place) - lambda * (share of matches where we die before earlyT seconds)
// Raw points (what the leaderboard scores) are always reported next to it.

export const DEFAULTS = { lambda: 2, earlyT: 90 }

/** did our mech die before earlyT in this match result? */
export const isEarly = (r, earlyT) => r.killedBy !== "survived" && r.surv < earlyT

/** per-match fitness value */
export const matchFitness = (r, { lambda, earlyT }) => r.pts - (isEarly(r, earlyT) ? lambda : 0)

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN)
const sem = (a) => {
  if (a.length < 2) return NaN
  const m = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) / a.length)
}

/** summary of one build's results (array of per-match records from eval.mjs) */
export function summarize(rs, opt = DEFAULTS) {
  const f = rs.map((r) => matchFitness(r, opt))
  const pts = rs.map((r) => r.pts)
  return {
    n: rs.length,
    fitness: mean(f),
    fitnessSe: sem(f),
    pts: mean(pts),
    ptsSe: sem(pts),
    early: mean(rs.map((r) => (isEarly(r, opt.earlyT) ? 1 : 0))),
    kills: mean(rs.map((r) => r.kills)),
    surv: mean(rs.map((r) => r.surv)),
    k90: mean(rs.map((r) => (r.killTs || []).filter((t) => t < 90).length)),
    k180: mean(rs.map((r) => (r.killTs || []).filter((t) => t < 180).length)),
    crashes: rs.reduce((s, r) => s + (r.crashes || 0), 0),
    maxMs: Math.max(0, ...rs.map((r) => r.maxMs || 0)),
  }
}

/**
 * Paired comparison of a candidate against the reference on the same seeds.
 * a, b: Map(seed -> result). Only seeds present in both are used.
 * Returns the mean difference (candidate - reference) in fitness and in raw points, with standard errors.
 */
export function paired(cand, ref, opt = DEFAULTS) {
  const df = [],
    dp = []
  for (const [seed, rc] of cand) {
    const rr = ref.get(seed)
    if (!rr) continue
    df.push(matchFitness(rc, opt) - matchFitness(rr, opt))
    dp.push(rc.pts - rr.pts)
  }
  const d = mean(df),
    se = sem(df)
  return { n: df.length, dFit: d, se, lo: d - 1.645 * se, dPts: mean(dp), dPtsSe: sem(dp) }
}

export const fmt = (x, d = 2) => (Number.isFinite(x) ? (x >= 0 ? "+" : "") + x.toFixed(d) : "n/a")
