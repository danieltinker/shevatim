import type { CSSProperties } from "react";
import type { TribeView } from "./tribes";
import s from "./Choshen.module.css";

/** One stone of the Choshen: the tribe's flag colour with its name set inside. */
export function stoneStyle(t: TribeView): CSSProperties {
  return { background: t.stoneBg, color: t.stoneText };
}
export function StoneLabel({ t }: { t: TribeView }) {
  return (
    <>
      <span className={s.stoneName} lang="he" dir="rtl">{t.he}</span>
      {t.latin ? <span className={s.stoneLatin}>{t.latin}</span> : null}
    </>
  );
}

/** The thin strip of twelve under the hero and on tribe pages: plain links, no script needed. */
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
