import type { Metadata } from "next";
import { pageMeta } from "@/components/site/meta";
import { Suspense } from "react";
import { getDict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import { CollectionFromQuery, CollectionView } from "@/components/site/Listing";
import { tribeViews } from "@/components/site/tribes";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = getDict(locale);
  return pageMeta(locale, "/collection/", t.nav.collection, t.meta.collection);
}
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const tribes = tribeViews((await params).locale as Locale);
  // The current collection is prerendered; ?c=<slug> swaps it in the browser.
  return <Suspense fallback={<CollectionView tribes={tribes} slug={null} />}><CollectionFromQuery tribes={tribes} /></Suspense>;
}
