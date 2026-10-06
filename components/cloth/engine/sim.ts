// XPBD cloth solver (after Matthias Müller's "Ten Minute Physics" 14/15): small substeps, one Gauss–Seidel pass
// per substep, compliance divided by dt². No rendering code here; plain typed arrays.

export const KIND_CLOTH = 0;
export const KIND_STRING = 1;
export const KIND_DEAD = 2;

export interface Capsule { ax: number; ay: number; az: number; bx: number; by: number; bz: number; ra: number; rb: number }
export interface Ellipsoid { cx: number; cy: number; cz: number; rx: number; ry: number; rz: number }

export class ClothSim {
  n = 0;
  pos: Float64Array;
  prev: Float64Array;
  vel: Float64Array;
  rest: Float64Array;          // settled pose, for reset
  w: Float64Array;             // inverse mass relative to one interior cloth particle
  nrm: Float32Array;           // cloth particle normals, refreshed once per frame by the garment
  kind: Uint8Array;

  nc = 0;
  cA: Int32Array;
  cB: Int32Array;
  cLen: Float64Array;
  cComp: Float64Array;         // compliance (mass-normalised); alpha = comp / dt²

  sepA: Int32Array = new Int32Array(0); // front particle
  sepB: Int32Array = new Int32Array(0); // matching back particle: keep zA >= zB + gap
  sepGap = 0.006;

  /** groups of string particles that must keep a minimum distance from each other: [a,b] pairs */
  repA: Int32Array = new Int32Array(0);
  repB: Int32Array = new Int32Array(0);
  repDist = 0.005;

  capsules: Capsule[] = [];
  ellipsoids: Ellipsoid[] = [];
  thickness = 0.006;
  friction = 0.45;

  gravity = 9.81;
  damping = 0.7;               // 1/s, plain velocity damping (stands in for the internal friction of the weave)
  dragLin = 1.5;               // 1/s  cloth, along the normal
  dragQuad = 2.9;              // 1/m  cloth, along the normal (rho*Cd / (2 * areal density))
  strDragLin = 1.6;
  strDragQuad = 2.0;
  vmax = 9;
  substeps = 12;
  windX = 0; windY = 0; windZ = 0;
  windPhase = 0;
  windGust = 0;

  grabIdx = -1;
  grabX = 0; grabY = 0; grabZ = 0;
  /** The hand never pulls harder than this share of the whole garment's weight: taut cloth holds instead of stretching. */
  grabForce = 0.5;
  /** Strain limiting: woven cloth does not stretch, and one solver pass per substep lets it.
   *  While the cloth is held (and for a moment after, or whenever a thread is found over-long) the threads (warp,
   *  weft, seams) are solved again in every substep, up to strainIters times, until none is more than strainLimit
   *  times the length it has in the settled garment (or its nominal length, if that is longer: around the neck
   *  seam under the hood a few threads hang longer than nominal, and those are left as they are).
   *  The hanging garment therefore drapes exactly as before and costs one cheap measurement per frame.
   *  Active from saveRest() on. */
  strainLimit = 1.05;
  strainIters = 6;
  private cHold: Float64Array = new Float64Array(0); // per thread: the length it may keep
  private cMax: Float64Array = new Float64Array(0);  // per thread: beyond this it counts as over-stretched
  private limiting = false;
  private limitFrames = 0;
  /** number of leading constraints that are inextensible threads (set by finalize) */
  nStretch = 0;
  totalMass = 0;

  private acc = 0;
  private windM: Float32Array;
  private mask: Uint8Array;
  cGrp: Uint8Array;            // solve order: 0 stretch, 1 shear, 2 bending, 3 soft tethers
  lastSolveMs = 0;
  kinetic = 0;
  /** how many extra thread passes strain limiting has run so far (a diagnostic: it must not grow while the cloth just hangs) */
  strainPasses = 0;

  constructor(maxParticles: number, maxConstraints: number) {
    this.pos = new Float64Array(maxParticles * 3);
    this.prev = new Float64Array(maxParticles * 3);
    this.vel = new Float64Array(maxParticles * 3);
    this.rest = new Float64Array(maxParticles * 3);
    this.w = new Float64Array(maxParticles);
    this.nrm = new Float32Array(maxParticles * 3);
    this.kind = new Uint8Array(maxParticles);
    this.cA = new Int32Array(maxConstraints);
    this.cB = new Int32Array(maxConstraints);
    this.cLen = new Float64Array(maxConstraints);
    this.cComp = new Float64Array(maxConstraints);
    this.cGrp = new Uint8Array(maxConstraints);
    this.windM = new Float32Array(maxParticles);
    this.mask = new Uint8Array(maxParticles);
  }

