// Rough-handling check: hard drags, shaking and pulls on phone- and desktop-sized stages, stepped deterministically.
// Reports how far the cloth is from its settled pose and how stretched it is while held and 2 / 5 / 12 s after release.
// A scenario FAILS if
//   - 5 s after release the cloth's mean distance from rest is more than 1.0 cm above what the same garment, never
//     touched, shows at that same moment (the draught alone; measured per stage), or the hood is more than 1.0 cm off;
//   - it visibly jumps: from +0.5 s on, a cloth particle's motion changes by more than 2 cm from one frame to the
//     next (snap: a teleport, a reset, cloth jerked into motion), or from +1 s on any cloth particle moves more than
//     2 cm in a single frame (by then the cloth only swings home; a jump there is the recovery showing). Right after
//     the release a dropped corner legitimately falls faster than 2 cm per frame (2 m/s after 25 cm) and catches
//     with a jerk, and a stiff hood rim springs back: those are reported (first 0.5 s), not failed;
//   - 12 s after release it is still knotted (the old recovery thresholds), or the threads stretched like rubber.
// usage: node cloth-lab/stress.mjs [outDir] [bundle.js] [only-scenario]
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || "";
const bundle = process.argv[3] && process.argv[3] !== "-" ? process.argv[3] : path.join(here, "dist/lab.js");
const only = process.argv[4] || "";
if (out) fs.mkdirSync(out, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const p = url === "/dist/lab.js" ? bundle : path.join(here, url);
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": types[path.extname(p)] || "text/html" }); res.end(data); });
}).listen(0);
const exe = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

