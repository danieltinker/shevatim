import type { CSSProperties } from "react";
import media from "@/content/media.json";
import { asset } from "@/lib/asset";
import type { Picture } from "@/lib/types";

type P = Pick<Picture, "base" | "sizes" | "ext" | "w" | "h">;
const url = (p: P, size: number) => asset(`${p.base}-${size}.${p.ext}`);

/** A copy is named by its longer side; this is how wide it really is. */
const widthOf = (p: P, size: number) => (p.w >= p.h ? size : Math.round((size * p.w) / p.h));

/** The smallest copy that is at least `wanted` pixels wide (or the largest there is). */
export function pictureUrl(p: P, wanted: number): string {
  const sizes = [...p.sizes].sort((a, b) => a - b);
  return url(p, sizes.find((s) => widthOf(p, s) >= wanted) ?? sizes[sizes.length - 1]);
}
export function pictureSrcSet(p: P): string {
  return [...p.sizes].sort((a, b) => a - b).map((s) => `${url(p, s)} ${widthOf(p, s)}w`).join(", ");
}

/** A picture with its box reserved, so nothing moves when it arrives. */
export default function Pic({ p, alt, sizes, ratio, eager, className, fit = "cover", position }: {
  p: P; alt: string; sizes: string; ratio?: string; eager?: boolean; className?: string; fit?: "cover" | "contain"; position?: string;
}) {
  return (
    <img
      className={className}
      src={pictureUrl(p, 720)} srcSet={pictureSrcSet(p)} sizes={sizes}
      width={p.w} height={p.h} alt={alt}
      loading={eager ? "eager" : "lazy"} decoding="async"
      style={{ aspectRatio: ratio ?? `${p.w} / ${p.h}`, objectFit: fit, objectPosition: position, width: "100%", height: "auto", display: "block" }}
    />
  );
}

/** The wordmark, drawn in the current text colour: the PNG (it has an alpha channel) is only a mask, so one
 *  file serves both themes and the film. Give `label` where the mark is the only name of its element; leave
 *  it out inside a link or heading that is named already. Its height is set with `block-size` (40px by default). */
export function Wordmark({ className, label }: { className?: string; label?: string }) {
  const style = { ["--wm" as string]: `url("${asset(media.brand.wordmarkWhiteSmall)}")` } as CSSProperties;
  return label
    ? <span className={`wordmark ${className ?? ""}`} style={style} role="img" aria-label={label} />
    : <span className={`wordmark ${className ?? ""}`} style={style} aria-hidden="true" />;
}
