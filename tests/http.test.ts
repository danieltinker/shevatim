// Starts the real dev server (scripts/dev-db.mjs) on a free port and talks to it with lib/api.ts over HTTP.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { ApiError } from "../lib/types";
import { ROOT } from "./helpers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const PASSWORD = "http test password";
let child: ChildProcess;
let base: string;
let api: typeof import("../lib/api");

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, () => { const { port } = s.address() as { port: number }; s.close(() => ok(port)); });
  });
}

beforeAll(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), ADMIN_PASSWORD: PASSWORD, RATE_LIMITS: "on" };
  delete env.DATA_DIR;
  child = spawn(process.execPath, [join(ROOT, "scripts/dev-db.mjs")], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise<void>((ok, fail) => {
    let out = "";
    const timer = setTimeout(() => fail(new Error("dev-db did not start: " + out.slice(0, 500))), 90_000);
    child.stdout!.on("data", (d) => {
      out += String(d);
      if (out.includes(`dev-db ready on http://localhost:${port}`)) { clearTimeout(timer); ok(); }
    });
    child.stderr!.on("data", (d) => { out += String(d); });
    child.on("exit", (code) => { clearTimeout(timer); fail(new Error(`dev-db exited (${code}): ${out.slice(0, 500)}`)); });
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = base;
  api = await import("../lib/api");
});

afterAll(() => { child?.kill("SIGTERM"); });

const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof ApiError ? e.code : String(e); } };

describe("dev-db over HTTP with lib/api.ts", () => {
  it("serves the catalogue", async () => {
    const cat = await api.getCatalog();
    expect(cat.items).toHaveLength(61);
    expect(cat.categories).toHaveLength(6);
    expect(cat.collections[0].slots.yehuda).toHaveLength(5);
  });

  it("logs in, takes a reservation and shows it in the back office", async () => {
    expect(await code(api.adminLogin("wrong password"))).toBe("bad_password");
    const { token, expiresAt } = await api.adminLogin(PASSWORD);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const res = await api.createReservation({
      customer: { name: "רות כהן", phone: "054-765-4321", email: "" },
      locale: "he", note: "בבקשה להתקשר בערב", website: "",
      lines: [{ itemId: "tz05", variantKey: "kid", qty: 2 }],
    });
    expect(res.code).toMatch(/^SHV-[2-9A-Z]{5}$/);
    expect(res.total).toBeNull();

    const state = await api.adminState(token);
    expect(state.catalog.items).toHaveLength(61);
    expect(state.counts).toEqual({ new: 1, open: 1, total: 1 });
    expect(state.reservations[0]).toMatchObject({ code: res.code, customer: { name: "רות כהן" }, note: "בבקשה להתקשר בערב" });
    expect(state.reservations[0].lines[0]).toMatchObject({ itemId: "tz05", variantKey: "kid", qty: 2, unitPrice: null });

    const priced = await api.adminSaveItem(token, { id: "tz05", price: 25000 });
    expect(priced.price).toBe(25000);
    const again = await api.createReservation({
      customer: { name: "Ruth Cohen", phone: "+972547654321", email: "ruth@example.com" },
      locale: "en", note: "", website: "", lines: [{ itemId: "tz05", variantKey: "adult", qty: 2 }],
    });
    expect(again.total).toBe(50000);

    expect(await code(api.createReservation({ customer: { name: "R", phone: "1", email: "" }, locale: "he", note: "", website: "", lines: [] }))).toBe("invalid");
    expect(await code(api.adminState("0".repeat(64)))).toBe("unauthorized");
    expect(await api.adminLogout(token)).toEqual({ ok: true });
    expect(await code(api.adminState(token))).toBe("unauthorized");
  });

  it("uploads a picture with a ticket and serves it back; refuses uploads without one", async () => {
    const { token } = await api.adminLogin(PASSWORD);
    const bytes = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    const picture = await api.adminUploadPicture(
      token, [{ width: 960, blob: new Blob([bytes], { type: "image/webp" }) }, { width: 480, blob: new Blob([bytes], { type: "image/webp" }) }],
      { w: 960, h: 1280, kind: "product", view: "front" });
    expect(picture.sizes).toEqual([480, 960]);
    expect(picture.base.startsWith(`${base}/storage/v1/object/public/shevatim-media/u/`)).toBe(true);
    const got = await fetch(`${picture.base}-480.webp`);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);

    const denied = await fetch(`${base}/storage/v1/object/shevatim-media/u/${"0".repeat(32)}/x-480.webp`, {
      method: "POST", headers: { "content-type": "image/webp" }, body: bytes,
    });
    expect(denied.status).toBe(403);
    const traversal = await fetch(`${base}/storage/v1/object/shevatim-media/u/..%2F..%2Fetc/passwd`, {
      method: "POST", headers: { "content-type": "image/webp" }, body: bytes,
    });
    expect(traversal.status).toBe(400);
  });

  it("passes x-forwarded-for to the SQL, so the per-address limit works over HTTP", async () => {
    const send = (ip: string) => fetch(`${base}/rest/v1/rpc/shv_reserve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.1.1.1` },
      body: JSON.stringify({ p_payload: {
        customer: { name: "Limit Tester", phone: "0541234567", email: "" }, locale: "en", note: "", website: "",
        lines: [{ itemId: "ne01", variantKey: null, qty: 1 }],
      } }),
    });
    for (let n = 0; n < 6; n++) expect((await send("203.0.113.40")).status).toBe(200);
    const seventh = await send("203.0.113.40");
    expect(seventh.status).toBe(400);
    expect(await seventh.json()).toMatchObject({ message: "too_many" });
    expect((await send("203.0.113.41")).status).toBe(200);
  });

  it("answers the CORS preflight and refuses functions that are not part of the contract", async () => {
    const pre = await fetch(`${base}/rest/v1/rpc/shv_reserve`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:3000", "access-control-request-method": "POST", "access-control-request-headers": "apikey,authorization,content-type" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    expect(pre.headers.get("access-control-allow-headers")).toContain("apikey");
    const other = await fetch(`${base}/rest/v1/rpc/pg_sleep`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(other.status).toBe(404);
    const priv = await fetch(`${base}/rest/v1/rpc/set_admin_password`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"p":"hacked-password"}' });
    expect(priv.status).toBe(404);
    const ok = await fetch(`${base}/rest/v1/rpc/shv_catalog`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: "{}" });
    expect(ok.headers.get("access-control-allow-origin")).toBe("*");
  });
});
