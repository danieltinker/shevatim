"use client";
import Link from "next/link";
import { formatPrice, tr } from "@/lib/format";
import type { Item } from "@/lib/types";
import { useI18n } from "./Providers";
import { pictureSrcSet, pictureUrl } from "./Pic";
import s from "./Tile.module.css";

export function PriceLine({ price, className }: { price: number | null; className?: string }) {
  const { t } = useI18n();
  return <span className={className}>{price == null ? t.shop.priceLater : <bdi dir="ltr">{formatPrice(price)}</bdi>}</span>;
}

/** Product tile: the picture floats on black (no edge), then the name and the price line. */
export default function Tile({ item, sizes, eager }: { item: Item; sizes?: string; eager?: boolean }) {
  const { locale, t } = useI18n();
  const [first, second] = item.pictures;
  const name = tr(item.name, locale);
  const sz = sizes ?? "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw";
  return (
    <Link className={s.tile} href={`/${locale}/item/?i=${encodeURIComponent(item.slug)}`}>
      <span className={s.frame}>
        {first ? (
          <img className={s.pic} src={pictureUrl(first, 480)} srcSet={pictureSrcSet(first)} sizes={sz} width={first.w} height={first.h}
            alt={first.alt?.[locale] || name} loading={eager ? "eager" : "lazy"} decoding="async" />
        ) : null}
        {second ? (
          <img className={`${s.pic} ${s.second}`} src={pictureUrl(second, 480)} srcSet={pictureSrcSet(second)} sizes={sz} width={second.w} height={second.h}
            alt="" loading="lazy" decoding="async" />
        ) : null}
        {item.soldOut ? <span className={s.sold}>{t.shop.soldOut}</span> : null}
      </span>
      <span className={s.name}>{name}</span>
      <PriceLine className={s.price} price={item.price} />
    </Link>
  );
}

export function Grid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`${s.grid} ${className ?? ""}`}>{children}</div>;
}
