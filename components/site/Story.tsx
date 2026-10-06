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
// Six of the lead's picked campaign pictures, the sand-and-cliff ones, in a wide / tall rhythm.
// `position` keeps the person inside the frame where a wide picture is cropped tall.
const LOOK: { base: string; tall?: boolean; position?: string }[] = [
  { base: "yog06077" },
  { base: "yog06056", tall: true, position: "66% 50%" },
  { base: "yog06061", tall: true, position: "52% 50%" },
  { base: "yog06121" },
  { base: "yog06092_2" },
  { base: "yog06172", tall: true, position: "56% 50%" },
];
// four different moments (not two of the motorbike and two of the camel)
export const CREW = ["img_1933", "img_1951", "img_1909", "img_1948"];

export function Lookbook({ t }: { t: Dict }) {
  const pics = LOOK.map((x) => ({ ...x, p: find(media.lookbook, x.base) })).filter((x): x is typeof x & { p: M } => !!x.p?.pick);
  return (
    <section className={`section ${s.surface}`} aria-labelledby="home-lookbook">
      <div className="wrap">
        <h2 id="home-lookbook" className={`${s.label} ${s.lookLabel}`}>{t.home.lookbookTitle}</h2>
        <div className={s.look}>
          {pics.map(({ p, tall, position }) => (
            <figure key={p.base} className={tall ? s.tall : s.wide}>
              <Pic p={p} alt="" ratio={tall ? "4 / 5" : "3 / 2"} position={position}
                sizes={tall ? "(min-width: 640px) 64vw, 150vw" : "(min-width: 640px) 60vw, 100vw"} />
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Crew({ t, locale, more = true }: { t: Dict; locale: Locale; more?: boolean }) {
  const pics = CREW.map((b) => find(media.team, b)).filter((p): p is M => !!p);
  return (
    <section className={`section ${s.bg}`} aria-labelledby="home-crew">
      <div className="wrap">
        <header className={s.head}>
          <h2 id="home-crew">{t.home.crewTitle}</h2>
          <p className={s.lede}>{t.home.crew1} {t.home.crew2} {t.home.crew3}</p>
          {more ? <Link className={s.quiet} href={`/${locale}/about/`}>{t.home.crewLink}</Link> : null}
        </header>
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
    <section className={`section ${s.surface}`} aria-labelledby="home-how">
      <div className="wrap">
        <header className={s.head}>
          <h2 id="home-how">{t.home.howTitle}</h2>
        </header>
        <ol className={s.steps}>
          {steps.map(([h, p]) => <li key={h}><h3>{h}</h3><p>{p}</p></li>)}
        </ol>
        {verse ? (
          <blockquote className={s.closing}>
            <p className={s.closingVerse} lang="he" dir="rtl">{verse.he}</p>
            {verse.tr ? <p className={s.closingTr}>{verse.tr}</p> : null}
            <cite className={s.closingRef}><bdi>{verse.ref}</bdi></cite>
          </blockquote>
        ) : null}
      </div>
    </section>
  );
}
