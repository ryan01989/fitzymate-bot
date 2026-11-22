// Training loop for the practice score: race candidate builds against the current best in the local sim.
// Run from fitzymate-bot/:
//   node sim/train/train.mjs status
//   node sim/train/train.mjs eval  --file sim/variants/ctrl.mjs [--p '{"crowd":70}'] [--set train|held] [--n 48] [--packs all]
//   node sim/train/train.mjs calib [--packs '<json array>'] [--n 48]
//   node sim/train/train.mjs round --gen sweep|mutate|none [--k 16] [--ext name1,name2] [--keys a,b,c]
//   node sim/train/train.mjs bake  --name t01-foo [--file F] [--p '{...}']      (default: the current best)
//   node sim/train/train.mjs real  --name t01-foo --score 4.9                    (record a real practice score)
// A candidate is { file, p }: a bot file plus overrides for its exported P object (passed as FM_P).
// Every match result is cached by (file contents, p, pack, seed), so nothing is simulated twice.
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"
import { DEFAULTS, summarize, paired, fmt } from "./fitness.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "../..")
const EVAL = path.join(ROOT, "sim/eval.mjs")
const F = (n) => path.join(HERE, n)
const arg = (k, d) => {
  const i = process.argv.indexOf("--" + k)
  return i < 0 ? d : (process.argv[i + 1] ?? true)
}
const PAR = +arg("par", Math.max(1, os.cpus().length - 1))
const CHUNK = +arg("chunk", 4)
const cmd = process.argv[2]

// ------------------------------------------------------------------ seeds
// Training seeds are used to screen and rank; held-out seeds only for the final gate, so the winner's score is unbiased.
const TRAIN = Array.from({ length: 96 }, (_, i) => 1000 + i * 101)
const HELD = Array.from({ length: 96 }, (_, i) => 700001 + i * 101)

