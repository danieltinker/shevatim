"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fill } from "@/lib/format";
import { useI18n } from "./Providers";
import { StoneLabel, stoneStyle } from "./Stone";
import { firstSentences, type TribeView } from "./tribes";
import Verse from "./Verse";
import ch from "./Choshen.module.css";
import s from "./Tribes.module.css";

/** The twelve tribes, told calmly: the stones choose a tribe; for the chosen one its name, one verse, two
 *  sentences and the way to its pieces. One tribe at a time, never on a timer. */
const REBUKED = new Set(["shimon", "levi"]);

export default function TribesSlider({ tribes, title, lede }: { tribes: TribeView[]; title: string; lede: string }) {
  const { locale, t } = useI18n();
  const [idx, setIdx] = useState(0);
  const [moved, setMoved] = useState(false); // the change of tribe is animated; the first paint is not
  const root = useRef<HTMLElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const n = tribes.length;
  const tribe = tribes[idx];
  const rtl = locale === "he";

  const go = useCallback((i: number) => {
    const next = ((i % n) + n) % n;
    setIdx(next);
    setMoved(true);
    window.history.replaceState(null, "", `#${tribes[next].key}`);
  }, [n, tribes]);

  // #reuven opens that tribe; #tribes opens the section
  useEffect(() => {
    const fromHash = () => {
      const key = decodeURIComponent(window.location.hash.slice(1));
      const i = tribes.findIndex((x) => x.key === key);
      if (i < 0) { if (key === "tribes") root.current?.scrollIntoView(); return; }
      setIdx(i);
      root.current?.scrollIntoView();
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tribes]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const forward = (e.key === "ArrowLeft") === rtl;
    go(idx + (forward ? 1 : -1));
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const st = touch.current; touch.current = null;
    if (!st) return;
    const dx = e.changedTouches[0].clientX - st.x, dy = e.changedTouches[0].clientY - st.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const forward = dx < 0 !== rtl; // swipe towards the start edge = next
    go(idx + (forward ? 1 : -1));
  };

  // French elides before a vowel: "de Acher" is written "d’Acher"
  const named = (text: string) => {
    const out = fill(text, { name: tribe.plain });
    return locale === "fr" ? out.replace(/\b([dD])e (?=[AEIOUÉÈÊ])/g, "$1’") : out;
  };
  // One verse per tribe. Shimon and Levi share Jacob's rebuke as their first verse (Genesis 49:5); the home page
  // leads with Moses' blessing where there is one, otherwise with the verse of the tribe's naming.
  const verse = REBUKED.has(tribe.key)
    ? tribe.verses.find((v) => v.source === "moses") ?? tribe.verses.find((v) => v.source === "naming") ?? tribe.verses[0]
    : tribe.verses[0];

  return (
    <section id="tribes" ref={root} className={`section ${s.section}`} aria-roledescription="carousel" aria-label={title}>
      <div className="wrap">
        <header className={s.head}>
          <h2>{title}</h2>
          <p>{lede}</p>
        </header>

        <div className={s.stage} tabIndex={0} role="group" aria-label={`${title}, ${tribe.plain}`} onKeyDown={onKey}
          onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }} onTouchEnd={onTouchEnd}>
          <ul className={ch.plate} aria-label={t.tribes.choose}>
            {tribes.map((x, i) => (
              <li key={x.key}>
                <button type="button" className={ch.stone} style={stoneStyle(x)} aria-pressed={i === idx} onClick={() => go(i)}>
                  <StoneLabel t={x} />
                </button>
              </li>
            ))}
          </ul>

          <div className={s.nav}>
            <button type="button" className={s.arrow} onClick={() => go(idx - 1)} aria-label={t.tribes.prev} title={t.tribes.prev}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14.5 5l-7 7 7 7" /></svg>
            </button>
            <span className={s.counter} aria-live="polite">{t.tribes.of.split(/(\{n\}|\{total\})/).map((part, i) => part === "{n}" ? <bdi key={i}>{idx + 1}</bdi> : part === "{total}" ? <bdi key={i}>{n}</bdi> : part)}</span>
            <button type="button" className={s.arrow} onClick={() => go(idx + 1)} aria-label={t.tribes.next} title={t.tribes.next}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9.5 5l7 7-7 7" /></svg>
            </button>
          </div>

          <article key={tribe.key} className={`${s.slide} ${moved ? s.fresh : ""}`} aria-roledescription="slide" aria-label={tribe.plain}>
            <h3 className={s.name}>{tribe.name}</h3>
            {verse ? <Verse v={verse} className={s.verse} /> : null}
            <p className={s.essence}>{firstSentences(tribe.essence, 2)}</p>
            <p className={s.links}>
              <Link className="link" href={`/${locale}/shop/?tribe=${tribe.key}`}>{named(t.tribes.pieces)}</Link>
              <Link className={s.quiet} href={`/${locale}/tribes/${tribe.key}/`}>{named(t.tribes.page)}</Link>
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
