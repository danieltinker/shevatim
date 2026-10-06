"use client";
// The playable 3D tzitzit. Loads the cloth engine (three.js + XPBD solver) only when the element is near the
// viewport, shows the poster until the first simulated frame is on screen, and falls back to the poster when
// WebGL is missing or the context is lost.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ClothSpec } from "@/lib/types";
import type { TzitzitHandle } from "./engine";

export interface TzitzitCanvasProps {
  spec: ClothSpec;
  /** kid = the same garment scaled down. */
  size?: "adult" | "kid";
  /** Picture shown before the 3D starts, without WebGL, and with reduced motion. */
  poster?: string;
  className?: string;
  /** Accessible description of what is shown. */
  label?: string;
  /** Short invitation shown until the visitor first touches the garment, e.g. "drag the cloth". */
  hint?: string;
}

const fill: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

export default function TzitzitCanvas({ spec, size = "adult", poster, className, label, hint }: TzitzitCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<TzitzitHandle | null>(null);
  const specRef = useRef(spec);
  specRef.current = spec;
  const visibleRef = useRef(false);
  const playingRef = useRef(true);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [touched, setTouched] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);

  const applyPause = (): void => {
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    handleRef.current?.setPaused(!(visibleRef.current && !hidden && playingRef.current));
  };

  // mount when close to the viewport; pause when off-screen or when the tab is hidden
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === "undefined") { visibleRef.current = true; setNear(true); return; }
    const nearIo = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setNear(true); nearIo.disconnect(); }
    }, { rootMargin: "400px 0px" });
    const seenIo = new IntersectionObserver((entries) => {
      for (const e of entries) visibleRef.current = e.isIntersecting;
      applyPause();
    }, { threshold: 0.02 });
    nearIo.observe(host);
    seenIo.observe(host);
    const onVisibility = (): void => applyPause();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { nearIo.disconnect(); seenIo.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the engine itself (safe under strict-mode double mounting: every mount is disposed by its own cleanup)
  useEffect(() => {
    if (!near || failed) return;
    const stage = stageRef.current;
    if (!stage || typeof window === "undefined") return;
    let cancelled = false;
    let handle: TzitzitHandle | null = null;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    playingRef.current = !reduced;
    setNeedsPlay(reduced);
    import("./engine")
      .then((mod) => {
        if (cancelled) return;
        handle = mod.mountTzitzit(stage, {
          spec: specRef.current,
          size,
          paused: true, // applyPause() decides right below
          onReady: () => { if (!cancelled) setReady(true); },
          onContextLost: () => { if (!cancelled) setFailed(true); },
          onInteract: () => {
            if (cancelled) return;
            setTouched(true);
            if (!playingRef.current) { playingRef.current = true; setNeedsPlay(false); }
          },
        });
        handleRef.current = handle;
        applyPause();
      })
      .catch(() => { if (!cancelled) setFailed(true); }); // no WebGL, blocked script, …: the poster stays
    return () => {
      cancelled = true;
      if (handleRef.current === handle) handleRef.current = null;
      try { handle?.dispose(); } catch { /* ignore */ }
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, failed, size]);

  useEffect(() => { handleRef.current?.setSpec(spec); }, [spec]);

  const play = (): void => {
    playingRef.current = true;
    setNeedsPlay(false);
    applyPause();
  };

  const live = ready && !failed;
  return (
    <div
      ref={hostRef}
      className={className}
      role="img"
      aria-label={label}
      style={{ position: "relative", aspectRatio: "3 / 4", background: "#000", overflow: "hidden" }}
    >
      {poster ? (
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{ ...fill, objectFit: "contain", opacity: live ? 0 : 1, transition: "opacity 500ms ease", pointerEvents: "none" }}
        />
      ) : null}
      {failed ? null : (
        <div ref={stageRef} style={{ ...fill, opacity: live ? 1 : 0, transition: "opacity 500ms ease" }} />
      )}
      {live && needsPlay ? (
        <button
          type="button"
          onClick={play}
          aria-label={hint ?? "Play"}
          style={{
            position: "absolute", insetInlineEnd: 12, bottom: 12, width: 40, height: 40, borderRadius: 20, padding: 0,
            border: "1px solid rgba(255,255,255,0.35)", background: "rgba(0,0,0,0.45)", color: "#fff", cursor: "pointer",
            display: "grid", placeItems: "center",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor" /></svg>
        </button>
      ) : null}
      {live && hint ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute", insetInline: 0, bottom: 10, textAlign: "center", fontSize: 11, letterSpacing: "0.08em",
            color: "rgba(255,255,255,0.55)", pointerEvents: "none", opacity: touched ? 0 : 1, transition: "opacity 600ms ease",
          }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}
