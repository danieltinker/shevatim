// The static export serves this as 404.html. The language of a missing address is unknown, so the page speaks
// all three and offers the three home pages.
import "@fontsource-variable/frank-ruhl-libre";
import "@fontsource-variable/heebo";
import "./globals.css";
import type { Metadata } from "next";
import media from "@/content/media.json";
import { asset } from "@/lib/asset";
import { dirOf, getDict } from "@/lib/i18n";
import { LOCALES } from "@/lib/types";
import { ICONS } from "@/components/site/meta";

export const metadata: Metadata = { title: "שבטים · Shevatim", robots: { index: false }, icons: ICONS };

export default function NotFound() {
  return (
    <main lang="he" dir="rtl" className="onBlack" style={{ minBlockSize: "100svh", display: "grid", placeContent: "center", justifyItems: "center", gap: 28, padding: "48px 16px", textAlign: "center" }}>
          <img src={asset(media.brand.wordmarkWhiteSmall)} alt="Shevatim" width={626} height={242} style={{ inlineSize: "min(72vw, 420px)", blockSize: "auto" }} />
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 20 }}>
            {LOCALES.map((l) => {
              const t = getDict(l);
              return (
                <li key={l} lang={l} dir={dirOf(l)}>
                  <p style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "clamp(20px, 2.4vw, 28px)", lineHeight: 1.3 }}>{t.notFound.line}</p>
                  <a className="link" href={asset(`/${l}/`)}>{t.notFound.home}</a>
                </li>
              );
            })}
          </ul>
    </main>
  );
}
