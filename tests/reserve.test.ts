import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { admin, login, makeDb, order, outcome, reserve, scalar, state } from "./helpers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const CODE = /^SHV-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;
let db: PGlite;
let token: string;
let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter}`;
const count = (table: string) => scalar<number>(db, `select count(*)::int from shevatim.${table}`);

beforeAll(async () => { db = await makeDb(); token = await login(db); });
afterAll(async () => { await db.close(); });

describe("shv_reserve: happy paths", () => {
  it("stores a reservation with a snapshot taken from the database; total is null without prices", async () => {
    const res = await reserve(db, {
      ...order({
        note: "call after 6",
        locale: "fr",
        lines: [
          { itemId: "tz01", variantKey: "adult", qty: 2 },
          { itemId: "ne01", variantKey: null, qty: 1 },
        ],
      }),
    }, freshIp());
    expect(res.code).toMatch(CODE);
    expect(res.total).toBeNull();

    const s = await state(db, token);
    const r = s.reservations.find((x) => x.code === res.code)!;
    expect(r.status).toBe("new");
    expect(r.customer).toEqual({ name: "Dana Levi", phone: "+972 54-123-4567", email: "dana@example.com" });
    expect(r.locale).toBe("fr");
    expect(r.note).toBe("call after 6");
    expect(r.total).toBeNull();
    expect(r.adminNote).toBe("");
    expect(r.history).toHaveLength(1);
    expect(r.history[0].status).toBe("new");
    expect(new Date(r.createdAt).toISOString().slice(0, 19) + "Z").toBe(r.createdAt);
    const tz01 = s.catalog.items.find((i) => i.id === "tz01")!;
    expect(r.lines).toEqual([
      { itemId: "tz01", code: "tz01", name: tz01.name, variantKey: "adult", variantLabel: tz01.variants[0].label, qty: 2, unitPrice: null },
      { itemId: "ne01", code: "ne01", name: s.catalog.items.find((i) => i.id === "ne01")!.name, variantKey: null, variantLabel: null, qty: 1, unitPrice: null },
    ]);
    expect(s.counts.total).toBeGreaterThanOrEqual(1);
    expect(s.counts.new).toBeGreaterThanOrEqual(1);
  });

  it("uses the owner's prices (variant price first, then the item price) and ignores anything the client sends", async () => {
    const tz02 = (await state(db, token)).catalog.items.find((i) => i.id === "tz02")!;
    await admin(db, token, "item.save", {
      id: "tz02", price: 30000,
      variants: tz02.variants.map((v) => (v.key === "kid" ? { ...v, price: 20000 } : v)),
    });
    await admin(db, token, "item.save", { id: "br01", price: 12000 });
    const res = await reserve(db, order({
      lines: [
        { itemId: "tz02", variantKey: "adult", qty: 2, unitPrice: 1, price: 1, name: { he: "x", en: "FREE", fr: "x" } } as any,
        { itemId: "tz02", variantKey: "kid", qty: 1 },
        { itemId: "br01", variantKey: null, qty: 3 },
      ],
      ...({ total: 5 } as any),
    }), freshIp());
    expect(res.total).toBe(2 * 30000 + 20000 + 3 * 12000);
    const r = (await state(db, token)).reservations.find((x) => x.code === res.code)!;
    expect(r.total).toBe(116000);
    expect(r.lines.map((l) => l.unitPrice)).toEqual([30000, 20000, 12000]);
    expect(r.lines[0].name).toEqual(tz02.name);

    // one unpriced line makes the whole total unknown
    const mixed = await reserve(db, order({
      lines: [{ itemId: "br01", variantKey: null, qty: 1 }, { itemId: "ne01", variantKey: null, qty: 1 }],
    }), freshIp());
    expect(mixed.total).toBeNull();
  });

  it("accepts local and international phone formats and an empty e-mail", async () => {
    for (const phone of ["054-1234567", "+972 (54) 123-4567", "0541234567", "+33 6 12 34 56 78"]) {
      expect(await outcome(reserve(db, order({ customer: { name: "אבי כהן", phone, email: "" } }), freshIp()))).toBe("ok");
    }
  });
});

describe("shv_reserve: variant and availability rules", () => {
  it("rejects wrong variants and unavailable items with item_unavailable", async () => {
    const one = (line: unknown) => outcome(reserve(db, order({ lines: [line as any] }), freshIp()));
    expect(await one({ itemId: "tz01", variantKey: null, qty: 1 })).toBe("item_unavailable");   // has variants, none chosen
    expect(await one({ itemId: "tz01", variantKey: "xxl", qty: 1 })).toBe("item_unavailable");  // unknown variant
    expect(await one({ itemId: "ne01", variantKey: "adult", qty: 1 })).toBe("item_unavailable"); // has no variants
    expect(await one({ itemId: "nope", variantKey: null, qty: 1 })).toBe("item_unavailable");   // unknown item
    expect(await one({ itemId: "ne01", qty: 1 })).toBe("ok");                                    // missing key = null

    const tz03 = (await state(db, token)).catalog.items.find((i) => i.id === "tz03")!;
    await admin(db, token, "item.save", {
      id: "tz03", variants: tz03.variants.map((v) => (v.key === "kid" ? { ...v, available: false } : v)),
    });
    expect(await one({ itemId: "tz03", variantKey: "kid", qty: 1 })).toBe("item_unavailable");
    expect(await one({ itemId: "tz03", variantKey: "adult", qty: 1 })).toBe("ok");

    await admin(db, token, "item.save", { id: "pa01", soldOut: true });
    const pa01 = (await state(db, token)).catalog.items.find((i) => i.id === "pa01")!;
    const key = pa01.variants[0]?.key ?? null;
    expect(await one({ itemId: "pa01", variantKey: key, qty: 1 })).toBe("item_unavailable");
    await admin(db, token, "item.save", { id: "pa01", soldOut: false });
    expect(await one({ itemId: "pa01", variantKey: key, qty: 1 })).toBe("ok");

    await admin(db, token, "item.save", { id: "pa02", status: "draft" });
    const key2 = (await state(db, token)).catalog.items.find((i) => i.id === "pa02")!.variants[0]?.key ?? null;
    expect(await one({ itemId: "pa02", variantKey: key2, qty: 1 })).toBe("item_unavailable");
    await admin(db, token, "item.save", { id: "pa02", status: "published" });
  });
});

describe("shv_reserve: validation", () => {
  const line = { itemId: "ne01", variantKey: null, qty: 1 };
  const cases: [string, unknown][] = [
    ["payload is not an object", "hello"],
    ["payload is an array", [1, 2]],
    ["payload is null", null],
    ["customer missing", { ...order(), customer: undefined }],
    ["name too short", order({ customer: { name: "A", phone: "0541234567", email: "" } })],
    ["name only spaces", order({ customer: { name: "     ", phone: "0541234567", email: "" } })],
    ["name too long", order({ customer: { name: "x".repeat(81), phone: "0541234567", email: "" } })],
    ["name not a string", order({ customer: { name: 12345 as any, phone: "0541234567", email: "" } })],
    ["phone too short", order({ customer: { name: "Dana", phone: "123456", email: "" } })],
    ["phone too long", order({ customer: { name: "Dana", phone: "1234567890123456", email: "" } })],
    ["phone with letters", order({ customer: { name: "Dana", phone: "054-CALL-ME1", email: "" } })],
    ["phone missing", order({ customer: { name: "Dana", email: "" } as any })],
    ["email not plausible", order({ customer: { name: "Dana", phone: "0541234567", email: "dana@" } })],
    ["email with a space", order({ customer: { name: "Dana", phone: "0541234567", email: "da na@example.com" } })],
    ["email not a string", order({ customer: { name: "Dana", phone: "0541234567", email: 5 as any } })],
    ["note too long", order({ note: "n".repeat(601) })],
    ["note not a string", order({ note: { a: 1 } as any })],
    ["unknown locale", order({ locale: "de" as any })],
    ["no lines", order({ lines: [] })],
    ["lines missing", { ...order(), lines: undefined }],
    ["31 lines", order({ lines: Array.from({ length: 31 }, () => line) })],
    ["qty 0", order({ lines: [{ ...line, qty: 0 }] })],
    ["qty 11", order({ lines: [{ ...line, qty: 11 }] })],
    ["qty 1.5", order({ lines: [{ ...line, qty: 1.5 }] })],
    ["qty as a string", order({ lines: [{ ...line, qty: "2" as any }] })],
    ["qty missing", order({ lines: [{ itemId: "ne01", variantKey: null } as any] })],
    ["itemId not a string", order({ lines: [{ itemId: 7 as any, variantKey: null, qty: 1 }] })],
    ["variantKey not a string", order({ lines: [{ itemId: "ne01", variantKey: 3 as any, qty: 1 }] })],
    ["line not an object", order({ lines: ["ne01" as any] })],
    ["payload too large", { ...order(), junk: "x".repeat(210_000) }],
  ];
  it.each(cases)("rejects: %s", async (_name, payload) => {
    const before = await count("reservations");
    expect(await outcome(reserve(db, payload, "203.0.113.250"))).toBe("invalid");
    expect(await count("reservations")).toBe(before);
  });

  it("accepts the limits: 80-char name, 600-char note, 30 lines, qty 10", async () => {
    expect(await outcome(reserve(db, order({
      customer: { name: "x".repeat(80), phone: "1234567", email: "" },
      note: "n".repeat(600),
      lines: Array.from({ length: 30 }, () => ({ ...line, qty: 10 })),
    }), freshIp()))).toBe("ok");
  });
});

describe("shv_reserve: honeypot, closed shop, rate limits", () => {
  it("pretends to succeed when the honeypot is filled and stores nothing", async () => {
    const before = await count("reservations");
    const events = await count("rate_events");
    const res = await reserve(db, order({ website: "https://spam.example" }), freshIp());
    expect(res.code).toMatch(CODE);
    expect(res.total).toBeNull();
    expect(await count("reservations")).toBe(before);
    expect(await count("rate_events")).toBe(events);
    expect(await scalar<number>(db, "select count(*)::int from shevatim.reservations where code = $1", [res.code])).toBe(0);
  });

  it("answers closed when the owner closes reservations", async () => {
    await admin(db, token, "settings.save", { reservationsOpen: false });
    expect(await outcome(reserve(db, order(), freshIp()))).toBe("closed");
    await admin(db, token, "settings.save", { reservationsOpen: true });
    expect(await outcome(reserve(db, order(), freshIp()))).toBe("ok");
  });

  it("allows 6 reservations per hour per address, then too_many; other addresses are not affected", async () => {
    const ip = "192.0.2.77";
    for (let n = 0; n < 6; n++) expect(await outcome(reserve(db, order(), ip))).toBe("ok");
    expect(await outcome(reserve(db, order(), ip))).toBe("too_many");
    expect(await outcome(reserve(db, order(), "192.0.2.78"))).toBe("ok");

    // an hour later the address may reserve again
    const hash = await scalar<string>(db, "select ip_hash from shevatim.reservations order by created_at desc, id limit 1");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    await db.query(
      "update shevatim.rate_events set at = at - interval '61 minutes' where ip_hash = (select ip_hash from shevatim.rate_events group by ip_hash having count(*) = 6 limit 1)");
    expect(await outcome(reserve(db, order(), ip))).toBe("ok");
  });

  it("treats a missing address as one shared 'unknown' client", async () => {
    for (let n = 0; n < 6; n++) expect(await outcome(reserve(db, order(), null))).toBe("ok");
    expect(await outcome(reserve(db, order(), null))).toBe("too_many");
  });

  it("never stores the address itself, only a salted hash", async () => {
    await reserve(db, order(), "192.0.2.123");
    const raw = await scalar<number>(db,
      "select (select count(*) from shevatim.rate_events where ip_hash like '%192.0.2.%')::int + (select count(*) from shevatim.reservations where ip_hash like '%192.0.2.%' or lines::text like '%192.0.2.%')::int");
    expect(raw).toBe(0);
    const bad = await scalar<number>(db, "select count(*)::int from shevatim.rate_events where ip_hash !~ '^[0-9a-f]{64}$'");
    expect(bad).toBe(0);
    const unsalted = await scalar<number>(db,
      "select count(*)::int from shevatim.rate_events where ip_hash = encode(sha256(convert_to('192.0.2.123', 'UTF8')), 'hex')");
    expect(unsalted).toBe(0);
  });

  it("stops at 300 reservations per day in total", async () => {
    const have = await scalar<number>(db, "select count(*)::int from shevatim.rate_events where kind = 'reserve' and at > now() - interval '1 day'");
    await db.query("insert into shevatim.rate_events (kind, ip_hash) select 'reserve', 'filler-' || g from generate_series(1, $1::int) g", [300 - have]);
    expect(await outcome(reserve(db, order(), freshIp()))).toBe("too_many");
    await db.query("delete from shevatim.rate_events where ip_hash like 'filler-%'");
    expect(await outcome(reserve(db, order(), freshIp()))).toBe("ok");
  });

  it("old rate events do not count, and the back-office login clears them", async () => {
    await db.query("insert into shevatim.rate_events (kind, ip_hash, at) values ('reserve', 'ancient', now() - interval '3 days')");
    expect(await outcome(reserve(db, order(), freshIp()))).toBe("ok");
    await db.query("select public.shv_admin_login('not-the-password')");
    expect(await scalar<number>(db, "select count(*)::int from shevatim.rate_events where ip_hash = 'ancient'")).toBe(0);
  });
});

describe("shv_reserve: codes are unique", () => {
  it("draws a new code when the unique constraint refuses a repeated one", async () => {
    const original = await scalar<string>(db, "select pg_get_functiondef('shevatim.new_reservation_code()'::regprocedure)");
    await db.exec(`
      create sequence shevatim.test_code_seq;
      create or replace function shevatim.new_reservation_code() returns text language sql set search_path = '' as $$
        select case when nextval('shevatim.test_code_seq') <= 4 then 'SHV-AAAAA' else 'SHV-BBBBB' end
      $$;
    `);
    try {
      const first = await reserve(db, order(), freshIp());   // draw 1
      const second = await reserve(db, order(), freshIp());  // draws 2, 3, 4 clash; draw 5 is free
      expect(first.code).toBe("SHV-AAAAA");
      expect(second.code).toBe("SHV-BBBBB");
      expect(await scalar<number>(db, "select count(*)::int from shevatim.reservations where code in ('SHV-AAAAA', 'SHV-BBBBB')")).toBe(2);
      // the constraint itself is what guarantees it
      await expect(db.query("update shevatim.reservations set code = 'SHV-AAAAA' where code = 'SHV-BBBBB'")).rejects.toThrow(/unique/);
    } finally {
      await db.exec(original);
      await db.exec("drop sequence shevatim.test_code_seq");
    }
    const next = await reserve(db, order(), freshIp());
    expect(next.code).toMatch(CODE);
    expect(["SHV-AAAAA", "SHV-BBBBB"]).not.toContain(next.code);
  });

  it("real codes use only the allowed alphabet and do not repeat", async () => {
    const r = await db.query<{ c: string }>("select shevatim.new_reservation_code() as c from generate_series(1, 300)");
    for (const row of r.rows) expect(row.c).toMatch(CODE);
    expect(new Set(r.rows.map((x) => x.c)).size).toBeGreaterThan(295);
  });
});
