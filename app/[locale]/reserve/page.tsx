import type { Metadata } from "next";
import { pageMeta } from "@/components/site/meta";
import { getDict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import { ReserveView } from "@/components/site/ReserveView";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = getDict(locale);
  return { ...pageMeta(locale, "/reserve/", t.reserve.title, t.meta.description), robots: { index: false, follow: true } };
}
export default function Page() { return <ReserveView />; }
