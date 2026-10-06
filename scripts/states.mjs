// States the seed data cannot show yet, checked by rewriting the catalogue answer on its way to the page:
// a gallery of eight pictures that starts with 3D renderings, an item without pictures, a failed send with the
// WhatsApp way out, and reserving paused. Needs the database running and a build that points at it.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const OUT = new URL("../out/", import.meta.url).pathname;
const DEST = process.env.SHOTS_DIR ?? "/home/claude/shots-storefront";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".txt": "text/plain" };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const body = await readFile(join(OUT, p));
    res.writeHead(200, { "Content-Type": TYPES[extname(p)] ?? "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4177, r));
const base = "http://localhost:4177";
let browser;
try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }); }

async function open(size, path, change, bag) {
  const ctx = await browser.newContext({ viewport: size, isMobile: size.width < 700, hasTouch: size.width < 700 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  await page.route("**/rest/v1/rpc/shv_catalog", async (route) => {
    const res = await route.fetch();
    const cat = await res.json();
    change(cat); cat.version = `${cat.version}-test`;
    await route.fulfill({ response: res, json: cat });
  });
  if (bag) await page.addInitScript((b) => localStorage.setItem("shv.bag", JSON.stringify(b)), bag);
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: join(DEST, `state-${name}.jpg`), type: "jpeg", quality: 76 });
const pic = (cat, id, i) => cat.items.find((x) => x.id === id).pictures[i];
const gallery = (cat) => {
  const it = cat.items.find((x) => x.id === "tz10");
  it.pictures = [...it.pictures.slice(0, 3).map((p) => ({ ...p, kind: "render" })), pic(cat, "tz01", 0), pic(cat, "tz01", 1), pic(cat, "tz01", 2), pic(cat, "tz02", 0), pic(cat, "tz02", 1), pic(cat, "tz03", 0)];
  cat.items.find((x) => x.id === "ls01").pictures = [];
  cat.settings.whatsapp = "972500000000";
};
const BAG = [{ itemId: "tz10", variantKey: "kid", qty: 1 }, { itemId: "ls01", variantKey: "m", qty: 2 }];

for (const [tag, size] of [["390", { width: 390, height: 844 }], ["1440", { width: 1440, height: 900 }]]) {
  const { ctx, page } = await open(size, "/he/item/?i=turquoise-ornament-tzitzit-tz10", gallery);
  console.log(`gallery@${tag}: thumbs ${await page.locator("[class*=thumbs] button").count()} (9 pictures given, 8 shown) | note: "${(await page.locator("[class*=renderNote]").innerText()).trim()}"`);
  await shot(page, `gallery-render-${tag}`);
  await page.locator("[class*=thumbs] button").nth(4).click(); await page.waitForTimeout(300);
  console.log(`  after choosing a photograph, note: "${(await page.locator("[class*=renderNote]").innerText()).trim()}"`);
  await shot(page, `gallery-photo-${tag}`);
  await ctx.close();
}
{
  const { ctx, page } = await open({ width: 390, height: 844 }, "/en/item/?i=my-story-long-sleeve-black-silver-ls01", gallery);
  console.log(`no pictures: "${(await page.locator("[class*=noPic]").innerText()).replace(/\n/g, " / ")}"`);
  await shot(page, "no-pictures-390"); await ctx.close();
}
{
  const { ctx, page } = await open({ width: 390, height: 844 }, "/he/reserve/", gallery, BAG);
  await page.route("**/rpc/shv_reserve", (r) => r.abort());
  await page.fill("#f-name", "בדיקה ישראלי"); await page.fill("#f-phone", "050-123 4567"); await page.fill("#f-note", "מידה גדולה");
  await page.locator("form button[type=submit]").click();
  const wa = page.locator("form a[href^='https://wa.me/']");
  await wa.waitFor({ timeout: 8000 });
  console.log(`network failure: "${await page.locator("form p[role=alert]").innerText()}"\n  button "${await wa.innerText()}" → ${decodeURIComponent((await wa.getAttribute("href")).split("text=")[1]).replace(/\n/g, " | ")}`);
  console.log(`  kept: name "${await page.inputValue("#f-name")}", bag lines ${await page.locator("section ul > li").count()}`);
  await page.locator("form button[type=submit]").scrollIntoViewIfNeeded(); await shot(page, "network-whatsapp-390"); await ctx.close();
}
{
  const { ctx, page } = await open({ width: 390, height: 844 }, "/fr/reserve/", (c) => { c.settings.reservationsOpen = false; }, BAG);
  console.log(`paused: "${await page.locator("#paused-h").innerText()}" | form on the page: ${await page.locator("form").count()} | bag lines ${await page.locator("section ul > li").count()}`);
  await page.locator("#paused-h").scrollIntoViewIfNeeded(); await shot(page, "paused-390"); await ctx.close();
}
await browser.close(); server.close();
