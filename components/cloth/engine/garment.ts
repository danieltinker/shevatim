// Builds the simulated garment (body sheet folded over the shoulders, hood, tzitzit strings, ghost body)
// from a ClothSpec, and keeps the smooth render surface (2× subdivided grid + normals) up to date.
import { ClothSim, KIND_CLOTH, KIND_STRING, KIND_DEAD } from "./sim";

export interface GarmentSpec {
  shape: "hooded-poncho" | "poncho" | "cropped" | "classic";
  trim: "none" | "fringe" | "tassels" | "gold-fringe" | "lace";
  /** overrides the shape's default (hooded-poncho: yes, everything else: no) */
  hood?: boolean;
}

export interface NeckShape { halfW: number; front: number; back: number; round: boolean }

/** A simulated rectangular grid of cloth and its 2× refined render surface. */
export class Sheet {
  ru: number; rv: number;
  rpos: Float32Array; rnrm: Float32Array;
  /** per render vertex: how deep in a fold it sits (>0 valley seen from outside, <0 ridge); drives a cheap occlusion term */
  fold: Float32Array;
  private aDst: Int32Array; private aSrc: Int32Array; private aW: Float32Array;
  private bDst: Int32Array; private bSrc: Int32Array; private bW: Float32Array;
  followers: { idx: number; src: Int32Array; wt: Float32Array }[] = [];