  addParticle(x: number, y: number, z: number, w: number, kind: number): number {
    const i = this.n++;
    const p = this.pos;
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    this.prev[i * 3] = x; this.prev[i * 3 + 1] = y; this.prev[i * 3 + 2] = z;
    this.w[i] = w;
    this.kind[i] = kind;
    return i;
  }

  /** len < 0: use the current distance. */
  addConstraint(a: number, b: number, len: number, comp: number, grp = 0): void {
    if (this.nc >= this.cA.length) return;
    const c = this.nc++;
    this.cA[c] = a; this.cB[c] = b;
    if (len < 0) {
      const p = this.pos;
      len = Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
    }
    this.cLen[c] = len;
    this.cComp[c] = comp;
    this.cGrp[c] = grp;
  }

  /** Sort constraints by group so the half-rate groups are contiguous. Call once after building. */
  finalize(): void {
    const order = Array.from({ length: this.nc }, (_, i) => i).sort((x, y) => this.cGrp[x] - this.cGrp[y] || x - y);
    const A = Int32Array.from(order, (i) => this.cA[i]), B = Int32Array.from(order, (i) => this.cB[i]);
    const L = Float64Array.from(order, (i) => this.cLen[i]), C = Float64Array.from(order, (i) => this.cComp[i]);
    const Gp = Uint8Array.from(order, (i) => this.cGrp[i]);
    this.cA = A; this.cB = B; this.cLen = L; this.cComp = C; this.cGrp = Gp;
    let ns = 0; while (ns < Gp.length && Gp[ns] === 0) ns++;
    this.nStretch = ns;
    let m = 0; for (let i = 0; i < this.n; i++) if (this.w[i] > 0) m += 1 / this.w[i];
    this.totalMass = m;
  }

  private overStretched(): boolean {
    const pos = this.pos, cA = this.cA, cB = this.cB, cMax = this.cMax;
    for (let c = 0, n = this.nStretch; c < n; c++) {
      const a = cA[c] * 3, b = cB[c] * 3;
      const dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
      if (dx * dx + dy * dy + dz * dz > cMax[c] * cMax[c]) return true;
    }
    return false;
  }

