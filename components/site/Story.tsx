// Server-rendered story sections: lookbook, crew, how reserving works.
import Link from "next/link";
import media from "@/content/media.json";
import type { Dict } from "@/lib/i18n";
import type { Locale, Picture } from "@/lib/types";
import Pic from "./Pic";
import type { VerseView } from "./tribes";
import s from "./Home.module.css";

type M = Picture & { pick?: boolean };
const find = (list: unknown, base: string) => (list as M[]).find((p) => p.base.endsWith("/" + base));
const LOOK = ["yog06077", "yog06056", "yog06036", "yog06084", "yog06092_2", "yog06163", "27ccf423", "yog06121", "yog06039"];
export const CREW = ["img_1921", "img_1955", "img_1933", "img_1951"];

export function Lookbook({ t }: { t: Dict }) {
  const pics = LOOK.map((b) => find(media.lookbook, b)).filter((p): p is M => !!p);
  return (
    <section className={`onBlack ${s.look}`} aria-label={t.home.lookbookTitle}>
      <div className={`wrap ${s.lookRow}`}>
        {pics.map((p, i) => (
          <figure key={p.base}>
            <Pic p={p} alt="" ratio="3 / 2" sizes={i === 0 || i === 4 ? "(min-width: 900px) 66vw, 86vw" : "(min-width: 900px) 40vw, 86vw"} />
          </figure>
        ))}
      </div>
    </section>
  );
}

export function Crew({ t, locale, more = true }: { t: Dict; locale: Locale; more?: boolean }) {
  const pics = CREW.map((b) => find(media.team, b)).filter((p): p is M => !!p);
  return (
    <section className="onChalk section">
      <div className={`wrap ${s.crewGrid}`}>
        <div className={s.crewText}>
          <h2>{t.home.crewTitle}</h2>
          <div className={s.crewLines}>
            <p>{t.home.crew1}</p>
            <p>{t.home.crew2}</p>
            <p>{t.home.crew3}</p>
            {more ? <Link className="link" href={`/${locale}/about/`}>{t.home.crewLink}</Link> : null}
          </div>
        </div>
        <div className={s.crewPics}>
          {pics.map((p) => <figure key={p.base}><Pic p={p} alt="" ratio="4 / 5" position="50% 100%" sizes="(min-width: 900px) 23vw, 46vw" /></figure>)}
        </div>
      </div>
    </section>
  );
}

export function How({ t, verse }: { t: Dict; verse?: VerseView }) {
  const steps = [[t.home.how1Title, t.home.how1], [t.home.how2Title, t.home.how2], [t.home.how3Title, t.home.how3]];
  return (
    <section className={`onChalk section ${s.how}`}>
      <div className="wrap">
        <h2 className={s.h}>{t.home.howTitle}</h2>
        <ol className={s.steps}>
          {steps.map(([h, p]) => <li key={h}><h3>{h}</h3><p>{p}</p></li>)}
        </ol>
        {verse ? (
          <blockquote className={s.closing}>
            <p className="verse" lang="he" dir="rtl">{verse.he}</p>
            {verse.tr ? <p className="verseTr">{verse.tr}</p> : null}
            <cite className="verseRef" style={{ display: "block", fontStyle: "normal" }}><bdi>{verse.ref}</bdi></cite>
          </blockquote>
        ) : null}
      </div>
    </section>
  );
}
