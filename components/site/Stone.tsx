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

/** A strip of the twelve as plain links (tribe pages): no script needed. */
export default function ChoshenStrip({ tribes, hrefFor, label, current }: {
  tribes: TribeView[]; hrefFor: (t: TribeView) => string; label: string; current?: string;
}) {
  return (
    <nav className={s.strip} aria-label={label}>
      <ul className={s.stripList}>
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
