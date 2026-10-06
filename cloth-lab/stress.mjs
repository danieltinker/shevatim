// Rough-handling check: hard drags, shaking and pulls on phone- and desktop-sized stages, stepped deterministically.
// Reports how far the cloth is from its settled pose and how stretched it is while held and 2 / 5 / 12 s after release.
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
  { name: "idle-60s", part: null, legs: [] },
];
const stages = [[358, 477, "low"], [358, 477, "high"], [540, 720, "high"]];
const rows = [];
let bad = 0;
for (const [w, h, quality] of stages) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
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
      if (!sc.part) { // no touch at all: a minute in the draught must never trip the recovery
        let peak = 0, homed = false;
        const p0 = L.stats().strainPasses ?? 0, t0 = performance.now();
        let pkHood = 0, pkShift = 0;
        for (let k = 0; k < 3600; k++) { L.step(1); if (k % 6 === 0) { const d = L.diag(); if (d.mean > peak) peak = d.mean; if (d.hood > pkHood) pkHood = d.hood; if (Math.abs(d.shiftX) > pkShift) pkShift = Math.abs(d.shiftX); } if (L.homing && L.homing()) homed = true; }
        const ms = (performance.now() - t0) / 3600;
        return { idle, hit: homed ? -1 : 0, held: L.diag(), peak, peakStrain: L.diag().strain, note: ` in 60 s untouched: peak mean ${(peak * 100).toFixed(1)}cm hood ${(pkHood * 100).toFixed(1)}cm shift ${(pkShift * 100).toFixed(1)}cm, eased back: ${homed}, extra thread passes ${(L.stats().strainPasses ?? 0) - p0}, ${ms.toFixed(2)} ms/frame` };
      }
      const [x0, y0] = L.screen(L.named()[sc.part]);
      const hit = L.down(x0, y0);
      let px = 0, py = 0, peak = 0, peakStrain = 0, peakNominal = 0;
      for (const [dx, dy, n] of sc.legs) {
        for (let k = 1; k <= n; k++) {
          L.move(x0 + px + ((dx - px) * k) / n, y0 + py + ((dy - py) * k) / n); L.step(1);
          const d = L.diag(); if (d.strain > peakStrain) peakStrain = d.strain; if (d.mean > peak) peak = d.mean; if ((d.nominal ?? d.strain) > peakNominal) peakNominal = d.nominal ?? d.strain;
        }
        px = dx; py = dy;
      }
      const p1 = L.stats().strainPasses ?? 0;
      return { idle, hit, held: L.diag(), peak, peakStrain, peakNominal, note: ` nominal peak ${peakNominal.toFixed(2)} (settled ${(idle.nominal ?? idle.strain).toFixed(2)}), ${p1} extra passes` };
    }, sc);
    await shot("0held");
    const after = {};
    let t = 0, homedAt = -1;
    for (const [sec, tag] of [[0.5, "0.5s"], [2, "2s"], [3.2, "3s"], [5, "5s"], [12, "12s"]]) {
      if (t === 0) await page.evaluate(() => window.handle.lab.up());
      const h = await page.evaluate(([n, f0]) => { const L = window.handle.lab; let at = -1; for (let k = 0; k < n; k++) { L.step(1); if (at < 0 && L.homing && L.homing()) at = f0 + k; } return at; }, [Math.round((sec - t) * 60), Math.round(t * 60)]);
      if (h >= 0 && homedAt < 0) homedAt = h / 60;
      t = sec;
      after[tag] = await page.evaluate(() => window.handle.lab.diag());
      if (tag !== "5s") await shot(`${sec < 1 ? "1" : sec < 3 ? "2" : sec < 4 ? "3" : "4"}after-${tag}`);
    }
    const f = (v) => (v * 100).toFixed(1);
    const end = after["12s"];
    const knotted = end.nan || end.mean > 0.04 || end.hood > 0.03 || Math.abs(end.shiftX) > 0.015 || end.strain > 1.12;
    const rubber = r.peakStrain > 1.25;
    if (knotted || rubber) bad++;
    rows.push(`${w}px ${quality.padEnd(4)} ${sc.name.padEnd(18)} hit=${r.hit >= 0 ? "y" : "N"} held: mean ${f(r.held.mean)}cm peak ${f(r.peak)}cm strain ${r.peakStrain.toFixed(2)} | +0.5s ${f(after["0.5s"].mean)} | +2s ${f(after["2s"].mean)} | +3.2s ${f(after["3s"].mean)} | +5s ${f(after["5s"].mean)} | +12s mean ${f(end.mean)}cm hood ${f(end.hood)}cm shiftX ${f(end.shiftX)}cm strain ${end.strain.toFixed(2)}${end.nan ? " NaN" : ""} ${knotted ? "KNOTTED" : "ok"}${rubber ? " RUBBER" : ""}${homedAt >= 0 ? ` (eased back at +${homedAt.toFixed(1)}s)` : ""} idle ${f(r.idle.mean)}cm/${r.idle.strain.toFixed(2)}${r.note ?? ""}`);
    console.log(rows[rows.length - 1]);
  }
  await page.close();
}
console.log(bad ? `${bad} scenario(s) failed` : "all scenarios recover");
await browser.close(); server.close();
process.exit(bad ? 1 : 0);