  constructor(public sim: ClothSim, public start: number, public nu: number, public nv: number) {
    const ru = (this.ru = nu * 2 - 1), rv = (this.rv = nv * 2 - 1);
    this.rpos = new Float32Array(ru * rv * 3);
    this.rnrm = new Float32Array(ru * rv * 3);
    this.fold = new Float32Array(ru * rv);
    const W = (m0: boolean, m3: boolean): number[] =>
      m0 && m3 ? [0, 0.5, 0.5, 0] : m0 ? [0, 7 / 16, 10 / 16, -1 / 16] : m3 ? [-1 / 16, 10 / 16, 7 / 16, 0] : [-1 / 16, 9 / 16, 9 / 16, -1 / 16];
    const aD: number[] = [], aS: number[] = [], aW: number[] = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu - 1; i++) {
      aD.push(j * 2 * ru + i * 2 + 1);
      const m0 = i - 1 < 0, m3 = i + 2 >= nu;
      aS.push(start + j * nu + (m0 ? i : i - 1), start + j * nu + i, start + j * nu + i + 1, start + j * nu + (m3 ? i + 1 : i + 2));
      aW.push(...W(m0, m3));
    }
    const bD: number[] = [], bS: number[] = [], bW: number[] = [];
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < ru; i++) {
      bD.push((j * 2 + 1) * ru + i);
      const m0 = j - 1 < 0, m3 = j + 2 >= nv;
      bS.push((m0 ? j : j - 1) * 2 * ru + i, j * 2 * ru + i, (j + 1) * 2 * ru + i, (m3 ? j + 1 : j + 2) * 2 * ru + i);
      bW.push(...W(m0, m3));
    }
    this.aDst = Int32Array.from(aD); this.aSrc = Int32Array.from(aS); this.aW = Float32Array.from(aW);
    this.bDst = Int32Array.from(bD); this.bSrc = Int32Array.from(bS); this.bW = Float32Array.from(bW);
  }

  /** Refresh follower particles, the refined surface, its normals, and the solver's per-particle normals. */
  update(): void {
    const { sim, nu, nv, ru, rv, rpos, rnrm, start } = this;
    const p = sim.pos;
    for (const f of this.followers) {
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < f.src.length; k++) { const s = f.src[k] * 3, w = f.wt[k]; x += p[s] * w; y += p[s + 1] * w; z += p[s + 2] * w; }
      const d = f.idx * 3; p[d] = x; p[d + 1] = y; p[d + 2] = z;
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const s = (start + j * nu + i) * 3, d = (j * 2 * ru + i * 2) * 3;
      rpos[d] = p[s]; rpos[d + 1] = p[s + 1]; rpos[d + 2] = p[s + 2];
    }
    const { aDst, aSrc, aW, bDst, bSrc, bW } = this;
    for (let k = 0, n = aDst.length; k < n; k++) {
      const k4 = k * 4, d = aDst[k] * 3;
      const s0 = aSrc[k4] * 3, s1 = aSrc[k4 + 1] * 3, s2 = aSrc[k4 + 2] * 3, s3 = aSrc[k4 + 3] * 3;
      const w0 = aW[k4], w1 = aW[k4 + 1], w2 = aW[k4 + 2], w3 = aW[k4 + 3];
      rpos[d] = p[s0] * w0 + p[s1] * w1 + p[s2] * w2 + p[s3] * w3;
      rpos[d + 1] = p[s0 + 1] * w0 + p[s1 + 1] * w1 + p[s2 + 1] * w2 + p[s3 + 1] * w3;
      rpos[d + 2] = p[s0 + 2] * w0 + p[s1 + 2] * w1 + p[s2 + 2] * w2 + p[s3 + 2] * w3;
    }
    for (let k = 0, n = bDst.length; k < n; k++) {
      const k4 = k * 4, d = bDst[k] * 3;
      const s0 = bSrc[k4] * 3, s1 = bSrc[k4 + 1] * 3, s2 = bSrc[k4 + 2] * 3, s3 = bSrc[k4 + 3] * 3;
      const w0 = bW[k4], w1 = bW[k4 + 1], w2 = bW[k4 + 2], w3 = bW[k4 + 3];
      rpos[d] = rpos[s0] * w0 + rpos[s1] * w1 + rpos[s2] * w2 + rpos[s3] * w3;
      rpos[d + 1] = rpos[s0 + 1] * w0 + rpos[s1 + 1] * w1 + rpos[s2 + 1] * w2 + rpos[s3 + 1] * w3;
      rpos[d + 2] = rpos[s0 + 2] * w0 + rpos[s1 + 2] * w1 + rpos[s2 + 2] * w2 + rpos[s3 + 2] * w3;
    }
    for (let j = 0; j < rv; j++) {
      const jm = j > 0 ? j - 1 : j, jp = j < rv - 1 ? j + 1 : j;
      for (let i = 0; i < ru; i++) {
        const im = i > 0 ? i - 1 : i, ip = i < ru - 1 ? i + 1 : i;
        const a = (j * ru + im) * 3, b = (j * ru + ip) * 3, c = (jm * ru + i) * 3, e = (jp * ru + i) * 3;
        const ux = rpos[b] - rpos[a], uy = rpos[b + 1] - rpos[a + 1], uz = rpos[b + 2] - rpos[a + 2];
        const vx = rpos[e] - rpos[c], vy = rpos[e + 1] - rpos[c + 1], vz = rpos[e + 2] - rpos[c + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
        nx *= l; ny *= l; nz *= l;
        const d = (j * ru + i) * 3;
        rnrm[d] = nx; rnrm[d + 1] = ny; rnrm[d + 2] = nz;
      }
    }
    const fold = this.fold;
    for (let j = 1; j < rv - 1; j++) for (let i = 1; i < ru - 1; i++) {
      const k = j * ru + i, d = k * 3, a = d - 3, b = d + 3, c = d - ru * 3, e = d + ru * 3;
      const lx = (rpos[a] + rpos[b] + rpos[c] + rpos[e]) * 0.25 - rpos[d];
      const ly = (rpos[a + 1] + rpos[b + 1] + rpos[c + 1] + rpos[e + 1]) * 0.25 - rpos[d + 1];
      const lz = (rpos[a + 2] + rpos[b + 2] + rpos[c + 2] + rpos[e + 2]) * 0.25 - rpos[d + 2];
      const ex = rpos[b] - rpos[a], ey = rpos[b + 1] - rpos[a + 1], ez = rpos[b + 2] - rpos[a + 2];
      const h2 = (ex * ex + ey * ey + ez * ez) * 0.25 + 1e-9;
      fold[k] = (4 * (lx * rnrm[d] + ly * rnrm[d + 1] + lz * rnrm[d + 2])) / h2; // ≈ mean curvature, 1/m
    }
    const sn = sim.nrm;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const s = (j * 2 * ru + i * 2) * 3, d = (start + j * nu + i) * 3;
      sn[d] = rnrm[s]; sn[d + 1] = rnrm[s + 1]; sn[d + 2] = rnrm[s + 2];
    }
  }
}

export interface TzitzitChain { attach: number; wound: number[]; strands: number[][] }

export interface Garment {
  sim: ClothSim;
  body: Sheet;
  hood: Sheet | null;
  width: number;      // m, across
  halfLen: number;    // m, shoulder to hem
  neck: NeckShape;
  hoodArc: number; hoodDepth: number;
  chains: TzitzitChain[];
  centerY: number;
  hemY: number;
  topY: number;
  counts: { particles: number; constraints: number; body: number; hood: number; strings: number };
}

