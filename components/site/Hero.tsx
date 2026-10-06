"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import media from "@/content/media.json";
import { asset } from "@/lib/asset";
import { useCatalog } from "@/lib/catalog";
import { tr } from "@/lib/format";
import { useI18n } from "./Providers";
import s from "./Hero.module.css";

const PORTRAIT = "(orientation: portrait) and (max-width: 900px)";

export default function Hero() {
  const { locale, t } = useI18n();
  const { settings } = useCatalog();
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<{ mp4: string; poster: string } | null>(null);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // poster only
    const pick = () => {
      const { desktop, mobile } = media.hero;
      if (window.matchMedia(PORTRAIT).matches) return { mp4: mobile.mp4, poster: mobile.poster };
      const saver = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
      // the 1080p film is large: only for wide screens that did not ask to save data
      return { mp4: window.innerWidth >= 1600 && !saver ? desktop.mp4 : desktop.mp4_720, poster: desktop.poster };
    };
    setSrc(pick());
    const mq = window.matchMedia(PORTRAIT);
    const on = () => setSrc(pick());
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) { void v.play().catch(() => undefined); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };

  return (
    <section className={s.hero} aria-label="Shevatim">
      {/* preload only the poster this screen will show */}
      <link rel="preload" as="image" href={asset(media.hero.mobile.poster)} media={PORTRAIT} fetchPriority="high" />
      <link rel="preload" as="image" href={asset(media.hero.desktop.poster)} media={`not all and ${PORTRAIT}`} fetchPriority="high" />
      <picture>
        <source media={PORTRAIT} srcSet={asset(media.hero.mobile.poster)} width={media.hero.mobile.w} height={media.hero.mobile.h} />
        <img className={s.media} src={asset(media.hero.desktop.poster)} width={media.hero.desktop.w} height={media.hero.desktop.h} alt="" fetchPriority="high" />
      </picture>
      {src ? (
        <video ref={video} key={src.mp4} className={s.media} src={asset(src.mp4)} poster={asset(src.poster)}
          muted loop playsInline autoPlay preload="metadata" aria-hidden="true" tabIndex={-1} />
      ) : null}
      <div className={s.shade} aria-hidden="true" />
      <div className={s.copy}>
        <h1 className={s.mark}>
          <picture>
            <source media="(max-width: 600px)" srcSet={asset(media.brand.wordmarkWhiteSmall)} width={626} height={242} />
            <img src={asset(media.brand.wordmarkWhite)} width={1252} height={484} alt={locale === "he" ? "שבטים" : "Shevatim"} />
          </picture>
        </h1>
        <p className={s.line}>{tr(settings.heroLine, locale)}</p>
        <Link className={`btn ${s.cta}`} href={`/${locale}/collection/`}>{t.hero.cta}</Link>
      </div>
      {src ? (
        <button type="button" className={s.toggle} onClick={toggle} aria-label={playing ? t.hero.pause : t.hero.play}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
            {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5l11 7-11 7z" />}
          </svg>
        </button>
      ) : null}
    </section>
  );
}