// ------------------------------------------------------------------ state
const readJ = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d)
const state = readJ(F("state.json"), {
  incumbent: { file: "sim/train/base.mjs", p: {} },
  packs: [{}], // {} = eval.mjs default ("cal2"). First entry is the screening pack.
  lambda: DEFAULTS.lambda,
  earlyT: DEFAULTS.earlyT,
  gate: 0.4,
  round: 0,
  archive: [], // every tested change: { round, file, delta, stage, n, dFit, se, dPts }
  promoted: [],
})
const saveState = () => fs.writeFileSync(F("state.json"), JSON.stringify(state, null, 1))
const opt = { lambda: +arg("lambda", state.lambda), earlyT: +arg("earlyT", state.earlyT) }
const logLine = (o) => fs.appendFileSync(F("log.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n")

// ------------------------------------------------------------------ cache
const canon = (o) => JSON.stringify(Object.keys(o || {}).sort().reduce((a, k) => ((a[k] = o[k]), a), {}))
const hashes = new Map()
const fileHash = (file) => {
  if (file === "starter") file = "sim/starter.mjs"
  if (!hashes.has(file)) hashes.set(file, crypto.createHash("sha1").update(fs.readFileSync(path.join(ROOT, file))).digest("hex").slice(0, 12))
  return hashes.get(file)
}
const ckey = (c, pack) => `${fileHash(c.file)}|${canon(c.p)}|${canon(pack)}`
const cache = new Map()
if (fs.existsSync(F("cache.jsonl")))
  for (const line of fs.readFileSync(F("cache.jsonl"), "utf8").split("\n")) {
    if (!line) continue
    try {
      const [k, r] = JSON.parse(line)
      cache.set(k, r)
    } catch {}
  }
const cacheOut = fs.openSync(F("cache.jsonl"), "a")

// ------------------------------------------------------------------ worker pool
/**
 * jobs: [{ cand:{file,p}, pack, seeds }]. Runs whatever is not cached, PAR processes at a time.
 * Returns, per job, a Map(seed -> result). A job whose worker crashed has job.failed set.
 */
async function runBatch(jobs, label = "") {
  const chunks = []
  for (const j of jobs) {
    j.key = ckey(j.cand, j.pack)
    const todo = j.seeds.filter((s) => !cache.has(j.key + "|" + s))
    for (let i = 0; i < todo.length; i += CHUNK) chunks.push({ j, seeds: todo.slice(i, i + CHUNK) })
  }
  const total = chunks.reduce((s, c) => s + c.seeds.length, 0)
  let done = 0
  const t0 = Date.now()
  if (total) process.stderr.write(`[${label}] ${total} matches to simulate (${jobs.reduce((s, j) => s + j.seeds.length, 0) - total} cached)\n`)
  // interleave so every job advances together
  chunks.sort((a, b) => a.seeds[0] - b.seeds[0])
  let next = 0
  const runOne = (c) =>
    new Promise((res) => {
      const args = ["--worker", "--seeds", JSON.stringify(c.seeds), "--brain", c.j.cand.file, "--mode", "practice", "--pack", JSON.stringify(c.j.pack), "--stop-on-death", "--frozen-clock"]
      const child = fork(EVAL, args, { cwd: ROOT, env: { ...process.env, FM_P: JSON.stringify(c.j.cand.p || {}), FM_NOSWITCH: "1" }, stdio: ["ignore", "ignore", "pipe", "ipc"] })
      let err = ""
      let got = 0
      child.stderr.on("data", (d) => (err = (err + d).slice(-600)))
      const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60e3)
      child.on("message", (r) => {
        got++
        done++
        const k = c.j.key + "|" + r.seed
        cache.set(k, r)
        fs.writeSync(cacheOut, JSON.stringify([k, r]) + "\n")
      })
      child.on("exit", (code) => {
        clearTimeout(timer)
        if (got < c.seeds.length) {
          c.j.failed = (c.j.failed || "") + `worker exit ${code}: ${err.trim().split("\n").slice(-2).join(" / ")}`
        } else if (err.includes("threw")) c.j.threw = err.trim().split("\n")[0]
        res()
      })
    })
  const lane = async () => {
    while (next < chunks.length) {
      const c = chunks[next++]
      await runOne(c)
      if (done && next % 8 === 0) process.stderr.write(`  ${done}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s\n`)
    }
  }
  await Promise.all(Array.from({ length: PAR }, lane))
  if (total) process.stderr.write(`[${label}] done ${done}/${total} in ${((Date.now() - t0) / 1000).toFixed(0)}s (${(((Date.now() - t0) / 1000) / Math.max(1, done)).toFixed(2)} s/match wall)\n`)
  for (const j of jobs) {
    j.res = new Map()
    for (const s of j.seeds) {
      const r = cache.get(j.key + "|" + s)
      if (r) j.res.set(s, r)
    }
  }
  return jobs
}

const sameCand = (a, b) => a.file === b.file && canon(a.p) === canon(b.p)
const label = (c) => c.name || `${path.basename(c.file, ".mjs")}${Object.keys(c.delta || {}).length ? " " + JSON.stringify(c.delta) : ""}`

