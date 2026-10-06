// Walks the real reservation flow against the built site (out/) and a running database.
// Build first with NEXT_PUBLIC_SUPABASE_URL pointing at the database. Usage: node scripts/walk.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const OUT = new URL("../out/", import.meta.url).pathname;
const DEST = process.env.SHOTS_DIR ?? "/home/claude/shots-storefront";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".woff2": "font/woff2", ".txt": "text/plain" };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const body = await readFile(join(OUT, p));
    res.writeHead(200, { "Content-Type": TYPES[extname(p)] ?? "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4175, r));
const base = "http://localhost:4175";
let browser;
try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }); }
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const log = [];
page.on("console", (m) => { if (m.type() === "error") log.push(m.text()); });
page.on("pageerror", (e) => log.push("PAGE " + e.message));

await page.goto(`${base}/he/item/?i=turquoise-ornament-tzitzit-tz10`, { waitUntil: "networkidle" });
await page.locator("input[name=variant][value=kid]").check({ force: true });
await page.locator("button:has-text('הוספה לשריון')").click();
await page.goto(`${base}/he/item/?i=my-story-long-sleeve-black-silver-ls01`, { waitUntil: "networkidle" });
await page.locator("input[name=variant][value=m]").check({ force: true });
await page.locator("button:has-text('הוספה לשריון')").click();
await page.locator("a:has-text('מעבר לשריון')").click();
await page.waitForURL("**/he/reserve/");
console.log("bag lines:", await page.locator("section ul > li").count(), "| header:", await page.locator("header a[class*=bag]").getAttribute("aria-label"));

// 1) the server cannot be reached
await page.route("**/rpc/shv_reserve", (r) => r.abort());
await page.fill("#f-name", "בדיקה ישראלי"); await page.fill("#f-phone", "050-123 4567"); await page.fill("#f-note", "בדיקת מערכת");
await page.locator("form button[type=submit]").click();
await page.waitForSelector("form p[role=alert]:not(:empty)");
console.log("network error →", await page.locator("form p[role=alert]").innerText());
await page.screenshot({ path: join(DEST, "walk-network-error.jpg"), type: "jpeg", quality: 75, fullPage: true });
await page.unroute("**/rpc/shv_reserve");

// 2) the real thing
await page.locator("form button[type=submit]").click();
await page.waitForURL("**/he/reserve/done/**", { timeout: 15000 }).catch(async () => console.log("NO DONE PAGE; alert:", await page.locator("form p[role=alert]").innerText().catch(() => "")));
await page.waitForTimeout(600);
console.log("url:", page.url());
console.log("code shown:", await page.locator("p bdi[dir=ltr]").first().innerText().catch(() => "—"));
console.log("receipt lines:", await page.locator("section ul li").allInnerTexts());
console.log("bag after:", await page.evaluate(() => localStorage.getItem("shv.bag")));
await page.screenshot({ path: join(DEST, "walk-done-390.jpg"), type: "jpeg", quality: 75, fullPage: true });
console.log(log.length ? "console errors:\n" + log.join("\n") : "no console errors (besides the forced network failure)");
await browser.close(); server.close();
