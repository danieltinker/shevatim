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
          <h1 style={{ margin: 0, lineHeight: 0 }}>
            <img src={asset(media.brand.wordmarkWhiteSmall)} alt="שבטים · Shevatim" width={626} height={242} style={{ inlineSize: "min(72vw, 420px)", blockSize: "auto" }} />
            <span className="srOnly"> 404</span>
          </h1>
          {/* this page has no layout of its own to say which language it is in: Hebrew first, like the site */}
          <script dangerouslySetInnerHTML={{ __html: "document.documentElement.lang='he';document.documentElement.dir='rtl'" }} />
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
