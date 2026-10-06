import { getDict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import Hero from "@/components/site/Hero";
import TribesSlider from "@/components/site/TribesSlider";
import { Categories, CollectionTeaser } from "@/components/site/HomeParts";
import { Crew, How, Lookbook } from "@/components/site/Story";
import { tribeViews, tribesIntro } from "@/components/site/tribes";
import { pageMeta } from "@/components/site/meta";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  const t = getDict(locale);
  return pageMeta(locale, "/", t.meta.title, t.meta.description, true);
}

// The order is the brand owner's: one strong message, then the collection and the shop, only then the brand.
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  const t = getDict(locale);
  const tribes = tribeViews(locale);
  const intro = tribesIntro(locale);
  return (
    <>
      <Hero />
      <CollectionTeaser />
      <Categories />
      <TribesSlider tribes={tribes} title={intro.title} lede={intro.lede} />
      <Lookbook t={t} />
      <Crew t={t} locale={locale} />
      <How t={t} verse={intro.tzitzit} />
    </>
  );
}