// each scenario: where to take hold, then a list of [dx, dy, frames] legs in CSS pixels relative to the start point
const scenarios = [
  { name: "hood-right-200", part: "hoodRim", legs: [[200, 0, 30], [200, 0, 30]] },
  { name: "hood-downleft-200", part: "hoodSide", legs: [[-140, 140, 30], [-140, 140, 30]] },
  { name: "hood-back-up-200", part: "hoodRim", legs: [[60, -190, 30], [60, -190, 20]] },
  { name: "shake", part: "chest", legs: [[150, 0, 9], [-150, 0, 9], [150, 0, 9], [-150, 0, 9], [150, 0, 9], [-150, 0, 9], [0, 0, 6]] },
  { name: "hem-down-200", part: "hemFront", legs: [[0, 200, 30], [0, 200, 30]] },
  { name: "corner-out-200", part: "cornerFR", legs: [[150, 130, 30], [150, 130, 30]] },
  { name: "side-drag-180", part: "chest", legs: [[180, 0, 30], [180, 0, 20]], normal: true },
  { name: "lift-corner-150", part: "cornerFR", legs: [[-60, -150, 30], [-60, -150, 20]], normal: true },
  { name: "idle-100s", part: null, legs: [] }, // through the draught's strongest gust (around 80 s)
];
const stages = [[358, 477, "low"], [358, 477, "high"], [540, 720, "high"]];
const rows = [];
let bad = 0;
const JUMP_MAX = 0.02, SNAP_MAX = 0.02, OVER_IDLE = 0.01, HOOD_MAX = 0.01;
const summary = [];
for (const [w, h, quality] of stages) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  // the draught alone: the untouched garment's distance from rest, frame by frame (the wind is a function of time)
  await page.goto(`http://localhost:${server.address().port}/index.html?quality=${quality}&trim=none`);
  await page.waitForFunction(() => window.handle || window.error, null, { timeout: 90000 });
  const ref = await page.evaluate(() => {
    const L = window.handle.lab, mean = [], hood = [];
    for (let k = 0; k < 1100; k++) { L.step(1); const d = L.diag(); mean.push(d.mean); hood.push(d.hood); }
    return { mean, hood };
  });
  const st = { stage: `${w}px ${quality}`, at2: [], at5: [], at12: [], over5: [], strain: 0, jump: 0, early: 0, snap: 0, earlySnap: 0, eased: 0, n: 0 };
  for (const sc of scenarios) {
    if (only && sc.name !== only) continue;
    await page.goto(`http://localhost:${server.address().port}/index.html?quality=${quality}&trim=none`);
    await page.waitForFunction(() => window.handle || window.error, null, { timeout: 90000 });
    const shot = async (tag) => {
      if (!out) return;
      const url = await page.evaluate(() => {
        const hd = window.handle; hd.lab.render();
        const c = document.createElement("canvas"); c.width = hd.canvas.width; c.height = hd.canvas.height;
        const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height); g.drawImage(hd.canvas, 0, 0);
        return c.toDataURL("image/png");
      });
      fs.writeFileSync(path.join(out, `${w}-${quality}-${sc.name}-${tag}.png`), Buffer.from(url.split(",")[1], "base64"));
    };
    const r = await page.evaluate((sc) => {
      const L = window.handle.lab;
      L.step(30); L.render();
      const idle = L.diag();
      if (!sc.part) { // no touch at all: 100 s in the draught (its strongest gust included) must never trip the recovery
        let peak = 0, homed = false;
        const p0 = L.stats().strainPasses ?? 0, t0 = performance.now();
        let pkHood = 0, pkShift = 0;
        for (let k = 0; k < 6000; k++) { L.step(1); if (k % 6 === 0) { const d = L.diag(); if (d.mean > peak) peak = d.mean; if (d.hood > pkHood) pkHood = d.hood; if (Math.abs(d.shiftX) > pkShift) pkShift = Math.abs(d.shiftX); } if (L.homing && L.homing()) homed = true; }
        const ms = (performance.now() - t0) / 6000;
        return { idle, hit: homed ? -1 : 0, held: L.diag(), peak, peakStrain: L.diag().strain, note: ` in 100 s untouched: peak mean ${(peak * 100).toFixed(1)}cm hood ${(pkHood * 100).toFixed(1)}cm shift ${(pkShift * 100).toFixed(1)}cm, eased back: ${homed}, extra thread passes ${(L.stats().strainPasses ?? 0) - p0}, ${ms.toFixed(2)} ms/frame` };
      }
      const [x0, y0] = L.screen(L.named()[sc.part]);
      const hit = L.down(x0, y0);
      let px = 0, py = 0, peak = 0, peakStrain = 0, peakNominal = 0, frames = 30;
      for (const [dx, dy, n] of sc.legs) {
        for (let k = 1; k <= n; k++) {
          L.move(x0 + px + ((dx - px) * k) / n, y0 + py + ((dy - py) * k) / n); L.step(1); frames++;
          const d = L.diag(); if (d.strain > peakStrain) peakStrain = d.strain; if (d.mean > peak) peak = d.mean; if ((d.nominal ?? d.strain) > peakNominal) peakNominal = d.nominal ?? d.strain;
        }
        px = dx; py = dy;
      }
      const p1 = L.stats().strainPasses ?? 0;
      if (L.jump) L.jump(); // from here on: only what happens after the release
      return { idle, hit, frames, held: L.diag(), peak, peakStrain, peakNominal, note: ` nominal peak ${peakNominal.toFixed(2)} (settled ${(idle.nominal ?? idle.strain).toFixed(2)}), ${p1} extra passes` };
    }, sc);
    await shot("0held");
    const after = {};
    let t = 0, homedAt = -1, early = 0, jump = 0, snap = 0, earlySnap = 0;
    for (const [sec, tag] of [[0.5, "0.5s"], [1, "1s"], [2, "2s"], [3.2, "3s"], [5, "5s"], [12, "12s"]]) {
      if (t === 0) await page.evaluate(() => window.handle.lab.up());
      const h = await page.evaluate(([n, f0]) => { const L = window.handle.lab; let at = -1; for (let k = 0; k < n; k++) { L.step(1); if (at < 0 && L.homing && L.homing()) at = f0 + k; } return at; }, [Math.round((sec - t) * 60), Math.round(t * 60)]);
      if (h >= 0 && homedAt < 0) homedAt = h / 60;
      const j = await page.evaluate(() => (window.handle.lab.jump ? window.handle.lab.jump() : { move: 0, snap: 0 }));
      if (sec <= 1) early = Math.max(early, j.move); else jump = Math.max(jump, j.move);
      if (sec <= 0.5) earlySnap = Math.max(earlySnap, j.snap); else snap = Math.max(snap, j.snap);
      t = sec;
      after[tag] = await page.evaluate(() => window.handle.lab.diag());
      if (tag !== "5s" && tag !== "1s") await shot(`${sec < 1 ? "1" : sec < 3 ? "2" : sec < 4 ? "3" : "4"}after-${tag}`);
    }
    const f = (v) => (v * 100).toFixed(1);
    const end = after["12s"];
    // the untouched garment at the same moment (frame index) as the +5 s look
    const k5 = sc.part ? Math.min(ref.mean.length - 1, r.frames + 5 * 60 - 1) : -1;
    const idle5 = sc.part ? ref.mean[k5] : after["5s"].mean, idleHood5 = sc.part ? ref.hood[k5] : after["5s"].hood;
    const over5 = after["5s"].mean - idle5;
    const late = sc.part ? over5 > OVER_IDLE || after["5s"].hood > HOOD_MAX : false;
    const jumped = jump > JUMP_MAX || snap > SNAP_MAX;
    const knotted = end.nan || end.mean > 0.04 || end.hood > 0.03 || Math.abs(end.shiftX) > 0.015 || end.strain > 1.12;
    const rubber = r.peakStrain > 1.25;
    if (knotted || rubber || late || jumped) bad++;
    if (sc.part) {
      st.at2.push(after["2s"].mean); st.at5.push(after["5s"].mean); st.at12.push(end.mean); st.over5.push(over5);
      st.strain = Math.max(st.strain, r.peakStrain); st.jump = Math.max(st.jump, jump); st.early = Math.max(st.early, early); st.snap = Math.max(st.snap, snap); st.earlySnap = Math.max(st.earlySnap, earlySnap); st.n++;
      if (homedAt >= 0) st.eased++;
    }
    rows.push(`${w}px ${quality.padEnd(4)} ${sc.name.padEnd(18)} hit=${r.hit >= 0 ? "y" : "N"} held: mean ${f(r.held.mean)}cm peak ${f(r.peak)}cm strain ${r.peakStrain.toFixed(2)} | +0.5s ${f(after["0.5s"].mean)} | +2s ${f(after["2s"].mean)} | +3.2s ${f(after["3s"].mean)} | +5s ${f(after["5s"].mean)} (untouched ${f(idle5)}, ${over5 >= 0 ? "+" : ""}${f(over5)}; hood ${f(after["5s"].hood)}/${f(idleHood5)}) | +12s mean ${f(end.mean)}cm hood ${f(end.hood)}cm shiftX ${f(end.shiftX)}cm strain ${end.strain.toFixed(2)}${end.nan ? " NaN" : ""} | move/frame ${f(early)}cm (0-1 s) ${f(jump)}cm (after), snap ${f(earlySnap)}cm (0-0.5 s) ${f(snap)}cm (after) ${knotted ? "KNOTTED" : late ? "LATE" : jumped ? "JUMPED" : "ok"}${rubber ? " RUBBER" : ""}${homedAt >= 0 ? ` (eased back at +${homedAt.toFixed(1)}s)` : ""} idle ${f(r.idle.mean)}cm/${r.idle.strain.toFixed(2)}${r.note ?? ""}`);
    console.log(rows[rows.length - 1]);
  }
  summary.push(st);
  await page.close();
}
const avg = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length) * 100 : 0).toFixed(2);
const mx = (a) => (a.length ? Math.max(...a) * 100 : 0).toFixed(2);
for (const st of summary) console.log(`summary ${st.stage.padEnd(11)} mean from rest after release (cm): +2s ${avg(st.at2)} | +5s ${avg(st.at5)} (worst above untouched ${mx(st.over5)}) | +12s ${avg(st.at12)} | held strain peak ${st.strain.toFixed(3)} | move/frame ${(st.early * 100).toFixed(2)}cm (0-1 s) ${(st.jump * 100).toFixed(2)}cm (after) | snap ${(st.earlySnap * 100).toFixed(2)}cm (0-0.5 s) ${(st.snap * 100).toFixed(2)}cm (after) | eased back ${st.eased}/${st.n}`);
console.log(bad ? `${bad} scenario(s) failed` : "all scenarios recover");
await browser.close(); server.close();
process.exit(bad ? 1 : 0);
