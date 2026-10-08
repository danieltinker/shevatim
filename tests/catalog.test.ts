import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { TRIBE_KEYS } from "../lib/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SEED_SQL, admin, catalog, login, makeDb, scalar, seed } from "./helpers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

let db: PGlite;
beforeAll(async () => { db = await makeDb(); });
afterAll(async () => { await db.close(); });

describe("shv_catalog", () => {
  it("returns exactly the seed catalogue", async () => {
    const cat = await catalog(db);
    const { version, ...rest } = cat;
    const { version: _seedVersion, ...expected } = seed;
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
    // the database adds one switch the seed does not carry: nothing is "coming soon" at first
    expect(rest).toEqual({ ...expected, items: expected.items.map((i) => ({ ...i, comingSoon: false })) });
  });

  it("has 61 items, 6 categories and 12 tribes × 5 slots", async () => {
    const cat = await catalog(db);
    expect(cat.items).toHaveLength(61);
    expect(cat.categories).toHaveLength(6);
    expect(cat.collections).toHaveLength(1);
    const slots = cat.collections[0].slots;
    expect(Object.keys(slots).sort()).toEqual([...TRIBE_KEYS].sort());
    for (const tribe of TRIBE_KEYS) expect(slots[tribe]).toHaveLength(5);
    expect(cat.items.every((i) => i.status === "published" && i.price === null)).toBe(true);
    expect(cat.collections[0].isCurrent).toBe(true);
  });

  it("keeps the same version until something changes", async () => {
    const a = await catalog(db);
    const b = await catalog(db);
    expect(b.version).toBe(a.version);
    const token = await login(db);
    await admin(db, token, "settings.save", { email: "shop@example.com" });
    const c = await catalog(db);
    expect(c.version).not.toBe(a.version);
    await admin(db, token, "item.save", { id: "br01", soldOut: true });
    const d = await catalog(db);
    expect(d.version).not.toBe(c.version);
    await admin(db, token, "item.save", { id: "br01", soldOut: false });
    await admin(db, token, "settings.save", { email: "" });
  });

  it("does not leak private settings", async () => {
    const cat = await catalog(db);
    expect(Object.keys(cat.settings).sort()).toEqual(
      ["announcement", "calLink", "email", "heroLine", "instagram", "reservationsOpen", "slotsPerTribe", "whatsapp"]);
    expect(JSON.stringify(cat)).not.toContain("ipSalt");
    expect(JSON.stringify(cat)).not.toContain("storagePublicBase");
  });
});

