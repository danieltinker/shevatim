import he from "@/content/i18n/he.json";
import en from "@/content/i18n/en.json";
import fr from "@/content/i18n/fr.json";
import type { Locale } from "./types";

/** Hebrew is the source; English and French must carry the same keys (checked by the compiler below). */
export type Dict = typeof he;
const dicts: Record<Locale, Dict> = { he, en, fr };
// The other direction: Hebrew must not miss a key that a translation has.
const _same: [typeof en, typeof fr] = [he, he];
void _same;

/** A string that may not be in the dictionaries yet: the new key when it exists, otherwise the fallback. */
export function pick(group: object, key: string, fallback: string): string {
  const v = (group as Record<string, unknown>)[key];
  return typeof v === "string" && v ? v : fallback;
}
/** French sets a no-break space before a colon. */
export const colon = (locale: Locale): string => (locale === "fr" ? "\u00a0:" : ":");

export const getDict = (locale: Locale): Dict => dicts[locale];
export const isLocale = (x: string): x is Locale => x === "he" || x === "en" || x === "fr";
export const dirOf = (locale: Locale): "rtl" | "ltr" => (locale === "he" ? "rtl" : "ltr");
export const LANG_LABEL: Record<Locale, string> = { he: "עב", en: "EN", fr: "FR" };
export const LANG_NAME: Record<Locale, string> = { he: "עברית", en: "English", fr: "Français" };
export const LANG_KEY = "shv.lang";
