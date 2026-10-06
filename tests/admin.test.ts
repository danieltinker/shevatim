import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Category, Collection, Item, Reservation, Settings } from "../lib/types";
import { TRIBE_KEYS } from "../lib/types";
import { L, PASSWORD, admin, catalog, login, makeDb, order, outcome, reserve, rpc, scalar, state } from "./helpers";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let db: PGlite;
let token: string;
beforeAll(async () => { db = await makeDb(); token = await login(db); });
afterAll(async () => { await db.close(); });

describe("shv_admin_login", () => {
  it("gives a 12-hour session for the right password and stores only a hash of the token", async () => {
    const res = await rpc<{ token: string; expiresAt: string }>(db, "shv_admin_login", { p_password: PASSWORD }, "198.51.100.10");
    expect(res.token).toMatch(/^[0-9a-f]{64}$/);
    const hours = (new Date(res.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThan(12.1);
    expect(await scalar<number>(db, "select count(*)::int from shevatim.admin_sessions where token_hash = $1", [res.token])).toBe(0);
    expect(await scalar<number>(db,
      "select count(*)::int from shevatim.admin_sessions where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [res.token])).toBe(1);
    expect(await scalar<string>(db, "select password_hash from shevatim.admin")).toMatch(/^\$2[aby]\$10\$/);
    expect((await state(db, res.token)).catalog.items.length).toBe(61);
  });

  it("answers bad_password for a wrong, empty or missing password", async () => {
    expect(await outcome(login(db, "wrong password", "198.51.100.11"))).toBe("bad_password");
    expect(await outcome(login(db, "", "198.51.100.11"))).toBe("bad_password");
    expect(await outcome(rpc(db, "shv_admin_login", { p_password: null }, "198.51.100.11"))).toBe("bad_password");
    expect(await outcome(login(db, PASSWORD + "x".repeat(300), "198.51.100.11"))).toBe("bad_password");
  });

  it("locks an address out after 8 wrong passwords in 15 minutes, even with the right one", async () => {
    const ip = "198.51.100.12";
    for (let n = 0; n < 8; n++) expect(await outcome(login(db, "guess-" + n, ip))).toBe("bad_password");
    expect(await outcome(login(db, "guess-9", ip))).toBe("too_many");
    expect(await outcome(login(db, PASSWORD, ip))).toBe("too_many");
    expect(await outcome(login(db, PASSWORD, "198.51.100.13"))).toBe("ok");
    // 15 minutes later the address is free again
    await db.query("update shevatim.rate_events set at = at - interval '16 minutes' where kind = 'login_fail'");
    expect(await outcome(login(db, PASSWORD, ip))).toBe("ok");
  });

  it("locks everybody out after 40 wrong passwords in 15 minutes", async () => {
    await db.query("insert into shevatim.rate_events (kind, ip_hash) select 'login_fail', 'filler-' || g from generate_series(1, 40) g");
    expect(await outcome(login(db, PASSWORD, "198.51.100.14"))).toBe("too_many");
    await db.query("delete from shevatim.rate_events where ip_hash like 'filler-%'");
    expect(await outcome(login(db, PASSWORD, "198.51.100.14"))).toBe("ok");
  });
});

describe("sessions", () => {
  it("refuses unknown, malformed and missing tokens", async () => {
    expect(await outcome(admin(db, "f".repeat(64), "state"))).toBe("unauthorized");
    expect(await outcome(admin(db, "", "state"))).toBe("unauthorized");
    expect(await outcome(admin(db, "not-a-token", "state"))).toBe("unauthorized");
    expect(await outcome(rpc(db, "shv_admin", { p_token: null, p_action: "state", p_payload: {} }))).toBe("unauthorized");
    expect(await outcome(admin(db, "f".repeat(64), "item.archive", { id: "tz01" }))).toBe("unauthorized");
    expect((await catalog(db)).items).toHaveLength(61);
  });

  it("refuses an expired session and removes it", async () => {
    const t = await login(db);
    expect(await outcome(state(db, t))).toBe("ok");
    await db.query("update shevatim.admin_sessions set expires_at = now() - interval '1 second' where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [t]);
    expect(await outcome(state(db, t))).toBe("unauthorized");
    await state(db, token); // any good call sweeps expired sessions
    expect(await scalar<number>(db, "select count(*)::int from shevatim.admin_sessions where expires_at < now()")).toBe(0);
  });

  it("slides: every good call pushes the end 12 hours out", async () => {
    const t = await login(db);
    const where = "where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')";
    await db.query(`update shevatim.admin_sessions set expires_at = now() + interval '5 minutes' ${where}`, [t]);
    await state(db, t);
    const left = await scalar<number>(db, `select extract(epoch from expires_at - now())::int from shevatim.admin_sessions ${where}`, [t]);
    expect(left).toBeGreaterThan(11.9 * 3600);
  });

  it("logout ends the session", async () => {
    const t = await login(db);
    expect(await admin(db, t, "logout")).toEqual({ ok: true });
    expect(await outcome(state(db, t))).toBe("unauthorized");
  });

  it("answers invalid for an unknown action or a payload that is not an object", async () => {
    expect(await outcome(admin(db, token, "drop.everything"))).toBe("invalid");
    expect(await outcome(admin(db, token, "item.save", [1, 2]))).toBe("invalid");
    expect(await outcome(admin(db, token, "item.save", { id: "tz01", name: L("x".repeat(210_000)) }))).toBe("invalid");
    expect(await outcome(rpc(db, "shv_admin", { p_token: token, p_action: null, p_payload: {} }))).toBe("invalid");
  });
});

describe("items", () => {
  let id: string;

  it("creates a draft with a generated id, code and slug", async () => {
    const item = await admin<Item>(db, token, "item.save", { category: "shirts", name: { he: "חולצת מדבר", en: "Desert Tee!", fr: "T-shirt du désert" } });
    id = item.id;
    expect(item.code).toBe("sh01");
    expect(item.slug).toBe("desert-tee-sh01");
    expect(item).toMatchObject({
      category: "shirts", status: "draft", price: null, variants: [], pictures: [], tribe: null, soldOut: false, cloth: null,
      description: { he: "", en: "", fr: "" },
    });
    expect(item.sort).toBeGreaterThan(600);
    expect(new Date(item.updatedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(Object.keys(item).sort()).toEqual(Object.keys((await catalog(db)).items[0]).sort());

    const second = await admin<Item>(db, token, "item.save", { category: "shirts", name: L("Desert Tee") });
    expect(second.code).toBe("sh02");
    expect(second.slug).toBe("desert-tee-sh02");
    const tz = await admin<Item>(db, token, "item.save", { category: "tzitziyot", name: { he: "ציצית חדשה", en: "", fr: "" }, tribe: "dan" });
    expect(tz.code).toBe("tz33");
    expect(tz.slug).toBe("tz33");
    expect(tz.tribe).toBe("dan");

    expect((await catalog(db)).items.some((i) => i.id === id)).toBe(false);          // drafts are not public
    expect((await state(db, token)).catalog.items.some((i) => i.id === id)).toBe(true);
  });

  it("renames without moving the slug, prices, and updates only the fields sent", async () => {
    const renamed = await admin<Item>(db, token, "item.save", { id, name: { he: "חולצה", en: "Dune Tee", fr: "T-shirt dune" } });
    expect(renamed.name.en).toBe("Dune Tee");
    expect(renamed.slug).toBe("desert-tee-sh01");
    const priced = await admin<Item>(db, token, "item.save", { id, price: 18000 });
    expect(priced.price).toBe(18000);
    expect(priced.name.en).toBe("Dune Tee");
    const more = await admin<Item>(db, token, "item.save", {
      id, tribe: "levi", soldOut: true, sort: 5, description: L("Soft cotton."),
      variants: [{ key: "s", label: L("S"), price: null, available: true }, { key: "m", label: L("M"), price: 19000, available: false }],
      pictures: [{ base: "https://example.test/storage/v1/object/public/shevatim-media/u/abc/p1", sizes: [480, 960], ext: "webp", w: 960, h: 1280, kind: "product", view: "front" }],
    });
    expect(more).toMatchObject({ price: 18000, tribe: "levi", soldOut: true, sort: 5 });
    expect(more.variants).toHaveLength(2);
    expect(more.pictures[0].base).toContain("https://");
    const unpriced = await admin<Item>(db, token, "item.save", { id, price: null, tribe: null, soldOut: false });
    expect(unpriced.price).toBeNull();
    expect(unpriced.tribe).toBeNull();
    expect(unpriced.variants).toHaveLength(2);
  });

  it("validates every field", async () => {
    const pic = { base: "/media/items/x/front", sizes: [480], ext: "webp", w: 480, h: 640, kind: "product" };
    const bad: Record<string, unknown>[] = [
      { price: -1 }, { price: 10.5 }, { price: "100" }, { price: 1e12 },
      { status: "live" }, { status: 1 },
      { category: "nope" }, { category: 5 },
      { tribe: "ephraim" }, { tribe: 3 },
      { name: "plain" }, { name: { he: "a", en: "b" } }, { name: L("") }, { name: L("x".repeat(121)) },
      { description: { he: 1, en: "", fr: "" } },
      { soldOut: "yes" }, { sort: 1.5 },
      { variants: "none" }, { variants: [{ key: "s", label: L("S"), price: -5, available: true }] },
      { variants: [{ key: "s", label: L("S"), price: null, available: true }, { key: "s", label: L("S"), price: null, available: true }] },
      { variants: [{ key: "Bad Key", label: L("S"), price: null, available: true }] },
      { pictures: Array.from({ length: 13 }, () => pic) },
      { pictures: [{ ...pic, base: "http://insecure.example/a" }] },
      { pictures: [{ ...pic, base: "javascript:alert(1)" }] },
      { pictures: [{ ...pic, ext: "gif" }] },
      { pictures: [{ ...pic, sizes: [] }] },
      { pictures: [{ ...pic, kind: "selfie" }] },
      { pictures: ["/media/x"] },
      { cloth: { shape: "cape" } },
      { slug: "Not A Slug" }, { code: "TZ 01" },
      { slug: "white-fringe-tzitzit-tz01" }, // taken
      { code: "tz01" },                      // taken
    ];
    for (const patch of bad) {
      expect([JSON.stringify(patch).slice(0, 60), await outcome(admin(db, token, "item.save", { id, ...patch }))])
        .toEqual([JSON.stringify(patch).slice(0, 60), "invalid"]);
    }
    expect(await outcome(admin(db, token, "item.save", { id: "does-not-exist", price: 1 }))).toBe("invalid");
    expect(await outcome(admin(db, token, "item.save", { name: L("No category") }))).toBe("invalid");
    expect(await outcome(admin(db, token, "item.save", { category: "shirts" }))).toBe("invalid");
    // twelve good pictures are fine, and nothing above changed the item
    expect(await outcome(admin(db, token, "item.save", { id, pictures: Array.from({ length: 12 }, () => pic) }))).toBe("ok");
    const now = (await state(db, token)).catalog.items.find((i) => i.id === id)!;
    expect(now.name.en).toBe("Dune Tee");
    expect(now.price).toBeNull();
  });

  it("publishes, then archiving removes it from the shop and from every slot", async () => {
    const published = await admin<Item>(db, token, "item.save", { id, status: "published" });
    expect(published.status).toBe("published");
    expect((await catalog(db)).items.some((i) => i.id === id)).toBe(true);

    const before = (await catalog(db)).collections[0].slots;
    await admin(db, token, "collection.slots", { collectionId: "midbar", tribe: "gad", itemIds: [id, ...before.gad.slice(0, 4)] });
    await admin(db, token, "collection.slots", { collectionId: "midbar", tribe: "asher", itemIds: [...before.asher.slice(0, 2), id] });
    expect((await catalog(db)).collections[0].slots.gad[0]).toBe(id);

    expect(await admin(db, token, "item.archive", { id })).toEqual({ ok: true });
    const pub = await catalog(db);
    expect(pub.items.some((i) => i.id === id)).toBe(false);
    expect(pub.collections[0].slots.gad).toEqual(before.gad.slice(0, 4));
    expect(pub.collections[0].slots.asher).toEqual(before.asher.slice(0, 2));
    expect(pub.collections[0].slots.reuven).toEqual(before.reuven);
    const s = await state(db, token);
    expect(s.catalog.items.some((i) => i.id === id)).toBe(false);
    expect(await scalar<string>(db, "select status from shevatim.items where id = $1", [id])).toBe("archived");
    expect(await scalar<boolean>(db, "select slots::text like '%' || $1 || '%' from shevatim.collections where id = 'midbar'", [id])).toBe(false);
    expect(await outcome(reserve(db, order({ lines: [{ itemId: id, variantKey: "s", qty: 1 }] }), "198.51.100.90"))).toBe("item_unavailable");
    expect(await outcome(admin(db, token, "item.archive", { id: "does-not-exist" }))).toBe("invalid");

    // put the seed slots back for the next tests
    await admin(db, token, "collection.slots", { collectionId: "midbar", tribe: "gad", itemIds: before.gad });
    await admin(db, token, "collection.slots", { collectionId: "midbar", tribe: "asher", itemIds: before.asher });
  });
});

describe("collection slots", () => {
  it("attaches, reorders and detaches the items of one tribe", async () => {
    const start = (await catalog(db)).collections[0].slots;
    const five = ["tz20", "tz21", "ls01", "te01", "br01"];
    const attached = await admin<Collection>(db, token, "collection.slots", { collectionId: "midbar", tribe: "dan", itemIds: five });
    expect(attached.slots.dan).toEqual(five);
    expect(attached.slots.reuven).toEqual(start.reuven);
    expect(Object.keys(attached.slots).sort()).toEqual([...TRIBE_KEYS].sort());
    const reordered = await admin<Collection>(db, token, "collection.slots", { collectionId: "midbar", tribe: "dan", itemIds: [...five].reverse() });
    expect(reordered.slots.dan).toEqual([...five].reverse());
    expect((await catalog(db)).collections[0].slots.dan).toEqual([...five].reverse());
    const detached = await admin<Collection>(db, token, "collection.slots", { collectionId: "midbar", tribe: "dan", itemIds: ["te01", "tz20"] });
    expect(detached.slots.dan).toEqual(["te01", "tz20"]);
    const empty = await admin<Collection>(db, token, "collection.slots", { collectionId: "midbar", tribe: "dan", itemIds: [] });
    expect(empty.slots.dan).toEqual([]);
    // the same item may sit in several tribes
    const shared = await admin<Collection>(db, token, "collection.slots", { collectionId: "midbar", tribe: "dan", itemIds: [start.reuven[0]] });
    expect(shared.slots.dan).toEqual([start.reuven[0]]);
    await admin(db, token, "collection.slots", { collectionId: "midbar", tribe: "dan", itemIds: start.dan });
  });

  it("refuses duplicates, too many items, unknown or archived items, unknown tribes and collections", async () => {
    const slots = (id: string[], tribe = "dan", collectionId = "midbar") =>
      outcome(admin(db, token, "collection.slots", { collectionId, tribe, itemIds: id }));
    expect(await slots(["tz01", "tz02", "tz01"])).toBe("invalid");
    expect(await slots(["tz01", "tz02", "tz03", "tz04", "tz05", "tz06"])).toBe("slots_full");
    expect(await slots(["tz01", "no-such-item"])).toBe("invalid");
    expect(await slots(["sh01"])).toBe("invalid"); // archived above
    expect(await slots(["tz01"], "ephraim")).toBe("invalid");
    expect(await slots(["tz01"], "dan", "no-such-collection")).toBe("invalid");
    expect(await outcome(admin(db, token, "collection.slots", { collectionId: "midbar", tribe: "dan", itemIds: "tz01" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "collection.slots", { collectionId: "midbar", tribe: "dan", itemIds: [1, 2] }))).toBe("invalid");
    expect((await catalog(db)).collections[0].slots.dan).toHaveLength(5);
  });

  it("follows settings.slotsPerTribe", async () => {
    await admin(db, token, "settings.save", { slotsPerTribe: 6 });
    const six = ["tz01", "tz02", "tz03", "tz04", "tz05", "tz06"];
    const c = await admin<Collection>(db, token, "collection.slots", { collectionId: "midbar", tribe: "naftali", itemIds: six });
    expect(c.slots.naftali).toEqual(six);
    await admin(db, token, "settings.save", { slotsPerTribe: 5 });
    expect(await outcome(admin(db, token, "collection.slots", { collectionId: "midbar", tribe: "naftali", itemIds: six }))).toBe("slots_full");
  });

  it("shows a draft item in a slot to the owner only", async () => {
    await admin(db, token, "item.save", { id: "tz30", status: "draft" });
    const c = await admin<Collection>(db, token, "collection.slots", { collectionId: "midbar", tribe: "zevulun", itemIds: ["tz30", "tz31"] });
    expect(c.slots.zevulun).toEqual(["tz30", "tz31"]);
    expect((await catalog(db)).collections[0].slots.zevulun).toEqual(["tz31"]);
    expect((await state(db, token)).catalog.collections[0].slots.zevulun).toEqual(["tz30", "tz31"]);
    await admin(db, token, "item.save", { id: "tz30", status: "published" });
    expect((await catalog(db)).collections[0].slots.zevulun).toEqual(["tz30", "tz31"]);
  });
});

describe("collections", () => {
  it("creates a draft, publishes it, and switches the current collection", async () => {
    const created = await admin<Collection>(db, token, "collection.save", { name: { he: "חורף", en: "Winter Light", fr: "Hiver" } });
    expect(created).toMatchObject({ slug: "winter-light", status: "draft", isCurrent: false, cover: null, description: { he: "", en: "", fr: "" } });
    expect(Object.keys(created.slots).sort()).toEqual([...TRIBE_KEYS].sort());
    expect(Object.values(created.slots).every((x) => Array.isArray(x) && x.length === 0)).toBe(true);
    expect((await catalog(db)).collections.map((c) => c.id)).toEqual(["midbar"]);
    expect((await state(db, token)).catalog.collections).toHaveLength(2);

    const again = await admin<Collection>(db, token, "collection.save", { name: L("Winter Light") });
    expect(again.slug).toBe("winter-light-2");

    const current = await admin<Collection>(db, token, "collection.save", { id: created.id, status: "published", isCurrent: true, description: L("Cold season.") });
    expect(current).toMatchObject({ status: "published", isCurrent: true, name: { en: "Winter Light" } });
    const pub = await catalog(db);
    expect(pub.collections).toHaveLength(2);
    expect(pub.collections.filter((c) => c.isCurrent).map((c) => c.id)).toEqual([created.id]);

    await admin(db, token, "collection.slots", { collectionId: created.id, tribe: "levi", itemIds: ["tz01"] });
    expect((await catalog(db)).collections.find((c) => c.id === created.id)!.slots.levi).toEqual(["tz01"]);

    await admin(db, token, "collection.save", { id: "midbar", isCurrent: true });
    expect((await catalog(db)).collections.filter((c) => c.isCurrent).map((c) => c.id)).toEqual(["midbar"]);

    expect(await outcome(admin(db, token, "collection.save", { id: created.id, status: "archived" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "collection.save", { id: created.id, slug: "midbar" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "collection.save", { id: "nope", status: "draft" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "collection.save", { description: L("no name") }))).toBe("invalid");

    expect(await admin(db, token, "collection.delete", { id: created.id })).toEqual({ ok: true });
    expect(await admin(db, token, "collection.delete", { id: again.id })).toEqual({ ok: true });
    expect(await outcome(admin(db, token, "collection.delete", { id: created.id }))).toBe("invalid");
    expect((await state(db, token)).catalog.collections.map((c) => c.id)).toEqual(["midbar"]);
  });
});

describe("categories", () => {
  it("creates and updates by key; hidden categories leave the public catalogue", async () => {
    const created = await admin<Category>(db, token, "category.save", { key: "hats", name: { he: "כובעים", en: "Hats", fr: "Chapeaux" } });
    expect(created).toEqual({ key: "hats", name: { he: "כובעים", en: "Hats", fr: "Chapeaux" }, sort: 60, visible: true });
    expect((await catalog(db)).categories.map((c) => c.key)).toEqual(["tzitziyot", "shirts", "pants", "necklaces", "bracelets", "kippot", "hats"]);
    const moved = await admin<Category>(db, token, "category.save", { key: "hats", sort: 5 });
    expect(moved).toMatchObject({ sort: 5, visible: true, name: { en: "Hats" } });
    expect((await catalog(db)).categories[1].key).toBe("hats");
    const hidden = await admin<Category>(db, token, "category.save", { key: "hats", visible: false });
    expect(hidden.visible).toBe(false);
    expect((await catalog(db)).categories.some((c) => c.key === "hats")).toBe(false);
    expect((await state(db, token)).catalog.categories.some((c) => c.key === "hats")).toBe(true);
    const item = await admin<Item>(db, token, "item.save", { category: "hats", name: L("Wool Hat") });
    expect(item.code).toBe("ha01");

    expect(await outcome(admin(db, token, "category.save", { key: "Bad Key", name: L("x") }))).toBe("invalid");
    expect(await outcome(admin(db, token, "category.save", { name: L("x") }))).toBe("invalid");
    expect(await outcome(admin(db, token, "category.save", { key: "scarves" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "category.save", { key: "hats", visible: "no" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "category.save", { key: "hats", name: { he: "x" } }))).toBe("invalid");
  });
});

describe("settings", () => {
  it("saves partially, keeps whatsapp as digits only and insists on https links", async () => {
    const before = (await catalog(db)).settings;
    const s = await admin<Settings>(db, token, "settings.save", { whatsapp: "+972 54-123-4567" });
    expect(s.whatsapp).toBe("972541234567");
    expect({ ...s, whatsapp: "" }).toEqual({ ...before, whatsapp: "" });

    expect(await outcome(admin(db, token, "settings.save", { calLink: "http://cal.com/shevatim" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "settings.save", { calLink: "cal.com/shevatim" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "settings.save", { instagram: "javascript:alert(1)" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "settings.save", { instagram: "https://x.example/\"><script>" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "settings.save", { email: "not-an-email" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "settings.save", { whatsapp: 972541234567 }))).toBe("invalid");
    expect(await outcome(admin(db, token, "settings.save", { reservationsOpen: "yes" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "settings.save", { slotsPerTribe: 0 }))).toBe("invalid");
    expect(await outcome(admin(db, token, "settings.save", { announcement: "hello" }))).toBe("invalid");

    const t = await admin<Settings>(db, token, "settings.save", {
      calLink: "https://cal.com/shevatim/fitting", instagram: "https://instagram.com/shevatim", email: "shop@example.com",
      announcement: L(""), heroLine: L("One thread."),
    });
    expect(t).toMatchObject({
      whatsapp: "972541234567", calLink: "https://cal.com/shevatim/fitting", instagram: "https://instagram.com/shevatim",
      email: "shop@example.com", announcement: { he: "", en: "", fr: "" }, heroLine: { en: "One thread." },
      reservationsOpen: true, slotsPerTribe: 5,
    });
    expect((await catalog(db)).settings).toEqual(t);
    const cleared = await admin<Settings>(db, token, "settings.save", { whatsapp: "", calLink: "", instagram: "" });
    expect(cleared).toMatchObject({ whatsapp: "", calLink: "", instagram: "", email: "shop@example.com" });
    // unknown keys cannot become settings
    await admin(db, token, "settings.save", { storagePublicBase: "https://evil.example", ipSalt: "x" });
    expect((await admin(db, token, "upload.ticket")).publicBase).toBe("https://example.test/storage/v1/object/public/shevatim-media");
  });
});

describe("reservations in the back office", () => {
  it("lists newest first with counts, updates status and note, and keeps a history", async () => {
    const a = await reserve(db, order({ customer: { name: "First Person", phone: "0541111111", email: "" } }), "198.51.100.60");
    await db.query("update shevatim.reservations set created_at = created_at - interval '1 hour' where code = $1", [a.code]);
    const b = await reserve(db, order({ customer: { name: "Second Person", phone: "0542222222", email: "" } }), "198.51.100.61");
    let s = await state(db, token);
    expect(s.reservations.slice(0, 2).map((r) => r.code)).toEqual([b.code, a.code]);
    expect(s.counts).toEqual({ new: 2, open: 2, total: 2 });

    const first = s.reservations.find((r) => r.code === a.code)!;
    const contacted = await admin<Reservation>(db, token, "reservation.update", { id: first.id, status: "contacted", adminNote: "Called, wants size M" });
    expect(contacted.status).toBe("contacted");
    expect(contacted.adminNote).toBe("Called, wants size M");
    expect(contacted.history.map((h) => h.status)).toEqual(["new", "contacted"]);
    expect(contacted.history[1].note).toBe("Called, wants size M");
    expect(Object.keys(contacted).sort()).toEqual(["adminNote", "code", "createdAt", "customer", "history", "id", "lines", "locale", "note", "status", "total"]);

    const noteOnly = await admin<Reservation>(db, token, "reservation.update", { id: first.id, adminNote: "Paid by Bit" });
    expect(noteOnly.status).toBe("contacted");
    expect(noteOnly.history).toHaveLength(3);
    const done = await admin<Reservation>(db, token, "reservation.update", { id: first.id, status: "done" });
    expect(done.adminNote).toBe("Paid by Bit");
    expect(done.history.map((h) => h.status)).toEqual(["new", "contacted", "contacted", "done"]);
    const second = s.reservations.find((r) => r.code === b.code)!;
    await admin(db, token, "reservation.update", { id: second.id, status: "cancelled" });
    s = await state(db, token);
    expect(s.counts).toEqual({ new: 0, open: 0, total: 2 });

    expect(await outcome(admin(db, token, "reservation.update", { id: first.id, status: "shipped" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "reservation.update", { id: first.id }))).toBe("invalid");
    expect(await outcome(admin(db, token, "reservation.update", { id: "not-a-uuid", status: "done" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "reservation.update", { id: "00000000-0000-4000-8000-000000000000", status: "done" }))).toBe("invalid");
    expect(await outcome(admin(db, token, "reservation.update", { id: first.id, adminNote: "x".repeat(2001) }))).toBe("invalid");
  });
});

describe("upload tickets", () => {
  it("makes a ticket that is valid for 15 minutes", async () => {
    const t = await admin<{ ticket: string; bucket: string; prefix: string; publicBase: string }>(db, token, "upload.ticket");
    expect(t.ticket).toMatch(/^[0-9a-f]{32}$/);
    expect(t).toMatchObject({ bucket: "shevatim-media", prefix: `u/${t.ticket}`, publicBase: "https://example.test/storage/v1/object/public/shevatim-media" });
    const ok = (ticket: string | null) => scalar<boolean>(db, "select shevatim.upload_ticket_ok($1)", [ticket]);
    expect(await ok(t.ticket)).toBe(true);
    expect(await ok("0".repeat(32))).toBe(false);
    expect(await ok("")).toBe(false);
    expect(await ok(null)).toBe(false);
    const minutes = await scalar<number>(db, "select (extract(epoch from expires_at - now()) / 60)::int from shevatim.upload_tickets where ticket = $1", [t.ticket]);
    expect(minutes).toBeGreaterThanOrEqual(14);
    expect(minutes).toBeLessThanOrEqual(15);
    await db.query("update shevatim.upload_tickets set expires_at = now() - interval '1 second' where ticket = $1", [t.ticket]);
    expect(await ok(t.ticket)).toBe(false);
    const other = await admin(db, token, "upload.ticket");
    expect(other.ticket).not.toBe(t.ticket);
  });
});

describe("password", () => {
  it("changes only with the current password and a new one of 10+ characters", async () => {
    const other = await login(db);
    expect(await outcome(admin(db, token, "password.change", { current: "wrong", next: "a brand new password" }))).toBe("bad_password");
    expect(await outcome(admin(db, token, "password.change", { current: PASSWORD, next: "short" }))).toBe("weak_password");
    expect(await outcome(admin(db, token, "password.change", { current: PASSWORD, next: "123456789" }))).toBe("weak_password");
    expect(await outcome(admin(db, token, "password.change", { current: PASSWORD }))).toBe("invalid");
    expect(await outcome(login(db, PASSWORD, "198.51.100.70"))).toBe("ok");

    expect(await admin(db, token, "password.change", { current: PASSWORD, next: "a brand new password" })).toEqual({ ok: true });
    expect(await outcome(login(db, PASSWORD, "198.51.100.71"))).toBe("bad_password");
    expect(await outcome(login(db, "a brand new password", "198.51.100.71"))).toBe("ok");
    expect(await outcome(state(db, token))).toBe("ok");            // this device stays in
    expect(await outcome(state(db, other))).toBe("unauthorized");  // other devices log in again
  });

  it("the owner helper sets a password from SQL and ends every session", async () => {
    await db.query("select shevatim.set_admin_password('set from the sql editor')");
    expect(await outcome(state(db, token))).toBe("unauthorized");
    expect(await outcome(login(db, "set from the sql editor", "198.51.100.72"))).toBe("ok");
    await expect(db.query("select shevatim.set_admin_password('short')")).rejects.toThrow(/weak_password/);
  });
});
