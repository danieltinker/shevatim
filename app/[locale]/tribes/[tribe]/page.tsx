import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDict } from "@/lib/i18n";
import { fill } from "@/lib/format";
import { LOCALES, TRIBE_KEYS, type Locale } from "@/lib/types";
import { TribeItems } from "@/components/site/Listing";
import ChoshenStrip from "@/components/site/Stone";
import Verse from "@/components/site/Verse";
import { tribeNameStyle, tribeViews } from "@/components/site/tribes";
import { asset } from "@/lib/asset";
import { pageMeta } from "@/components/site/meta";
import s from "@/components/site/Page.module.css";

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

export default async function Page({ params }: P) {
  const { locale: l, tribe: key } = await params;
  const locale = l as Locale;
  const t = getDict(locale);
  const tribes = tribeViews(locale);
  const i = tribes.findIndex((v) => v.key === key);
  if (i < 0) notFound();
  const x = tribes[i], prev = tribes[(i + 11) % 12], next = tribes[(i + 1) % 12];
  return (
    <>
      <article className={`onChalk section ${s.story}`}>
        <div className="wrap">
          <header className={s.storyTop}>
            <p className="small muted"><bdi>{fill(t.tribes.of, { n: x.order, total: 12 })}</bdi></p>
            <h1 className={s.storyName} style={tribeNameStyle(x, "chalk")}>{x.name}</h1>
            <p className={`verse ${s.tagline}`} lang="he" dir="rtl">{x.tagline.he}</p>
            {x.tagline.tr ? <p className="muted">{x.tagline.tr}</p> : null}
          </header>
          <div className={s.storyGrid}>
            <div>
              <p className={s.essence}>{x.essence}</p>
              <dl className={s.facts}>
                <div><dt>{t.tribes.meaning}</dt><dd>{x.meaning}</dd></div>
                <div><dt>{t.tribes.mother}</dt><dd>{x.mother}</dd></div>
                <div><dt>{t.tribes.stone}</dt><dd>{x.stone}, {x.stoneGloss}</dd></div>
                <div><dt>{t.tribes.flag}</dt><dd><span className={s.swatch} style={{ background: x.hex }} aria-hidden="true" />{x.flagColor}</dd></div>
                <div><dt>{t.tribes.emblem}</dt><dd>{x.symbol}</dd></div>
                <div><dt>{t.tribes.camp}</dt><dd>{x.camp}</dd></div>
              </dl>
            </div>
            <section className={s.storyVerses} aria-labelledby="verses-h">
              <h2 id="verses-h">{t.tribes.verses}</h2>
              {x.verses.map((v) => <Verse key={v.ref} v={v} />)}
            </section>
          </div>
        </div>
      </article>
      <TribeItems tribe={x} />
      <div className="onBlack">
        <ChoshenStrip tribes={tribes} label={t.tribes.all} current={x.key} hrefFor={(v) => asset(`/${locale}/tribes/${v.key}/`)} />
        <nav className={`wrap ${s.pager}`} aria-label={t.tribes.all} style={{ paddingBlockEnd: 56 }}>
          <Link href={`/${locale}/tribes/${prev.key}/`} rel="prev"><span>{t.tribes.prev}</span>{prev.plain}</Link>
          <Link href={`/${locale}/tribes/${next.key}/`} rel="next"><span>{t.tribes.next}</span>{next.plain}</Link>
        </nav>
      </div>
    </>
  );
}
