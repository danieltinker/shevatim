// Checks the React component: strict-mode double mount leaves exactly one canvas, poster fades once the first frame is drawn.
import { chromium } from "playwright";
import { build } from "esbuild";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
await build({ entryPoints: [path.join(here, "react-harness.tsx")], bundle: true, format: "iife", jsx: "automatic", outfile: path.join(here, "dist/react-harness.js"), define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
const types = { ".html": "text/html", ".js": "text/javascript", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const p = path.join(here, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": types[path.extname(p)] || "text/html" }); res.end(data); });
}).listen(0);
const exe = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
for (const reduced of [false, true]) {
  const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 400, height: 600 }, reducedMotion: reduced ? "reduce" : "no-preference" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://localhost:${server.address().port}/react.html`);
  await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && getComputedStyle(c.parentElement).opacity === "1"; }, null, { timeout: 90000 }).catch(() => errors.push("never became ready"));
  await page.waitForTimeout(700);
  console.log(JSON.stringify({
    reducedMotion: reduced,
    canvases: await page.evaluate(() => document.querySelectorAll("canvas").length),
    posterOpacity: await page.evaluate(() => getComputedStyle(document.querySelector("img")).opacity),
    playButton: await page.evaluate(() => !!document.querySelector("button")),
    hint: await page.evaluate(() => document.querySelector("span")?.textContent ?? null),
    errors,
  }));
  if (reduced) { await page.click("button"); await page.waitForTimeout(300); console.log("after play: button present =", await page.evaluate(() => !!document.querySelector("button"))); }
  await browser.close();
}
server.close();
