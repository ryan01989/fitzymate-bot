// Static world model: terrain + prisms rasterized to a 1 m grid, ray casts, and a
// two-layer 2 m navigation graph (ground + roofs/bridge decks) with jet/drop links.
import fs from "node:fs"
import path from "node:path"

const EMPTY_LO = 1e9
const EMPTY_HI = -1e9
const NS = 2 // nav cell size in raster cells (meters)
const DX8 = [1, 1, 0, -1, -1, -1, 0, 1]
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1]
const now = () => performance.now()

export class World {
  constructor(dir) {
    const wj = JSON.parse(fs.readFileSync(path.join(dir, "v2/world.json"), "utf8"))
    const T = wj.terrain
    const W = (this.W = T.nx)
    const H = (this.H = T.ny)
    this.minX = T.minX
    this.minY = T.minY
    const scale = T.scale || 0.01
    const buf = fs.readFileSync(path.join(dir, "v2", T.file || "terrain.i16"))
    const terr = (this.terr = new Float32Array(W * H))
    for (let i = 0; i < W * H; i++) terr[i] = buf.readInt16LE(i * 2) * scale
    const b = wj.bounds || {}
    this.bMinX = b.minX ?? this.minX
    this.bMaxX = b.maxX ?? this.minX + W - 1
    this.bMinY = b.minY ?? this.minY
    this.bMaxY = b.maxY ?? this.minY + H - 1
    this.lo1 = new Float32Array(W * H).fill(EMPTY_LO)
    this.hi1 = new Float32Array(W * H).fill(EMPTY_HI)
    this.lo2 = new Float32Array(W * H).fill(EMPTY_LO)
    this.hi2 = new Float32Array(W * H).fill(EMPTY_HI)
    for (const p of wj.prisms || []) this._raster(p)
    this._buildNav()
  }

