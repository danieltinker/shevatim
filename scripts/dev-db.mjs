// Local stand-in for Supabase: the real SQL (db/001_schema.sql + the seed) on an embedded Postgres (pglite),
// behind the same URLs the browser uses in production.
//   POST /rest/v1/rpc/<fn>                               the four shv_* functions (PostgREST style)
//   POST /storage/v1/object/shevatim-media/u/<ticket>/…   picture upload (needs a live upload ticket)
//   GET  /storage/v1/object/public/shevatim-media/…       serves uploaded pictures
// Env: PORT (54321) · ADMIN_PASSWORD (shevatim-dev-password) · DATA_DIR (unset = in memory, nothing is kept)
//      RATE_LIMITS=on keeps the real limits (6 reservations/hour per address, 8 wrong passwords/15 min).
//      By default the dev server forgets rate events after every call, so nobody gets locked out while building.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeedSql } from "../db/seed.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 54321);
const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : null;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "shevatim-dev-password";
const BUCKET = "shevatim-media";
const RATE_LIMITS = ["on", "1", "true"].includes(String(process.env.RATE_LIMITS ?? "").toLowerCase());
const MAX_RPC_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const MIME = { webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

// function → its named arguments and their SQL types (nothing else is callable)
const FUNCTIONS = {
  shv_catalog: {},
  shv_reserve: { p_payload: "jsonb" },
  shv_admin_login: { p_password: "text" },
  shv_admin: { p_token: "text", p_action: "text", p_payload: "jsonb" },
};

// ───────── database ─────────
if (DATA_DIR) mkdirSync(DATA_DIR, { recursive: true });
const storageDir = DATA_DIR ? join(DATA_DIR, "storage") : mkdtempSync(join(tmpdir(), "shevatim-storage-"));
mkdirSync(storageDir, { recursive: true });

const db = new PGlite({ ...(DATA_DIR ? { dataDir: join(DATA_DIR, "pg") } : {}), extensions: { pgcrypto } });
await db.exec(`
  create schema if not exists extensions;
  create extension if not exists pgcrypto with schema extensions;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;
`);
await db.exec(readFileSync(join(root, "db/001_schema.sql"), "utf8"));
await db.exec(buildSeedSql(join(root, "db/seed.json")));
const hasAdmin = (await db.query("select 1 from shevatim.admin where id = 1")).rows.length > 0;
if (!hasAdmin || process.env.ADMIN_PASSWORD) {
  await db.query("select shevatim.set_admin_password($1)", [ADMIN_PASSWORD]);
}
await db.query("select shevatim.set_setting('storagePublicBase', to_jsonb($1::text))", [
  `http://localhost:${PORT}/storage/v1/object/public/${BUCKET}`,
]);

// ───────── http helpers ─────────
function cors(req) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*",
    "access-control-max-age": "86400",
  };
}
function send(req, res, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body);
  const payload = isBuffer ? body : typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...cors(req),
    ...(isBuffer ? {} : { "content-type": "application/json; charset=utf-8" }),
    ...headers,
  });
  res.end(payload);
}
function readBody(req, limit) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { fail(Object.assign(new Error("too large"), { tooLarge: true })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", fail);
  });
}
function requestHeaders(req) {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) h[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  if (!h["x-forwarded-for"]) h["x-forwarded-for"] = req.socket.remoteAddress ?? "";
  return h;
}

// ───────── rpc ─────────
async function handleRpc(req, res, fn) {
  const spec = Object.hasOwn(FUNCTIONS, fn) ? FUNCTIONS[fn] : null;
  if (!spec) return send(req, res, 404, { code: "PGRST202", message: `Could not find the function public.${fn}` });
  let args = {};
  try {
    const raw = (await readBody(req, MAX_RPC_BYTES)).toString("utf8");
    if (raw.trim() !== "") args = JSON.parse(raw);
    if (args === null || typeof args !== "object" || Array.isArray(args)) throw new Error("not an object");
  } catch (e) {
    return send(req, res, e?.tooLarge ? 413 : 400, { code: "PGRST102", message: "bad request body" });
  }
  const names = Object.keys(spec);
  if (Object.keys(args).some((k) => !names.includes(k)) || names.some((k) => !(k in args))) {
    return send(req, res, 404, { code: "PGRST202", message: `Could not find the function public.${fn} with these arguments` });
  }
  const params = [];
  const list = names.map((name, i) => {
    const value = args[name];
    if (spec[name] === "jsonb") { params.push(JSON.stringify(value ?? null)); return `${name} => $${i + 1}::text::jsonb`; }
    params.push(value === null || value === undefined ? null : typeof value === "string" ? value : JSON.stringify(value));
    return `${name} => $${i + 1}::text`;
  });
  try {
    const out = await db.transaction(async (tx) => {
      await tx.query("select set_config('request.headers', $1, true), set_config('response.status', '', true)", [
        JSON.stringify(requestHeaders(req)),
      ]);
      const r = await tx.query(`select public.${fn}(${list.join(", ")})::text as body`, params);
      const s = await tx.query("select current_setting('response.status', true) as status");
      if (!RATE_LIMITS) await tx.query("delete from shevatim.rate_events");
      return { body: r.rows[0].body ?? "null", status: Number(s.rows[0].status) || 200 };
    });
    return send(req, res, out.status, out.body);
  } catch (e) {
    if (e && e.code === "P0001") {
      return send(req, res, 400, { code: "P0001", message: String(e.message), details: null, hint: null });
    }
    console.error(`[dev-db] ${fn} failed:`, e);
    return send(req, res, 500, { message: "server" });
  }
}

