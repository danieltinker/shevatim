// Pure helpers shared by server and client components (no React, no browser APIs).
import type { Catalog, Collection, Item, L10n, Locale, TribeKey } from "./types";

/** Agorot → "₪ 480" (the shekel sign comes first in every language). */
export function formatPrice(agorot: number): string {
  const n = agorot / 100;
  return `₪ ${Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2)}`;
}

/** "{n} items" + { n: 3 } → "3 items". */
export function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export const tr = (v: L10n | null | undefined, locale: Locale): string => (v ? v[locale] || v.he || v.en || "" : "");

export function currentCollection(c: Catalog, slug?: string | null): Collection | null {
  const pub = c.collections.filter((x) => x.status === "published");
  return (slug ? pub.find((x) => x.slug === slug) : null) ?? pub.find((x) => x.isCurrent) ?? pub[0] ?? null;
}

export function itemMap(c: Catalog): Map<string, Item> {
  return new Map(c.items.filter((i) => i.status === "published").map((i) => [i.id, i]));
}

export function slotItems(c: Catalog, col: Collection | null, tribe: TribeKey): Item[] {
  if (!col) return [];
  const m = itemMap(c);
  return (col.slots[tribe] ?? []).map((id) => m.get(id)).filter((x): x is Item => !!x).slice(0, c.settings.slotsPerTribe || 5);
}

/** The price to show for an item (or one of its variants); null = not priced yet. */
export function priceOf(item: Item, variantKey?: string | null): number | null {
  const v = variantKey ? item.variants.find((x) => x.key === variantKey) : null;
  return v?.price ?? item.price;
}

export function isPhone(raw: string): boolean {
  const d = raw.replace(/[\s\-().]/g, "");
  return /^\+?\d{9,15}$/.test(d);
}
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
