import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import "@fontsource-variable/frank-ruhl-libre";
import "@fontsource-variable/heebo";
import "../globals.css";
import { dirOf, getDict, isLocale } from "@/lib/i18n";
import { LOCALES } from "@/lib/types";
import Providers from "@/components/site/Providers";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { THEME_BOOT } from "@/components/site/Theme";
import { brandName, ICONS, metadataBase } from "@/components/site/meta";

export const dynamicParams = false;
export function generateStaticParams() { return LOCALES.map((locale) => ({ locale })); }
// the browser bar: a meta tag cannot read a CSS token, so this repeats --bg of the light theme (Theme.tsx
// rewrites it when the visitor switches)
export const viewport: Viewport = { themeColor: "#F4EDE0", width: "device-width", initialScale: 1 };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDict(locale);
  return { metadataBase, title: { default: t.meta.title, template: `%s · ${brandName(locale)}` }, description: t.meta.description, icons: ICONS };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDict(locale);
  return (
    <html lang={locale} dir={dirOf(locale)} data-theme="light" suppressHydrationWarning>
      <head>
        {/* the saved theme is applied before the first paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <Providers locale={locale} dict={t}>
          <a className="skip" href="#main">{t.nav.skip}</a>
          <Header />
          <main id="main">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