// ------------------------------------------------------------------ search space
const space = readJ(F("space.json"), {})
/** read the P defaults of a bot file (in a child-free way: import it) */
const defaultsCache = new Map()
async function defaultsOf(file) {
  if (!defaultsCache.has(file)) {
    const saved = process.env.FM_P
    delete process.env.FM_P
    const m = await import(path.join(ROOT, file) + "?d=" + fileHash(file))
    if (saved !== undefined) process.env.FM_P = saved
    defaultsCache.set(file, { ...m.P })
  }
  return defaultsCache.get(file)
}
const round3 = (x) => Math.round(x * 1000) / 1000
/** value of key moved `steps` steps (negative = down); null when out of range or unchanged */
function moved(key, cur, steps) {
  const s = space[key]
  if (!s) return null
  if (s.type === "bool") return !cur
  if (s.values) {
    const i = s.values.indexOf(cur)
    const j = Math.max(0, Math.min(s.values.length - 1, (i < 0 ? 0 : i) + steps))
    return s.values[j] === cur ? null : s.values[j]
  }
  const v = round3(Math.max(s.lo, Math.min(s.hi, cur + steps * s.step)))
  return v === cur ? null : v
}
let rs = (Date.now() ^ 0x9e3779b9) >>> 0
const rnd = () => {
  rs = (rs + 0x6d2b79f5) | 0
  let t = Math.imul(rs ^ (rs >>> 15), 1 | rs)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

async function generate(gen, k, keysArg) {
  const inc = state.incumbent
  const cur = { ...(await defaultsOf(inc.file)), ...inc.p }
  const keys = (keysArg ? keysArg.split(",") : Object.keys(space)).filter((q) => q in cur && space[q])
  const out = []
  const add = (delta) => {
    if (!Object.keys(delta).length) return
    const c = { file: inc.file, p: { ...inc.p, ...delta }, delta }
    if (!out.some((o) => sameCand(o, c)) && !sameCand(c, inc)) out.push(c)
  }
  if (gen === "sweep") {
    for (const key of keys)
      for (const st of space[key].type === "bool" ? [1] : [-1, 1]) {
        const v = moved(key, cur[key], st)
        if (v !== null) add({ [key]: v })
      }
  } else if (gen === "mutate") {
    // single-parameter moves that looked good so far (best estimate per exact change)
    const best = new Map()
    for (const a of state.archive) {
      const ks = Object.keys(a.delta || {})
      if (ks.length !== 1 || a.file !== inc.file || cur[ks[0]] === a.delta[ks[0]]) continue
      const id = canon(a.delta)
      if (!best.has(id) || a.n > best.get(id).n) best.set(id, a)
    }
    const good = [...best.values()].filter((a) => a.dFit > 0).sort((a, b) => b.dFit / (b.se || 1) - a.dFit / (a.se || 1)).slice(0, 6)
    // combine pairs of good moves
    for (let i = 0; i < good.length && out.length < k / 2; i++)
      for (let j = i + 1; j < good.length && out.length < k / 2; j++) {
        const d = { ...good[i].delta, ...good[j].delta }
        if (Object.keys(d).length === 2) add(d)
      }
    // push the best moves one step further in the same direction
    for (const g of good.slice(0, 4)) {
      const key = Object.keys(g.delta)[0]
      if (space[key]?.type === "bool" || !space[key]) continue
      const dir = Math.sign(g.delta[key] - cur[key]) || 1
      const v = moved(key, g.delta[key], dir)
      if (v !== null) add({ [key]: v })
    }
    // random one- and two-parameter moves to keep exploring
    let guard = 0
    while (out.length < k && guard++ < 200) {
      const d = {}
      const nk = rnd() < 0.6 ? 1 : 2
      for (let q = 0; q < nk; q++) {
        const key = keys[Math.floor(rnd() * keys.length)]
        const v = moved(key, cur[key], (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.7 ? 1 : 2))
        if (v !== null) d[key] = v
      }
      add(d)
    }
  }
  return gen === "sweep" ? out : out.slice(0, k)
}

// ------------------------------------------------------------------ one round
async function round() {
  const gen = arg("gen", "mutate")
  const k = +arg("k", 16)
  const inc = state.incumbent
  const packs = state.packs
  const main = packs[0]
  const nA = +arg("nA", 16),
    nB = +arg("nB", 48),
    keepB = +arg("keepB", 5),
    keepC = +arg("keepC", 2),
    nC = +arg("nC", 96)
  state.round++
  const R = state.round
  let cands = gen === "none" ? [] : await generate(gen, k, arg("keys"))
  // external candidates: bot files written by agents, each with the flag values that switch their behaviour on
  const ext = readJ(F("cands.json"), [])
  for (const name of String(arg("ext", "")).split(",").filter(Boolean)) {
    const e = ext.find((q) => q.name === name)
    if (!e) throw new Error("no candidate named " + name + " in sim/train/cands.json")
    cands.push({ name: e.name, file: e.file, p: { ...inc.p, ...e.p }, delta: e.p, ext: true })
  }
  if (!cands.length) return console.log("no candidates")
  console.log(`round ${R}: ${cands.length} candidates vs ${label(inc)} ${canon(inc.p)}  (lambda ${opt.lambda}, early < ${opt.earlyT}s, gate +${state.gate})`)

  const stage = async (list, seeds, pks, name) => {
    const jobs = [{ cand: inc, pack: null, seeds, ref: true }, ...list.map((c) => ({ cand: c, seeds }))]
    const all = []
    for (const pk of pks) for (const j of jobs) all.push({ ...j, pack: pk })
    await runBatch(all, `r${R} ${name}`)
    for (const c of list) {
      const per = pks.map((pk) => {
        const ref = all.find((j) => j.ref && j.pack === pk)
        const mine = all.find((j) => j.cand === c && j.pack === pk)
        return { pack: pk, failed: mine.failed, threw: mine.threw, cmp: paired(mine.res, ref.res, opt), sum: summarize([...mine.res.values()], opt) }
      })
      // pool every (pack, seed) pair
      const ref = new Map(),
        mine = new Map()
      pks.forEach((pk, i) => {
        for (const j of all.filter((q) => q.pack === pk)) for (const [s, r] of j.res) (j.ref ? ref : j.cand === c ? mine : new Map()).set(i + ":" + s, r)
      })
      c[name] = { per, cmp: paired(mine, ref, opt), failed: per.map((q) => q.failed).filter(Boolean).join("; "), crashes: per.reduce((s, q) => s + q.sum.crashes, 0) }
      state.archive.push({ round: R, file: c.file, delta: c.delta, stage: name, n: c[name].cmp.n, dFit: round3(c[name].cmp.dFit), se: round3(c[name].cmp.se), dPts: round3(c[name].cmp.dPts), name: c.name })
    }
    const ok = list.filter((c) => !c[name].failed && !c[name].crashes && c[name].cmp.n >= seeds.length * pks.length * 0.9)
    ok.sort((a, b) => b[name].cmp.dFit - a[name].cmp.dFit)
    console.log(`  stage ${name} (${seeds.length} seeds x ${pks.length} pack${pks.length > 1 ? "s" : ""}):`)
    for (const c of [...ok, ...list.filter((c) => !ok.includes(c))]) {
      const m = c[name].cmp
      console.log(`    ${fmt(m.dFit).padStart(6)} ±${(m.se || 0).toFixed(2)}  pts ${fmt(m.dPts)}  n=${m.n}  ${label(c)}${c[name].failed ? "  FAILED: " + c[name].failed : ""}${c[name].crashes ? "  CRASHES: " + c[name].crashes : ""}`)
    }
    return ok
  }

  const a = await stage(cands, TRAIN.slice(0, nA), [main], "A")
  saveState()
  const toB = a.filter((c) => c.A.cmp.dFit > -0.25).slice(0, keepB)
  let passed = null
  if (toB.length) {
    const b = await stage(toB, TRAIN.slice(0, nB), [main], "B")
    saveState()
    const toC = b.filter((c) => c.B.cmp.dFit > 0).slice(0, keepC)
    if (toC.length) {
      const c3 = await stage(toC, HELD.slice(0, nC), packs, "C")
      for (const c of c3) {
        const m = c.C.cmp
        const worstPack = Math.min(...c.C.per.map((q) => q.cmp.dFit))
        c.gate = { gain: m.dFit >= state.gate, sure: m.lo > 0, pts: m.dPts >= 0, packs: worstPack > 0 }
        c.pass = Object.values(c.gate).every(Boolean)
        console.log(`  gate ${label(c)}: gain ${fmt(m.dFit)} (need +${state.gate}) ${c.gate.gain ? "ok" : "NO"} | lower bound ${fmt(m.lo)} ${c.gate.sure ? "ok" : "NO"} | raw pts ${fmt(m.dPts)} ${c.gate.pts ? "ok" : "NO"} | worst pack ${fmt(worstPack)} ${c.gate.packs ? "ok" : "NO"}  => ${c.pass ? "PASS" : "fail"}`)
      }
      passed = c3.find((c) => c.pass) || null
    } else console.log("  nothing beat the current best in stage B")
  } else console.log("  nothing survived stage A")
  if (passed) {
    state.promoted.push({ round: R, from: { ...inc }, to: { file: passed.file, p: passed.p }, name: label(passed), dFit: round3(passed.C.cmp.dFit), lo: round3(passed.C.cmp.lo), dPts: round3(passed.C.cmp.dPts) })
    state.incumbent = { file: passed.file, p: passed.p }
    console.log(`  NEW BEST: ${label(passed)}  ->  ${passed.file} ${canon(passed.p)}`)
  }
  logLine({ round: R, gen, incumbent: inc, cands: cands.map((c) => ({ name: label(c), file: c.file, delta: c.delta, A: c.A?.cmp, B: c.B?.cmp, C: c.C?.cmp, gate: c.gate, pass: c.pass })) })
  saveState()
  await board()
}

// ------------------------------------------------------------------ eval / status
async function evalCmd() {
  const cand = { file: arg("file", state.incumbent.file), p: JSON.parse(arg("p", arg("file") ? "{}" : JSON.stringify(state.incumbent.p))) }
  const seeds = (arg("set", "train") === "held" ? HELD : TRAIN).slice(0, +arg("n", 48))
  const packs = arg("packs") === "all" ? state.packs : [state.packs[0]]
  const jobs = []
  for (const pk of packs) jobs.push({ cand, pack: pk, seeds }, { cand: state.incumbent, pack: pk, seeds, ref: true })
  await runBatch(jobs, "eval")
  for (const pk of packs) {
    const mine = jobs.find((j) => !j.ref && j.pack === pk),
      ref = jobs.find((j) => j.ref && j.pack === pk)
    const s = summarize([...mine.res.values()], opt)
    const c = paired(mine.res, ref.res, opt)
    console.log(`${label(cand)} ${canon(cand.p)} pack ${canon(pk)}`)
    console.log(`  fitness ${s.fitness.toFixed(2)} ±${s.fitnessSe.toFixed(2)}  pts ${s.pts.toFixed(2)} ±${s.ptsSe.toFixed(2)}  early ${(s.early * 100).toFixed(0)}%  kills ${s.kills.toFixed(2)} (by 90s ${s.k90.toFixed(2)}, by 180s ${s.k180.toFixed(2)})  surv ${s.surv.toFixed(0)}s  crashes ${s.crashes}  n=${s.n}${mine.failed ? "  FAILED " + mine.failed : ""}`)
    if (!sameCand(cand, state.incumbent)) console.log(`  vs current best: fitness ${fmt(c.dFit)} ±${c.se.toFixed(2)} (lower bound ${fmt(c.lo)})  raw pts ${fmt(c.dPts)} ±${c.dPtsSe.toFixed(2)}  n=${c.n}`)
  }
}

async function board() {
  const inc = state.incumbent
  const L = []
  L.push(`# Training board`, ``, `Updated ${new Date().toLocaleString()} · round ${state.round} · reward = mean(16 − place) − ${state.lambda} × share dead before ${state.earlyT} s`, ``)
  L.push(`## Current best`, ``, `\`${inc.file}\` with \`${canon(inc.p)}\``, ``)
  L.push(`| Pack | Seeds | Fitness | Raw points | Dead < ${state.earlyT} s | Kills by 90 s | by 180 s | n |`, `|---|---|---|---|---|---|---|---|`)
  for (const pk of state.packs)
    for (const [nm, seeds] of [["train", TRAIN.slice(0, 48)], ["held-out", HELD]]) {
      const rsl = seeds.map((s) => cache.get(ckey(inc, pk) + "|" + s)).filter(Boolean)
      if (!rsl.length) continue
      const s = summarize(rsl, opt)
      L.push(`| \`${canon(pk)}\` | ${nm} | ${s.fitness.toFixed(2)} | ${s.pts.toFixed(2)} ±${s.ptsSe.toFixed(2)} | ${(s.early * 100).toFixed(0)}% | ${s.k90.toFixed(2)} | ${s.k180.toFixed(2)} | ${s.n} |`)
    }
  L.push(``, `## Promotions`, ``)
  if (!state.promoted.length) L.push(`None yet.`)
  else {
    L.push(`| Round | Change | Fitness gain (held-out) | Lower bound | Raw points |`, `|---|---|---|---|---|`)
    for (const p of state.promoted) L.push(`| ${p.round} | ${p.name} | ${fmt(p.dFit)} | ${fmt(p.lo)} | ${fmt(p.dPts)} |`)
  }
  const real = readJ(F("real.json"), [])
  L.push(``, `## Real practice scores`, ``, `| Build | Real | Sim predicted | Note |`, `|---|---|---|---|`)
  for (const r of real) L.push(`| ${r.name} | ${r.real ?? "pending"} | ${r.simPred ?? ""} | ${r.note ?? ""} |`)
  const last = state.archive.filter((a) => a.round === state.round)
  if (last.length) {
    L.push(``, `## Last round (${state.round})`, ``, `| Stage | Change | Fitness vs best | ± | Raw points | n |`, `|---|---|---|---|---|---|`)
    for (const a of last.sort((x, y) => (x.stage < y.stage ? 1 : x.stage > y.stage ? -1 : y.dFit - x.dFit)).slice(0, 40)) L.push(`| ${a.stage} | ${a.name || JSON.stringify(a.delta)} | ${fmt(a.dFit)} | ${a.se} | ${fmt(a.dPts)} | ${a.n} |`)
  }
  fs.writeFileSync(F("board.md"), L.join("\n") + "\n")
}

// ------------------------------------------------------------------ calibration of the simulated house bots
async function calib() {
  const only = arg("only") ? String(arg("only")).split(",") : null // --only v3-farm : fit the kill timeline first, cheaply
  const real = readJ(F("real.json"), []).filter((r) => r.calib && r.real != null && (!only || only.includes(r.name)))
  const packs = JSON.parse(arg("packs", "[{}]"))
  const seeds = TRAIN.slice(0, +arg("n", 48))
  const jobs = []
  for (const pk of packs) for (const r of real) jobs.push({ cand: { file: r.file, p: r.p || {} }, pack: pk, seeds, r })
  await runBatch(jobs, "calib")
  const out = []
  for (const pk of packs) {
    const rows = jobs.filter((j) => j.pack === pk).map((j) => ({ name: j.r.name, real: j.r.realMean ?? j.r.real, s: summarize([...j.res.values()], opt), failed: j.failed }))
    const off = rows.reduce((s, r) => s + (r.s.pts - r.real), 0) / rows.length
    const rmse = Math.sqrt(rows.reduce((s, r) => s + (r.s.pts - r.real) ** 2, 0) / rows.length)
    const rmse0 = Math.sqrt(rows.reduce((s, r) => s + (r.s.pts - r.real - off) ** 2, 0) / rows.length)
    // pairs of builds the sim orders the same way as reality (real gap >= 0.25 only)
    let agree = 0,
      pairs = 0
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) {
        if (Math.abs(rows[i].real - rows[j].real) < 0.25) continue
        pairs++
        if (Math.sign(rows[i].s.pts - rows[j].s.pts) === Math.sign(rows[i].real - rows[j].real)) agree++
      }
    const base = rows.find((r) => r.name === "v3-farm")
    const tl = base ? { k90: base.s.k90, k180: base.s.k180, kEnd: base.s.kills, surv: base.s.surv, early: base.s.early } : null
    // real kill timeline of v3-farm from the idle probes: 1.58 by 90 s, 3.58 by 180 s, 4.58 at the end
    const tlErr = tl ? Math.sqrt(((tl.k90 - 1.58) ** 2 + (tl.k180 - 3.58) ** 2 + (tl.kEnd - 4.58) ** 2) / 3) : NaN
    // DELTA ERROR: how well the sim predicts the real change between builds that differ by one decision.
    // This is what the trainer relies on (it compares candidates, never absolute scores).
    const DELTAS = [["v2", "v3-farm"], ["v3-farm", "farm-all"], ["v3-farm", "v5-peek"], ["v3-farm", "t01-laser-first"], ["t01-laser-first", "t02-one-front"], ["t01-laser-first", "t04-no-retreat"], ["t01-laser-first", "t05-drop-heal"], ["t04-no-retreat", "t08-nr-cubes"]]
    const dl = []
    for (const [a, b] of DELTAS) {
      const A = rows.find((r) => r.name === a),
        B = rows.find((r) => r.name === b)
      if (A && B) dl.push({ pair: `${a}->${b}`, real: B.real - A.real, sim: B.s.pts - A.s.pts })
    }
    const deltaErr = dl.length ? Math.sqrt(dl.reduce((s, d) => s + (d.sim - d.real) ** 2, 0) / dl.length) : NaN
    const signOk = dl.filter((d) => Math.abs(d.real) >= 0.15 && Math.sign(d.sim) === Math.sign(d.real)).length
    const signN = dl.filter((d) => Math.abs(d.real) >= 0.15).length
    out.push({ pack: pk, off, rmse, rmse0, agree, pairs, tl, tlErr, deltaErr, signOk, signN, dl, rows })
    console.log(`pack ${canon(pk)}`)
    if (dl.length) console.log(`  DELTA ERROR ${deltaErr.toFixed(2)}  (sign right ${signOk}/${signN} where |real| >= 0.15)  ` + dl.map((d) => `${d.pair} real ${fmt(d.real)} sim ${fmt(d.sim)}`).join(" | "))
    console.log(`  rmse ${rmse.toFixed(2)}  offset ${fmt(off)}  rmse after offset ${rmse0.toFixed(2)}  order agrees ${agree}/${pairs}  timeline err ${tlErr.toFixed(2)}`)
    if (tl) console.log(`  v3-farm kills by 90s ${tl.k90.toFixed(2)} (real 1.58)  by 180s ${tl.k180.toFixed(2)} (real 3.58)  end ${tl.kEnd.toFixed(2)} (real 4.58)  surv ${tl.surv.toFixed(0)}s  dead<${opt.earlyT}s ${(tl.early * 100).toFixed(0)}%`)
    console.log("  " + rows.map((r) => `${r.name} ${r.s.pts.toFixed(2)}/${r.real}${r.failed ? "(FAILED)" : ""}`).join("  "))
  }
  fs.writeFileSync(F("calib.json"), JSON.stringify(out.map((o) => ({ ...o, rows: o.rows.map((r) => ({ name: r.name, real: r.real, sim: round3(r.s.pts) })) })), null, 1))
}

