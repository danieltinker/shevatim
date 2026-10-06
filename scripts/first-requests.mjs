// What the home page asks for in its first 3 seconds, at phone and desktop width. Usage: node scripts/first-requests.mjs
// (build first; serves out/ itself). Video is counted by the bytes actually received in those 3 seconds.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const OUT = new URL("../out/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".txt": "text/plain" };
let sent = new Map();
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const body = await readFile(join(OUT, p));
    const type = TYPES[extname(p)] ?? "application/octet-stream";
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
    const a = range ? Number(range[1]) : 0, b = range && range[2] ? Number(range[2]) : body.length - 1;
    res.writeHead(range ? 206 : 200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": b - a + 1, ...(range ? { "Content-Range": `bytes ${a}-${b}/${body.length}` } : {}) });
    // count what really leaves the server (a paused video stops reading long before the end of the file)
    let n = 0; const chunk = 64 * 1024;
    const push = () => { while (a + n <= b) { const part = body.subarray(a + n, Math.min(b + 1, a + n + chunk)); n += part.length; sent.set(p, (sent.get(p) ?? 0) + part.length); if (!res.write(part)) { res.once("drain", push); return; } } res.end(); };
    res.on("close", () => {}); push();
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4176, r));
let browser;
try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }); }
for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
  sent = new Map();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
  const page = await ctx.newPage();
  await page.goto("http://localhost:4176/he/", { waitUntil: "commit" });
  await page.waitForTimeout(3000);
  const rows = [...sent].sort((x, y) => y[1] - x[1]);
  const kind = (p) => /\.mp4$/.test(p) ? "video" : /\.(webp|jpg|png|svg)$/.test(p) ? "pictures" : /\.js$/.test(p) ? "script" : /\.css$/.test(p) ? "style" : /\.woff2$/.test(p) ? "fonts" : /\.txt$/.test(p) ? "prefetch" : "html";
  const by = {}; for (const [p, n] of rows) by[kind(p)] = (by[kind(p)] ?? 0) + n;
  const total = rows.reduce((n, r) => n + r[1], 0);
  console.log(`\n${w}×${h}: ${rows.length} requests, ${(total / 1024).toFixed(0)} KB in the first 3 s`);
  console.log("  " + Object.entries(by).map(([k, n]) => `${k} ${(n / 1024).toFixed(0)} KB`).join(" · "));
  console.log("  films and clips: " + (rows.filter(([p]) => /\.mp4$/.test(p)).map(([p, n]) => `${p.split("/").pop()} ${(n / 1024).toFixed(0)} KB`).join(", ") || "none"));
  console.log("  pages and data: " + rows.filter(([p]) => /\.(html|txt)$/.test(p)).map(([p, n]) => `${p} ${(n / 1024).toFixed(0)} KB`).join(", "));
  console.log("  largest: " + rows.slice(0, 6).map(([p, n]) => `${p.split("/").pop()} ${(n / 1024).toFixed(0)} KB`).join(", "));
  await ctx.close();
}
await browser.close(); server.close();