// ───────── storage ─────────
const OBJECT_PATH = /^u\/([a-f0-9]{16,64})\/([A-Za-z0-9][A-Za-z0-9._-]{0,120})$/;

async function handleUpload(req, res, path) {
  const m = OBJECT_PATH.exec(path);
  if (!m) return send(req, res, 400, { message: "bad_path" });
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (!["image/webp", "image/jpeg", "image/png"].includes(type)) return send(req, res, 415, { message: "bad_type" });
  const ok = await db.query("select shevatim.upload_ticket_ok($1) as ok", [m[1]]);
  if (!ok.rows[0].ok) return send(req, res, 403, { message: "new row violates row-level security policy" });
  let body;
  try { body = await readBody(req, MAX_UPLOAD_BYTES); } catch { return send(req, res, 413, { message: "too_large" }); }
  if (body.length === 0) return send(req, res, 400, { message: "empty" });
  const dir = join(storageDir, "u", m[1]);
  const file = join(dir, m[2]);
  if (existsSync(file) && String(req.headers["x-upsert"] ?? "false") !== "true") {
    return send(req, res, 409, { message: "The resource already exists" });
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, body);
  return send(req, res, 200, { Key: `${BUCKET}/${path}`, Id: `${m[1]}/${m[2]}` });
}

function handleDownload(req, res, path) {
  const m = OBJECT_PATH.exec(path);
  const file = m ? join(storageDir, "u", m[1], m[2]) : null;
  if (!file || !existsSync(file) || !statSync(file).isFile()) return send(req, res, 404, { message: "not_found" });
  const ext = m[2].split(".").pop().toLowerCase();
  return send(req, res, 200, readFileSync(file), {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": "public, max-age=31536000",
  });
}

// ───────── server ─────────
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return send(req, res, 400, { message: "bad_path" }); }
    if (req.method === "OPTIONS") { res.writeHead(204, cors(req)); return res.end(); }
    if (req.method === "POST" && path.startsWith("/rest/v1/rpc/")) return await handleRpc(req, res, path.slice("/rest/v1/rpc/".length));
    if (req.method === "POST" && path.startsWith(`/storage/v1/object/${BUCKET}/`)) {
      return await handleUpload(req, res, path.slice(`/storage/v1/object/${BUCKET}/`.length));
    }
    if ((req.method === "GET" || req.method === "HEAD") && path.startsWith(`/storage/v1/object/public/${BUCKET}/`)) {
      return handleDownload(req, res, path.slice(`/storage/v1/object/public/${BUCKET}/`.length));
    }
    if (req.method === "GET" && (path === "/" || path === "/health")) return send(req, res, 200, { ok: true, service: "shevatim dev-db" });
    return send(req, res, 404, { message: "not_found" });
  } catch (e) {
    console.error("[dev-db] request failed:", e);
    if (!res.headersSent) send(req, res, 500, { message: "server" });
    else res.end();
  }
});

server.on("error", (e) => {
  console.error(e && e.code === "EADDRINUSE" ? `[dev-db] port ${PORT} is already in use; start with PORT=<another port>` : e);
  process.exit(1);
});
server.listen(PORT, () => {
  if (!RATE_LIMITS) console.error("[dev-db] rate limits are off (start with RATE_LIMITS=on to keep them)");
  console.log(`dev-db ready on http://localhost:${PORT}`);
});

async function shutdown() {
  server.close();
  try { await db.close(); } catch { /* ignore */ }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