// ------------------------------------------------------------------ bake a standalone build
function bake() {
  const name = arg("name")
  if (!name) throw new Error("--name required")
  const file = arg("file", state.incumbent.file)
  const p = JSON.parse(arg("p", arg("file") ? "{}" : JSON.stringify(state.incumbent.p)))
  let src = fs.readFileSync(path.join(ROOT, file), "utf8")
  const marker = 'if (typeof process !== "undefined" && process.env && process.env.FM_P)'
  const i = src.indexOf(marker)
  if (i < 0) throw new Error("FM_P line not found in " + file)
  const line = `Object.assign(P, ${JSON.stringify(p)}) // baked by sim/train/train.mjs from ${file}\n`
  if (Object.keys(p).length) src = src.slice(0, i) + line + src.slice(i)
  const out = path.join(ROOT, "sim/variants", name + ".mjs")
  fs.writeFileSync(out, src)
  console.log(`wrote sim/variants/${name}.mjs  (${file} + ${JSON.stringify(p)})`)
}

function realCmd() {
  const real = readJ(F("real.json"), [])
  const name = arg("name")
  let r = real.find((q) => q.name === name)
  if (!r) real.push((r = { name }))
  if (arg("score") !== undefined) r.real = +arg("score")
  if (arg("file")) r.file = arg("file")
  if (arg("p")) r.p = JSON.parse(arg("p"))
  if (arg("pred") !== undefined) r.simPred = arg("pred")
  if (arg("note")) r.note = arg("note")
  r.when = new Date().toISOString()
  fs.writeFileSync(F("real.json"), JSON.stringify(real, null, 1))
  console.log(JSON.stringify(r))
}

if (cmd === "round") await round()
else if (cmd === "eval") await evalCmd()
else if (cmd === "calib") await calib()
else if (cmd === "bake") bake()
else if (cmd === "real") realCmd()
else if (cmd === "status") {
  await board()
  console.log(fs.readFileSync(F("board.md"), "utf8"))
} else console.log("commands: status | eval | calib | round | bake | real   (see the header of this file)")
fs.closeSync(cacheOut)
