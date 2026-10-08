import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDict } from "@/lib/i18n";
import { LOCALES, TRIBE_KEYS, type Locale } from "@/lib/types";
import { TribeItems } from "@/components/site/Listing";
import ChoshenStrip from "@/components/site/Stone";
import Verse from "@/components/site/Verse";
import { TribeIcon } from "@/components/site/TribeIcon";
import { tribeViews } from "@/components/site/tribes";
import { asset } from "@/lib/asset";
import { pageMeta } from "@/components/site/meta";
import s from "@/components/site/Page.module.css";
import x from "@/components/site/TribePages.module.css";

type P = { params: Promise<{ locale: string; tribe: string }> };
export const dynamicParams = false;
export function generateStaticParams() {
  return LOCALES.flatMap((locale) => TRIBE_KEYS.map((tribe) => ({ locale, tribe })));
}
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale, tribe } = await params;
  const x = tribeViews(locale as Locale).find((v) => v.key === tribe);
  return x ? pageMeta(locale as Locale, `/tribes/${x.key}/`, x.plain, x.essence) : {};
}

/** A tribe's page, top to bottom: the twelve stones (to change tribe), the tribe's pieces (their heading is the
 *  page's h1), everything about the tribe, and the previous and next tribe. */
export default async function Page({ params }: P) {
  const { locale: l, tribe: key } = await params;
  const locale = l as Locale;
  const t = getDict(locale);
  const tribes = tribeViews(locale);
  const i = tribes.findIndex((v) => v.key === key);
  if (i < 0) notFound();
  const v = tribes[i], prev = tribes[(i + 11) % 12], next = tribes[(i + 1) % 12];
  return (
    <>
      <div className={x.stones}>
        <ChoshenStrip tribes={tribes} label={t.tribes.all} current={v.key} hrefFor={(o) => asset(`/${locale}/tribes/${o.key}/`)} plate />
      </div>
      <TribeItems tribe={v} />
      <article className={s.story} aria-labelledby="tribe-h">
        <div className="wrap">
          <header className={x.storyHead}>
            <span className={x.mark}><TribeIcon tribe={v.key} className={x.markIcon} /></span>
            <h2 id="tribe-h" className={x.storyName}>{v.name}</h2>
          </header>
          <div className={x.tagline}>
            <p className="verse" lang="he" dir="rtl">{v.tagline.he}</p>
            {v.tagline.tr ? <p className={x.taglineTr}>{v.tagline.tr}</p> : null}
          </div>
          <div className={s.storyGrid}>
            <div>
              <p className={s.essence}>{v.essence}</p>
              <dl className={s.facts}>
                <div><dt>{t.tribes.meaning}</dt><dd>{v.meaning}</dd></div>
                <div><dt>{t.tribes.mother}</dt><dd>{v.mother}</dd></div>
                <div><dt>{t.tribes.stone}</dt><dd>{v.stone}, {v.stoneGloss}</dd></div>
                <div><dt>{t.tribes.flag}</dt><dd>{v.flagColor}</dd></div>
                <div><dt>{t.tribes.emblem}</dt><dd>{v.symbol}</dd></div>
                <div><dt>{t.tribes.camp}</dt><dd>{v.camp}</dd></div>
              </dl>
            </div>
            <section className={s.storyVerses} aria-labelledby="verses-h">
              <h3 id="verses-h" className={x.versesLabel}>{t.tribes.verses}</h3>
              {v.verses.map((q) => <Verse key={q.ref} v={q} />)}
            </section>
          </div>
        </div>
      </article>
      <div className={s.tribeFoot}>
        <nav className={`wrap ${s.pager}`} aria-label={`${t.tribes.prev}, ${t.tribes.next}`}>
          <Link href={`/${locale}/tribes/${prev.key}/`} rel="prev"><span>{t.tribes.prev}</span>{prev.plain}</Link>
          <Link href={`/${locale}/tribes/${next.key}/`} rel="next"><span>{t.tribes.next}</span>{next.plain}</Link>
        </nav>
      </div>
    </>
  );
}
