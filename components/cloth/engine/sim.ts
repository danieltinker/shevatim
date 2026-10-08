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
  /** where the pointer wants the held particle (set by the caller, at event time) */
  grabX = 0; grabY = 0; grabZ = 0;
  /** The hand never pulls harder than this share of the whole garment's weight: taut cloth holds instead of stretching. */
  grabForce = 0.5;
  /** Pointer events do not arrive in step with the frames (a phone may deliver two in one frame and none in the next),
   *  so the hand follows the pointer through a short low-pass (s): it moves every substep instead of in steps, and
   *  starts from where the held particle is, so taking the cloth never jerks it. 0 = no smoothing. */
  grabLag = 0.02;
  /** Mass of one simulated particle relative to one high-quality particle: the coarse grid has heavier particles, and
   *  the hand's acceleration cap is scaled by it so the held point is as quick at low quality as at high. */
  massScale = 1;
  /** A hand opens; it does not vanish. For this long (s) after a release the held particle keeps part of its extra
   *  weight and the hand part of its pull, both fading out, so cloth that was held taut eases off instead of snapping
   *  away from the fingers in a single frame. */
  releaseTime = 0.2;
  private handX = 0; private handY = 0; private handZ = 0; private handIdx = -1;
  private relIdx = -1; private relT = 0;

  /** ---- back to its own shape ----
   *  Friction against the ghost body, a hood that tipped to one side, a fold that caught: after a pull the cloth
   *  often comes to rest a centimetre or two from where it hung, and nothing in the physics brings it back. So every
   *  free particle is drawn towards its settled position by a first-order pull (a rate, 1/s) that moves the particle
   *  and its previous position together: it shifts the pose without adding or taking away speed, so the swing goes
   *  on as before while its centre glides home. Off while the cloth is held; after a release it rises over
   *  pullRamp s to pullPeak, holds until pullHold, then falls back (time constant pullDecay) to the weak permanent
   *  pullRest that undoes slow creep without stilling the draught. Strings take only pullString of it: they swing
   *  freely. The settled pose itself is never touched (no pull before saveRest()). */
  pullRest = 0.12;
  pullPeak = 1.7;
  pullRamp = 0.45;
  pullHold = 1.9;
  pullDecay = 0.8;
  pullString = 0.25;
  /** s since the last release while the stronger pull is on, -1 otherwise */
  recoverT = -1;
  /** Set by the caller at a release: the pull stays at its peak after pullHold until cleared (the caller has looked
   *  at the pose and found it home), so cloth the pull is still holding near home is never let go before that look.
   *  Never longer than pullLatchMax s past pullHold. */
  pullLatch = false;
  pullLatchMax = 2.5;
  private latchT = 0;
  /** the pull rate (1/s) used in the latest frame */
  pull = 0;
  private restReady = false;
  private wasHeld = false;
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
  /** of those, the leading ones that are cloth (the strings' come last). While held, and after a release until the
   *  caller has seen the cloth home (pullLatch), any thread found too long during the solve starts the extra passes:
   *  a hood dragged off the head hangs on them. Otherwise they run only in frames that start with a cloth thread (not
   *  a string segment, not a seam or tack under 15 mm) still too long after the previous frame's solve: cloth that
   *  really is over-stretched. (Mid-solve, some thread next to a seam or a swinging string is always momentarily
   *  long, and the passes would run on nearly every substep for nothing.) */
  nStretchCloth = 0;
  private strained = false;
  totalMass = 0;

  private acc = 0;
  private windM: Float32Array;
  private mask: Uint8Array;
  cGrp: Uint8Array;            // solve order: 0 stretch, 1 shear, 2 bending, 3 soft tethers
  lastSolveMs = 0;
  kinetic = 0;
  /** how many extra thread passes strain limiting has run so far (a diagnostic: it must not grow while the cloth just hangs) */
  strainPasses = 0;

  /** positions at the start of the latest frame: the renderer draws between this and pos (see lerpTo) */
  last: Float64Array;

  constructor(maxParticles: number, maxConstraints: number) {
    this.pos = new Float64Array(maxParticles * 3);
    this.prev = new Float64Array(maxParticles * 3);
    this.last = new Float64Array(maxParticles * 3);
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
    this.last[i * 3] = x; this.last[i * 3 + 1] = y; this.last[i * 3 + 2] = z;
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
    let nc = 0; while (nc < ns && this.kind[A[nc]] !== KIND_STRING && this.kind[B[nc]] !== KIND_STRING) nc++;
    this.nStretchCloth = nc;
    let m = 0; for (let i = 0; i < this.n; i++) if (this.w[i] > 0) m += 1 / this.w[i];
    this.totalMass = m;
  }

  private overStretched(): boolean {
    const pos = this.pos, cA = this.cA, cB = this.cB, cMax = this.cMax;
    for (let c = 0, n = this.nStretchCloth; c < n; c++) {
      if (this.cLen[c] < 0.015) continue;
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
    this.restReady = true;
  }
  reset(): void {
    this.pos.set(this.rest); this.prev.set(this.rest); this.last.set(this.rest); this.vel.fill(0);
    this.grabIdx = -1; this.acc = 0; this.wasHeld = false; this.recoverT = -1; this.handIdx = -1; this.relIdx = -1; this.pullLatch = false;
  }
  zeroVelocities(): void { this.vel.fill(0); this.prev.set(this.pos); this.last.set(this.pos); }

  /** Pull rate (1/s) t seconds after a release (t < 0: no release pending). */
  pullAt(t: number): number {
    if (t < 0) return this.pullRest;
    if (t < this.pullRamp) { const u = t / this.pullRamp; return this.pullPeak * u * u * (3 - 2 * u); }
    if (t < this.pullHold) return this.pullPeak;
    return this.pullRest + (this.pullPeak - this.pullRest) * Math.exp(-(t - this.pullHold) / this.pullDecay);
  }

  /** Advance by real time; fixed 60 Hz frames with an accumulator. Returns the number of frames simulated.
   *  At 30 fps every call runs two frames; time beyond maxFrames is dropped (never a catch-up spiral), but only the
   *  excess: the accumulator keeps just under one frame, so a display that runs a little slow does not lose a frame
   *  every few calls. Draw with lerpTo(alpha()) for motion that is even at any display rate. */
  advance(dtReal: number, maxFrames = 2): number {
    const h = 1 / 60;
    this.acc += Math.min(dtReal, 0.1);
    let frames = 0;
    while (this.acc >= h && frames < maxFrames) {
      this.frame(h);
      this.acc -= h;
      frames++;
    }
    if (this.acc >= h) this.acc = h * 0.999; // dropped time
    return frames;
  }
  /** How far real time is past the start of the latest frame, in frames (0..1). */
  alpha(): number { const a = this.acc * 60; return a < 0 ? 0 : a > 1 ? 1 : a; }
  /** Positions between the start of the latest frame and its end. The drawn cloth then runs one frame behind the
   *  simulation, at an even pace, whatever the display rate (30, 60, 90 or 120 Hz). */
  lerpTo(alpha: number, out: Float64Array): Float64Array {
    const a = this.last, b = this.pos;
    for (let i = 0, n = this.n * 3; i < n; i++) out[i] = a[i] + (b[i] - a[i]) * alpha;
    return out;
  }

  frame(h: number): void {
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    const sdt = h / this.substeps;
    this.last.set(this.pos.subarray(0, this.n * 3));
    // strain limiting: while held, while the pull home is latched (cloth dragged round the body may be hanging on its
    // limited threads until the caller has looked), for 1.5 s after, and whenever a thread is found over-long
    const held = this.grabIdx >= 0 || this.relIdx >= 0;
    this.strained = !held && this.cMax.length === this.nStretch && this.overStretched();
    if (this.strainIters > 0 && this.nStretch > 0 && this.cMax.length === this.nStretch && (held || this.pullLatch || this.strained)) this.limitFrames = 90;
    this.limiting = this.limitFrames > 0;
    if (this.limiting) this.limitFrames--;
    // the pull home: off while held, strong for a moment after each release, weak otherwise
    if (this.grabIdx >= 0) { this.wasHeld = true; this.recoverT = -1; this.pull = 0; this.relIdx = -1; this.pullLatch = false; }
    else {
      if (this.wasHeld) { this.wasHeld = false; this.recoverT = 0; this.relIdx = this.handIdx; this.relT = 0; this.latchT = 0; }
      else if (this.relIdx >= 0 && (this.relT += h) >= this.releaseTime) this.relIdx = -1;
      this.handIdx = -1;
      this.pull = this.restReady ? this.pullAt(this.recoverT) : 0;
      if (this.recoverT >= 0) {
        if (this.pullLatch && this.recoverT >= this.pullHold && (this.latchT += h) < this.pullLatchMax) this.recoverT = this.pullHold;
        else { this.recoverT += h; if (this.recoverT > this.pullHold + 6 * this.pullDecay) { this.recoverT = -1; this.pullLatch = false; } }
      }
    }
    this.broadPhase();
    for (let s = 0; s < this.substeps; s++) this.substep(sdt);
    if (typeof performance !== "undefined") this.lastSolveMs = performance.now() - t0;
  }

  substep(dt: number): void {
    const n = this.n, pos = this.pos, prev = this.prev, vel = this.vel, w = this.w, nrm = this.nrm, kind = this.kind, rest = this.rest;
    const gdt = -this.gravity * dt;
    const damp = Math.max(0, 1 - this.damping * dt);
    const vmax = this.vmax, vmax2 = vmax * vmax;
    const k1 = this.dragLin * dt, k2 = this.dragQuad * dt, s1 = this.strDragLin * dt, s2 = this.strDragQuad * dt;
    const wx0 = this.windX, wy0 = this.windY, wz0 = this.windZ, windM = this.windM;
    const pc = this.pull > 0 ? 1 - Math.exp(-this.pull * dt) : 0, ps = pc * this.pullString;

    for (let i = 0, i3 = 0; i < n; i++, i3 += 3) {
      if (w[i] === 0) continue;
      let vx = vel[i3], vy = vel[i3 + 1] + gdt, vz = vel[i3 + 2];
      let px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
      if (pc > 0) { // the pull home moves the particle and its previous position alike: no speed is added
        const k = kind[i] === KIND_STRING ? ps : pc;
        px += (rest[i3] - px) * k; py += (rest[i3 + 1] - py) * k; pz += (rest[i3 + 2] - pz) * k;
      }
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
    // While the hand opens (releaseTime after a release) the same particle is treated alike, with its extra weight and
    // the force cap fading out together.
    const opening = this.grabIdx < 0 && this.relIdx >= 0;
    const g = opening ? this.relIdx : this.grabIdx;
    const u = opening ? Math.min(1, this.relT / this.releaseTime) : 0, hold = (1 - u) * (1 - u);
    const heavy = 0.04 + 0.96 * (1 - hold);
    let gw = 0;
    if (g >= 0) {
      const g3 = g * 3;
      gw = w[g]; w[g] = gw * heavy;
      const aMax = this.grabForce * this.totalMass * this.gravity * w[g] * this.massScale * hold;
      if (!opening) {
        if (this.handIdx !== g) { this.handIdx = g; this.handX = prev[g3]; this.handY = prev[g3 + 1]; this.handZ = prev[g3 + 2]; }
        const f = this.grabLag > 0 ? 1 - Math.exp(-dt / this.grabLag) : 1;
        this.handX += (this.grabX - this.handX) * f; this.handY += (this.grabY - this.handY) * f; this.handZ += (this.grabZ - this.handZ) * f;
      }
      const ex = this.handX - pos[g3], ey = this.handY - pos[g3 + 1], ez = this.handZ - pos[g3 + 2];
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
    const nS = this.limiting ? this.nStretch : 0, nTrig = g >= 0 || this.pullLatch ? nS : this.strained ? Math.min(nS, this.nStretchCloth) : 0;
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
      if (c < nTrig && len > cMax[c]) over = true;
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
    if (g >= 0) w[g] = gw * heavy;

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
