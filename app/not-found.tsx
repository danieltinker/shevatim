// The static export serves this as 404.html. The language of a missing address is unknown, so the page speaks
// all three and offers the three home pages.
import "@fontsource-variable/frank-ruhl-libre";
import "@fontsource-variable/heebo";
import "./globals.css";
import type { Metadata } from "next";
import { asset } from "@/lib/asset";
import { dirOf, getDict } from "@/lib/i18n";
import { LOCALES } from "@/lib/types";
import { ICONS } from "@/components/site/meta";
import { Wordmark } from "@/components/site/Pic";
import { THEME_BOOT } from "@/components/site/Theme";

export const metadata: Metadata = { title: "שבטים · Shevatim", robots: { index: false }, icons: ICONS };

export default function NotFound() {
  return (
    <main lang="he" dir="rtl" style={{ minBlockSize: "100svh", display: "grid", placeContent: "center", justifyItems: "center", gap: 56, padding: "64px 20px", textAlign: "center", background: "var(--bg)", color: "var(--fg)" }}>
      {/* this page has no layout of its own: it sets the language (Hebrew first, like the site) and the saved theme */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.lang='he';document.documentElement.dir='rtl'" }} />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <h1 style={{ margin: 0, lineHeight: 0 }}>
        <a href={asset("/he/")} aria-label="שבטים · Shevatim" style={{ display: "block" }}><Wordmark /></a>
        <span className="srOnly"> 404</span>
      </h1>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 28 }}>
        {LOCALES.map((l) => {
          const t = getDict(l);
          return (
            <li key={l} lang={l} dir={dirOf(l)}>
              <p style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "var(--fs-h3)", lineHeight: 1.4 }}>{t.notFound.line}</p>
              <a className="link" href={asset(`/${l}/`)}>{t.notFound.home}</a>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
