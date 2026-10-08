// Touch check through the DevTools protocol (real touch events, real browser scrolling) on a phone-sized stage
// inside a page that scrolls:
//   a vertical swipe that starts on the garment scrolls the page and does not take the cloth;
//   a sideways drag takes the cloth and does not scroll; so does a press-and-hold, even if the finger then moves down;
//   one finger beside the garment turns the camera; two fingers pinch to zoom.
// Then the ways a gesture can end without its pointerup, each followed by a fresh drag that must take the cloth:
//   a pointerdown whose pointerup never arrived (stale pointer), a second finger arriving mid-grab (pinch takes over),
//   a pointercancel mid-grab (the browser takes the touch), lost pointer capture, the window losing focus or the page
//   being hidden mid-grab, the stage paused mid-grab. After each, nothing may stay held, pending or pinching.
// usage: node cloth-lab/touch-check.mjs [bundle.js]
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = process.argv[2] || path.join(here, "dist/lab.js");
const types = { ".html": "text/html", ".js": "text/javascript", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const p = url === "/dist/lab.js" ? bundle : path.join(here, url);
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": types[path.extname(p)] || "text/html" }); res.end(data); });
}).listen(0);
const exe = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`http://localhost:${server.address().port}/scroll.html?live=1&quality=low&trim=tassels`);
await page.waitForFunction(() => window.ready || window.error, null, { timeout: 90000 });
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x: Math.round(x), y: Math.round(y), id })) });
const view = () => page.evaluate(() => window.handle.lab.view());
const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
const wait = (ms) => page.waitForTimeout(ms);
const onCloth = () => page.evaluate(() => { const L = window.handle.lab; return L.screen(L.named().chest); });
// A finger does not wait for the page: the moves are sent 16 ms apart whether or not the previous one was handled.
// (Software GL draws this page at a few frames per second, so waiting for each event would turn every swipe into a hold.)
const swipe = async (x, y, dx, dy, steps = 12, gap = 16) => {
  const sent = [];
  for (let k = 1; k <= steps; k++) { sent.push(touch("touchMove", [[x + (dx * k) / steps, y + (dy * k) / steps]])); await new Promise((r) => setTimeout(r, gap)); }
  await Promise.all(sent);
  return (await view()).grabbed >= 0;
};
const down = async (x, y) => { const p = touch("touchStart", [[x, y]]); await new Promise((r) => setTimeout(r, 16)); return p; };
const out = {};
let ok = true;
const expect = (name, value, pass) => { out[name] = value; if (!pass) { ok = false; out[name + "_FAILED"] = true; } };
let x, y, y0, grabbed;

// twice: with the page idle between gestures (frames as quick as on a real phone), and with the cloth simulating
// and drawing all the time (very slow frames here: the worst case for telling a swipe from a hold)
for (const mode of ["quickFrames", "slowFrames"]) {
  const rest = async (ms) => { await wait(ms); await page.evaluate((p) => window.handle.setPaused(p), mode === "quickFrames"); await wait(250); };
  const t = (n) => `${mode}.${n}`;

  // 1. vertical swipe starting on the garment
  await page.evaluate(() => window.scrollTo(0, 0)); await rest(100);
  [x, y] = await onCloth(); y0 = await scrollY();
  let d = down(x, y);
  grabbed = await swipe(x, y, 0, -200); await d;
  await touch("touchEnd", []); await wait(700);
  expect(t("verticalSwipeOnCloth_scrolledPx"), (await scrollY()) - y0, (await scrollY()) - y0 > 100);
  expect(t("verticalSwipeOnCloth_holdsCloth"), grabbed, grabbed === false);

  // 2. sideways drag on the garment
  await page.evaluate(() => window.scrollTo(0, 0)); await rest(300);
  [x, y] = await onCloth(); y0 = await scrollY();
  d = down(x, y);
  grabbed = await swipe(x, y, 120, 10); await d;
  expect(t("sidewaysDrag_holdsCloth"), grabbed, grabbed === true);
  expect(t("sidewaysDrag_scrolledPx"), (await scrollY()) - y0, Math.abs((await scrollY()) - y0) < 2);
  await touch("touchEnd", []); await wait(150);
  expect(t("releasedAfterLift"), (await view()).grabbed === -1, (await view()).grabbed === -1);

  // 3. press and hold, then pull down: the cloth is held, the page stays
  await page.evaluate(() => window.scrollTo(0, 0)); await rest(3500); // let the cloth come to rest again
  [x, y] = await onCloth(); y0 = await scrollY();
  await touch("touchStart", [[x, y]]);
  await wait(mode === "quickFrames" ? 320 : 700);
  expect(t("hold_holdsCloth"), (await view()).grabbed >= 0, (await view()).grabbed >= 0);
  grabbed = await swipe(x, y, 0, -160);
  expect(t("holdThenVertical_scrolledPx"), (await scrollY()) - y0, Math.abs((await scrollY()) - y0) < 2);
  expect(t("holdThenVertical_stillHeld"), grabbed, grabbed === true);
  await touch("touchEnd", []); await wait(150);
}
await page.evaluate(() => window.scrollTo(0, 0)); await wait(300);

// 4. a quick tap does not take the cloth
[x, y] = await onCloth();
await touch("touchStart", [[x, y]]); await wait(60); await touch("touchEnd", []); await wait(300);
expect("tap_tookCloth", (await view()).grabbed >= 0, (await view()).grabbed < 0);

