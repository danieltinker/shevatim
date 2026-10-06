// Live interaction check: real pointer events on the running canvas (grab, release, orbit, double-click reset).
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const p = path.join(here, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": types[path.extname(p)] || "text/html" }); res.end(data); });
}).listen(0);
const exe = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 450, height: 600 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`http://localhost:${server.address().port}/index.html?live=1&quality=low&trim=tassels`);
await page.waitForFunction(() => window.ready || window.error, null, { timeout: 90000 });
const view = () => page.evaluate(() => window.handle.lab.view());
const out = {};
out.start = await view();
await page.mouse.move(225, 330); await page.mouse.down();
out.grabbedOnCloth = (await view()).grabbed >= 0;
for (let k = 1; k <= 6; k++) { await page.mouse.move(225 + k * 15, 330 - k * 8); await page.waitForTimeout(60); }
out.kineticWhileDragging = await page.evaluate(() => window.handle.lab.stats().kinetic);
await page.mouse.up();
out.releasedAfterUp = (await view()).grabbed === -1;
await page.mouse.move(20, 30); await page.mouse.down();
out.grabbedOnEmpty = (await view()).grabbed >= 0;
for (let k = 1; k <= 6; k++) { await page.mouse.move(20 + k * 20, 30 + k * 4); await page.waitForTimeout(40); }
await page.mouse.up();
out.afterOrbit = await view();
await page.mouse.dblclick(430, 580);
await page.waitForTimeout(200);
out.afterDoubleClick = await view();
out.snapshotBytes = (await page.evaluate(() => window.handle.snapshot())).length;
await page.evaluate(() => window.handle.setPaused(true));
out.pausedFlag = (await view()).paused;
await page.evaluate(() => window.handle.dispose());
out.canvasRemoved = await page.evaluate(() => document.querySelectorAll("canvas").length === 0);
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.close();
