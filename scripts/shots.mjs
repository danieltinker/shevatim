// Screenshots of the built site (out/) for looking at the work. Usage: node scripts/shots.mjs [name-filter]
// Serves out/ on a local port, walks the pages at phone and desktop sizes, cuts tall pages into contact sheets,
// and prints every console error it saw.
import { createServer } from "node:http";
import { readFile, mkdir, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const OUT = new URL("../out/", import.meta.url).pathname;
const DEST = process.env.SHOTS_DIR ?? "/home/claude/shots-storefront";
const PORT = Number(process.env.SHOTS_PORT ?? 4173);
const FILTER = process.argv[2] ?? "";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp",
  ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".txt": "text/plain", ".ico": "image/x-icon" };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    let file = normalize(join(OUT, p));
    if (!file.startsWith(OUT)) throw new Error("outside");
    const st = await stat(file).catch(() => null);
    if (st?.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
    if (range) {
      const a = Number(range[1]), b = range[2] ? Number(range[2]) : body.length - 1;
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${a}-${b}/${body.length}`, "Accept-Ranges": "bytes", "Content-Length": b - a + 1 });
      res.end(body.subarray(a, b + 1));
    } else { res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes" }); res.end(body); }
  } catch {
    const page = await readFile(join(OUT, "404.html")).catch(() => "not found"); // what a static host does
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }); res.end(page);
  }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir(DEST, { recursive: true });
const base = `http://localhost:${PORT}`;

// Two browsers: the plain one for pages (software GL caps a full-page capture at 8192px and repeats the page
// after that), and one with software WebGL so the 3D cloth draws headless (same flags as cloth-lab/).
const GL = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const start = (args) => chromium.launch({ args }).catch(() => chromium.launch({ args, executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium" }));
let browser = await start([]);
const glBrowser = await start(GL);

const SIZES = { m: { width: 390, height: 844 }, d: { width: 1440, height: 900 }, s: { width: 360, height: 780 }, l: { width: 1470, height: 745 }, t: { width: 768, height: 1024 } };
const BAG = [{ itemId: "tz10", variantKey: "kid", qty: 1 }, { itemId: "ls01", variantKey: "m", qty: 2 }];
const RECEIPT = { code: "SHV-4K7Q", total: null, lines: [
  { name: { he: "ציצית לבנה עם פרנזים", en: "White Fringe Tzitzit", fr: "Tsitsit blanc à franges" }, variant: { he: "ילד · מידה אחת", en: "Kid · one size", fr: "Enfant · taille unique" }, qty: 1, price: null },
  { name: { he: "חולצת ״זה מעשה שלי״ · שחור · כסף", en: "“My Story” Long Sleeve · Black / Silver", fr: "Manches longues « Mon histoire » · noir / argent" }, variant: { he: "M", en: "M", fr: "M" }, qty: 2, price: null } ] };

// name, path, sizes, options
const SHOTS = [
  ["home-he", "/he/", "mdsl"], ["home-en", "/en/", "mdt"], ["home-fr", "/fr/", "md"],
  ["slider-he-yehuda", "/he/#yehuda", "md", { el: "#tribes" }], ["slider-en-zevulun", "/en/#zevulun", "md", { el: "#tribes" }], ["slider-fr-yosef", "/fr/#yosef", "md", { el: "#tribes" }],
  ["collection-he", "/he/collection/", "md", { max: 3400 }], ["collection-en", "/en/collection/", "d", { max: 1800 }],
  ["tribe-he-yehuda", "/he/tribes/yehuda/", "md"], ["tribe-fr-zevulun", "/fr/tribes/zevulun/", "md", { max: 2600 }],
  ["shop-he-filter", "/he/shop/?cat=tzitziyot&tribe=levi", "md", { max: 2400 }], ["shop-fr-kippot", "/fr/shop/?cat=kippot", "md", { max: 1700 }],
  ["item-he", "/he/item/?i=white-fringe-tzitzit-tz01", "md"], ["item-en-shirt", "/en/item/?i=my-story-long-sleeve-black-silver-ls01", "mdt", { max: 1800 }],
  ["bag-he", "/he/reserve/", "md", { bag: true }], ["form-errors-he", "/he/reserve/", "md", { bag: true, submit: true }], ["form-errors-fr", "/fr/reserve/", "m", { bag: true, submit: true }],
  ["bag-empty-en", "/en/reserve/", "m"],
  ["done-he", "/he/reserve/done/?code=SHV-4K7Q", "md", { receipt: true }], ["done-en", "/en/reserve/done/?code=SHV-4K7Q", "d", { receipt: true }],
  ["cloth-home-he", "/he/", "md", { el: "[class*=clothStage]", cloth: true }], ["cloth-item-en", "/en/item/?i=turquoise-ornament-tzitzit-tz10", "md", { el: "[class*=playStage]", cloth: true }],
  ["notfound", "/no-such-page/", "md", { quiet: true }],
  ["about-he", "/he/about/", "md"], ["terms-fr", "/fr/terms/", "m"], ["menu-he", "/he/", "m", { menu: true, max: 844 }],
];

const errors = [];
async function sheet(buf, name, size) {
  const meta = await sharp(buf).metadata();
  const desktop = size.width > 1000;
  const sliceH = desktop ? 1620 : 1688, per = desktop ? 2 : 4, scale = desktop ? 0.5 : 1;
  const n = Math.ceil(meta.height / sliceH);
  for (let s = 0, k = 0; s < n; s += per, k++) {
    const parts = [];
    for (let i = s; i < Math.min(n, s + per); i++) {
      const h = Math.min(sliceH, meta.height - i * sliceH);
      const part = await sharp(buf).extract({ left: 0, top: i * sliceH, width: meta.width, height: h }).resize({ width: Math.round(meta.width * scale) }).toBuffer();
      parts.push({ input: part, left: (i - s) * Math.round(meta.width * scale + 12), top: 0 });
    }
    const W = per * Math.round(meta.width * scale + 12), H = Math.round(Math.min(sliceH, meta.height) * scale);
    await sharp({ create: { width: W, height: H, channels: 3, background: "#7a1fa2" } }).composite(parts).jpeg({ quality: 78 }).toFile(join(DEST, `${name}${n > per ? `-${k + 1}` : ""}.jpg`));
  }
}

for (const [name, path, sizes, opt = {}] of SHOTS) {
  if (FILTER && !name.includes(FILTER)) continue;
  for (const key of sizes) {
    const size = SIZES[key];
    try {
    const ctx = await (opt.cloth ? glBrowser : browser).newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: size.width < 700, isMobile: size.width < 700 });
    const page = await ctx.newPage();
    const tag = `${name}@${size.width}`;
    page.on("console", (m) => { if (m.type() === "error" && !opt.quiet && !/favicon/.test(m.location().url ?? "")) errors.push(`${tag}: ${m.text()} ${m.location().url ?? ""}`); });
    page.on("pageerror", (e) => errors.push(`${tag}: PAGE ${e.message}`));
    if (opt.bag || opt.receipt) {
      await page.addInitScript(([bag, receipt, o]) => {
        if (o.bag && !localStorage.getItem("shv.bag")) localStorage.setItem("shv.bag", JSON.stringify(bag));
        if (o.receipt) sessionStorage.setItem("shv.last", JSON.stringify(receipt));
      }, [BAG, RECEIPT, opt]);
    }
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(700);
    if (opt.submit) { await page.locator("form button[type=submit]").click(); await page.waitForTimeout(300); }
    if (opt.menu) { await page.locator("button[aria-controls=site-menu]").click(); await page.waitForTimeout(300); }
    // walk the page so lazy pictures load and in-view clips start, then wait for every picture
    if (!opt.menu) {
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo({ top: y, behavior: "instant" }); await new Promise((r) => setTimeout(r, 90)); }
        document.querySelectorAll("img[loading=lazy]").forEach((i) => { i.loading = "eager"; });
        await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 4000); }))));
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await page.waitForTimeout(500);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) errors.push(`${tag}: horizontal overflow ${overflow}px`);
    const small = await page.evaluate(() => [...document.querySelectorAll("a, button, input:not([type=hidden]), textarea")].filter((el) => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && (r.height < 40) && !el.closest("p, li > span, [class*=hp]") && cs.display !== "inline";
    }).slice(0, 6).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 20)}"`));
    if (small.length && key === "m") errors.push(`${tag}: small targets → ${small.join(" | ")}`);
    let buf;
    if (opt.el) {
      const el = page.locator(opt.el); await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
      if (opt.cloth) {
        // the engine loads when near; wait for its canvas and for the stage to fade in, then say what happened
        await page.evaluate(() => window.scrollBy({ top: -120, behavior: "instant" }));
        const ok = await page.waitForFunction((sel) => { const c = document.querySelector(sel + " canvas"); return !!c && getComputedStyle(c.parentElement).opacity === "1"; }, opt.el, { timeout: 20000 }).then(() => true, () => false);
        const box = await el.boundingBox();
        console.log(`  cloth ${tag}: ${ok ? "canvas drawing" : "NOT drawing (poster only)"}; stage ${Math.round(box.width)}×${Math.round(box.height)} in a ${size.height}px-high screen; hint "${await el.locator("span[aria-hidden=true]").last().innerText().catch(() => "")}"`);
        if (!ok) errors.push(`${tag}: the 3D cloth did not start`);
        await page.waitForTimeout(1500);
      }
      buf = await el.screenshot({ type: "png" });
    }
    else {
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      buf = await page.screenshot({ type: "png", fullPage: true, clip: opt.max ? { x: 0, y: 0, width: size.width, height: Math.min(h, opt.max) } : undefined });
    }
    await sheet(buf, `${name}-${size.width}`, size);
    await ctx.close();
    console.log("shot", tag);
    } catch (e) { errors.push(`${name}@${key}: SHOT FAILED ${String(e.message).split("\n")[0]}`); if (!browser.isConnected()) browser = await start([]); }
  }
}
await browser.close(); await glBrowser.close();
server.close();
console.log(errors.length ? `\n${errors.length} notes:\n` + [...new Set(errors)].join("\n") : "\nno console errors");
