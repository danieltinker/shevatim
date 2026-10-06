import type { Metadata } from "next";
import Link from "next/link";
import { getDict } from "@/lib/i18n";
import { fill } from "@/lib/format";
import type { Locale } from "@/lib/types";
import Verse from "@/components/site/Verse";
import { firstSentences, tribeViews, tribesIntro } from "@/components/site/tribes";
import { pageMeta } from "@/components/site/meta";
import s from "@/components/site/Page.module.css";

type P = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale } = await params;
  const intro = tribesIntro(locale as Locale);
  return pageMeta(locale as Locale, "/tribes/", intro.title, intro.lede);
}

/** The twelve tribes, one quiet row each: the way in to every tribe's own page. */
export default async function Page({ params }: P) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const t = getDict(locale);
  const intro = tribesIntro(locale);
  const tribes = tribeViews(locale);
  return (
    <article className={s.story}>
      <div className="wrap">
        <header className={s.storyTop}>
          <h1 className={s.storyName}>{intro.title}</h1>
          <p className={s.tribesLede}>{intro.lede}</p>
        </header>
        <ol className={s.tribeRows}>
          {tribes.map((x) => (
            <li key={x.key}>
              <Link href={`/${locale}/tribes/${x.key}/`}>
                <span className={s.rowNo}><bdi>{fill(t.tribes.of, { n: x.order, total: 12 })}</bdi></span>
                <span className={s.rowName}>{x.name}</span>
                <span className={s.rowLine}>{firstSentences(x.essence, 1)}</span>
              </Link>
            </li>
          ))}
        </ol>
        <Verse v={intro.choshen} className={s.tribesVerse} />
      </div>
    </article>
  );
}
