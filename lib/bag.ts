"use client";
// The reservation bag: item id, variant key and quantity, kept in localStorage.
import { useSyncExternalStore } from "react";

export interface BagLine { itemId: string; variantKey: string | null; qty: number }
const KEY = "shv.bag";
const EMPTY: BagLine[] = [];
let lines: BagLine[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(raw)) {
      lines = raw.filter((l) => l && typeof l.itemId === "string" && l.qty > 0)
        .map((l) => ({ itemId: l.itemId, variantKey: l.variantKey ?? null, qty: Math.min(9, Math.floor(l.qty)) }));
    }
  } catch { /* ignore */ }
  window.addEventListener("storage", (e) => { if (e.key === KEY) { loaded = false; load(); emit(); } });
}
function emit() { listeners.forEach((l) => l()); }
function save(next: BagLine[]) {
  lines = next;
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  emit();
}
const same = (a: BagLine, itemId: string, variantKey: string | null) => a.itemId === itemId && a.variantKey === variantKey;

export const bag = {
  add(itemId: string, variantKey: string | null, qty = 1) {
    load();
    const hit = lines.find((l) => same(l, itemId, variantKey));
    save(hit ? lines.map((l) => (l === hit ? { ...l, qty: Math.min(9, l.qty + qty) } : l)) : [...lines, { itemId, variantKey, qty }]);
  },
  setQty(itemId: string, variantKey: string | null, qty: number) {
    load();
    save(qty <= 0 ? lines.filter((l) => !same(l, itemId, variantKey)) : lines.map((l) => (same(l, itemId, variantKey) ? { ...l, qty: Math.min(9, qty) } : l)));
  },
  remove(itemId: string, variantKey: string | null) { load(); save(lines.filter((l) => !same(l, itemId, variantKey))); },
  clear() { save([]); },
  /** Reads the saved bag now (a no-op after the first time). */
  load,
};

function subscribe(l: () => void) {
  listeners.add(l);
  if (!loaded) { load(); if (lines !== EMPTY) queueMicrotask(emit); }
  return () => { listeners.delete(l); };
}
export function useBag(): BagLine[] {
  // reading the snapshot also reads localStorage, so the first client render after hydration has the real bag
  return useSyncExternalStore(subscribe, () => { load(); return lines; }, () => EMPTY);
}
export const bagCount = (b: BagLine[]) => b.reduce((n, l) => n + l.qty, 0);
