import type { Metadata } from "next";
import { pageMeta } from "@/components/site/meta";
import { Suspense } from "react";
import { getDict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import { ShopFromQuery, ShopView } from "@/components/site/Listing";
import { tribeViews } from "@/components/site/tribes";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = getDict(locale);
  return pageMeta(locale, "/shop/", t.shop.title, t.meta.shop);
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const tribes = tribeViews((await params).locale as Locale);
  return <Suspense fallback={<ShopView tribes={tribes} cat={null} tribe={null} />}><ShopFromQuery tribes={tribes} /></Suspense>;
}
