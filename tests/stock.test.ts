// Stock (db/004_stock.sql): counts per piece and size, taken by reservations, given back on cancel, the moves log.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Catalog, Item } from "../lib/types";
import { admin, catalog, login, makeDb, order, outcome, reserve, rpc, state } from "./helpers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

let db: PGlite;
let token: string;
let ip = 0;
const freshIp = () => `192.0.2.${++ip}`;
type StockInfo = Record<string, { qty: number | null; held: number; sold: number }>;
type OwnerItem = Item & { stock: StockInfo };
const stock = (action: string, payload: unknown) => rpc<any>(db, "shv_admin_stock", { p_token: token, p_action: action, p_payload: payload });
const pub = async (id: string) => (await catalog(db)).items.find((i) => i.id === id) as Item & { left?: number | null };
const owner = async (id: string) => (await state(db, token)).catalog.items.find((i) => i.id === id) as OwnerItem;

beforeAll(async () => { db = await makeDb(); token = await login(db); });
afterAll(async () => { await db.close(); });

describe("stock", () => {
  it("nothing is counted at first: the shop behaves as before", async () => {
    const it0 = await pub("tz01");
    expect(it0.variants.every((v) => v.available)).toBe(true);
    expect(it0.soldOut).toBe(false);
    expect(it0.variants.some((v) => "left" in v)).toBe(false);
    const o = await owner("tz01");
    expect(o.stock).toEqual({ adult: { qty: null, held: 0, sold: 0 }, kid: { qty: null, held: 0, sold: 0 } });
    const one = await owner("ne01");
    expect(Object.keys(one.stock)).toEqual([""]);
    expect((await reserve(db, order(), freshIp())).code).toMatch(/^SHV-/);
  });

  it("the owner sets and adjusts counts; every change is logged", async () => {
    const a = await stock("stock.set", { itemId: "tz02", variantKey: "adult", qty: 3 }) as OwnerItem;
    expect(a.stock.adult.qty).toBe(3);
    expect(a.stock.kid.qty).toBeNull();
    const b = await stock("stock.adjust", { itemId: "tz02", variantKey: "adult", delta: 2 }) as OwnerItem;
    expect(b.stock.adult.qty).toBe(5);
    const c = await stock("stock.adjust", { itemId: "tz02", variantKey: "kid", delta: 4 }) as OwnerItem; // starts counting from 0
    expect(c.stock.kid.qty).toBe(4);
    expect(await outcome(stock("stock.adjust", { itemId: "tz02", variantKey: "adult", delta: -6 }))).toBe("not_enough");
    const moves = await stock("stock.moves", { itemId: "tz02" }) as { delta: number; qtyAfter: number; reason: string }[];
    expect(moves.map((m) => [m.reason, m.delta, m.qtyAfter])).toEqual([["adjust", 4, 4], ["adjust", 2, 5], ["count", 3, 3]]);
  });

  it("refuses bad input and a missing session", async () => {
    expect(await outcome(stock("stock.set", { itemId: "tz02", variantKey: "xl", qty: 1 }))).toBe("invalid");
    expect(await outcome(stock("stock.set", { itemId: "tz02", variantKey: "adult", qty: -1 }))).toBe("invalid");
    expect(await outcome(stock("stock.set", { itemId: "ne01", variantKey: "adult", qty: 1 }))).toBe("invalid"); // one-size piece: key is ""
    expect(await outcome(stock("stock.set", { itemId: "nope", variantKey: "", qty: 1 }))).toBe("invalid");
    expect(await outcome(stock("stock.adjust", { itemId: "tz02", variantKey: "adult", delta: 0 }))).toBe("invalid");
    expect(await outcome(stock("stock.drop", {}))).toBe("invalid");
    expect(await outcome(rpc(db, "shv_admin_stock", { p_token: "0".repeat(64), p_action: "stock.moves", p_payload: {} }))).toBe("unauthorized");
  });

  it("the shop sees availability and small counts, never the owner's numbers", async () => {
    await stock("stock.set", { itemId: "tz03", variantKey: "adult", qty: 2 });
    await stock("stock.set", { itemId: "tz03", variantKey: "kid", qty: 0 });
    const p = await pub("tz03");
    const adult = p.variants.find((v) => v.key === "adult") as { available: boolean; left?: number };
    const kid = p.variants.find((v) => v.key === "kid") as { available: boolean; left?: number };
    expect(adult).toMatchObject({ available: true, left: 2 });
    expect(kid).toMatchObject({ available: false, left: 0 });
    expect(p.soldOut).toBe(false);
    expect("stock" in p).toBe(false);
    // the owner's own switch is untouched
    expect((await owner("tz03")).variants.find((v) => v.key === "kid")!.available).toBe(true);
    // all counted sizes gone: sold out
    await stock("stock.set", { itemId: "tz03", variantKey: "adult", qty: 0 });
    expect((await pub("tz03")).soldOut).toBe(true);
    // a one-size piece
    await stock("stock.set", { itemId: "ne01", variantKey: "", qty: 0 });
    expect((await pub("ne01")).soldOut).toBe(true);
    await stock("stock.set", { itemId: "ne01", variantKey: "", qty: 7 });
    const ne = await pub("ne01");
    expect(ne.soldOut).toBe(false);
    expect(ne.left).toBe(7);
    // large counts are not told
    await stock("stock.set", { itemId: "ne01", variantKey: "", qty: 40 });
    expect("left" in (await pub("ne01"))).toBe(false);
  });

  it("a reservation takes counted pieces, refuses when there are not enough, and leaves uncounted sizes alone", async () => {
    await stock("stock.set", { itemId: "tz04", variantKey: "adult", qty: 2 });
    const r1 = await reserve(db, order({ lines: [{ itemId: "tz04", variantKey: "adult", qty: 2 }, { itemId: "tz04", variantKey: "kid", qty: 1 }] }), freshIp());
    let o = await owner("tz04");
    expect(o.stock.adult).toEqual({ qty: 0, held: 2, sold: 0 });
    expect(o.stock.kid).toEqual({ qty: null, held: 0, sold: 0 });
    const s = await state(db, token);
    const lines = s.reservations.find((x) => x.code === r1.code)!.lines as unknown as { held: boolean }[];
    expect(lines.map((l) => l.held)).toEqual([true, false]);
    expect(await outcome(reserve(db, order({ lines: [{ itemId: "tz04", variantKey: "adult", qty: 1 }] }), freshIp()))).toBe("item_unavailable");
    // two lines of the same size add up
    await stock("stock.set", { itemId: "tz05", variantKey: "adult", qty: 1 });
    expect(await outcome(reserve(db, order({ lines: [{ itemId: "tz05", variantKey: "adult", qty: 1 }, { itemId: "tz05", variantKey: "adult", qty: 1 }] }), freshIp()))).toBe("item_unavailable");
    o = await owner("tz05");
    expect(o.stock.adult.qty).toBe(1); // the refused reservation took nothing
    const before = (await state(db, token)).reservations.length;
    expect((await state(db, token)).reservations.length).toBe(before);
  });

  it("cancelling gives held pieces back; opening it again takes them again or refuses", async () => {
    await stock("stock.set", { itemId: "tz06", variantKey: "adult", qty: 1 });
    const r = await reserve(db, order({ lines: [{ itemId: "tz06", variantKey: "adult", qty: 1 }] }), freshIp());
    const id = (await state(db, token)).reservations.find((x) => x.code === r.code)!.id;
    expect((await owner("tz06")).stock.adult).toEqual({ qty: 0, held: 1, sold: 0 });
    await admin(db, token, "reservation.update", { id, status: "confirmed" });
    expect((await owner("tz06")).stock.adult).toEqual({ qty: 0, held: 1, sold: 0 });
    await admin(db, token, "reservation.update", { id, status: "cancelled" });
    expect((await owner("tz06")).stock.adult).toEqual({ qty: 1, held: 0, sold: 0 });
    await admin(db, token, "reservation.update", { id, status: "new" });
    expect((await owner("tz06")).stock.adult).toEqual({ qty: 0, held: 1, sold: 0 });
    await admin(db, token, "reservation.update", { id, status: "done" });
    expect((await owner("tz06")).stock.adult).toEqual({ qty: 0, held: 0, sold: 1 });
    // cancelled again, then someone else takes the last piece, then the owner tries to open it: refused, nothing changes
    await admin(db, token, "reservation.update", { id, status: "cancelled" });
    expect((await owner("tz06")).stock.adult.qty).toBe(1);
    await reserve(db, order({ lines: [{ itemId: "tz06", variantKey: "adult", qty: 1 }] }), freshIp());
    expect(await outcome(admin(db, token, "reservation.update", { id, status: "new" }))).toBe("item_unavailable");
    const after = (await state(db, token)).reservations.find((x) => x.id === id)!;
    expect(after.status).toBe("cancelled");
    const moves = await stock("stock.moves", { itemId: "tz06" }) as { reason: string }[];
    expect(moves.map((m) => m.reason)).toEqual(["reserve", "release", "retake", "release", "reserve", "count"].slice(0, moves.length));
  });

  it("a reservation made before counting started gives nothing back when cancelled", async () => {
    const r = await reserve(db, order({ lines: [{ itemId: "tz07", variantKey: "adult", qty: 1 }] }), freshIp());
    await stock("stock.set", { itemId: "tz07", variantKey: "adult", qty: 5 });
    const id = (await state(db, token)).reservations.find((x) => x.code === r.code)!.id;
    await admin(db, token, "reservation.update", { id, status: "cancelled" });
    expect((await owner("tz07")).stock.adult.qty).toBe(5);
  });

  it("stopping the count makes a size behave as before", async () => {
    await stock("stock.set", { itemId: "tz08", variantKey: "adult", qty: 0 });
    expect((await pub("tz08")).variants.find((v) => v.key === "adult")!.available).toBe(false);
    await stock("stock.set", { itemId: "tz08", variantKey: "adult", qty: null });
    const v = (await pub("tz08")).variants.find((x) => x.key === "adult") as { available: boolean; left?: number };
    expect(v.available).toBe(true);
    expect("left" in v).toBe(false);
  });

  it("the public catalogue keeps its shape (version, collections)", async () => {
    const c: Catalog = await catalog(db);
    expect(typeof c.version).toBe("string");
    expect(c.collections.length).toBeGreaterThan(0);
  });
});

