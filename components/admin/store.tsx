"use client";
import { createContext, useContext } from "react";
import type { AdminState, Category, Collection, Item, Reservation, Settings } from "@/lib/types";
import { ApiError } from "@/lib/types";
import type { AdminLang, Strings } from "./strings";

export interface ConfirmOptions { title: string; body: string; yes: string; no?: string; danger?: boolean }

export interface Store {
  lang: AdminLang;
  t: Strings;
  state: AdminState;
  /** Central wrapper for every back-office call: supplies the session and sends the owner back to the
   *  sign-in screen (with a calm message) when the session is missing or has ended. */
  call: <T>(fn: (token: string) => Promise<T>) => Promise<T>;
  refresh: () => Promise<void>;
  refreshing: boolean;
  putItem: (it: Item) => void;
  dropItem: (id: string) => void;
  putCollection: (c: Collection) => void;
  dropCollection: (id: string) => void;
  putReservation: (r: Reservation) => void;
  putSettings: (s: Settings) => void;
  putCategory: (c: Category) => void;
  toast: (message: string, kind?: "ok" | "bad") => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  errText: (e: unknown) => string;
  route: string[];              // e.g. ["collections", "midbar"]
  go: (path: string) => void;   // e.g. go("items/new")
  setDirty: (dirty: boolean) => void;
}

export const StoreCtx = createContext<Store | null>(null);
export function useStore(): Store {
  const s = useContext(StoreCtx);
  if (!s) throw new Error("no store");
  return s;
}

export function errorSentence(e: unknown, t: Strings): string {
  const code = e instanceof ApiError ? e.code : "";
  switch (code) {
    case "network": return t.errNetwork;
    case "unauthorized": return t.errSession;
    case "too_many": return t.errTooMany;
    case "invalid": return t.errInvalid;
    case "not_found": return t.errNotFound;
    case "slots_full": case "too_many_slots": case "tribe_full": return t.errRowFull;
    case "is_current": return t.colDeleteCurrent;
    case "taken": case "duplicate": case "slug_taken": return t.errTaken;
    default: return t.errGeneric;
  }
}
export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.code === "unauthorized";
