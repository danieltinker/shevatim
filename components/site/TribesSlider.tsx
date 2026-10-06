"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCatalog } from "@/lib/catalog";
import { currentCollection, fill, slotItems } from "@/lib/format";
import { colon } from "@/lib/i18n";
import { useI18n } from "./Providers";
import { StoneLabel, stoneStyle } from "./Stone";
import Tile from "./Tile";
import { tribeNameStyle, type TribeView } from "./tribes";
import Verse from "./Verse";
import ch from "./Choshen.module.css";
import s from "./Tribes.module.css";

export default function TribesSlider({ tribes, title, lede }: { tribes: TribeView[]; title: string; lede: string }) {
  const { locale, t } = useI18n();
  const catalog = useCatalog();
  const [idx, setIdx] = useState(0);
  const root = useRef<HTMLElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const plate = useRef<HTMLUListElement>(null);
  const n = tribes.length;
  const tribe = tribes[idx];
  const rtl = locale === "he";

  const go = useCallback((i: number, writeHash = true) => {
    const next = ((i % n) + n) % n;
    setIdx(next);
    if (writeHash) window.history.replaceState(null, "", `#${tribes[next].key}`);
  }, [n, tribes]);

  // #reuven opens that tribe (also from the strip of stones under the hero)
  useEffect(() => {
    const fromHash = (scroll: boolean) => {
      const key = decodeURIComponent(window.location.hash.slice(1));
      const i = tribes.findIndex((x) => x.key === key);
      if (i < 0) { if (key === "tribes" && scroll) root.current?.scrollIntoView(); return; }
      setIdx(i);
      if (scroll) root.current?.scrollIntoView();
    };
    fromHash(true);
    const on = () => fromHash(true);
    window.addEventListener("hashchange", on);
    // a stone anywhere on the page (the strip under the film) opens its slide, even when the hash is already set
    const click = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
      const i = a ? tribes.findIndex((x) => `#${x.key}` === a.getAttribute("href")) : -1;
      if (i < 0) return;
      e.preventDefault();
      setIdx(i);
      window.history.replaceState(null, "", `#${tribes[i].key}`);
      root.current?.scrollIntoView();
    };
    document.addEventListener("click", click);
    return () => { window.removeEventListener("hashchange", on); document.removeEventListener("click", click); };
  }, [tribes]);

  // on phones the stones are a sideways strip: keep the chosen one in view (without moving the page)
  useEffect(() => {
    const list = plate.current, li = list?.children[idx] as HTMLElement | undefined;
    if (!list || !li || list.scrollWidth <= list.clientWidth) return;
    const a = li.getBoundingClientRect(), b = list.getBoundingClientRect();
    list.scrollBy({ left: a.left + a.width / 2 - (b.left + b.width / 2), behavior: "smooth" });
  }, [idx]);

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

  const five = slotItems(catalog, currentCollection(catalog), tribe.key);
  const verses = tribe.verses.filter((v) => v.source === "jacob" || v.source === "moses").slice(0, 2);
  const shown = verses.length ? verses : tribe.verses.slice(0, 2);

  return (
    <section id="tribes" ref={root} className={`onChalk section ${s.section}`} aria-roledescription="carousel" aria-label={title}>
      <div className="wrap">
        <header className={s.head}>
          <h2>{title}</h2>
          <p className="measure">{lede}</p>
        </header>

        <div className={s.stage} tabIndex={0} role="group" aria-label={`${title}, ${tribe.plain}`} onKeyDown={onKey}
          onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }} onTouchEnd={onTouchEnd}>
          <div className={s.controls}>
            <ul ref={plate} className={ch.plate} aria-label={t.tribes.choose}>
              {tribes.map((x, i) => (
                <li key={x.key}>
                  <button type="button" className={ch.stone} style={stoneStyle(x)} aria-pressed={i === idx} onClick={() => go(i)}>
                    <StoneLabel t={x} />
                  </button>
                </li>
              ))}
            </ul>
            <div className={s.nav}>
              <button type="button" className={s.arrow} onClick={() => go(idx - 1)} aria-label={t.tribes.prev}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14.5 5l-7 7 7 7" /></svg>
              </button>
              <span className={s.counter} aria-live="polite">{t.tribes.of.split(/(\{n\}|\{total\})/).map((part, i) => part === "{n}" ? <bdi key={i}>{idx + 1}</bdi> : part === "{total}" ? <bdi key={i}>{n}</bdi> : part)}</span>
              <button type="button" className={s.arrow} onClick={() => go(idx + 1)} aria-label={t.tribes.next}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9.5 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>

          <article key={tribe.key} className={s.slide} aria-roledescription="slide" aria-label={tribe.plain}>
            <div className={s.who}>
              <h3 className={s.name} style={tribeNameStyle(tribe, "chalk")}>{tribe.name}</h3>
              <p className={s.stoneLine}>
                <span className={s.dot} style={{ background: tribe.hex }} aria-hidden="true" />
                <span><span lang={locale === "he" ? undefined : "he-Latn"}>{tribe.stone}</span>, {tribe.stoneGloss}</span>
              </p>
              <p className={s.emblem}><span>{t.tribes.emblem}{colon(locale)}</span> {tribe.symbol}</p>
              <p className={s.essence}>{tribe.essence}</p>
              <Link className="link" href={`/${locale}/tribes/${tribe.key}/`}>{fill(t.tribes.page, { name: tribe.plain })}</Link>
            </div>
            <div className={s.verses}>
              {shown.map((v) => <Verse key={v.ref} v={v} className={s.verse} />)}
            </div>
            {five.length ? (
              <div className={s.five}>
                <h4 className={s.fiveTitle}>{fill(t.tribes.five, { name: tribe.plain })}</h4>
                <div className={s.fiveRow}>
                  {five.map((it) => <Tile key={it.id} item={it} sizes="(min-width: 1024px) 19vw, 44vw" />)}
                </div>
              </div>
            ) : null}
          </article>
        </div>
      </div>
    </section>
  );
}
