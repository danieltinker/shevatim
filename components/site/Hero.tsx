"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import media from "@/content/media.json";
import { asset } from "@/lib/asset";
import { useCatalog } from "@/lib/catalog";
import { tr } from "@/lib/format";
import { useI18n } from "./Providers";
import LogoAssemble from "./LogoAssemble";
import { SoundToggle, useSound } from "./Sound";
import s from "./Hero.module.css";

const PORTRAIT = "(orientation: portrait) and (max-width: 900px)";

/** The first screen: the film, the wordmark, the one line and the one button. Nothing else. */
export default function Hero() {
  const { locale, t } = useI18n();
  const { settings } = useCatalog();
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<{ mp4: string; poster: string } | null>(null);
  const [playing, setPlaying] = useState(false); // follows the film itself (a phone in low-power mode may not start it)
  const { attachFilm } = useSound();
  // the film keeps its own sound; the sound provider decides when it is heard
  useEffect(() => { attachFilm(video.current); return () => attachFilm(null); }, [src, attachFilm]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // poster only
    const pick = () => {
      const { desktop, mobile } = media.hero;
      if (window.matchMedia(PORTRAIT).matches) return { mp4: mobile.mp4, poster: mobile.poster };
      const saver = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
      // the 1080p film is large: only for screens that can show it (wide, or dense like a laptop's) and did not ask to save data
      return { mp4: window.innerWidth * Math.min(2, window.devicePixelRatio || 1) >= 1600 && !saver ? desktop.mp4 : desktop.mp4_720, poster: desktop.poster };
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
    if (v.paused) void v.play().catch(() => undefined); else v.pause();
  };

  // the wordmark is drawn through its PNG as a mask (the small file on small, ordinary screens)
  const mark = {
    ["--mark" as string]: `url("${asset(media.brand.wordmarkWhite)}")`,
    ["--mark-small" as string]: `url("${asset(media.brand.wordmarkWhiteSmall)}")`,
  } as CSSProperties;

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
          muted loop playsInline autoPlay preload="metadata" aria-hidden="true" tabIndex={-1}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      ) : null}
      <div className={s.shade} aria-hidden="true" />
      <div className={s.copy}>
        <h1 className={s.mark}>
          <LogoAssemble className={s.ink} label={locale === "he" ? "שבטים" : "Shevatim"} style={mark} />
        </h1>
        <p className={s.line}>{tr(settings.heroLine, locale)}</p>
        <Link className={`btn ${s.cta}`} href={`/${locale}/collection/`}>{t.hero.cta}</Link>
      </div>
      <div className={s.controls}>
        <SoundToggle className={s.ctl} />
        {src ? (
          <button type="button" className={`iconBtn ${s.ctl}`} onClick={toggle} aria-label={playing ? t.hero.pause : t.hero.play} title={playing ? t.hero.pause : t.hero.play}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
              {playing ? <path d="M7.5 6h3v12h-3zM13.5 6h3v12h-3z" /> : <path d="M8.5 6l9.5 6-9.5 6z" />}
            </svg>
          </button>
        ) : null}
      </div>
    </section>
  );
}