const SHOULDER_Y = 1.4;
const R0 = 0.072;

export function buildGarment(spec: GarmentSpec, quality: "low" | "high", kid: boolean): Garment {
  const hooded = spec.hood ?? spec.shape === "hooded-poncho";
  const classic = spec.shape === "classic";
  const width = classic ? 0.55 : 1.0;
  const halfLen = spec.shape === "cropped" ? 0.52 : classic ? 0.6 : 0.75;
  const cell = quality === "high" ? 0.0323 : 0.042;
  const nx = Math.round(width / cell) + 1;
  const ny = 2 * Math.round(halfLen / (cell * 0.97));
  const hx = width / (nx - 1), hy = (2 * halfLen) / (ny - 1);
  const neck: NeckShape = classic
    ? { halfW: 0.085, front: 0.1, back: 0.04, round: true }
    : { halfW: 0.095, front: 0.25, back: 0.04, round: false };

  const nhu = hooded ? 17 : 0; // the hood needs this resolution to wrap the head, in both qualities
  const nhv = hooded ? 9 : 0;
  const nStr = quality === "high" ? 4 : 3;
  const nSeg = quality === "high" ? 8 : 6;
  const nWound = 5;
  const maxP = nx * ny + nhu * nhv + 4 * (nWound + nStr * nSeg) + 8;
  const sim = new ClothSim(maxP, maxP * 7);
  sim.substeps = quality === "high" ? 10 : 8;
  if (kid) sim.gravity = 9.81 / 0.7; // a smaller garment swings faster; the camera does the scaling

  // --- ghost body (never drawn) ---
  // a classic tallit katan hangs from narrow, sloping shoulders only (no sleeve support), so its edges fall and it drapes
  const sh = classic ? 0.15 : 0.19, drop = classic ? 0.03 : 0.012;
  sim.capsules.push(
    { ax: 0, ay: SHOULDER_Y + 0.012, az: 0, bx: -sh, by: SHOULDER_Y - drop, bz: 0, ra: 0.06, rb: classic ? 0.05 : 0.058 },
    { ax: 0, ay: SHOULDER_Y + 0.012, az: 0, bx: sh, by: SHOULDER_Y - drop, bz: 0, ra: 0.06, rb: classic ? 0.05 : 0.058 },
    { ax: 0, ay: SHOULDER_Y + 0.02, az: 0, bx: 0, by: SHOULDER_Y + 0.17, bz: 0, ra: 0.05, rb: 0.048 },
  );
  if (!classic) sim.capsules.push(
    { ax: -0.19, ay: SHOULDER_Y - 0.012, az: 0, bx: -0.36, by: SHOULDER_Y - 0.125, bz: 0, ra: 0.058, rb: 0.045 },
    { ax: 0.19, ay: SHOULDER_Y - 0.012, az: 0, bx: 0.36, by: SHOULDER_Y - 0.125, bz: 0, ra: 0.058, rb: 0.045 },
  );
  sim.ellipsoids.push({ cx: 0, cy: 1.1, cz: 0, rx: classic ? 0.165 : 0.19, ry: 0.36, rz: classic ? 0.12 : 0.115 });
  if (hooded) sim.ellipsoids.push({ cx: 0, cy: 1.645, cz: -0.008, rx: 0.083, ry: 0.122, rz: 0.097 });

  // --- body sheet ---
  const arc = (Math.PI / 2) * R0;
  const droop = classic ? 10 : 0.3; // x beyond which the unsupported cloth starts lower
  const to3D = (x: number, t: number, out: number[]): void => {
    const at = Math.abs(t), sg = t < 0 ? 1 : -1; // front (t<0) is +z
    let y: number, z: number;
    if (at <= arc) { const a = at / R0; y = SHOULDER_Y + R0 * Math.cos(a); z = sg * R0 * Math.sin(a); }
    else { const e = at - arc; y = SHOULDER_Y - e; z = sg * (R0 + 0.012 + e * 0.12); }
    const ax = Math.abs(x);
    if (ax > droop) { const o = ax - droop; x = Math.sign(x) * (droop + o * 0.72); y -= o * 0.69 + 0.03; z *= Math.max(0.25, 1 - o * 3); }
    else if (ax > 0.2) y -= (ax - 0.2) * 0.55;
    out[0] = x; out[1] = y; out[2] = z;
  };
  const inNeck = (x: number, t: number): boolean => {
    const ax = Math.abs(x);
    if (t >= 0) return (ax / neck.halfW) ** 2 + (t / neck.back) ** 2 < 1;
    if (neck.round) return (ax / neck.halfW) ** 2 + (t / neck.front) ** 2 < 1;
    return ax < neck.halfW * (1 + t / neck.front);
  };
  const heavyHem = spec.trim === "tassels" || spec.trim === "gold-fringe";
  const tmp = [0, 0, 0];
  const dead = new Uint8Array(nx * ny);
  const sx = (i: number): number => -width / 2 + i * hx;
  const st = (j: number): number => (j - (ny - 1) / 2) * hy;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = sx(i), t = st(j);
    to3D(x, t, tmp);
    const isDead = inNeck(x, t);
    const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
    const hemRow = j <= 1 || j >= ny - 2;
    const w = isDead ? 0 : heavyHem && hemRow ? 0.5 : edge ? 0.7 : 1;
    sim.addParticle(tmp[0], tmp[1], tmp[2], w, isDead ? KIND_DEAD : KIND_CLOTH);
    dead[j * nx + i] = isDead ? 1 : 0;
  }
  const B = (i: number, j: number): number => j * nx + i;
  const live = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nx && j < ny && !dead[B(i, j)];
  const shearC = 3e-5, bendC = classic ? 4.5e-4 : 3e-4;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!live(i, j)) continue;
    if (live(i + 1, j)) sim.addConstraint(B(i, j), B(i + 1, j), hx, 0);
    if (live(i, j + 1)) sim.addConstraint(B(i, j), B(i, j + 1), hy, 0);
  }
  const hd = Math.hypot(hx, hy);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    // one diagonal per cell, alternating like a checkerboard: isotropic shear resistance at half the cost
    // (cells on the rim get both, or the free edge would zigzag)
    const rimCell = i === 0 || j === 0 || i === nx - 2 || j === ny - 2;
    if ((rimCell || (i + j) % 2 === 0) && live(i, j) && live(i + 1, j + 1)) sim.addConstraint(B(i, j), B(i + 1, j + 1), hd, shearC, 1);
    if ((rimCell || (i + j) % 2 === 1) && live(i + 1, j) && live(i, j + 1)) sim.addConstraint(B(i + 1, j), B(i, j + 1), hd, shearC, 1);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!live(i, j)) continue;
    if (live(i + 1, j) && live(i + 2, j)) sim.addConstraint(B(i, j), B(i + 2, j), 2 * hx, bendC, 2);
    if (live(i, j + 1) && live(i, j + 2)) sim.addConstraint(B(i, j), B(i, j + 2), 2 * hy, bendC, 2);
  }
  // under-arm tacks, as on the real garment: front and back joined for a short stretch at the side edges
  if (!classic) {
    const from = spec.shape === "cropped" ? 0.27 : 0.33, to = from + 0.1;
    for (let j = 0; j < ny / 2; j++) {
      const d = -st(j);
      if (d < from || d > to) continue;
      sim.addConstraint(B(0, j), B(0, ny - 1 - j), 0.012, 0);
      sim.addConstraint(B(nx - 1, j), B(nx - 1, ny - 1 - j), 0.012, 0);
    }
  }
  const sa: number[] = [], sb: number[] = [];
  for (let j = 0; j < ny / 2 - 3; j++) for (let i = 0; i < nx; i++) {
    if (live(i, j) && live(i, ny - 1 - j)) { sa.push(B(i, j)); sb.push(B(i, ny - 1 - j)); }
  }
  sim.sepA = Int32Array.from(sa); sim.sepB = Int32Array.from(sb);

  const body = new Sheet(sim, 0, nx, ny);
  // particles inside the neck opening follow the rim (a membrane that is never drawn) so the surface
  // can be interpolated smoothly and the opening cut per pixel
  const rim: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (dead[B(i, j)]) continue;
    if ((i > 0 && dead[B(i - 1, j)]) || (i < nx - 1 && dead[B(i + 1, j)]) || (j > 0 && dead[B(i, j - 1)]) || (j < ny - 1 && dead[B(i, j + 1)])) rim.push(B(i, j));
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!dead[B(i, j)]) continue;
    const wt = new Float32Array(rim.length);
    let sum = 0;
    for (let k = 0; k < rim.length; k++) {
      const ri = rim[k] % nx, rj = (rim[k] / nx) | 0;
      const d2 = ((ri - i) * hx) ** 2 + ((rj - j) * hy) ** 2;
      wt[k] = 1 / (d2 * d2); sum += wt[k];
    }
    for (let k = 0; k < rim.length; k++) wt[k] /= sum;
    body.followers.push({ idx: B(i, j), src: Int32Array.from(rim), wt });
  }

  // --- hood: a rectangle arched over the head, back edge sewn to itself, bottom edges sewn to the neckline ---
  let hood: Sheet | null = null;
  const hoodArc = 0.92, hoodDepth = 0.285;
  if (hooded) {
    const h0 = sim.n;
    const H = (iu: number, jv: number): number => h0 + jv * nhu + iu;
    const mid = (nhu - 1) / 2;
    // neckline path for one side, in sheet coordinates, from part-way down the V to the centre back
    const path: [number, number][] = [];
    const f0 = 0.42;
    for (let k = 0; k <= 10; k++) { const f = f0 * (1 - k / 10); path.push([neck.halfW * (1 - f) + 0.012, -neck.front * f]); }
    for (let k = 1; k <= 10; k++) { const a = (k / 10) * (Math.PI / 2); path.push([(neck.halfW + 0.012) * Math.cos(a), (neck.back + 0.012) * Math.sin(a)]); }
    const plen: number[] = [0];
    for (let k = 1; k < path.length; k++) plen.push(plen[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]));
    const pathAt = (f: number): [number, number] => {
      const L = f * plen[plen.length - 1];
      let k = 1; while (k < path.length - 1 && plen[k] < L) k++;
      const u = (L - plen[k - 1]) / (plen[k] - plen[k - 1] || 1);
      return [path[k - 1][0] + (path[k][0] - path[k - 1][0]) * u, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * u];
    };
    const yTop = 1.83;
    const base = [0, 0, 0];
    for (let jv = 0; jv < nhv; jv++) {
      const fv = jv / (nhv - 1);
      const [bx, bt] = pathAt(fv);
      to3D(bx, bt, base);
      const close = fv < 0.5 ? 0 : ((fv - 0.5) / 0.5) ** 2;
      const zTop = 0.115 - fv * 0.25;
      for (let iu = 0; iu < nhu; iu++) {
        const sgn = iu < mid ? -1 : 1;
        const q = 1 - Math.abs(iu - mid) / mid; // 0 at the neckline, 1 at the top
        const x = sgn * (base[0] * (1 - q) + 0.118 * (1 - 0.85 * close) * Math.pow(Math.sin(Math.PI * q), 0.75));
        const y = base[1] + (yTop - close * 0.05 - base[1]) * (1 - Math.pow(1 - q, 1.7));
        const z = base[2] + (zTop - base[2]) * Math.pow(q, 0.8) - close * 0.03 * Math.sin(Math.PI * q);
        const edge = jv === 0;
        sim.addParticle(iu === mid ? 0 : x, y, z, edge ? 0.5 : 0.75, KIND_CLOTH);
      }
    }
    const hu = hoodArc / (nhu - 1), hv = hoodDepth / (nhv - 1), hdg = Math.hypot(hu, hv);
    for (let jv = 0; jv < nhv; jv++) for (let iu = 0; iu < nhu; iu++) {
      if (iu < nhu - 1) sim.addConstraint(H(iu, jv), H(iu + 1, jv), hu, 0);
      if (jv < nhv - 1) sim.addConstraint(H(iu, jv), H(iu, jv + 1), hv, 0);
      if (iu < nhu - 1 && jv < nhv - 1) {
        sim.addConstraint(H(iu, jv), H(iu + 1, jv + 1), hdg, shearC, 1);
        sim.addConstraint(H(iu + 1, jv), H(iu, jv + 1), hdg, shearC, 1);
      }
      // the hood is doubled/lined cloth with a trimmed rim: stiffer in bending than the body
      if (iu < nhu - 2) sim.addConstraint(H(iu, jv), H(iu + 2, jv), 2 * hu, jv === 0 ? 2e-6 : 8e-6, 2);
      if (jv < nhv - 2) sim.addConstraint(H(iu, jv), H(iu, jv + 2), 2 * hv, 8e-6, 2);
    }
    for (let iu = 0; iu < mid; iu++) sim.addConstraint(H(iu, nhv - 1), H(nhu - 1 - iu, nhv - 1), 0.002, 1e-7); // back seam
    // neckline seam: each bottom-edge particle to the nearest live body particle of its target point
    for (let jv = 0; jv < nhv; jv++) {
      const [px, pt] = pathAt(jv / (nhv - 1));
      // pick the seam partner on the left and mirror it, so the hood is sewn on symmetrically
      let best = -1, bd = 1e9;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (dead[B(i, j)] || dead[B(nx - 1 - i, j)]) continue;
        const d = (sx(i) + px) ** 2 + (st(j) - pt) ** 2;
        if (d < bd) { bd = d; best = B(i, j); }
      }
      const bi = best % nx, bj = (best / nx) | 0;
      sim.addConstraint(H(0, jv), best, 0.012, 4e-7);
      sim.addConstraint(H(nhu - 1, jv), B(nx - 1 - bi, bj), 0.012, 4e-7);
    }
    hood = new Sheet(sim, h0, nhu, nhv);
    // the crown seam is held loosely on the centre line by two fixed points far to the sides, as the head form
    // of a ghost mannequin would: without it the slack hood slumps to one side
    const aL = sim.addParticle(-1.2, 1.7, 0, 0, KIND_DEAD), aR = sim.addParticle(1.2, 1.7, 0, 0, KIND_DEAD);
    for (let jv = 0; jv < nhv; jv++) { sim.addConstraint(H(mid, jv), aL, -1, 6e-5, 3); sim.addConstraint(H(mid, jv), aR, -1, 6e-5, 3); }
  }

  // --- tzitzit: wound cord, then loose strands, at each of the four corners ---
  const chains: TzitzitChain[] = [];
  const ks = kid ? 1.2 : 1; // kid garments carry nearly full-size strings
  const rep: number[][] = [];
  let seed = 7;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const strStart = sim.n;
  for (const [ci, cj] of [[1, 1], [nx - 2, 1], [1, ny - 2], [nx - 2, ny - 2]]) {
    const attach = B(ci, cj);
    const ax = sim.pos[attach * 3], ay = sim.pos[attach * 3 + 1], az = sim.pos[attach * 3 + 2];
    const zs = cj < ny / 2 ? 1 : -1;
    const wound: number[] = [];
    let prevI = attach, prev2 = -1;
    const wl = 0.021 * ks;
    for (let k = 1; k <= nWound; k++) {
      const p = sim.addParticle(ax, ay - k * wl - 0.02, az + zs * 0.004, 1.4, KIND_STRING);
      sim.addConstraint(prevI, p, k === 1 ? wl + 0.02 : wl, 0);
      if (prev2 >= 0) sim.addConstraint(prev2, p, 2 * wl, 6e-7); // the wound part is stiff
      prev2 = prevI; prevI = p; wound.push(p);
    }
    const endW = prevI, beforeEnd = prev2;
    const wy = ay - nWound * wl - 0.02;
    const strands: number[][] = [];
    for (let s = 0; s < nStr; s++) {
      const sl = 0.027 * ks * (0.86 + 0.2 * rnd());
      const ox = (rnd() - 0.5) * 0.012, oz = (rnd() - 0.5) * 0.012;
      const pts: number[] = [];
      let a = endW, b = beforeEnd;
      for (let k = 1; k <= nSeg; k++) {
        const p = sim.addParticle(ax + ox * k * 0.4, wy - k * sl, az + zs * 0.004 + oz * k * 0.4, 3.2, KIND_STRING);
        sim.addConstraint(a, p, sl, 0);
        if (k > 1) sim.addConstraint(b, p, 2 * sl, 2.5e-5);
        b = a; a = p; pts.push(p);
      }
      strands.push(pts);
    }
    for (let k = 1; k < nSeg; k++) for (let s = 0; s < nStr; s++) for (let s2 = s + 1; s2 < nStr; s2++) rep.push([strands[s][k], strands[s2][k]]);
    chains.push({ attach, wound, strands });
  }
  sim.repA = Int32Array.from(rep.map((r) => r[0])); sim.repB = Int32Array.from(rep.map((r) => r[1]));

  sim.finalize();
  body.update();
  hood?.update();
  return {
    sim, body, hood, width, halfLen, neck, hoodArc, hoodDepth, chains,
    centerY: SHOULDER_Y + R0 - halfLen * 0.42 + (hooded ? 0.1 : 0),
    hemY: SHOULDER_Y + R0 - halfLen, topY: hooded ? 1.84 : SHOULDER_Y + R0,
    counts: { particles: sim.n, constraints: sim.nc + sim.sepA.length + sim.repA.length, body: nx * ny, hood: nhu * nhv, strings: sim.n - strStart },
  };
}
