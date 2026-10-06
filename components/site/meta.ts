// Page metadata shared by every public page: canonical, hreflang alternates for the three languages, and the
// social picture. Set NEXT_PUBLIC_SITE_URL (e.g. https://shevatim.co.il) at build time so these become absolute.
import type { Metadata } from "next";
import media from "@/content/media.json";
import { asset } from "@/lib/asset";
import type { Locale } from "@/lib/types";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
export const metadataBase = SITE ? new URL(SITE) : undefined;
// A build served from a temporary address (a preview host) sets NEXT_PUBLIC_NOINDEX=1 so search engines skip it.
const NOINDEX = process.env.NEXT_PUBLIC_NOINDEX === "1";
const OG_LOCALE: Record<Locale, string> = { he: "he_IL", en: "en_US", fr: "fr_FR" };
export const brandName = (locale: Locale) => (locale === "he" ? "שבטים" : "Shevatim");

export const ICONS: Metadata["icons"] = {
  icon: [{ url: asset("/favicon.svg"), type: "image/svg+xml" }],
  apple: [{ url: asset("/apple-touch-icon.png"), sizes: "180x180" }],
};

/** `path` is the part after the language, with slashes: "/", "/collection/", "/tribes/dan/". */
export function pageMeta(locale: Locale, path: string, title: string, description: string, absoluteTitle = false): Metadata {
  const url = (l: Locale) => asset(`/${l}${path}`);
  const full = absoluteTitle ? title : `${title} · ${brandName(locale)}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url(locale), languages: { he: url("he"), en: url("en"), fr: url("fr"), "x-default": url("he") } },
    openGraph: {
      type: "website", siteName: brandName(locale), locale: OG_LOCALE[locale], url: url(locale), title: full, description,
      images: [{ url: asset(media.brand.og) }],
    },
    twitter: { card: "summary_large_image", title: full, description, images: [asset(media.brand.og)] },
    ...(NOINDEX ? { robots: { index: false, follow: false } } : {}),
  };
}
