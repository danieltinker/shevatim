// Solver-only CPU benchmark (no rendering).
//   npx esbuild cloth-lab/bench.ts --bundle --platform=node --format=cjs --outfile=<dir>/bench.cjs && node <dir>/bench.cjs
// "hanging": the garment hanging still, as built (no settled pose saved: what this bench always measured).
// Then, settled and saved as in the engine, in the draught: "idle" (untouched), "held" (a hand drags the chest
// sideways and back: strain limiting at work) and "released" (the 3 s after letting go: the pull home at its
// strongest, strain limiting on; at 2 s the engine has looked and found the cloth home).
import { buildGarment } from "../components/cloth/engine/garment";
import type { Garment } from "../components/cloth/engine/garment";

function wind(G: Garment, t: number): void { // as the engine's lazy indoor draught
  const s = G.sim;
  const base = 0.12 + 0.07 * Math.sin(t * 0.23) + 0.04 * Math.sin(t * 0.61 + 1.3);
  const gust = Math.pow(Math.max(0, Math.sin(t * 0.17 + 0.6) * Math.sin(t * 0.071 + 2.1)), 3) * 1.6;
  const a = 0.9 * Math.sin(t * 0.11) + 0.5 * Math.sin(t * 0.29 + 0.7);
  const sp = base + gust * 0.35;
  s.windX = Math.sin(a) * sp; s.windZ = Math.cos(a) * sp * 0.9; s.windY = 0.03 * Math.sin(t * 0.4);
  s.windPhase = t * 0.9; s.windGust = gust;
}
const stats = (times: number[]): string => {
  const t = [...times].sort((x, y) => x - y), n = t.length, mean = t.reduce((x, y) => x + y, 0) / n;
  return `mean ${mean.toFixed(3)} median ${t[n >> 1].toFixed(3)} p90 ${t[Math.floor(n * 0.9)].toFixed(3)}`;
};
for (const q of ["high", "low"] as const) {
  const g = buildGarment({ shape: "hooded-poncho", trim: "tassels" }, q, false);
  if (process.env.STRAIN_ITERS) g.sim.strainIters = Number(process.env.STRAIN_ITERS); // 0 = the solver without strain limiting, for comparison
  for (let k = 0; k < 120; k++) { g.sim.frame(1 / 60); if (k % 2 === 0) { g.body.update(); g.hood?.update(); } }
  const N = 300;
  let t0 = performance.now();
  const times: number[] = [];
  for (let k = 0; k < N; k++) { const a = performance.now(); g.sim.frame(1 / 60); times.push(performance.now() - a); }
  times.sort((x, y) => x - y);
  const solve = (performance.now() - t0) / N;
  console.log(q, "solver ms/frame min", times[0].toFixed(3), "median", times[N >> 1].toFixed(3), "p90", times[Math.floor(N * 0.9)].toFixed(3));
  t0 = performance.now();
  for (let k = 0; k < N; k++) { g.body.update(); g.hood?.update(); }
  const surf = (performance.now() - t0) / N;
  console.log(q, JSON.stringify(g.counts), "substeps", g.sim.substeps, "solver ms/frame", solve.toFixed(3), "surface ms/frame", surf.toFixed(3), "kinetic", g.sim.kinetic.toExponential(2));

  // settled and saved as the engine does, then a minute of use
  const G = buildGarment({ shape: "hooded-poncho", trim: "tassels" }, q, false), s = G.sim, saveSub = s.substeps;
  for (let k = 200; k > 0; k--) { s.damping = k > 60 ? 8 : 2; s.substeps = Math.min(saveSub, 10); s.frame(1 / 60); if (k % 2 === 0) { G.body.update(); G.hood?.update(); } }
  s.damping = 0.7; s.substeps = saveSub; s.zeroVelocities(); s.saveRest(); G.body.update(); G.hood?.update();
  let t = 0;
  const run = (n: number, each?: (k: number) => void): number[] => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) { t += 1 / 60; wind(G, t); each?.(k); const a = performance.now(); s.frame(1 / 60); out.push(performance.now() - a); G.body.update(); G.hood?.update(); }
    return out;
  };
  const idle = run(300);
  const chest = Math.round(G.body.nv * 0.27) * G.body.nu + (G.body.nu >> 1) + 4, c3 = chest * 3;
  s.grabIdx = chest;
  const held = run(180, (k) => { const f = Math.sin((k / 180) * Math.PI); s.grabX = s.rest[c3] + 0.25 * f; s.grabY = s.rest[c3 + 1] + 0.05 * f; s.grabZ = s.rest[c3 + 2]; });
  s.grabIdx = -1;
  (s as { pullLatch?: boolean }).pullLatch = true; // as the engine does at a release (absent in older solvers: harmless)
  const released = run(180, (k) => { if (k === 120) (s as { pullLatch?: boolean }).pullLatch = false; });
  console.log(q, "idle", stats(idle), "| held", stats(held), "| released", stats(released));
}
