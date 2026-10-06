import { buildGarment } from "../components/cloth/engine/garment";
for (const q of ["high", "low"] as const) {
  const g = buildGarment({ shape: "hooded-poncho", trim: "tassels" }, q, false);
  const s = g.sim;
  const report = (label: string) => {
    const ke = [0, 0, 0], cnt = [0, 0, 0]; let fast = "";
    for (let i = 0; i < s.n; i++) { if (s.w[i] === 0) continue; const k = s.kind[i] === 1 ? 2 : i >= g.counts.body ? 1 : 0; const v2 = s.vel[i*3]**2 + s.vel[i*3+1]**2 + s.vel[i*3+2]**2; ke[k] += v2; cnt[k]++; if (v2 > 0.25 && fast.length < 200) fast += ` [${k}:${i - (k === 1 ? g.counts.body : 0)} v=${Math.sqrt(v2).toFixed(1)} y=${s.pos[i*3+1].toFixed(2)} x=${s.pos[i*3].toFixed(2)}]`; }
    console.log(q, label, "rms v body/hood/strings", ke.map((e, k) => Math.sqrt(e / cnt[k]).toFixed(4)).join(" "), fast);
  };
  for (let k = 0; k <= 500; k++) { s.damping = k < 140 ? 8 : k < 200 ? 2 : 0.25; s.frame(1 / 60); if (k % 2 === 0) { g.body.update(); g.hood?.update(); } if (k % 100 === 0) report("f" + k); }
}
