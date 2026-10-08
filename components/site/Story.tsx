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
// Eleven of the lead's picked campaign pictures, the sand-and-cliff ones, laid as one dense mosaic (see .look in
// Home.module.css: each place in this list has a cell of its own, so the order is the layout; phones show the
// first ten). `position` keeps the people inside a cell that crops the 3:2 frame tall or wide. `sizes` follows
// the cell: a tall or big cell is filled by its height, so its picture is drawn wider than the cell itself.
const BIG = "(min-width: 640px) 54vw, 110vw";
const ONE = "(min-width: 640px) 27vw, 54vw";
const LOOK: { base: string; position?: string; sizes: string }[] = [
  { base: "yog06077", sizes: BIG, position: "50% 60%" },                // big: two of them before the cliffs
  { base: "yog06061", sizes: BIG, position: "53% 50%" },                // tall: alone on the ledge, the sun above
  { base: "yog06092_2", sizes: ONE, position: "50% 30%" },
  { base: "yog06056", sizes: ONE, position: "50% 40%" },
  { base: "yog06163", sizes: ONE, position: "60% 50%" },
  { base: "yog06039", sizes: ONE, position: "50% 40%" },
  { base: "yog06172", sizes: BIG, position: "47% 50%" },                // tall: the green cloak
  { base: "yog06084", sizes: "(min-width: 640px) 54vw, 54vw" },         // big; a single cell on phones
  { base: "yog06121", sizes: "(min-width: 640px) 50vw, 100vw", position: "50% 85%" }, // wide: three on the rock
  { base: "yog06066", sizes: ONE, position: "50% 70%" },
  { base: "yog06145", sizes: ONE, position: "50% 60%" },                // desktop and tablet only
];
// four different moments (not two of the motorbike and two of the camel)
export const CREW = ["img_1933", "img_1951", "img_1909", "img_1948"];

export function Lookbook({ t }: { t: Dict }) {
  const pics = LOOK.map((x) => ({ ...x, p: find(media.lookbook, x.base) })).filter((x): x is typeof x & { p: M } => !!x.p?.pick);
  return (
    <section className={`${s.surface} ${s.lookSection}`} aria-labelledby="home-lookbook">
      <div className={`wrap ${s.lookHead}`}>
        <h2 id="home-lookbook" className={`${s.label} ${s.lookLabel}`}>{t.home.lookbookTitle}</h2>
      </div>
      <div className={s.lookFrame}>
        <div className={s.look}>
          {pics.map(({ p, position, sizes }) => (
            <figure key={p.base}>
              <Pic p={p} alt="" position={position} sizes={sizes} />
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
