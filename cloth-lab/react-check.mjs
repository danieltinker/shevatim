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
  page.on("console", (m) => { if (m.type() === "error" && !/status of 404/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on("response", (r) => { if (r.status() === 404 && !r.url().endsWith("/favicon.ico")) errors.push("404 " + r.url()); }); // the harness page has no favicon; anything else missing is an error
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
  else {
    // the reset control: absent until the cloth is touched, then a real, labelled, focusable button that does not move the layout
    const host = () => page.evaluate(() => { const r = document.querySelector("canvas").parentElement.parentElement.parentElement.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(","); });
    const before = await host();
    const absentBeforeTouch = await page.evaluate(() => !document.querySelector(".tz-reset"));
    await page.mouse.move(150, 220); await page.mouse.down();
    for (let k = 1; k <= 5; k++) { await page.mouse.move(150 + k * 12, 220); await page.waitForTimeout(50); }
    await page.mouse.up();
    await page.waitForSelector(".tz-reset", { timeout: 5000 }).catch(() => errors.push("reset button never appeared"));
    await page.waitForTimeout(700);
    const info = await page.evaluate(() => {
      const b = document.querySelector(".tz-reset"); if (!b) return null;
      const r = b.getBoundingClientRect(), st = getComputedStyle(b);
      return { tag: b.tagName, type: b.type, label: b.getAttribute("aria-label"), size: `${Math.round(r.width)}x${Math.round(r.height)}`, radius: st.borderRadius, color: st.color, insideImgRole: !!b.closest('[role="img"]'), tabIndex: b.tabIndex };
    });
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => { const b = document.activeElement; const st = getComputedStyle(b); return { isReset: b.classList.contains("tz-reset"), focusVisible: b.matches(":focus-visible"), outline: `${st.outlineWidth} ${st.outlineStyle} ${st.outlineColor}` }; });
    const labels = {};
    for (const l of ["he", "en", "fr"]) { await page.evaluate((l) => { document.documentElement.lang = l; }, l); await page.waitForTimeout(80); labels[l] = await page.evaluate(() => document.querySelector(".tz-reset")?.getAttribute("aria-label")); }
    await page.keyboard.press("Enter"); // keyboard activation resets
    await page.waitForTimeout(900);
    console.log(JSON.stringify({ resetButton: { absentBeforeTouch, ...info, focus, labels, layoutUnchanged: before === (await host()), stillThereAfterReset: await page.evaluate(() => !!document.querySelector(".tz-reset")) }, errors }, null, 1));
    await page.screenshot({ path: path.join(here, "dist/react-reset.png") });
  }
  await browser.close();
}
server.close();
