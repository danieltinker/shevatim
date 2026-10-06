import tribesJson from "@/content/tribes.json";
import { asset } from "@/lib/asset";
import type { Item, L10n, Picture, TribeKey } from "@/lib/types";
import { TRIBE_KEYS } from "@/lib/types";
import type { AdminLang } from "./strings";

interface TribeRow { key: string; name: { he_plain: string; en: string }; flag: { hex: string } }
const rows = tribesJson as unknown as TribeRow[];

export interface TribeInfo { key: TribeKey; he: string; en: string; hex: string }
/** The twelve tribes in their fixed order, with plain Hebrew names and flag colours. */
export const TRIBES: TribeInfo[] = TRIBE_KEYS.map((key) => {
  const r = rows.find((x) => x.key === key);
  return { key, he: r?.name.he_plain ?? key, en: r?.name.en ?? key, hex: r?.flag.hex ?? "#888" };
});
export const tribeName = (key: TribeKey | string | null, lang: AdminLang): string => {
  const t = TRIBES.find((x) => x.key === key);
  return t ? (lang === "he" ? t.he : t.en) : "";
};

export const EMPTY_L10N: L10n = { he: "", en: "", fr: "" };
export const l10n = (v: Partial<L10n> | null | undefined): L10n => ({ he: v?.he ?? "", en: v?.en ?? "", fr: v?.fr ?? "" });
/** A name in the interface language, falling back to whichever language has text. */
export const pick = (v: Partial<L10n> | null | undefined, lang: AdminLang): string =>
  (v?.[lang] || v?.he || v?.en || v?.fr || "").trim();

/** URL of the copy nearest to (and not smaller than) the wanted width. */
export function pictureUrl(p: Picture, wanted: number): string {
  const sizes = [...(p.sizes ?? [])].sort((a, b) => a - b);
  const size = sizes.find((s) => s >= wanted) ?? sizes[sizes.length - 1];
  return asset(`${p.base}-${size}.${p.ext}`);
}
export const itemThumb = (it: Item | undefined | null, wanted = 480): string | null =>
  it && it.pictures && it.pictures[0] ? pictureUrl(it.pictures[0], wanted) : null;

/** agorot → "480" or "480.50" (no currency sign). */
export function shekels(agorot: number): string {
  const n = agorot / 100;
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Text typed by the owner → agorot, null for empty, NaN when it is not a price. */
export function parseShekels(text: string): number | null {
  const s = text.replace(/[₪\s,]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100);
}
export const priceText = (agorot: number | null): string => (agorot == null ? "" : String(agorot / 100));

/** "054-123 4567" → "972541234567" (digits only, international). */
export function intlDigits(phone: string): string {
  let d = (phone || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "972" + d.slice(1);
  return d;
}

export function dateTime(iso: string, lang: AdminLang): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "he" ? "he-IL" : "en-GB", {
    timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

export const norm = (s: string) => s.toLowerCase().replace(/[֑-ׇ]/g, "").trim();
export function itemMatches(it: Item, q: string): boolean {
  const n = norm(q);
  if (!n) return true;
  return [it.name.he, it.name.en, it.name.fr, it.code].some((x) => norm(x || "").includes(n));
}
