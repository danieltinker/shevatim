import { asset } from "@/lib/asset";
import type { Picture } from "@/lib/types";

type P = Pick<Picture, "base" | "sizes" | "ext" | "w" | "h">;
const url = (p: P, size: number) => asset(`${p.base}-${size}.${p.ext}`);

/** The smallest copy that is at least `wanted` pixels wide (or the largest there is). */
export function pictureUrl(p: P, wanted: number): string {
  const sizes = [...p.sizes].sort((a, b) => a - b);
  return url(p, sizes.find((s) => s >= wanted) ?? sizes[sizes.length - 1]);
}
export function pictureSrcSet(p: P): string {
  return [...p.sizes].sort((a, b) => a - b).map((s) => `${url(p, s)} ${s}w`).join(", ");
}

/** A picture with its box reserved, so nothing moves when it arrives. */
export default function Pic({ p, alt, sizes, ratio, eager, className, fit = "cover", position }: {
  p: P; alt: string; sizes: string; ratio?: string; eager?: boolean; className?: string; fit?: "cover" | "contain"; position?: string;
}) {
  return (
    <img
      className={className}
      src={pictureUrl(p, 960)} srcSet={pictureSrcSet(p)} sizes={sizes}
      width={p.w} height={p.h} alt={alt}
      loading={eager ? "eager" : "lazy"} decoding="async"
      style={{ aspectRatio: ratio ?? `${p.w} / ${p.h}`, objectFit: fit, objectPosition: position, width: "100%", height: "auto", display: "block" }}
    />
  );
}
