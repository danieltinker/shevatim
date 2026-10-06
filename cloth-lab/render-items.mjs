// Product stills of every tzitzit from the 3D engine, on pure black, same camera distance for every item.
// usage: node cloth-lab/render-items.mjs [all|tz01,tz07,…] [front,back,threeq]
// Writes shop/public/media/items/<code>/3d-<view>-{480,960,1600}.webp (360×480, 720×960, 1200×1600).
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
const only = process.argv[2] && process.argv[2] !== "all" ? process.argv[2].split(",") : null;
const views = (process.argv[3] || "front,back,threeq").split(",");
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
const exe = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const scale = Number(process.env.SUPERSAMPLE || 1.5); // internal resolution relative to 1200×1600
const page = await browser.newPage({ viewport: { width: Math.round(600 * scale), height: Math.round(800 * scale) }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const t0 = Date.now();
// all fronts first, then the other views, so an interrupted run still leaves a complete set of fronts
for (const pass of [views.filter((v) => v === "front"), views.filter((v) => v !== "front")]) {
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
        const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height); g.drawImage(h.canvas, 0, 0);
        return c.toDataURL("image/png");
      }, [AZ[view], ELEVATION, DISTANCE, ty]);
      const png = Buffer.from(url.split(",")[1], "base64");
      const dir = path.join(shop, "public/media/items", item.code);
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, w, h] of [["1600", 1200, 1600], ["960", 720, 960], ["480", 360, 480]]) {
        await sharp(png).resize(w, h, { fit: "cover", kernel: "lanczos3" }).webp({ quality: 86 }).toFile(path.join(dir, `3d-${view}-${name}.webp`));
      }
    }
    console.log(item.code, pass.join("+"), ((Date.now() - t0) / 1000).toFixed(0) + "s");
  }
}
await browser.close(); server.close();
