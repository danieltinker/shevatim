import { getDict } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import Hero from "@/components/site/Hero";
import ChoshenStrip from "@/components/site/Stone";
import TribesSlider from "@/components/site/TribesSlider";
import { Categories, ClothSection, CollectionTeaser } from "@/components/site/HomeParts";
import { Crew, How, Lookbook } from "@/components/site/Story";
import { tribeViews, tribesIntro } from "@/components/site/tribes";
import { pageMeta } from "@/components/site/meta";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  const t = getDict(locale);
  return pageMeta(locale, "/", t.meta.title, t.meta.description, true);
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  const t = getDict(locale);
  const tribes = tribeViews(locale);
  const intro = tribesIntro(locale);
  return (
    <>
      <Hero />
      <div className="onBlack"><ChoshenStrip tribes={tribes} label={t.tribes.choose} hrefFor={(x) => `#${x.key}`} /></div>
      <CollectionTeaser />
      <TribesSlider tribes={tribes} title={intro.title} lede={intro.lede} />
      <ClothSection />
      <Categories />
      <Lookbook t={t} />
      <Crew t={t} locale={locale} />
      <How t={t} verse={intro.tzitzit} />
    </>
  );
}
