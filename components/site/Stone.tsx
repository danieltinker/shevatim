import type { CSSProperties } from "react";
import type { TribeView } from "./tribes";
import s from "./Choshen.module.css";

/** One stone of the Choshen. Every stone is the same quiet tile now, drawn entirely by the stylesheet
 *  (ground, hairline, and the accent fill of the chosen one), so there is nothing left to set inline.
 *  The function stays because listings still spread its result onto their stones. */
export function stoneStyle(t: TribeView): CSSProperties {
  void t;
  return {};
}
export function StoneLabel({ t }: { t: TribeView }) {
  return (
    <>
      <span className={s.stoneName} lang="he" dir="rtl">{t.he}</span>
      {t.latin ? <span className={s.stoneLatin}>{t.latin}</span> : null}
    </>
  );
}

/** A strip of the twelve as plain links (tribe pages): no script needed. With `plate` the twelve are laid out
 *  as the breastplate (rows of three, six or twelve, as on the home page), so none hides off screen. */
export default function ChoshenStrip({ tribes, hrefFor, label, current, plate }: {
  tribes: TribeView[]; hrefFor: (t: TribeView) => string; label: string; current?: string; plate?: boolean;
}) {
  return (
    <nav className={s.strip} aria-label={label}>
      <ul className={plate ? s.plate : s.stripList}>
        {tribes.map((t) => (
          <li key={t.key}>
            <a className={s.stone} style={stoneStyle(t)} href={hrefFor(t)} aria-current={current === t.key ? "true" : undefined}>
              <StoneLabel t={t} />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
