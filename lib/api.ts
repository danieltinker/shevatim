// Browser-side client for the shop's backend. The site is a static export: every call goes straight from the
// browser to the database's REST endpoint (Supabase PostgREST in production, scripts/dev-db.mjs locally).
// All server logic lives in SQL functions (db/*.sql). This file is the only place that talks to the network.
import type {
  AdminState, Catalog, Category, Collection, Item, Picture, Reservation, ReservationInput,
  ReservationStatus, Settings, TribeKey,
} from "./types";
import { ApiError } from "./types";

const URL_ = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321").replace(/\/$/, "");
const KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY ?? "dev-key";
// Supabase's publishable keys (sb_publishable_…) go on the `apikey` header only; they are not JWTs, so they must
// not be sent as a Bearer token. A legacy anon key (a JWT, "eyJ…") is sent on both, as it always was.
const AUTH: Record<string, string> = KEY.startsWith("eyJ") ? { apikey: KEY, Authorization: `Bearer ${KEY}` } : { apikey: KEY };

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify(args),
    });
  } catch {
    throw new ApiError("network");
  }
  if (!res.ok) {
    // SQL raises errors as: raise exception 'code' using errcode = 'P0001'  → PostgREST: {"message":"code", …}
    let code = `http_${res.status}`;
    try { const j = await res.json(); if (j && typeof j.message === "string") code = j.message; } catch { /* ignore */ }
    throw new ApiError(code);
  }
  return (await res.json()) as T;
}

// ───────── public ─────────
/** Everything the storefront shows: visible categories, published items, published collections, settings. */
export const getCatalog = () => rpc<Catalog>("shv_catalog");
/** Places a reservation. Prices and names are taken from the database, never from the client.
 *  Errors: "invalid", "closed", "item_unavailable", "too_many" (rate limit). */
export const createReservation = (input: ReservationInput) =>
  rpc<{ code: string; total: number | null }>("shv_reserve", { p_payload: input });

// ───────── back office ─────────
/** Errors: "bad_password", "too_many". */
export const adminLogin = async (password: string): Promise<{ token: string; expiresAt: string }> => {
  const r = await rpc<{ token?: unknown; expiresAt?: unknown; message?: unknown }>("shv_admin_login", { p_password: password });
  // A wrong password is answered with HTTP 400 without a raised SQL error (the failed attempt must be kept for the
  // rate limit, see db/README.md). Should a gateway ever drop that status, a reply without a token is still an error.
  if (!r || typeof r.token !== "string") throw new ApiError(r && typeof r.message === "string" ? r.message : "bad_password");
  return { token: r.token, expiresAt: String(r.expiresAt ?? "") };
};

const admin = <T>(token: string, action: string, payload: unknown = {}) =>
  rpc<T>("shv_admin", { p_token: token, p_action: action, p_payload: payload });
// Every admin call can fail with "unauthorized" (missing/expired session) → send the owner back to the login.

export const adminState = (t: string) => admin<AdminState>(t, "state");
export const adminLogout = (t: string) => admin<{ ok: true }>(t, "logout");
export const adminChangePassword = (t: string, current: string, next: string) =>
  admin<{ ok: true }>(t, "password.change", { current, next }); // errors: "bad_password", "weak_password" (< 10 chars)

/** Create (no id) or update (id) an item. Send only the fields that change. Returns the saved item. */
export const adminSaveItem = (t: string, item: Partial<Item>) => admin<Item>(t, "item.save", item);
export const adminArchiveItem = (t: string, id: string) => admin<{ ok: true }>(t, "item.archive", { id });

export const adminSaveCollection = (t: string, c: Partial<Collection>) => admin<Collection>(t, "collection.save", c);
export const adminDeleteCollection = (t: string, id: string) => admin<{ ok: true }>(t, "collection.delete", { id });
/** Replaces the ordered list of items attached to one tribe of one collection (attach, detach, reorder). */
export const adminSetSlots = (t: string, collectionId: string, tribe: TribeKey, itemIds: string[]) =>
  admin<Collection>(t, "collection.slots", { collectionId, tribe, itemIds });

export const adminSaveCategory = (t: string, c: Partial<Category> & { key: string }) => admin<Category>(t, "category.save", c);
export const adminSaveSettings = (t: string, s: Partial<Settings>) => admin<Settings>(t, "settings.save", s);

export const adminUpdateReservation = (t: string, id: string, patch: { status?: ReservationStatus; adminNote?: string }) =>
  admin<Reservation>(t, "reservation.update", { id, ...patch });

/** Uploads pre-sized copies of one picture (the browser resizes before upload, see lib/resize.ts) and returns
 *  the Picture to store on an item. `copies` maps width → Blob (webp). */
export async function adminUploadPicture(
  t: string, copies: { width: number; blob: Blob }[], meta: { w: number; h: number; kind: Picture["kind"]; view?: Picture["view"] },
): Promise<Picture> {
  const ticket = await admin<{ ticket: string; bucket: string; prefix: string; publicBase: string }>(t, "upload.ticket");
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  for (const c of copies) {
    const path = `${ticket.prefix}/${id}-${c.width}.webp`;
    const res = await fetch(`${URL_}/storage/v1/object/${ticket.bucket}/${path}`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "image/webp", "x-upsert": "false", "cache-control": "31536000" },
      body: c.blob,
    });
    if (!res.ok) throw new ApiError("upload_failed");
  }
  return { base: `${ticket.publicBase}/${ticket.prefix}/${id}`, sizes: copies.map((c) => c.width).sort((a, b) => a - b), ext: "webp", w: meta.w, h: meta.h, kind: meta.kind, view: meta.view };
}
