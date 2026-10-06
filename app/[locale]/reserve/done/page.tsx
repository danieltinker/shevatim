import type { Metadata } from "next";
import { pageMeta } from "@/components/site/meta";
import { Suspense } from "react";
import { getDict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import { DoneFromQuery } from "@/components/site/ReserveView";
import s from "@/components/site/Reserve.module.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = getDict(locale);
  // the static page does not know whether a reservation was just sent, so its title is neutral; the view puts
  // "received" in the tab only once it has confirmed the code (see DoneView)
  return { ...pageMeta(locale, "/reserve/done/", t.done.tab, t.meta.description), robots: { index: false, follow: true } };
}
export default function Page() {
  return <Suspense fallback={<div className={`section ${s.page}`} aria-busy="true" />}><DoneFromQuery /></Suspense>;
}
