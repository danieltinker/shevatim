"use client";
import { createContext, useContext, useEffect } from "react";
import type { Dict } from "@/lib/i18n";
import { LANG_KEY } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

const Ctx = createContext<{ locale: Locale; t: Dict } | null>(null);

export default function Providers({ locale, dict, children }: { locale: Locale; dict: Dict; children: React.ReactNode }) {
  useEffect(() => { try { window.localStorage.setItem(LANG_KEY, locale); } catch { /* ignore */ } }, [locale]);
  return <Ctx.Provider value={{ locale, t: dict }}>{children}</Ctx.Provider>;
}
export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside Providers");
  return v;
}
