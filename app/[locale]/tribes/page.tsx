import type { Metadata } from "next";
import Link from "next/link";
import type { Locale } from "@/lib/types";
import Verse from "@/components/site/Verse";
import { TribeIcon } from "@/components/site/TribeIcon";
import { firstSentences, tribeViews, tribesIntro } from "@/components/site/tribes";
import { pageMeta } from "@/components/site/meta";
import x from "@/components/site/TribePages.module.css";

type P = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale } = await params;
  const intro = tribesIntro(locale as Locale);
  return pageMeta(locale as Locale, "/tribes/", intro.title, intro.lede);
}

/** The twelve tribes as twelve arches, each with its emblem: the way in to every tribe's own page. */
export default async function Page({ params }: P) {
  const { locale: l } = await params;
  const locale = l as Locale;
  const intro = tribesIntro(locale);
  const tribes = tribeViews(locale);
  return (
    <article className={x.index}>
      <div className="wrap">
        <header className={x.indexHead}>
          <h1 className={x.indexTitle}>{intro.title}</h1>
          <p className={x.lede}>{intro.lede}</p>
        </header>
        <ol className={x.arches}>
          {tribes.map((v) => (
            <li key={v.key}>
              <Link className={x.card} href={`/${locale}/tribes/${v.key}/`}>
                <span className={x.arch}><TribeIcon tribe={v.key} className={x.icon} /></span>
                <span className={x.name}>{v.name}</span>
                <span className={x.line}>{firstSentences(v.essence, 1)}</span>
              </Link>
            </li>
          ))}
        </ol>
        <Verse v={intro.choshen} className={x.indexVerse} />
      </div>
    </article>
  );
}
