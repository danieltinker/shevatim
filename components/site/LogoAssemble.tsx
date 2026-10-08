"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import s from "./LogoAssemble.module.css";

/* The hero wordmark as one soft, matte object: a cream face over a short extrusion of sand (six copies of the
   shape, each a little lower and darker) and a soft shadow on the film. Once per page load it is built from
   twelve pieces (twelve tribes, one name) that come forward from depth and lock together; then a slow light
   passes over it once. Every layer is the wordmark PNG used as a CSS mask. The motion is CSS, so it starts
   before the page's script has run; the script only holds it until the mask has arrived, removes the pieces
   once they have locked, and adds the pointer tilt on desktop. */

// the twelve pieces, cut at quiet columns of the 1252 px master so most cuts fall between letters
const MASTER = 1252;
const CUTS = [0, 133, 258, 357, 459, 557, 625, 756, 817, 900, 1040, 1119, MASTER];
// arrival order: from the centre outward, alternating sides
const ORDER = [6, 5, 7, 4, 8, 3, 9, 2, 10, 1, 11, 0];
const STAGGER = 0.055; // s between two arrivals
const START = 0.15; // s before the first

const PIECES = CUTS.slice(0, -1).map((a, i) => {
  const b = CUTS[i + 1];
  const c = (a + b) / 2 / MASTER - 0.5; // -0.5 (left) … 0.5 (right)
  const side = i % 2 ? 1 : -1;
  const jit = ((i * 7) % 5) / 4; // 0 … 1, fixed per piece
  return {
    key: i,
    style: {
      "--l": a / MASTER,
      "--pw": (b - a) / MASTER,
      "--d": `${(START + ORDER.indexOf(i) * STAGGER).toFixed(3)}s`,
      "--x": `${(c * 90).toFixed(2)}cqi`,
      "--y": `${(side * (5 + 4 * jit)).toFixed(2)}cqi`,
      "--z": `${(-(120 + 40 * jit)).toFixed(2)}cqi`,
      "--rx": `${(-side * (14 + 8 * jit)).toFixed(1)}deg`,
      "--ry": `${(-c * 60).toFixed(1)}deg`,
      "--rz": `${(side * (1.5 + 1.5 * jit)).toFixed(1)}deg`,
    } as CSSProperties,
  };
});

// the object itself: the sides (copies of the shape, each a little lower and darker, back to front), then the face
const SIDES = 6;
const BODY = (
  <>
    {Array.from({ length: SIDES }, (_, i) => <span key={i} className={s.side} />)}
    <span className={s.face} />
  </>
);

const TILT = 5; // degrees at the edge of the hero
const EASE_MS = 240; // time constant of the tilt's easing

type Props = { label: string; className?: string; style?: CSSProperties };

export default function LogoAssemble({ label, className, style }: Props) {
  const root = useRef<HTMLSpanElement>(null);
  const obj = useRef<HTMLSpanElement>(null);
  const shadow = useRef<HTMLSpanElement>(null);
  // 0: assembling, 1: assembled (pieces gone, light still passing), 2: still (light gone)
  const [phase, setPhase] = useState(0);

  // hold the moment until the mask has arrived: until then nothing of the wordmark can be seen, so restarting
  // it from the beginning is invisible, and it keeps the twelve pieces from landing unseen on a slow network
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setPhase(2); return; }
    const url = /url\(\s*["']?([^"')]+)/.exec(getComputedStyle(el).getPropertyValue("--m"))?.[1];
    if (!url) return;
    const img = new Image();
    img.src = url;
    if ((img.complete && img.naturalWidth) || performance.getEntriesByName(img.src).length) return; // already here
    const area = el.closest("section") ?? el;
    const held = area.getAnimations({ subtree: true }).filter((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target;
      const delay = Number(a.effect?.getTiming().delay ?? 0);
      return (target instanceof Node && el.contains(target)) || Number(a.currentTime ?? 0) < delay;
    });
    held.forEach((a) => a.pause());
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      window.clearTimeout(timer);
      held.forEach((a) => { a.currentTime = 0; a.play(); });
    };
    const timer = window.setTimeout(release, 2500); // never hold the button back for long
    img.decode().then(release, release);
    return release;
  }, []);

  // once assembled, on a desktop with a fine pointer only: a very small tilt toward the pointer, eased, with the
  // shadow on the film moving away from it; no listener and no frame runs while the hero is off screen
  const assembled = phase >= 1;
  useEffect(() => {
    const el = root.current, o = obj.current, sh = shadow.current;
    if (!assembled || !el || !o || !sh) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const area = (el.closest("section") ?? el) as HTMLElement;
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0, last = 0;
    const apply = () => {
      o.style.transform = x || y ? `perspective(300cqi) rotateX(${x.toFixed(3)}deg) rotateY(${y.toFixed(3)}deg)` : "";
      sh.style.translate = x || y ? `${(-y * 0.12).toFixed(3)}cqi ${(x * 0.1).toFixed(3)}cqi` : "";
    };
    const frame = (t: number) => {
      const dt = last ? Math.min(64, t - last) : 16;
      last = t;
      const k = 1 - Math.exp(-dt / EASE_MS);
      x += (tx - x) * k; y += (ty - y) * k;
      if (Math.abs(tx - x) + Math.abs(ty - y) < 0.004) { x = tx; y = ty; raf = 0; last = 0; } else raf = requestAnimationFrame(frame);
      apply();
    };
    const kick = () => {
      o.style.willChange = "transform"; // its own layer while it moves, so a tilt never repaints the object
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = el.getBoundingClientRect(), a = area.getBoundingClientRect();
      const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (a.width / 2)));
      const ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (a.height / 2)));
      ty = nx * TILT; tx = -ny * TILT;
      kick();
    };
    const leave = () => { tx = 0; ty = 0; kick(); };
    let on = false;
    const start = () => {
      if (on) return;
      on = true;
      area.addEventListener("pointermove", move, { passive: true });
      area.addEventListener("pointerleave", leave);
    };
    const stop = () => {
      if (!on) return;
      on = false;
      area.removeEventListener("pointermove", move);
      area.removeEventListener("pointerleave", leave);
      if (raf) cancelAnimationFrame(raf);
      raf = 0; last = 0; x = y = tx = ty = 0;
      apply();
      o.style.willChange = "";
    };
    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()));
    io.observe(area);
    return () => { io.disconnect(); stop(); };
  }, [assembled]);

  return (
    <span ref={root} className={`${s.logo} ${className ?? ""}`} role="img" aria-label={label} style={style}>
      <span ref={shadow} className={s.shadow} aria-hidden="true"><span className={s.shadowInk} /></span>
      <span ref={obj} className={s.obj} aria-hidden="true">
        <span className={`${s.body} ${s.whole}`}>{BODY}</span>
        {phase < 1 ? (
          <span className={s.pieces} onAnimationEnd={(e) => { if (e.target === e.currentTarget) setPhase(1); }}>
            {PIECES.map((p) => <span key={p.key} className={`${s.body} ${s.piece}`} style={p.style}>{BODY}</span>)}
          </span>
        ) : null}
        {phase < 2 ? (
          <span className={s.sheen} onAnimationEnd={(e) => { if (e.target !== e.currentTarget) setPhase(2); }}>
            <span className={s.band} />
          </span>
        ) : null}
      </span>
    </span>
  );
}
