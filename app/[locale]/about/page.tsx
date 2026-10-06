import type { Metadata } from "next";
import { pageMeta } from "@/components/site/meta";
import Link from "next/link";
import media from "@/content/media.json";
import { getDict } from "@/lib/i18n";
import type { Locale, Picture } from "@/lib/types";
import Pic from "@/components/site/Pic";
import s from "@/components/site/Page.module.css";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = getDict(locale);
  return pageMeta(locale, "/about/", t.about.title, t.meta.about);
}
const PICS: [string, boolean][] = [["yog06146", true], ["img_1921", false], ["img_1948", false], ["img_1909", false], ["img_1951", false], ["yog06122", true]];

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  const t = getDict(locale);
  const team = media.team as unknown as Picture[];
  return (
    <div className={s.text}>
      <div className="wrap">
        <div className={s.prose}>
          <h1>{t.about.title}</h1>
          <p>{t.about.p1}</p>
          <p>{t.about.p2}</p>
          <p>{t.about.p3}</p>
          <p><Link className="btn" href={`/${locale}/collection/`}>{t.about.cta}</Link></p>
          <p><Link className="link" href={`/${locale}/shop/`}>{t.nav.shop}</Link></p>
        </div>
        <div className={s.aboutPics}>
          {PICS.map(([b, wide]) => {
            const p = team.find((x) => x.base.endsWith("/" + b));
            return p ? <figure key={b} className={wide ? s.wide : undefined}><Pic p={p} alt="" ratio={wide ? "3 / 2" : "3 / 4"} sizes={wide ? "(min-width: 900px) 46vw, 100vw" : "(min-width: 900px) 23vw, 50vw"} /></figure> : null;
          })}
        </div>
      </div>
    </div>
  );
}
