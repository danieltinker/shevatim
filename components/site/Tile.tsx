"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { formatPrice, tr } from "@/lib/format";
import { pick } from "@/lib/i18n";
import type { Item } from "@/lib/types";
import { useI18n } from "./Providers";
import { pictureSrcSet, pictureUrl } from "./Pic";
import s from "./Tile.module.css";

export function PriceLine({ price, className }: { price: number | null; className?: string }) {
  const { t } = useI18n();
  return <span className={className}>{price == null ? t.shop.priceLater : <bdi dir="ltr">{formatPrice(price)}</bdi>}</span>;
}

/** One sentence for the head of a listing, shown only when a piece in it has no price yet (instead of
 *  repeating it under every tile). */
export function PriceNote({ items, className }: { items: Item[]; className?: string }) {
  const { t } = useI18n();
  if (!items.some((i) => i.price == null)) return null;
  return <p className={className}>{pick(t.shop, "priceNote", t.shop.priceLater)}</p>;
}

// Can this screen hover? Decided in the browser after hydration (the server and the first client render say
// no), so phones never download the second picture of a tile, which they could not show anyway.
const HOVER = "(hover: hover) and (pointer: fine)";
function subscribeHover(cb: () => void) {
  const mq = window.matchMedia(HOVER);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export function useCanHover(): boolean {
  return useSyncExternalStore(subscribeHover, () => window.matchMedia(HOVER).matches, () => false);
}

/** Product tile: the cut-out sits on a stage box with air around it, then the name and, when there is one,
 *  the price. The second picture is asked for only when this tile is first hovered or focused, and it takes
 *  the place of the first only once it has arrived (the pictures are transparent, so they are never stacked). */
export default function Tile({ item, sizes, eager }: { item: Item; sizes?: string; eager?: boolean }) {
  const { locale, t } = useI18n();
  const canHover = useCanHover();
  const [wanted, setWanted] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [first, second] = item.pictures;
  const name = tr(item.name, locale);
  const sz = sizes ?? "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw";
  const soon = !!item.comingSoon;
  const want = canHover && second && !wanted && !soon ? () => setWanted(true) : undefined;
  return (
    <Link className={`${s.tile} ${soon ? s.soon : ""}`} href={`/${locale}/item/?i=${encodeURIComponent(item.slug)}`} onPointerEnter={want} onFocus={want}>
      <span className={`${s.frame} ${arrived ? s.swap : ""}`}>
        {first ? (
          <img className={`${s.pic} ${s.first}`} src={pictureUrl(first, 480)} srcSet={pictureSrcSet(first)} sizes={sz} width={first.w} height={first.h}
            alt={first.alt?.[locale] || name} loading={eager ? "eager" : "lazy"} decoding="async" />
        ) : null}
        {second && canHover && wanted ? (
          <img className={`${s.pic} ${s.second}`} src={pictureUrl(second, 480)} srcSet={pictureSrcSet(second)} sizes={sz} width={second.w} height={second.h}
            alt="" decoding="async" onLoad={() => setArrived(true)} />
        ) : null}
        {/* coming soon: the garment under a sand veil, the word in the middle */}
        {soon ? <span className={s.veil} aria-hidden="true"><span className={s.veilWord}>{t.home.comingSoon}</span><span className={s.veilSub}>{t.shop.nextDrop}</span></span> : null}
      </span>
      <span className={s.name}>{name}</span>
      {soon ? <span className="srOnly">{t.home.comingSoon}</span> : item.price != null ? <PriceLine className={s.price} price={item.price} /> : null}
      {item.soldOut ? <span className={s.sold}>{t.shop.soldOut}</span> : null}
    </Link>
  );
}

export function Grid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`${s.grid} ${className ?? ""}`}>{children}</div>;
}
