// Renders the lab in headless Chromium (software GL) and saves stills + a frame sequence for review.
// usage: node cloth-lab/shoot.mjs [outDir] [query] [mode]
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || "/home/claude/shots-cloth";
const query = process.argv[3] || "trim=tassels";
const mode = process.argv[4] || "all";
const prefix = process.argv[5] || "r";
fs.mkdirSync(out, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  const p = path.join(here, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p.endsWith("/") ? p + "index.html" : p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "text/html" }); res.end(data);
  });
}).listen(0);
const port = server.address().port;
const exe = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 1 });
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("[console]", m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`http://localhost:${port}/index.html?${query}`);
await page.waitForFunction(() => window.handle || window.error, null, { timeout: 60000 });
if (await page.evaluate(() => window.error)) { console.log("ERROR", await page.evaluate(() => window.error)); process.exit(1); }
await page.waitForTimeout(600); // fabric picture
const save = async (name) => {
  // draw and composite over black in the same task (the canvas itself is transparent)
  const url = await page.evaluate(() => {
    const h = window.handle; h.lab.render();
    const c = document.createElement("canvas"); c.width = h.canvas.width; c.height = h.canvas.height;
    const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height); g.drawImage(h.canvas, 0, 0);
    return c.toDataURL("image/png");
  });
  fs.writeFileSync(path.join(out, name), Buffer.from(url.split(",")[1], "base64"));
};
const view = (a, e, z, ty, tx) => page.evaluate(([a, e, z, ty, tx]) => window.handle.lab.setView(a, e, z, ty ?? undefined, tx ?? undefined), [a, e, z, ty, tx]);
const step = (n) => page.evaluate((n) => window.handle.lab.step(n), n);
await step(60);
console.log("stats", JSON.stringify(await page.evaluate(() => window.handle.lab.stats())));
if (mode === "bench" || mode === "all") console.log("solver ms/frame (60 frames avg):", (await page.evaluate(() => window.handle.lab.bench(60))).toFixed(3));
await view(0, 0.06, 1); await save(`${prefix}-front.png`);
if (mode !== "front") {
  await view(0.7, 0.12, 1); await save(`${prefix}-34.png`);
  await view(Math.PI, 0.06, 1); await save(`${prefix}-back.png`);
  const hem = await page.evaluate(() => { const h = window.handle.lab; return h.corner(0); });
  await view(-0.35, 0.02, 0.36, 0.56, -0.3); await save(`${prefix}-corner.png`);
  // pull the front-right corner out and up, hold, release
  await view(0.25, 0.06, 1);
  await page.evaluate(() => { const h = window.handle.lab; h.grab(h.corner(1), 0.28, 0.2, 0.3); });
  await step(40); await page.evaluate(() => window.handle.lab.release());
  await step(24); await save(`${prefix}-pull.png`);          // 0.4 s after release
  if (mode === "all") for (let k = 0; k < 8; k++) { await step(6); await save(`${prefix}-seq-${k}.png`); }
  else await step(48);
  await step(48); await save(`${prefix}-pull-2s.png`);       // ~2 s after release
  console.log("kinetic after 2s", await page.evaluate(() => window.handle.lab.stats().kinetic));
  await step(180); console.log("kinetic after 5s", await page.evaluate(() => window.handle.lab.stats().kinetic));
}
await browser.close(); server.close();
