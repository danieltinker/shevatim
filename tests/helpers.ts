// Test helpers: the real SQL files on an in-memory pglite, called the way PostgREST (and scripts/dev-db.mjs) does.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ApiError } from "../lib/types";
import type { AdminState, Catalog, ReservationInput } from "../lib/types";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const PASSWORD = "correct horse battery";
export const SCHEMA_SQL = readFileSync(join(ROOT, "db/001_schema.sql"), "utf8") + "\n" + readFileSync(join(ROOT, "db/004_stock.sql"), "utf8");
export const SEED_SQL = readFileSync(join(ROOT, "db/003_seed.sql"), "utf8");
export const seed = JSON.parse(readFileSync(join(ROOT, "db/seed.json"), "utf8")) as Catalog;

export async function makeDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create role anon nologin;
    create role authenticated nologin;
  `);
  await db.exec(SCHEMA_SQL);
  await db.exec(SEED_SQL);
  await db.query("select shevatim.set_admin_password($1)", [PASSWORD]);
  await db.query(`select shevatim.set_setting('storagePublicBase', '"https://example.test/storage/v1/object/public/shevatim-media"')`);
  return db;
}

/** Calls public.<fn> with named arguments inside one transaction, with the request headers PostgREST would set.
 *  Errors come back the way lib/api.ts sees them: an ApiError whose code is the SQL exception text. */
export async function rpc<T = any>(
  db: PGlite, fn: string, args: Record<string, unknown> = {}, ip: string | null = "198.51.100.1",
): Promise<T> {
  const names = Object.keys(args);
  const params = names.map((n) => (n === "p_payload" ? JSON.stringify(args[n] ?? null) : (args[n] as string | null)));
  const list = names.map((n, i) => `${n} => $${i + 1}::text${n === "p_payload" ? "::jsonb" : ""}`);
  let out: { body: any; status: number } | undefined;
  try {
    out = await db.transaction(async (tx) => {
      await tx.query("select set_config('request.headers', $1, true), set_config('response.status', '', true)", [
        JSON.stringify(ip === null ? {} : { "x-forwarded-for": `${ip}, 10.0.0.1` }),
      ]);
      const r = await tx.query<{ body: string }>(`select public.${fn}(${list.join(", ")})::text as body`, params);
      const s = await tx.query<{ status: string }>("select current_setting('response.status', true) as status");
      return { body: JSON.parse(r.rows[0].body), status: Number(s.rows[0].status) || 200 };
    });
  } catch (e: any) {
    if (e?.code === "P0001") throw new ApiError(String(e.message));
    throw e;
  }
  if (!out) throw new Error("no result");
  if (out.status >= 400) throw new ApiError(String(out.body?.message));
  return out.body as T;
}

/** "ok" when the promise resolves, else the ApiError code. Anything else is rethrown. */
export async function outcome(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) { if (e instanceof ApiError) return e.code; throw e; }
}

export const catalog = (db: PGlite) => rpc<Catalog>(db, "shv_catalog");
export const reserve = (db: PGlite, input: unknown, ip: string | null = "198.51.100.1") =>
  rpc<{ code: string; total: number | null }>(db, "shv_reserve", { p_payload: input }, ip);
export const login = async (db: PGlite, password = PASSWORD, ip: string | null = "198.51.100.200") =>
  (await rpc<{ token: string; expiresAt: string }>(db, "shv_admin_login", { p_password: password }, ip)).token;
export const admin = <T = any>(db: PGlite, token: string, action: string, payload: unknown = {}) =>
  rpc<T>(db, "shv_admin", { p_token: token, p_action: action, p_payload: payload });
export const state = (db: PGlite, token: string) => admin<AdminState>(db, token, "state");

export function order(over: Partial<ReservationInput> = {}): ReservationInput {
  return {
    customer: { name: "Dana Levi", phone: "+972 54-123-4567", email: "dana@example.com" },
    locale: "he",
    note: "",
    lines: [{ itemId: "tz01", variantKey: "adult", qty: 1 }],
    website: "",
    ...over,
  };
}

export async function scalar<T = any>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<Record<string, T>>(sql, params as any[]);
  return Object.values(r.rows[0])[0];
}

export const L = (en: string) => ({ he: en, en, fr: en });
