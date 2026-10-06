"use client";
// The catalogue in the browser: starts from the snapshot that ships with the site, then refreshes once per
// page load from the database. If the database cannot be reached the snapshot simply stays.
import { useSyncExternalStore } from "react";
import snapshot from "@/content/catalog.snapshot.json";
import { getCatalog } from "./api";
import type { Catalog } from "./types";

const SNAPSHOT = snapshot as unknown as Catalog;
const KEY = "shv.catalog";
let current: Catalog = SNAPSHOT;
let started = false;
const listeners = new Set<() => void>();

function set(next: Catalog) {
  if (!next || !Array.isArray(next.items) || next.version === current.version) return;
  current = next;
  listeners.forEach((l) => l());
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    const saved = window.sessionStorage.getItem(KEY);
    if (saved) set(JSON.parse(saved) as Catalog);
  } catch { /* private mode or bad JSON: keep the snapshot */ }
  getCatalog()
    .then((fresh) => {
      set(fresh);
      try { window.sessionStorage.setItem(KEY, JSON.stringify(fresh)); } catch { /* ignore */ }
    })
    .catch(() => { /* database unreachable: keep what we have */ });
}

function subscribe(l: () => void) {
  listeners.add(l);
  start();
  return () => { listeners.delete(l); };
}

export function useCatalog(): Catalog {
  return useSyncExternalStore(subscribe, () => current, () => SNAPSHOT);
}
