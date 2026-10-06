// The twelve tribes, reduced to one language so that pages ship only what they show.
import raw from "@/content/tribes.json";
import introRaw from "@/content/tribes-intro.json";
import type { CSSProperties } from "react";
import type { Locale, TribeKey } from "@/lib/types";

type Tri = { he: string; en: string; fr: string };
interface RawTribe {
  key: TribeKey; order: number;
  name: Tri & { he_plain: string };
  mother: Tri; meaning: Tri;
  stone: { he: string; he_plain: string; en: string; fr?: string; gloss: Tri };
  flag: { color: Tri; hex: string; symbol: Tri };
  camp: Tri; essence: Tri; tagline: Tri;
  verses: { ref: Tri; source: string; he: string; en: string; fr: string }[];
}

export interface VerseView { ref: string; he: string; tr: string | null; source?: string }
export interface TribeView {
  key: TribeKey; order: number;
  name: string;        // display name in the page language (Hebrew with nikud)
  plain: string;       // Hebrew without nikud / Latin name: for links and labels
  he: string;          // Hebrew name without nikud: always shown inside the stone
  latin: string | null; // transliteration shown under it in English and French
  len: number;         // letters in the display name, used to size it
  // The tribes are no longer colour-coded (docs/DESIGN.md, version 2). The next five fields stay because pages
  // read them, but they only ever carry theme tokens: every consumer is monochrome and follows the theme.
  hex: string;         // was the flag colour, painted as a swatch: now nothing
  onChalk: { color: string; underline: boolean };
  onBlack: string;
  stoneText: string;
  stoneBg: string;
  stone: string; stoneGloss: string;
  flagColor: string; symbol: string;
  mother: string; meaning: string; camp: string; essence: string;
  tagline: VerseView;
  verses: VerseView[];
}

const TRIBES = raw as unknown as RawTribe[];

export function tribeViews(locale: Locale): TribeView[] {
  return TRIBES.map((t) => {
    const plain = locale === "he" ? t.name.he_plain : t.name[locale];
    return {
      key: t.key, order: t.order,
      name: t.name[locale], plain, len: [...plain].length,
      he: t.name.he_plain, latin: locale === "he" ? null : t.name[locale],
      hex: "transparent",
      onChalk: { color: "var(--fg)", underline: false },
      onBlack: "var(--fg)",
      stoneText: "var(--fg)", stoneBg: "var(--surface)",
      stone: locale === "he" ? t.stone.he : locale === "fr" ? t.stone.fr || t.stone.en : t.stone.en, stoneGloss: t.stone.gloss[locale],
      flagColor: t.flag.color[locale], symbol: t.flag.symbol[locale],
      mother: t.mother[locale], meaning: t.meaning[locale], camp: t.camp[locale], essence: t.essence[locale],
      tagline: { ref: "", he: t.tagline.he, tr: locale === "he" ? null : t.tagline[locale] },
      verses: t.verses.map((v) => ({ ref: v.ref[locale], he: v.he, tr: locale === "he" ? null : v[locale], source: v.source })),
    };
  });
}
export const tribeView = (locale: Locale, key: string) => tribeViews(locale).find((t) => t.key === key) ?? null;

const INTRO = introRaw as unknown as {
  title: Tri; lede: Tri;
  choshen_verse: { ref: Tri; he: string; en: string; fr: string };
  tzitzit_verse: { ref: Tri; he: string; en: string; fr: string };
};
export function tribesIntro(locale: Locale) {
  const v = (x: typeof INTRO.choshen_verse): VerseView => ({ ref: x.ref[locale], he: x.he, tr: locale === "he" ? null : x[locale] });
  return { title: INTRO.title[locale], lede: INTRO.lede[locale], choshen: v(INTRO.choshen_verse), tzitzit: v(INTRO.tzitzit_verse) };
}

/** A tribe's name in display type is always the text colour. Also passes the name length, which some pages
 *  use to size the name. The second argument is kept for the pages that still pass a ground. */
export function tribeNameStyle(t: TribeView, ground?: "chalk" | "black"): CSSProperties {
  void ground;
  return { ["--len" as string]: Math.max(4, t.len), color: "var(--fg)" } as CSSProperties;
}

/** The first `max` sentences of a text. A closing quote after the full stop stays with its sentence. */
export function firstSentences(text: string, max: number): string {
  const end = /[.!?…]+["'’”»]*(?=\s|$)/g;
  let n = 0;
  for (let m = end.exec(text); m; m = end.exec(text)) if (++n === max) return text.slice(0, m.index + m[0].length);
  return text;
}