describe("seed file and migration", () => {
  it("003_seed.sql is the current seed.json, minified, in one load_seed call", () => {
    expect(SEED_SQL).toContain(JSON.stringify(seed));
    expect(SEED_SQL.match(/shevatim\.load_seed\(/g)).toHaveLength(1);
  });

  it("running the migration and the seed again changes nothing the owner edited", async () => {
    const token = await login(db);
    await admin(db, token, "item.save", { id: "ne01", name: { he: "שרשרת", en: "Owner Necklace", fr: "Collier" }, price: 15000 });
    await admin(db, token, "settings.save", { heroLine: { he: "א", en: "Owner line", fr: "b" } });
    const { SCHEMA_SQL } = await import("./helpers");
    await db.exec(SCHEMA_SQL);
    await db.exec(SEED_SQL);
    const cat = await catalog(db);
    const ne = cat.items.find((i) => i.id === "ne01")!;
    expect(ne.name.en).toBe("Owner Necklace");
    expect(ne.price).toBe(15000);
    expect(cat.settings.heroLine.en).toBe("Owner line");
    expect(cat.items).toHaveLength(61);
    // the owner's login survives a re-run too
    expect(await admin(db, token, "logout")).toEqual({ ok: true });
    await admin(db, await login(db), "item.save", { id: "ne01", name: seed.items.find((i) => i.id === "ne01")!.name, price: null });
    await admin(db, await login(db), "settings.save", { heroLine: seed.settings.heroLine });
  });
});

describe("privileges", () => {
  async function asAnon<T>(fn: () => Promise<T>): Promise<T> {
    await db.exec("set role anon");
    try { return await fn(); } finally { await db.exec("reset role"); }
  }

  it("anon can call the public functions but cannot touch the private schema", async () => {
    const version = await asAnon(() => scalar<string>(db, "select public.shv_catalog() ->> 'version'"));
    expect(version.length).toBeGreaterThan(0);
    await expect(asAnon(() => db.query("select count(*) from shevatim.items"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(() => db.query("select * from shevatim.admin"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(() => db.query("select shevatim.set_admin_password('hacked-password')"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(() => db.query(`select shevatim.set_setting('whatsapp', '"1"')`))).rejects.toThrow(/permission denied/);
    await expect(asAnon(() => db.query(`select shevatim.load_seed('{}')`))).rejects.toThrow(/permission denied/);
  });

  it("every table has row level security on and no policy", async () => {
    const off = await scalar<number>(db,
      "select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'shevatim' and c.relkind = 'r' and not c.relrowsecurity");
    const tables = await scalar<number>(db,
      "select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'shevatim' and c.relkind = 'r'");
    const policies = await scalar<number>(db, "select count(*)::int from pg_policies where schemaname = 'shevatim'");
    expect(tables).toBe(11); // 9 in 001_schema.sql + stock and stock_moves in 004_stock.sql
    expect(off).toBe(0);
    expect(policies).toBe(0);
  });

  it("all five public functions are security definer with an empty search_path", async () => {
    const r = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      "select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'shv\\_%' order by 1");
    expect(r.rows.map((x) => x.proname)).toEqual(["shv_admin", "shv_admin_login", "shv_admin_stock", "shv_catalog", "shv_reserve"]);
    for (const row of r.rows) {
      expect(row.prosecdef).toBe(true);
      expect(String(row.proconfig)).toMatch(/search_path=("")?$/);
    }
  });

  it("002_storage.sql: bucket + one insert policy; anon uploads only under u/<live ticket>/ (storage schema imitated)", async () => {
    // a minimal copy of Supabase's storage schema, enough to run the real file
    await db.exec(`
      create schema storage;
      create table storage.buckets (id text primary key, name text not null, public boolean default false,
                                    file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(name text) returns text[] language sql immutable as $$
        select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
      $$;
      insert into storage.buckets (id, name) values ('other', 'other');
      grant usage on schema storage to anon;
      grant select, insert, update, delete on storage.objects to anon;
    `);
    const storageSql = readFileSync(join(ROOT, "db/002_storage.sql"), "utf8");
    await db.exec(storageSql);
    await db.exec(storageSql); // idempotent
    const bucket = await db.query<any>("select * from storage.buckets where id = 'shevatim-media'");
    expect(bucket.rows[0]).toMatchObject({ name: "shevatim-media", public: true, allowed_mime_types: ["image/webp", "image/jpeg", "image/png"] });
    expect(Number(bucket.rows[0].file_size_limit)).toBe(6 * 1024 * 1024);
    expect(await scalar<number>(db, "select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'")).toBe(1);

    const token = await login(db);
    const t = await admin(db, token, "upload.ticket");
    const put = (bucketId: string, name: string) =>
      asAnon(() => db.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [bucketId, name]));
    await put("shevatim-media", `${t.prefix}/abc-480.webp`);
    await put("shevatim-media", `${t.prefix}/abc-960.webp`);
    await expect(put("shevatim-media", `u/${"0".repeat(32)}/abc-480.webp`)).rejects.toThrow(/row-level security/);
    await expect(put("shevatim-media", `x/${t.ticket}/abc-480.webp`)).rejects.toThrow(/row-level security/);
    await expect(put("shevatim-media", `${t.prefix}/deeper/abc-480.webp`)).rejects.toThrow(/row-level security/);
    await expect(put("shevatim-media", `${t.ticket}/abc-480.webp`)).rejects.toThrow(/row-level security/);
    await expect(put("shevatim-media", "abc-480.webp")).rejects.toThrow(/row-level security/);
    await expect(put("other", `${t.prefix}/abc-480.webp`)).rejects.toThrow(/row-level security/);
    // no read, change or delete through the table for anon: no policy allows it
    expect(await asAnon(() => scalar<number>(db, "select count(*)::int from storage.objects"))).toBe(0);
    expect((await asAnon(() => db.query("delete from storage.objects"))).affectedRows).toBe(0);
    expect((await asAnon(() => db.query("update storage.objects set name = 'x'"))).affectedRows).toBe(0);
    expect(await scalar<number>(db, "select count(*)::int from storage.objects")).toBe(2);
    // once the ticket is over, so are uploads
    await db.query("update shevatim.upload_tickets set expires_at = now() - interval '1 second' where ticket = $1", [t.ticket]);
    await expect(put("shevatim-media", `${t.prefix}/late-480.webp`)).rejects.toThrow(/row-level security/);
  });
});