// 5. one finger beside the garment turns the camera; vertical there still scrolls
const box = await page.evaluate(() => { const r = window.handle.canvas.getBoundingClientRect(); return [r.left, r.top]; });
await touch("touchStart", [[box[0] + 20, box[1] + 30]]);
await touch("touchMove", [[box[0] + 80, box[1] + 34]]); await wait(30); await touch("touchMove", [[box[0] + 140, box[1] + 36]]); await wait(30);
expect("oneFingerOnEmptyOrbits", Math.abs((await view()).azimuth) > 0.2, Math.abs((await view()).azimuth) > 0.2);
await touch("touchEnd", []);

// 6. pinch
await touch("touchStart", [[box[0] + 130, box[1] + 60]]);
await touch("touchStart", [[box[0] + 130, box[1] + 60], [box[0] + 220, box[1] + 60]]);
await touch("touchMove", [[box[0] + 90, box[1] + 60], [box[0] + 260, box[1] + 60]]); await touch("touchMove", [[box[0] + 50, box[1] + 60], [box[0] + 300, box[1] + 60]]);
expect("zoomAfterSpread", (await view()).zoom, (await view()).zoom < 0.95);
await touch("touchEnd", []);

// 7. stuck states: every path must end released, and the next touch must work
const clean = async () => { const v = await view(); return v.grabbed === -1 && v.pointer === -1 && !v.pinching && !v.pending && !v.grabbing; };
const freshStart = async () => { await page.evaluate(() => { window.handle.lab.reset(); window.scrollTo(0, 0); }); await wait(250); };
// a sideways drag on the cloth; leaves the finger down. true if the cloth is held
const drag = async () => { [x, y] = await onCloth(); const d = down(x, y); const g = await swipe(x, y, 110, 8); await d; return g; };
const lift = async () => { await touch("touchEnd", []); await wait(150); };
const nextTouchWorks = async (name) => {
  await freshStart();
  const g = await drag(); await lift();
  expect(`${name}_nextDragHolds`, g, g === true);
  expect(`${name}_nextLiftReleases`, await clean(), await clean());
};

// 7a. a pointerdown whose pointerup never comes (a stale touch id): the page must not ignore every later touch
await freshStart();
[x, y] = await onCloth();
await page.evaluate(([x, y]) => {
  const c = window.handle.canvas;
  c.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 9999, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
}, [x, y]);
await wait(400); // long enough for the hold timer to take the cloth for the phantom finger
expect("missedUp_staleHeld", (await view()).pointer === 9999, (await view()).pointer === 9999); // the stale state really was there
await nextTouchWorks("missedUp");

// 7b. a second finger arriving mid-grab: the grab ends, the pinch takes over; lifting both leaves nothing behind
await freshStart();
let g = await drag();
expect("secondFinger_heldBefore", g, g === true);
const [x2, y2] = [x + 40, y + 70];
await touch("touchStart", [[x + 110, y + 8], [x2, y2]]); await wait(120);
let v = await view();
expect("secondFinger_grabEnded", v.grabbed === -1, v.grabbed === -1);
expect("secondFinger_pinching", v.pinching, v.pinching === true);
await touch("touchMove", [[x + 130, y + 8], [x2 - 30, y2 + 40]]); await wait(60);
await touch("touchEnd", []); await wait(150);
expect("secondFinger_cleanAfterLift", await clean(), await clean());
await nextTouchWorks("secondFinger");

// 7c. pointercancel mid-grab (the browser takes the touch over)
await freshStart();
g = await drag();
expect("cancel_heldBefore", g, g === true);
await touch("touchCancel", []); await wait(150);
expect("cancel_released", await clean(), await clean());
// the cloth is let go like any release: the pull home starts with the next simulated frame
const recovering = await page.waitForFunction(() => window.handle.lab.stats().recovering, null, { timeout: 5000 }).then(() => true, () => false);
expect("cancel_recovering", recovering, recovering === true);
await nextTouchWorks("cancel");

// 7d. lost pointer capture mid-grab
await freshStart();
g = await drag();
expect("lostCapture_heldBefore", g, g === true);
await page.evaluate(() => { const v = window.handle.lab.view(); window.handle.canvas.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: v.pointer, pointerType: "touch", bubbles: true })); });
await wait(100);
expect("lostCapture_released", await clean(), await clean());
await lift();
await nextTouchWorks("lostCapture");

// 7e. the window loses focus / the page is hidden mid-grab (app switch, notification, tab change)
await freshStart();
g = await drag();
expect("blur_heldBefore", g, g === true);
await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await wait(100);
expect("blur_released", await clean(), await clean());
await lift();
await freshStart();
g = await drag();
await page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  delete document.visibilityState;
});
await wait(100);
expect("hidden_released", await clean(), await clean());
await lift();
await nextTouchWorks("hidden");

// 7f. the stage paused mid-grab (scrolled out of view)
await freshStart();
g = await drag();
await page.evaluate(() => window.handle.setPaused(true)); await wait(100);
expect("paused_released", await clean(), await clean());
await page.evaluate(() => window.handle.setPaused(false));
await lift();
await nextTouchWorks("paused");

console.log(JSON.stringify(out, null, 1));
console.log(ok ? "touch: all checks pass" : "touch: FAILED");
await browser.close(); server.close();
process.exit(ok ? 0 : 1);
