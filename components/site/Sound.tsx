"use client";
// All sound on the site lives here. Sound is off until the visitor turns it on (browsers refuse sound before a
// tap). On: the hero film plays its own sound while it is on screen, and a very quiet background track loops
// across the site. Off: silence at once. The choice is remembered; the track pauses while the tab is hidden.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { asset } from "@/lib/asset";
import { useI18n } from "./Providers";

export const SOUND_KEY = "shv-sound";
const TRACK = "/media/audio/midbar-ambient.m4a";
const MUSIC_LEVEL = 0.2;       // the track never competes with the film or with reading
const MUSIC_UNDER_FILM = 0.08; // and steps back while the film's own sound is heard
const FILM_LEVEL = 0.7;

type Ctx = { on: boolean; toggle: () => void; attachFilm: (v: HTMLVideoElement | null) => void };
const SoundCtx = createContext<Ctx>({ on: false, toggle: () => undefined, attachFilm: () => undefined });
export const useSound = () => useContext(SoundCtx);

/** Moves a media element's volume to `to` over `ms`, then calls `done`. Returns a cancel function. */
function fade(el: HTMLMediaElement, to: number, ms: number, done?: () => void): () => void {
  const from = el.volume, t0 = performance.now();
  let raf = 0, stopped = false;
  const step = (now: number) => {
    if (stopped) return;
    const k = Math.min(1, (now - t0) / ms);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) raf = requestAnimationFrame(step); else done?.();
  };
  raf = requestAnimationFrame(step);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  const onRef = useRef(false);
  const music = useRef<HTMLAudioElement | null>(null);
  const film = useRef<HTMLVideoElement | null>(null);
  const filmSeen = useRef(false);
  const io = useRef<IntersectionObserver | null>(null);
  const cancelMusic = useRef<() => void>(() => undefined);
  const cancelFilm = useRef<() => void>(() => undefined);

  const apply = useCallback(() => {
    const wantOn = onRef.current && !document.hidden;
    const v = film.current;
    const filmAudible = wantOn && !!v && filmSeen.current && !v.paused;
    // the film
    if (v) {
      cancelFilm.current();
      if (filmAudible) {
        if (v.muted) { v.volume = 0; v.muted = false; }
        cancelFilm.current = fade(v, FILM_LEVEL, 500);
      } else if (!v.muted) {
        cancelFilm.current = fade(v, 0, 250, () => { v.muted = true; });
      }
    }
    // the track
    cancelMusic.current();
    if (wantOn) {
      if (!music.current) {
        const a = new Audio(asset(TRACK));
        a.loop = true; a.preload = "auto"; a.volume = 0;
        music.current = a;
      }
      const a = music.current;
      const level = filmAudible ? MUSIC_UNDER_FILM : MUSIC_LEVEL;
      const p = a.paused ? a.play() : Promise.resolve();
      void p.then(() => { cancelMusic.current = fade(a, level, 1200); }).catch(() => undefined); // refused before a tap: retried on the next gesture
    } else if (music.current && !music.current.paused) {
      const a = music.current;
      cancelMusic.current = fade(a, 0, 300, () => a.pause());
    }
  }, []);

  const set = useCallback((next: boolean) => {
    onRef.current = next;
    setOn(next);
    try { window.localStorage.setItem(SOUND_KEY, next ? "on" : "off"); } catch { /* ignore */ }
    apply();
  }, [apply]);
  const toggle = useCallback(() => set(!onRef.current), [set]);

  const attachFilm = useCallback((v: HTMLVideoElement | null) => {
    io.current?.disconnect();
    film.current = v;
    filmSeen.current = false;
    if (!v) { apply(); return; }
    io.current = new IntersectionObserver(([e]) => { filmSeen.current = e.isIntersecting && e.intersectionRatio > 0.35; apply(); }, { threshold: [0, 0.35, 0.6] });
    io.current.observe(v);
    v.addEventListener("pause", apply);
    v.addEventListener("play", apply);
  }, [apply]);

  useEffect(() => {
    let saved = false;
    try { saved = window.localStorage.getItem(SOUND_KEY) === "on"; } catch { /* ignore */ }
    if (saved) { onRef.current = true; setOn(true); apply(); }
    // a remembered "on" can only start after the first tap or key on this page
    const kick = () => { if (onRef.current) apply(); };
    window.addEventListener("pointerdown", kick, { passive: true });
    window.addEventListener("keydown", kick);
    document.addEventListener("visibilitychange", apply);
    return () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
      document.removeEventListener("visibilitychange", apply);
      io.current?.disconnect();
      cancelMusic.current(); cancelFilm.current();
      music.current?.pause();
    };
  }, [apply]);

  const value = useMemo(() => ({ on, toggle, attachFilm }), [on, toggle, attachFilm]);
  return <SoundCtx.Provider value={value}>{children}</SoundCtx.Provider>;
}

/** The one sound control: a round speaker button. Pressed = sound is on. */
export function SoundToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const { on, toggle } = useSound();
  const label = on ? t.sound.off : t.sound.on;
  return (
    <button type="button" className={`iconBtn ${className ?? ""}`} onClick={toggle} aria-pressed={on} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z" />
        {on ? <><path d="M15.5 9a4.2 4.2 0 0 1 0 6" /><path d="M18 6.5a7.8 7.8 0 0 1 0 11" /></> : <path d="m16 9.5 5 5m0-5-5 5" />}
      </svg>
    </button>
  );
}