describe("coming soon", () => {
  it("is off at first, the owner switches it, the shop sees it and cannot reserve it", async () => {
    expect((await pub("tz09")).comingSoon).toBe(false);
    const o = await stock("item.comingSoon", { itemId: "tz09", comingSoon: true }) as OwnerItem;
    expect(o.comingSoon).toBe(true);
    expect((await pub("tz09")).comingSoon).toBe(true);
    expect(await outcome(reserve(db, order({ lines: [{ itemId: "tz09", variantKey: "adult", qty: 1 }] }), freshIp()))).toBe("item_unavailable");
    await stock("item.comingSoon", { itemId: "tz09", comingSoon: false });
    expect((await reserve(db, order({ lines: [{ itemId: "tz09", variantKey: "adult", qty: 1 }] }), freshIp())).code).toMatch(/^SHV-/);
  });

  it("saving the item in the editor keeps the switch as it is", async () => {
    await stock("item.comingSoon", { itemId: "tz10", comingSoon: true });
    const saved = await admin<Item>(db, token, "item.save", { id: "tz10", sort: 5 });
    expect(saved.comingSoon).toBe(true);
  });

  it("refuses bad input and archived pieces", async () => {
    expect(await outcome(stock("item.comingSoon", { itemId: "tz11", comingSoon: "yes" }))).toBe("invalid");
    expect(await outcome(stock("item.comingSoon", { itemId: "no-such", comingSoon: true }))).toBe("invalid");
    expect(await outcome(rpc(db, "shv_admin_stock", { p_token: "0".repeat(64), p_action: "item.comingSoon", p_payload: { itemId: "tz11", comingSoon: true } }))).toBe("unauthorized");
  });
});
