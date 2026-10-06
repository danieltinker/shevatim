// Shared domain types. The SQL functions return exactly these shapes (camelCase JSON).
export type Locale = "he" | "en" | "fr";
export const LOCALES: Locale[] = ["he", "en", "fr"];
export type L10n = { he: string; en: string; fr: string };

export type TribeKey =
  | "reuven" | "shimon" | "levi" | "yehuda" | "dan" | "naftali"
  | "gad" | "asher" | "yissachar" | "zevulun" | "yosef" | "binyamin";
export const TRIBE_KEYS: TribeKey[] = [
  "reuven", "shimon", "levi", "yehuda", "dan", "naftali",
  "gad", "asher", "yissachar", "zevulun", "yosef", "binyamin",
];

/** A picture stored as pre-sized copies: `${base}-${size}.${ext}`. `base` is site-relative
 *  ("/media/items/tz10/front") or absolute ("https://…/storage/v1/object/public/…/abc"). */
export interface Picture {
  base: string;
  sizes: number[];        // widths that exist, ascending, e.g. [480, 960, 1600]
  ext: "webp" | "jpg" | "png";
  w: number;              // intrinsic width of the largest copy
  h: number;              // intrinsic height of the largest copy
  kind: "product" | "model" | "detail" | "campaign" | "render"; // render = a 3D rendering, shown with a small note
  view?: "front" | "back" | "side" | "detail";
  alt?: Partial<L10n>;
}

export interface Category {
  key: string;            // "tzitziyot" | "shirts" | "pants" | "necklaces" | "bracelets" | "kippot" | owner-made
  name: L10n;
  sort: number;
  visible: boolean;
}

export interface Variant {
  key: string;            // "adult" | "kid" | "s" | "m" | "l" | "xl" | "one"
  label: L10n;
  price: number | null;   // agorot (ILS × 100); null = use the item price
  available: boolean;
}

/** Parameters of the playable 3D garment (tzitziyot only). */
export interface ClothSpec {
  shape: "hooded-poncho" | "poncho" | "cropped" | "classic";
  texture: string | null; // site-relative or absolute URL of the fabric picture, or null for a flat colour
  baseColor: string;      // hex
  trim: "none" | "fringe" | "tassels" | "gold-fringe" | "lace";
  trimColor: string;      // hex
  stringColor: string;    // hex, the tzitzit strings
  techelet: boolean;      // a blue thread in each corner
}

export interface Item {
  id: string;
  code: string;           // short working code shown in the back office, e.g. "tz10"
  slug: string;           // latin, url-safe, unique
  category: string;
  name: L10n;
  description: L10n;
  price: number | null;   // agorot; null = not priced yet ("price confirmed when we contact you")
  variants: Variant[];    // [] = one size
  pictures: Picture[];    // first picture is the tile picture
  tribe: TribeKey | null; // home tribe, optional
  status: "draft" | "published" | "archived";
  soldOut: boolean;
  cloth: ClothSpec | null;
  sort: number;
  updatedAt: string;      // ISO
}

export interface Collection {
  id: string;
  slug: string;
  name: L10n;
  description: L10n;
  status: "draft" | "published";
  isCurrent: boolean;     // the one the home page presents
  cover: Picture | null;
  slots: Record<TribeKey, string[]>; // item ids per tribe, in display order
  sort: number;
}

export interface Settings {
  whatsapp: string;       // international digits only, e.g. "972541234567"; "" hides WhatsApp
  email: string;
  instagram: string;      // full URL or ""
  calLink: string;        // Cal.com booking link (full URL) or ""
  announcement: L10n;     // thin bar above the header; all empty = hidden
  reservationsOpen: boolean;
  slotsPerTribe: number;  // 5
  heroLine: L10n;
}

export interface Catalog {
  version: string;        // changes whenever anything changes
  categories: Category[];
  items: Item[];          // public: published only; admin: everything except archived unless asked
  collections: Collection[];
  settings: Settings;
}

export type ReservationStatus = "new" | "contacted" | "confirmed" | "paid" | "ready" | "done" | "cancelled";

export interface ReservationLine {
  itemId: string;
  code: string;
  name: L10n;             // snapshot at reservation time
  variantKey: string | null;
  variantLabel: L10n | null;
  qty: number;
  unitPrice: number | null; // agorot snapshot, null if the item had no price
}

export interface Reservation {
  id: string;
  code: string;           // human code, e.g. "SHV-4K7Q"
  createdAt: string;
  status: ReservationStatus;
  customer: { name: string; phone: string; email: string };
  locale: Locale;
  note: string;
  lines: ReservationLine[];
  total: number | null;   // agorot, null when any line has no price
  adminNote: string;
  history: { at: string; status: ReservationStatus; note: string }[];
}

export interface ReservationInput {
  customer: { name: string; phone: string; email: string };
  locale: Locale;
  note: string;
  lines: { itemId: string; variantKey: string | null; qty: number }[];
  website: string;        // honeypot, must be ""
}

export interface AdminState {
  catalog: Catalog;       // includes drafts
  reservations: Reservation[];
  counts: { new: number; open: number; total: number };
}

export class ApiError extends Error {
  code: string;
  constructor(code: string, message?: string) { super(message ?? code); this.code = code; }
}
