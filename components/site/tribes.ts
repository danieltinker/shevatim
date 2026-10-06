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
  stone: { he: string; he_plain: string; en: string; gloss: Tri };
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
  hex: string;
  onChalk: { color: string; underline: boolean };
  onBlack: string;     // the flag colour lifted until it reads on black
  stoneText: string;   // text colour inside the stone
  stone: string; stoneGloss: string;
  flagColor: string; symbol: string;
  mother: string; meaning: string; camp: string; essence: string;
  tagline: VerseView;
  verses: VerseView[];
}

const CHALK = "#E9E5DC", INK = "#0B0A09", BONE = "#F3EFE7", BLACK = "#000000";
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function lum(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
function mix(a: string, b: string, t: number) {
  const [x, y] = [rgb(a), rgb(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function lift(hex: string) {
  let c = hex;
  for (let t = 0; t <= 1 && contrast(c, BLACK) < 5; t += 0.08) c = mix(hex, BONE, t);
  return c;
}

const TRIBES = raw as unknown as RawTribe[];

export function tribeViews(locale: Locale): TribeView[] {
  return TRIBES.map((t) => {
    const plain = locale === "he" ? t.name.he_plain : t.name[locale];
    return {
      key: t.key, order: t.order,
      name: t.name[locale], plain, len: [...plain].length,
      he: t.name.he_plain, latin: locale === "he" ? null : t.name[locale],
      hex: t.flag.hex,
      onChalk: contrast(t.flag.hex, CHALK) >= 3 ? { color: t.flag.hex, underline: false } : { color: INK, underline: true },
      onBlack: lift(t.flag.hex),
      stoneText: contrast(t.flag.hex, BONE) >= contrast(t.flag.hex, INK) ? BONE : INK,
      stone: locale === "he" ? t.stone.he : t.stone.en, stoneGloss: t.stone.gloss[locale],
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

/** Colour for a tribe's name: its flag colour where it reads, otherwise ink with a colour underline (chalk)
 *  or the colour lifted towards bone (black). Also passes the name length for sizing. */
export function tribeNameStyle(t: TribeView, ground: "chalk" | "black"): CSSProperties {
  const base = { ["--len" as string]: Math.max(4, t.len) } as CSSProperties;
  if (ground === "black") return { ...base, color: t.onBlack };
  return t.onChalk.underline
    ? { ...base, color: t.onChalk.color, textDecoration: "underline", textDecorationColor: t.hex, textDecorationThickness: "0.06em", textUnderlineOffset: "0.14em" }
    : { ...base, color: t.onChalk.color };
}
