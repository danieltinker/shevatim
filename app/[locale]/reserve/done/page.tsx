import type { Metadata } from "next";
import { pageMeta } from "@/components/site/meta";
import { Suspense } from "react";
import { getDict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import { DoneFromQuery } from "@/components/site/ReserveView";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = getDict(locale);
  return { ...pageMeta(locale, "/reserve/done/", t.done.title, t.meta.description), robots: { index: false, follow: true } };
}
export default function Page() {
  return <Suspense fallback={<div className="onChalk section" style={{ minBlockSize: "76vh" }} />}><DoneFromQuery /></Suspense>;
}
