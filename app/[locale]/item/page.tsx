import { Suspense } from "react";
import type { Locale } from "@/lib/types";
import { ItemFromQuery, ItemView } from "@/components/site/ItemView";
import { tribeViews } from "@/components/site/tribes";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const tribes = tribeViews((await params).locale as Locale);
  return <Suspense fallback={<ItemView tribes={tribes} slug={null} pending />}><ItemFromQuery tribes={tribes} /></Suspense>;
}
