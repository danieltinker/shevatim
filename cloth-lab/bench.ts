// Solver-only CPU benchmark (no rendering): node cloth-lab/dist/bench.cjs
import { buildGarment } from "../components/cloth/engine/garment";
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
}