  /** Longest thread relative to the length it has in the settled garment (1 = as settled). NaN if the state is broken. */
  maxStrain(): number {
    const pos = this.pos, cA = this.cA, cB = this.cB, cLen = this.cLen;
    const hold = this.cHold.length === this.nStretch ? this.cHold : cLen;
    let worst = 0;
    for (let c = 0, n = this.nStretch; c < n; c++) {
      if (cLen[c] < 0.015) continue; // seams and tacks: their slack is not cloth strain
      const a = cA[c] * 3, b = cB[c] * 3;
      const dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz) / hold[c];
      if (r !== r) return NaN;
      if (r > worst) worst = r;
    }
    return worst;
  }

  /** Mean distance of the cloth particles from the settled pose, in metres. NaN if the state is broken. */
  meanFromRest(from = 0, to = this.n): number {
    const pos = this.pos, rest = this.rest, w = this.w, kind = this.kind;
    let sum = 0, cnt = 0;
    for (let i = from, i3 = from * 3; i < to; i++, i3 += 3) {
      if (w[i] === 0 || kind[i] !== KIND_CLOTH) continue;
      const dx = pos[i3] - rest[i3], dy = pos[i3 + 1] - rest[i3 + 1], dz = pos[i3 + 2] - rest[i3 + 2];
      sum += Math.sqrt(dx * dx + dy * dy + dz * dz); cnt++;
    }
    return cnt ? sum / cnt : 0;
  }

  saveRest(): void {
    this.rest.set(this.pos);
    const pos = this.pos, cA = this.cA, cB = this.cB, L = this.cLen, ns = this.nStretch;
    const cHold = (this.cHold = new Float64Array(ns)), cMax = (this.cMax = new Float64Array(ns));
    for (let c = 0; c < ns; c++) {
      const a = cA[c] * 3, b = cB[c] * 3;
      const settled = Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]);
      cHold[c] = Math.max(L[c], settled);
      cMax[c] = L[c] < 0.015 ? cHold[c] + 0.004 : cHold[c] * this.strainLimit; // a seam may gape 4 mm
    }
  }
  reset(): void {
    this.pos.set(this.rest); this.prev.set(this.rest); this.vel.fill(0); this.grabIdx = -1; this.acc = 0;
  }
  zeroVelocities(): void { this.vel.fill(0); this.prev.set(this.pos); }

  /** Advance by real time; fixed 60 Hz frames with an accumulator. Returns the number of frames simulated. */
  advance(dtReal: number, maxFrames = 2): number {
    const h = 1 / 60;
    this.acc += Math.min(dtReal, 0.1);
    let frames = 0;
    while (this.acc >= h && frames < maxFrames) {
      this.frame(h);
      this.acc -= h;
      frames++;
    }
    if (this.acc > h) this.acc = 0; // dropped time: never try to catch up
    return frames;
  }

  frame(h: number): void {
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    const sdt = h / this.substeps;
    if (this.strainIters > 0 && this.nStretch > 0 && this.cMax.length === this.nStretch && (this.grabIdx >= 0 || this.overStretched())) this.limitFrames = 90;
    this.limiting = this.limitFrames > 0;
    if (this.limiting) this.limitFrames--;
    this.broadPhase();
    for (let s = 0; s < this.substeps; s++) this.substep(sdt);
    if (typeof performance !== "undefined") this.lastSolveMs = performance.now() - t0;
  }

  substep(dt: number): void {
    const n = this.n, pos = this.pos, prev = this.prev, vel = this.vel, w = this.w, nrm = this.nrm, kind = this.kind;
    const gdt = -this.gravity * dt;
    const damp = Math.max(0, 1 - this.damping * dt);
    const vmax = this.vmax, vmax2 = vmax * vmax;
    const k1 = this.dragLin * dt, k2 = this.dragQuad * dt, s1 = this.strDragLin * dt, s2 = this.strDragQuad * dt;
    const wx0 = this.windX, wy0 = this.windY, wz0 = this.windZ, windM = this.windM;

    for (let i = 0, i3 = 0; i < n; i++, i3 += 3) {
      if (w[i] === 0) continue;
      let vx = vel[i3], vy = vel[i3 + 1] + gdt, vz = vel[i3 + 2];
      const px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
      // slowly varying, spatially uneven air: a travelling swell plus a gust front
      const m = windM[i];
      const rx = vx - wx0 * m, ry = vy - wy0 * m, rz = vz - wz0 * m;
      if (kind[i] === KIND_CLOTH) {
        const nx = nrm[i3], ny = nrm[i3 + 1], nz = nrm[i3 + 2];
        const vn = rx * nx + ry * ny + rz * nz;
        const f = k1 + k2 * (vn < 0 ? -vn : vn);
        const d = vn * f / (1 + f);
        vx -= nx * d; vy -= ny * d; vz -= nz * d;
      } else {
        const sp = Math.sqrt(rx * rx + ry * ry + rz * rz);
        const f = s1 + s2 * sp;
        const d = f / (1 + f);
        vx -= rx * d; vy -= ry * d; vz -= rz * d;
      }
      vx *= damp; vy *= damp; vz *= damp;
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 > vmax2) { const s = vmax / Math.sqrt(v2); vx *= s; vy *= s; vz *= s; }
      prev[i3] = px; prev[i3 + 1] = py; prev[i3 + 2] = pz;
      pos[i3] = px + vx * dt; pos[i3 + 1] = py + vy * dt; pos[i3 + 2] = pz + vz * dt;
    }

    // pointer grab: the held particle is heavy and is steered towards the pointer by a velocity servo whose
    // acceleration is capped, so the hand pulls with a bounded force. Slack cloth follows the pointer closely;
    // taut cloth holds the hand back instead of stretching like rubber or being dragged off the shoulders.
    const g = this.grabIdx;
    let gw = 0;
    if (g >= 0) {
      const g3 = g * 3;
      gw = w[g]; w[g] = gw * 0.04;
      const aMax = this.grabForce * this.totalMass * this.gravity * w[g];
      const ex = this.grabX - pos[g3], ey = this.grabY - pos[g3 + 1], ez = this.grabZ - pos[g3 + 2];
      const e = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (e > 1e-9) {
        // approach speed: proportional close in, never faster than the cap can still brake
        let sp = e * 90; const brake = Math.sqrt(aMax * e); if (sp > brake) sp = brake; if (sp > 6) sp = 6;
        const k = sp / e;
        let ax = ex * k - (pos[g3] - prev[g3]) / dt, ay = ey * k - (pos[g3 + 1] - prev[g3 + 1]) / dt, az = ez * k - (pos[g3 + 2] - prev[g3 + 2]) / dt;
        const a = Math.sqrt(ax * ax + ay * ay + az * az), lim = aMax * dt;
        if (a > lim) { const q = lim / a; ax *= q; ay *= q; az *= q; }
        pos[g3] += ax * dt; pos[g3 + 1] += ay * dt; pos[g3 + 2] += az * dt;
      }
    }

    // distance constraints
    const idt2 = 1 / (dt * dt);
    const cA = this.cA, cB = this.cB, cLen = this.cLen, cComp = this.cComp;
    const cHold = this.cHold, cMax = this.cMax;
    const nS = this.limiting ? this.nStretch : 0;
    let over = false;
    for (let c = 0, nc = this.nc; c < nc; c++) {
      const ia = cA[c], ib = cB[c];
      const wa = w[ia], wb = w[ib];
      const ws = wa + wb;
      if (ws === 0) continue;
      const a = ia * 3, b = ib * 3;
      const dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-9) continue;
      if (c < nS && len > cMax[c]) over = true;
      const s = -(len - cLen[c]) / ((ws + cComp[c] * idt2) * len);
      const sa = s * wa, sb = s * wb;
      pos[a] += dx * sa; pos[a + 1] += dy * sa; pos[a + 2] += dz * sa;
      pos[b] -= dx * sb; pos[b + 1] -= dy * sb; pos[b + 2] -= dz * sb;
    }
    // strain limiting: where a thread went into that pass too long, solve the threads again (only them, and only
    // then), so a hard pull travels through the cloth instead of lengthening it.
    for (let it = 0, its = this.strainIters; over && it < its; it++) {
      over = false; this.strainPasses++;
      if (g >= 0 && it === its - 2) w[g] = gw; // the last passes: the held particle gives way like any other
      for (let c = 0; c < nS; c++) {
        const ia = cA[c], ib = cB[c];
        const wa = w[ia], wb = w[ib];
        const ws = wa + wb;
        if (ws === 0) continue;
        const a = ia * 3, b = ib * 3;
        const dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-9) continue;
        const hold = cHold[c];
        if (len <= hold) continue; // threads buckle freely; only pull back what is too long
        if (len > cMax[c]) over = true;
        const s = -(len - hold) / ((ws + cComp[c] * idt2) * len);
        const sa = s * wa, sb = s * wb;
        pos[a] += dx * sa; pos[a + 1] += dy * sa; pos[a + 2] += dz * sa;
        pos[b] -= dx * sb; pos[b + 1] -= dy * sb; pos[b + 2] -= dz * sb;
      }
    }
    if (g >= 0) w[g] = gw * 0.04;

    // front panel stays in front of the back panel (cheap cloth–cloth for a garment that never turns)
    const sA = this.sepA, sB = this.sepB, gap = this.sepGap;
    for (let k = 0, ns = sA.length; k < ns; k++) {
      const a = sA[k] * 3 + 2, b = sB[k] * 3 + 2;
      const d = pos[a] - pos[b];
      if (d < gap) {
        const wa = w[sA[k]], wb = w[sB[k]];
        const ws = wa + wb;
        if (ws === 0) continue;
        const c = (gap - d) / ws;
        pos[a] += c * wa; pos[b] -= c * wb;
      }
    }

    // loose strands keep a little distance so they read as separate threads
    const rA = this.repA, rB = this.repB, rd = this.repDist, rd2 = rd * rd;
    for (let k = 0, nr = rA.length; k < nr; k++) {
      const a = rA[k] * 3, b = rB[k] * 3;
      const dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rd2 && d2 > 1e-12) {
        const d = Math.sqrt(d2);
        const s = 0.5 * (rd - d) / d * 0.5;
        pos[a] += dx * s; pos[a + 1] += dy * s; pos[a + 2] += dz * s;
        pos[b] -= dx * s; pos[b + 1] -= dy * s; pos[b + 2] -= dz * s;
      }
    }

    this.collide();

    if (g >= 0) w[g] = gw;

    const idt = 1 / dt;
    let ke = 0;
    for (let i = 0, i3 = 0; i < n; i++, i3 += 3) {
      if (w[i] === 0) continue;
      const vx = (pos[i3] - prev[i3]) * idt, vy = (pos[i3 + 1] - prev[i3 + 1]) * idt, vz = (pos[i3 + 2] - prev[i3 + 2]) * idt;
      vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
      ke += vx * vx + vy * vy + vz * vz;
    }
    this.kinetic = ke / n;
  }

  /** Once per frame: per-particle air unevenness and the set of colliders each particle could reach this frame. */
  private broadPhase(): void {
    const n = this.n, pos = this.pos, w = this.w, windM = this.windM, mask = this.mask;
    const ph = this.windPhase, gust = this.windGust;
    const els = this.ellipsoids, caps = this.capsules, ne = els.length, ncap = caps.length;
    const margin = 0.07;
    for (let i = 0, i3 = 0; i < n; i++, i3 += 3) {
      if (w[i] === 0) { mask[i] = 0; continue; }
      const px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
      // slowly varying, spatially uneven air: a travelling swell plus a gust front
      windM[i] = 0.55 + 0.45 * Math.sin(px * 4.1 + py * 2.3 + ph) + gust * (0.5 + 0.5 * Math.sin(py * 3.0 - px * 1.7 + ph * 1.9));
      let m = 0;
      for (let e = 0; e < ne; e++) {
        const E = els[e];
        const dx = (px - E.cx) / (E.rx + margin), dy = (py - E.cy) / (E.ry + margin), dz = (pz - E.cz) / (E.rz + margin);
        if (dx * dx + dy * dy + dz * dz < 1) m |= 1 << e;
      }
      for (let c = 0; c < ncap; c++) {
        const C = caps[c];
        const abx = C.bx - C.ax, aby = C.by - C.ay, abz = C.bz - C.az;
        let t = ((px - C.ax) * abx + (py - C.ay) * aby + (pz - C.az) * abz) / (abx * abx + aby * aby + abz * abz);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const r = (C.ra > C.rb ? C.ra : C.rb) + margin;
        const dx = px - (C.ax + abx * t), dy = py - (C.ay + aby * t), dz = pz - (C.az + abz * t);
        if (dx * dx + dy * dy + dz * dz < r * r) m |= 1 << (c + ne);
      }
      mask[i] = m;
    }
  }

  private collide(): void {
    const n = this.n, pos = this.pos, prev = this.prev, mask = this.mask;
    const th = this.thickness, mu = this.friction;
    const els = this.ellipsoids, caps = this.capsules;
    const ne = els.length, ncap = caps.length;
    for (let i = 0, i3 = 0; i < n; i++, i3 += 3) {
      const mk = mask[i];
      if (mk === 0) continue;
      let px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
      let hit = false, nx = 0, ny = 0, nz = 0, depth = 0;
      for (let e = 0; e < ne; e++) {
        if ((mk & (1 << e)) === 0) continue;
        const E = els[e];
        const rx = E.rx + th, ry = E.ry + th, rz = E.rz + th;
        const dx = (px - E.cx) / rx, dy = (py - E.cy) / ry, dz = (pz - E.cz) / rz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1 && d2 > 1e-12) {
          const d = Math.sqrt(d2);
          const qx = E.cx + dx / d * rx, qy = E.cy + dy / d * ry, qz = E.cz + dz / d * rz;
          let gx = dx / rx, gy = dy / ry, gz = dz / rz;
          const gl = 1 / Math.sqrt(gx * gx + gy * gy + gz * gz);
          gx *= gl; gy *= gl; gz *= gl;
          depth = (qx - px) * gx + (qy - py) * gy + (qz - pz) * gz;
          px = qx; py = qy; pz = qz; nx = gx; ny = gy; nz = gz; hit = true;
        }
      }
      for (let c = 0; c < ncap; c++) {
        if ((mk & (1 << (c + ne))) === 0) continue;
        const C = caps[c];
        const abx = C.bx - C.ax, aby = C.by - C.ay, abz = C.bz - C.az;
        let t = ((px - C.ax) * abx + (py - C.ay) * aby + (pz - C.az) * abz) / (abx * abx + aby * aby + abz * abz);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const r = C.ra + (C.rb - C.ra) * t + th;
        const dx = px - (C.ax + abx * t), dy = py - (C.ay + aby * t), dz = pz - (C.az + abz * t);
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r * r && d2 > 1e-12) {
          const d = Math.sqrt(d2);
          nx = dx / d; ny = dy / d; nz = dz / d; depth = r - d;
          px += nx * depth; py += ny * depth; pz += nz * depth; hit = true;
        }
      }
      if (hit) {
        // Coulomb friction against the body: remove tangential motion in proportion to the push-out depth
        let tx = px - prev[i3], ty = py - prev[i3 + 1], tz = pz - prev[i3 + 2];
        const dn = tx * nx + ty * ny + tz * nz;
        tx -= nx * dn; ty -= ny * dn; tz -= nz * dn;
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tl > 1e-12) {
          const k = Math.min(1, (mu * depth) / tl);
          px -= tx * k; py -= ty * k; pz -= tz * k;
        }
        pos[i3] = px; pos[i3 + 1] = py; pos[i3 + 2] = pz;
      }
    }
  }
}
