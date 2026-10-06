// Product stills of every tzitzit from the 3D engine as transparent cut-outs (RGBA WebP), same camera distance for every item.
// usage: node cloth-lab/render-items.mjs [all|tz01,tz07,…] [front,back,threeq] [--out <dir>] [--one-pass]
//   run `node cloth-lab/build.mjs` first (bundles the engine into cloth-lab/dist/lab.js).
//   --out <dir>   where the <code>/ folders go (default: <repo>/public/media/items)
//   --one-pass    shoot all views of an item on one load (about a third faster: the cloth settles once per item);
//                 default is all fronts first, then the other views, so an interrupted run leaves a complete set of fronts
//   CHROME_PATH   Chromium binary (default /opt/pw-browsers/chromium); SUPERSAMPLE internal scale (default 1.5)
// Writes <out>/<code>/3d-<view>-{480,960,1600}.webp (360×480, 720×960, 1200×1600).
// Nothing is drawn behind the garment: the engine clears to transparent and has no ground, vignette or shadow catcher
// (the only shadows are the garment's own, on itself). The garment colour is bled outward under the alpha so that
// neither the lossy colour planes nor a scaling browser can pull a dark fringe in from the empty pixels.
import { chromium } from "playwright";
import sharp from "sharp";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shop = path.dirname(here);
const seed = JSON.parse(fs.readFileSync(path.join(shop, "db/seed.json"), "utf8"));
const ovPath = path.join(shop, "db/cloth-overrides.json");
const overrides = fs.existsSync(ovPath) ? JSON.parse(fs.readFileSync(ovPath, "utf8")) : {};
const argv = process.argv.slice(2);
const onePass = argv.includes("--one-pass"); if (onePass) argv.splice(argv.indexOf("--one-pass"), 1);
const outAt = argv.indexOf("--out");
const outRoot = outAt >= 0 ? path.resolve(argv.splice(outAt, 2)[1]) : path.join(shop, "public/media/items");
const only = argv[0] && argv[0] !== "all" ? argv[0].split(",") : null;
const views = (argv[1] || "front,back,threeq").split(",");
const items = seed.items.filter((i) => i.cloth && (!only || only.includes(i.code)));
const AZ = { front: 0, back: Math.PI, threeq: (35 * Math.PI) / 180 };
const ELEVATION = 0.07;   // a slight look down, like a studio shot
const DISTANCE = 3.22;    // the full hooded poncho with its strings fills ~86% of the height
const types = { ".html": "text/html", ".js": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const p = url.startsWith("/media/") ? path.join(shop, "public", url) : path.join(shop, url);
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" }); res.end(data);
  });
}).listen(0);
const port = server.address().port;
const exe = process.env.CHROME_PATH || "/opt/pw-browsers/chromium";

/** Straight-alpha RGBA in place: pixels that are (nearly) empty take the colour of the nearest garment pixels, so the
 *  colour planes carry garment colour past the outline. The alpha itself is not touched. */
function bleed(px, w, h, passes = 10) {
  const n = w * h;
  const known = new Uint8Array(n);
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let i = 0; i < n; i++) if (px[i * 4 + 3] >= 96) { known[i] = 1; sr += px[i * 4]; sg += px[i * 4 + 1]; sb += px[i * 4 + 2]; sn++; }
  if (!sn) return;
  let front = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (known[i]) continue;
    if ((x > 0 && known[i - 1]) || (x < w - 1 && known[i + 1]) || (y > 0 && known[i - w]) || (y < h - 1 && known[i + w])) front.push(i);
  }
  for (let p = 0; p < passes && front.length; p++) {
    const vals = new Uint8Array(front.length * 3);
    front.forEach((i, k) => {
      const x = i % w, y = (i / w) | 0; let r = 0, g = 0, b = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx; if (!known[j]) continue;
        r += px[j * 4]; g += px[j * 4 + 1]; b += px[j * 4 + 2]; c++;
      }
      vals[k * 3] = r / c; vals[k * 3 + 1] = g / c; vals[k * 3 + 2] = b / c;
    });
    front.forEach((i, k) => { px[i * 4] = vals[k * 3]; px[i * 4 + 1] = vals[k * 3 + 1]; px[i * 4 + 2] = vals[k * 3 + 2]; });
    const next = [];
    for (const i of front) known[i] = 1;
    for (const i of front) {
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx; if (!known[j]) { known[j] = 2; next.push(j); }
      }
    }
    for (const j of next) known[j] = 0;
    front = next;
  }
  const mr = sr / sn, mg = sg / sn, mb = sb / sn; // far from the garment: its mean colour, flat (costs nothing, never seen)
  for (let i = 0; i < n; i++) if (!known[i]) { px[i * 4] = mr; px[i * 4 + 1] = mg; px[i * 4 + 2] = mb; }
}
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const scale = Number(process.env.SUPERSAMPLE || 1.5); // internal resolution relative to 1200×1600
const page = await browser.newPage({ viewport: { width: Math.round(600 * scale), height: Math.round(800 * scale) }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const t0 = Date.now();
// all fronts first, then the other views, so an interrupted run still leaves a complete set of fronts
for (const pass of onePass ? [views] : [views.filter((v) => v === "front"), views.filter((v) => v !== "front")]) {
  if (!pass.length) continue;
  for (const item of items) {
    const spec = overrides[item.code] || item.cloth;
    await page.goto(`http://localhost:${port}/cloth-lab/index.html?quality=high&spec=${encodeURIComponent(JSON.stringify(spec))}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.handle || window.error, null, { timeout: 120000 });
    if (await page.evaluate(() => window.error)) { console.log(item.code, "ERROR", await page.evaluate(() => window.error)); continue; }
    await page.waitForFunction(() => window.handle.lab.textureReady(), null, { timeout: 30000 }); // never shoot before the fabric is on
    const b = await page.evaluate(() => window.handle.lab.bounds());
    const ty = (b.top + b.bottom) / 2;
    for (const view of pass) {
      const url = await page.evaluate(([az, el, d, ty]) => {
        const h = window.handle; h.lab.frame(az, el, d, ty); h.lab.render();
        const c = document.createElement("canvas"); c.width = h.canvas.width; c.height = h.canvas.height;
        const g = c.getContext("2d"); g.drawImage(h.canvas, 0, 0); // no backdrop: the still keeps the renderer's alpha
        return c.toDataURL("image/png");
      }, [AZ[view], ELEVATION, DISTANCE, ty]);
      const png = Buffer.from(url.split(",")[1], "base64");
      const dir = path.join(outRoot, item.code);
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, w, h] of [["1600", 1200, 1600], ["960", 720, 960], ["480", 360, 480]]) {
        const { data } = await sharp(png).ensureAlpha().resize(w, h, { fit: "cover", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
        bleed(data, w, h);
        await sharp(data, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 84, alphaQuality: 100, effort: 4, exact: true }).toFile(path.join(dir, `3d-${view}-${name}.webp`));
      }
    }
    console.log(item.code, pass.join("+"), ((Date.now() - t0) / 1000).toFixed(0) + "s");
  }
}
await browser.close(); server.close();