  // ---------------------------------------------------------------- raster
  _raster(p) {
    const { W, H, minX, minY } = this
    const rings = [p.ring, ...(p.holes || [])]
    let y0 = Infinity,
      y1 = -Infinity
    for (let i = 1; i < p.ring.length; i += 2) {
      if (p.ring[i] < y0) y0 = p.ring[i]
      if (p.ring[i] > y1) y1 = p.ring[i]
    }
    const j0 = Math.max(0, Math.ceil(y0 - minY)),
      j1 = Math.min(H - 1, Math.floor(y1 - minY))
    const xs = []
    for (let j = j0; j <= j1; j++) {
      const y = minY + j + 1e-4
      xs.length = 0
      for (const r of rings) {
        const n = r.length >> 1
        for (let k = 0; k < n; k++) {
          const ax = r[2 * k],
            ay = r[2 * k + 1]
          const m = (k + 1) % n
          const bx = r[2 * m],
            by = r[2 * m + 1]
          if (ay <= y !== by <= y) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax))
        }
      }
      xs.sort((a, b) => a - b)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil(xs[k] - minX)),
          i1 = Math.min(W - 1, Math.floor(xs[k + 1] - minX))
        for (let i = i0; i <= i1; i++) this._addInterval(j * W + i, p.base, p.top)
      }
    }
  }

  _addInterval(c, b, t) {
    const { lo1, hi1, lo2, hi2, terr } = this
    if (t <= terr[c] + 0.05) return
    if (b <= terr[c] + 1.5) b = -1e6 // rests on the ground: solid from below
    const ov = (lo, hi) => b <= hi + 0.3 && t >= lo - 0.3
    if (hi1[c] === EMPTY_HI) {
      lo1[c] = b
      hi1[c] = t
    } else if (ov(lo1[c], hi1[c])) {
      lo1[c] = Math.min(lo1[c], b)
      hi1[c] = Math.max(hi1[c], t)
    } else if (hi2[c] === EMPTY_HI) {
      lo2[c] = b
      hi2[c] = t
    } else {
      lo2[c] = Math.min(lo2[c], b)
      hi2[c] = Math.max(hi2[c], t)
    }
    if (hi2[c] !== EMPTY_HI) {
      if (lo2[c] <= hi1[c] + 0.3 && hi2[c] >= lo1[c] - 0.3) {
        lo1[c] = Math.min(lo1[c], lo2[c])
        hi1[c] = Math.max(hi1[c], hi2[c])
        lo2[c] = EMPTY_LO
        hi2[c] = EMPTY_HI
      } else if (lo2[c] < lo1[c]) {
        const a = lo1[c],
          d = hi1[c]
        lo1[c] = lo2[c]
        hi1[c] = hi2[c]
        lo2[c] = a
        hi2[c] = d
      }
    }
  }

  // ---------------------------------------------------------------- queries
  cell(x, y) {
    let i = Math.round(x - this.minX),
      j = Math.round(y - this.minY)
    if (i < 0) i = 0
    else if (i >= this.W) i = this.W - 1
    if (j < 0) j = 0
    else if (j >= this.H) j = this.H - 1
    return j * this.W + i
  }
  inBounds(x, y) {
    return x > this.bMinX && x < this.bMaxX && y > this.bMinY && y < this.bMaxY
  }
  /** bilinear terrain height */
  ground(x, y) {
    const { W, H, terr } = this
    let fx = x - this.minX,
      fy = y - this.minY
    if (fx < 0) fx = 0
    else if (fx > W - 1.001) fx = W - 1.001
    if (fy < 0) fy = 0
    else if (fy > H - 1.001) fy = H - 1.001
    const i = fx | 0,
      j = fy | 0,
      u = fx - i,
      v = fy - j,
      c = j * W + i
    return (terr[c] * (1 - u) + terr[c + 1] * u) * (1 - v) + (terr[c + W] * (1 - u) + terr[c + W + 1] * u) * v
  }
  /** is the point inside a prism or under the terrain */
  solid(x, y, z) {
    const c = this.cell(x, y)
    if (z < this.terr[c] - 0.25) return true
    return (z > this.lo1[c] && z < this.hi1[c]) || (z > this.lo2[c] && z < this.hi2[c])
  }
  /** is any prism occupying [z0,z1] in this column */
  blockedColumn(x, y, z0, z1) {
    const c = this.cell(x, y)
    return (this.lo1[c] < z1 && this.hi1[c] > z0) || (this.lo2[c] < z1 && this.hi2[c] > z0)
  }
  /** highest standable surface not above z+step at (x,y) */
  standZ(x, y, z, step = 1.2) {
    const c = this.cell(x, y)
    let s = this.ground(x, y)
    const lim = z + step
    if (this.hi1[c] > s && this.hi1[c] <= lim) s = this.hi1[c]
    if (this.hi2[c] > s && this.hi2[c] <= lim) s = this.hi2[c]
    return s
  }
  /** top of everything at (x,y) */
  topZ(x, y) {
    const c = this.cell(x, y)
    return Math.max(this.ground(x, y), this.hi1[c], this.hi2[c])
  }
  /**
   * March a segment; returns the fraction (0..1) where it first hits a solid, or 1 if clear.
   * `skip` meters at the start are ignored (a muzzle can sit next to a wall).
   */
  ray(ax, ay, az, bx, by, bz, skip = 0) {
    const dx = bx - ax,
      dy = by - ay,
      dz = bz - az
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-6) return 1
    const { W, H, minX, minY, terr, lo1, hi1, lo2, hi2 } = this
    const n = Math.ceil(len / 0.9)
    const inv = 1 / n
    let k = skip > 0 ? Math.ceil((skip / len) * n) : 0
    for (; k <= n; k++) {
      const t = k * inv
      const x = ax + dx * t,
        y = ay + dy * t,
        z = az + dz * t
      let i = Math.round(x - minX),
        j = Math.round(y - minY)
      if (i < 0 || j < 0 || i >= W || j >= H) return t
      const c = j * W + i
      if (z < terr[c] - 0.3 || (z > lo1[c] && z < hi1[c]) || (z > lo2[c] && z < hi2[c])) return t
    }
    return 1
  }
  los(ax, ay, az, bx, by, bz) {
    return this.ray(ax, ay, az, bx, by, bz, 0) >= 1
  }

  // ---------------------------------------------------------------- nav graph
  _buildNav() {
    const { W, H, terr, lo1, hi1, lo2, hi2 } = this
    const NX = (this.NX = ((W - 1) / NS + 1) | 0)
    const NY = (this.NY = ((H - 1) / NS + 1) | 0)
    const NC = (this.NC = NX * NY)
    const surf = (this.surf = new Float32Array(2 * NC).fill(NaN))
    const clr = (this.clr = new Float32Array(2 * NC))
    const wd = (this.wd = new Float32Array(2 * NC))
    const isT = (this.isT = new Uint8Array(2 * NC))
    // surfaces
    for (let J = 0; J < NY; J++)
      for (let I = 0; I < NX; I++) {
        const c = J * NS * W + I * NS
        const n = J * NX + I
        const t = terr[c]
        const cand = []
        const inside = (z) => (lo1[c] < z && hi1[c] > z) || (lo2[c] < z && hi2[c] > z)
        if (!inside(t + 0.6)) cand.push([t, 1])
        if (hi1[c] > t + 0.3 && !inside(hi1[c] + 0.1)) cand.push([hi1[c], 0])
        if (hi2[c] > t + 0.3 && !inside(hi2[c] + 0.1)) cand.push([hi2[c], 0])
        cand.sort((a, b) => a[0] - b[0])
        const pick = cand.length > 2 ? [cand[0], cand[cand.length - 1]] : cand
        for (let L = 0; L < pick.length; L++) {
          const s = pick[L][0]
          let cl = 1e3
          if (lo1[c] >= s - 0.1 && lo1[c] < EMPTY_LO) cl = Math.min(cl, lo1[c] - s)
          if (lo2[c] >= s - 0.1 && lo2[c] < EMPTY_LO) cl = Math.min(cl, lo2[c] - s)
          surf[L * NC + n] = s
          clr[L * NC + n] = cl
          isT[L * NC + n] = pick[L][1]
        }
      }
    // wall distance: nearest raster cell with a prism between feet+1.25 and head
    const R = 7
    const offs = []
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) offs.push([Math.hypot(dx, dy), dx, dy])
    offs.sort((a, b) => a[0] - b[0])
    const od = Float32Array.from(offs.map((o) => Math.max(0, o[0] - 0.5))),
      ox = Int8Array.from(offs.map((o) => o[1])),
      oy = Int8Array.from(offs.map((o) => o[2]))
    const BW = (W >> 3) + 2,
      BH = (H >> 3) + 2
    const occ = new Uint8Array(BW * BH)
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (hi1[j * W + i] !== EMPTY_HI) occ[(j >> 3) * BW + (i >> 3)] = 1
    const MECH_H = 8.5
    for (let L = 0; L < 2; L++)
      for (let J = 0; J < NY; J++)
        for (let I = 0; I < NX; I++) {
          const n = L * NC + J * NX + I
          const s = surf[n]
          if (s !== s) continue
          const ci = I * NS,
            cj = J * NS
          const ex = this.minX + ci,
            ey = this.minY + cj
          let d = Math.min(R, ex - this.bMinX, this.bMaxX - ex, ey - this.bMinY, this.bMaxY - ey)
          const bi = ci >> 3,
            bj = cj >> 3
          let any = 0
          for (let a = -1; a <= 1 && !any; a++)
            for (let bb = -1; bb <= 1; bb++) {
              const qi = bi + bb,
                qj = bj + a
              if (qi >= 0 && qj >= 0 && qi < BW && qj < BH && occ[qj * BW + qi]) {
                any = 1
                break
              }
            }
          if (any) {
            const z0 = s + 1.25,
              z1 = s + MECH_H
            for (let k = 0; k < od.length; k++) {
              if (od[k] >= d) break
              const i = ci + ox[k],
                j = cj + oy[k]
              if (i < 0 || j < 0 || i >= W || j >= H) continue
              const c = j * W + i
              if ((lo1[c] < z1 && hi1[c] > z0) || (lo2[c] < z1 && hi2[c] > z0)) {
                d = od[k]
                break
              }
            }
          }
          // raised surfaces (roofs, bridge decks): keep away from the drop at their edge as well
          if (!isT[n] && d > 0) {
            const lim = s + 1.2
            for (let k = 0; k < od.length; k++) {
              const e = od[k] + 1.4
              if (e >= d) break
              const i = ci + ox[k],
                j = cj + oy[k]
              if (i < 0 || j < 0 || i >= W || j >= H) continue
              const c = j * W + i
              let top = terr[c]
              if (hi1[c] > top && hi1[c] <= lim) top = hi1[c]
              if (hi2[c] > top && hi2[c] <= lim) top = hi2[c]
              if (top < s - 1.5) {
                d = e
                break
              }
            }
          }
          wd[n] = d < 0 ? 0 : d
        }
    this._buildLinks()
    // search scratch
    const N2 = 2 * NC
    this.gS = new Float32Array(N2)
    this.fS = new Float32Array(N2)
    this.par = new Int32Array(N2)
    this.stamp = new Uint32Array(N2)
    this.closed = new Uint32Array(N2)
    this.gen = 1
    this.heap = new Int32Array(1 << 20)
    this.visited = new Int32Array(N2)
    this.nVisited = 0
    this.banned = new Map() // link index -> expiry time
  }

  nodeX(n) {
    return this.minX + ((n % this.NC) % this.NX) * NS
  }
  nodeY(n) {
    return this.minY + (((n % this.NC) / this.NX) | 0) * NS
  }
  nodeZ(n) {
    return this.surf[n]
  }

  /** can the terrain between two adjacent nav cells be walked up (slope rule) */
  _slopeOk(I, J, dx, dy) {
    const { W, terr } = this
    const c0 = J * NS * W + I * NS
    const c1 = c0 + dy * W + dx
    const c2 = c1 + dy * W + dx
    const lim = dx !== 0 && dy !== 0 ? 1.55 : 1.1
    return terr[c1] - terr[c0] <= lim && terr[c2] - terr[c1] <= lim
  }

  _buildLinks() {
    const { NX, NY, NC, surf, clr, wd } = this
    const from = [],
      to = [],
      rise = [],
      cost = []
    const MINWD = 3.0
    for (let L = 0; L < 2; L++)
      for (let J = 2; J < NY - 2; J++)
        for (let I = 2; I < NX - 2; I++) {
          const g = L * NC + J * NX + I
          const sg = surf[g]
          if (sg !== sg || wd[g] < MINWD || wd[g] > 6.5) continue
          for (let d = 0; d < 8; d++) {
            const dx = DX8[d],
              dy = DY8[d]
            let found = -1
            for (let k = 2; k <= 4 && found < 0; k++) {
              const i = I + dx * k,
                j = J + dy * k
              if (i < 1 || j < 1 || i >= NX - 1 || j >= NY - 1) break
              for (let L2 = 0; L2 < 2; L2++) {
                const r = L2 * NC + j * NX + i
                const sr = surf[r]
                if (sr !== sr || sr - sg < 1.5 || wd[r] < MINWD || clr[r] < 10) continue
                // nothing taller than the roof between, and open sky above the launch cell
                let ok = clr[g] >= sr - sg + 11
                for (let q = 1; q < k && ok; q++) {
                  const c = (J + dy * q) * NS * this.W + (I + dx * q) * NS
                  const top = Math.max(this.terr[c], this.hi1[c], this.hi2[c])
                  if (top > sr + 0.4) ok = false
                }
                if (!ok) continue
                found = r
                break
              }
            }
            if (found < 0) continue
            const h = surf[found] - sg
            const dist = Math.hypot(this.nodeX(found) - this.nodeX(g), this.nodeY(found) - this.nodeY(g))
            // drop link (roof -> ground)
            from.push(found)
            to.push(g)
            rise.push(-h)
            cost.push(dist + 4 + Math.sqrt(h) * 2)
            if (h <= 56) {
              from.push(g)
              to.push(found)
              rise.push(h)
              cost.push(dist + h * 1.4 + 25)
            }
          }
        }
    const M = from.length
    const order = Array.from({ length: M }, (_, i) => i).sort((a, b) => from[a] - from[b])
    this.lkStart = new Int32Array(2 * NC + 1)
    this.lkTo = new Int32Array(M)
    this.lkRise = new Float32Array(M)
    this.lkCost = new Float32Array(M)
    for (let k = 0; k < M; k++) {
      const e = order[k]
      this.lkTo[k] = to[e]
      this.lkRise[k] = rise[e]
      this.lkCost[k] = cost[e]
      this.lkStart[from[e] + 1]++
    }
    for (let n = 0; n < 2 * NC; n++) this.lkStart[n + 1] += this.lkStart[n]
    this.nLinks = M
  }

  /** nearest node a mech of this size can stand on, close to (x,y,z). -1 if none. */
  nearestNode(x, y, z, reqR = 3, myH = 9, maxCells = 14) {
    const { NX, NY, NC, surf, wd, clr } = this
    const I0 = Math.round((x - this.minX) / NS),
      J0 = Math.round((y - this.minY) / NS)
    let best = -1,
      bestD = 1e18
    for (let r = 0; r <= maxCells; r++) {
      if (best >= 0 && (r - 1) * NS > Math.sqrt(bestD)) break
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
          const I = I0 + di,
            J = J0 + dj
          if (I < 0 || J < 0 || I >= NX || J >= NY) continue
          for (let L = 0; L < 2; L++) {
            const n = L * NC + J * NX + I
            const s = surf[n]
            if (s !== s || wd[n] < reqR || clr[n] < myH) continue
            const dzv = s - z
            // surfaces above us are unreachable without a jet; below us we can drop
            const pz = dzv > 1.5 ? 40 + dzv * 3 : dzv < -1.5 ? 2 + -dzv * 0.3 : 0
            const ddx = this.minX + I * NS - x,
              ddy = this.minY + J * NS - y
            const d = ddx * ddx + ddy * ddy + pz * pz
            if (d < bestD) {
              bestD = d
              best = n
            }
          }
        }
    }
    return best
  }

  /** node at exactly this cell whose surface is near z, or -1 */
  nodeAt(x, y, z, tol = 2.5) {
    const I = Math.round((x - this.minX) / NS),
      J = Math.round((y - this.minY) / NS)
    if (I < 0 || J < 0 || I >= this.NX || J >= this.NY) return -1
    let best = -1,
      bd = tol
    for (let L = 0; L < 2; L++) {
      const n = L * this.NC + J * this.NX + I
      const s = this.surf[n]
      if (s !== s) continue
      const d = Math.abs(s - z)
      if (d <= bd) {
        bd = d
        best = n
      }
    }
    return best
  }

  /**
   * A* (goal >= 0) or bounded Dijkstra (goal < 0). Costs are meters.
   * o: { reqR, myH, maxEnergy, allowJet, maxCost, maxExp, pens:[x,y,r,w,...], zone:[cx,cy,r,w], deadline, tNow }
   * Returns the path as node ids (start..goal) or null. After a Dijkstra, use this.visited / this.gS / pathTo().
   */
  search(start, goal, o = {}) {
    const { NX, NY, NC, surf, wd, clr, isT, gS, fS, par, stamp, closed, heap, lkStart, lkTo, lkRise, lkCost } = this
    const reqR = o.reqR ?? 3,
      myH = o.myH ?? 9
    const maxCost = o.maxCost ?? 1e9,
      maxExp = o.maxExp ?? 250000
    const pens = o.pens || null,
      zone = o.zone || null
    const jetBudget = o.allowJet === false ? -1 : ((o.maxEnergy ?? 100) - 18) / 1.5
    const jetExtra = o.jetExtra ?? 60
    const deadline = o.deadline ?? Infinity
    const hw = o.hw ?? 1.6
    let bestH = 1e18,
      bestN = start
    this.partial = false
    const gen = ++this.gen
    this.nVisited = 0
    if (start < 0) return null
    const gx = goal >= 0 ? this.nodeX(goal) : 0,
      gy = goal >= 0 ? this.nodeY(goal) : 0
    let hn = 0
    const push = (n, f) => {
      let i = hn++
      if (hn >= heap.length) {
        hn--
        return
      }
      fS[n] = f
      while (i > 0) {
        const p = (i - 1) >> 1
        if (fS[heap[p]] <= f) break
        heap[i] = heap[p]
        i = p
      }
      heap[i] = n
    }
    const pop = () => {
      const top = heap[0]
      const last = heap[--hn]
      if (hn > 0) {
        const f = fS[last]
        let i = 0
        for (;;) {
          let c = 2 * i + 1
          if (c >= hn) break
          if (c + 1 < hn && fS[heap[c + 1]] < fS[heap[c]]) c++
          if (fS[heap[c]] >= f) break
          heap[i] = heap[c]
          i = c
        }
        heap[i] = last
      }
      return top
    }
    stamp[start] = gen
    gS[start] = 0
    par[start] = -1
    push(start, goal >= 0 ? hw * Math.hypot(this.nodeX(start) - gx, this.nodeY(start) - gy) : 0)
    let exp = 0
    let found = false
    while (hn > 0) {
      const n = pop()
      if (closed[n] === gen) continue
      closed[n] = gen
      this.visited[this.nVisited++] = n
      if (n === goal) {
        found = true
        break
      }
      const g = gS[n]
      if (goal >= 0) {
        const hh = fS[n] - g
        if (hh < bestH) {
          bestH = hh
          bestN = n
        }
      }
      if (++exp > maxExp) break
      if ((exp & 511) === 0 && now() > deadline) break
      const L = n >= NC ? 1 : 0
      const cidx = n - L * NC
      const I = cidx % NX,
        J = (cidx / NX) | 0
      const s = surf[n]
      const sT = isT[n]
      for (let d = 0; d < 8; d++) {
        const i = I + DX8[d],
          j = J + DY8[d]
        if (i < 0 || j < 0 || i >= NX || j >= NY) continue
        const base = j * NX + i
        for (let L2 = 0; L2 < 2; L2++) {
          const m = L2 * NC + base
          const s2 = surf[m]
          if (s2 !== s2) continue
          if (closed[m] === gen) continue
          if (wd[m] < reqR || clr[m] < myH) continue
          const dz = s2 - s
          if (dz > 0) {
            if (sT && isT[m]) {
              if (dz > 2.4 || !this._slopeOk(I, J, DX8[d], DY8[d])) continue
            } else if (dz > 1.1) continue
          } else if (dz < -3.5) continue
          let step = d & 1 ? 2.8284 : 2
          let mult = 1
          if (wd[m] < reqR + 1.2) mult += 0.25
          if (dz < -1.3) step += 1.5
          const x = this.minX + i * NS,
            y = this.minY + j * NS
          if (pens)
            for (let k = 0; k < pens.length; k += 4) {
              const ddx = x - pens[k],
                ddy = y - pens[k + 1],
                r = pens[k + 2]
              const q = ddx * ddx + ddy * ddy
              if (q < r * r) mult += pens[k + 3] * (1 - Math.sqrt(q) / r)
            }
          if (zone) {
            const ddx = x - zone[0],
              ddy = y - zone[1]
            if (ddx * ddx + ddy * ddy > zone[2] * zone[2]) mult += zone[3]
          }
          const ng = g + step * mult
          if (ng > maxCost) continue
          if (stamp[m] !== gen || ng < gS[m]) {
            stamp[m] = gen
            gS[m] = ng
            par[m] = n
            push(m, goal >= 0 ? ng + hw * Math.hypot(x - gx, y - gy) : ng)
          }
        }
      }
      for (let k = lkStart[n]; k < lkStart[n + 1]; k++) {
        const m = lkTo[k]
        if (closed[m] === gen || wd[m] < reqR || clr[m] < myH) continue
        const rise = lkRise[k]
        if (rise > 0 && rise > jetBudget) continue
        if (this.banned.size && this.banned.has(k)) {
          if (this.banned.get(k) > (o.tNow ?? 0)) continue
          this.banned.delete(k)
        }
        const ng = g + lkCost[k] + (rise > 0 ? jetExtra : 0)
        if (ng > maxCost) continue
        if (stamp[m] !== gen || ng < gS[m]) {
          stamp[m] = gen
          gS[m] = ng
          par[m] = n
          push(m, goal >= 0 ? ng + hw * Math.hypot(this.nodeX(m) - gx, this.nodeY(m) - gy) : ng)
        }
      }
    }
    if (goal < 0) return null
    if (!found) {
      // best effort: the path toward the closest node reached
      if (bestN === start || o.noPartial) return null
      this.partial = true
      return this.pathTo(bestN)
    }
    return this.pathTo(goal)
  }
  /** reconstruct the path to a node reached by the last search */
  pathTo(n) {
    if (this.closed[n] !== this.gen && this.stamp[n] !== this.gen) return null
    const out = []
    let guard = 0
    while (n >= 0 && guard++ < 100000) {
      out.push(n)
      n = this.par[n]
    }
    out.reverse()
    return out
  }
  reached(n) {
    return n >= 0 && this.closed[n] === this.gen
  }
  /** link index for a path step that is not a plain walk edge, or -1 */
  linkBetween(a, b) {
    for (let k = this.lkStart[a]; k < this.lkStart[a + 1]; k++) if (this.lkTo[k] === b) return k
    return -1
  }
  banLink(k, until) {
    this.banned.set(k, until)
  }

  /** can a mech walk the straight segment (same surface family) */
  walkLine(ax, ay, az, bx, by, reqR = 3, myH = 9) {
    const dx = bx - ax,
      dy = by - ay
    const len = Math.hypot(dx, dy)
    const n = Math.max(1, Math.ceil(len / 1.0))
    let z = az
    for (let k = 1; k <= n; k++) {
      const t = k / n
      const m = this.nodeAt(ax + dx * t, ay + dy * t, z, 1.6)
      if (m < 0 || this.wd[m] < reqR || this.clr[m] < myH) return false
      z = this.surf[m]
    }
    return true
  }
}

export { NS }
