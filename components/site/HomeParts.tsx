"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import media from "@/content/media.json";
import { asset } from "@/lib/asset";
import { useCatalog } from "@/lib/catalog";
import { currentCollection, slotItems, tr } from "@/lib/format";
import type { Item, Picture, TribeKey } from "@/lib/types";
import Pic, { pictureUrl } from "./Pic";
import { useI18n } from "./Providers";
import Tile, { Grid, PriceNote } from "./Tile";
import s from "./Home.module.css";

// while the 3D code is on its way the stage keeps its box (and shows the poster under this empty holder)
const TzitzitCanvas = dynamic(() => import("@/components/cloth/TzitzitCanvas"), { ssr: false, loading: () => <div className={s.canvasHold} aria-hidden="true" /> });

/** True once the element has come near the viewport (and stays true). */
export function useNear<T extends Element>(margin = "300px") {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) setNear(true); }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);
  return [ref, near] as const;
}

const FIRST: TribeKey[] = ["yehuda", "asher", "gad", "shimon"];

export function CollectionTeaser() {
  const { locale, t } = useI18n();
  const catalog = useCatalog();
  const col = currentCollection(catalog);
  if (!col) return null;
  const four = FIRST.map((k) => { const items = slotItems(catalog, col, k); return items.find((i) => i.category === "tzitziyot") ?? items[0]; })
    .filter((x): x is Item => !!x);
  return (
    <section className={`onBlack section ${s.collection}`}>
      <div className="wrap">
        <header className={s.colHead}>
          <div>
            <p className={s.kicker}>{t.home.collectionLabel}</p>
            <h2 className={s.colName}>{tr(col.name, locale)}</h2>
          </div>
          <div className={s.colText}>
            <p className="measure">{tr(col.description, locale)}</p>
            <PriceNote items={four} className={s.priceNote} />
            <Link className="link" href={`/${locale}/collection/`}>{t.home.collectionLink}</Link>
          </div>
        </header>
        <Grid className={s.four}>{four.map((it) => <Tile key={it.id} item={it} />)}</Grid>
      </div>
    </section>
  );
}

export function ClothSection() {
  const { locale, t } = useI18n();
  const catalog = useCatalog();
  const [ref, near] = useNear<HTMLDivElement>("200px");
  const col = currentCollection(catalog);
  const item = (col ? slotItems(catalog, col, "yehuda").find((i) => i.cloth) : null) ?? catalog.items.find((i) => i.cloth);
  if (!item?.cloth) return null;
  const poster = item.pictures[0] ? pictureUrl(item.pictures[0], 960) : undefined;
  return (
    <section className={`onBlack section ${s.cloth}`}>
      <div className={`wrap ${s.clothGrid}`}>
        <div className={s.clothText}>
          <h2>{t.home.clothTitle}</h2>
          <p className="muted">{t.home.clothLine}</p>
          <Link className="link" href={`/${locale}/item/?i=${encodeURIComponent(item.slug)}`}>{tr(item.name, locale)}</Link>
        </div>
        <div ref={ref} className={s.clothStage}>
          {poster ? <img className={s.stagePoster} src={poster} alt="" loading="lazy" decoding="async" /> : null}
          {near ? <TzitzitCanvas spec={item.cloth} poster={poster} label={t.home.clothLabel} hint={t.home.clothHint} className={s.canvas} /> : null}
        </div>
      </div>
    </section>
  );
}

const CLIP: Record<string, string> = { tzitziyot: "tzitzit-bw", shirts: "longsleeve" };
// The other tiles are campaign pictures cropped onto the item: the olive pants beside the camel, the shell necklace
// on a chest, a wrist stacked with bracelets, and (no kippah item yet) the white knitted kippah.
const STILL: Record<string, { base: string; position?: string; zoom?: number; origin?: string }> = {
  pants: { base: "/media/lookbook/yog06048", position: "78% 100%", zoom: 1.5, origin: "80% 100%" },
  necklaces: { base: "/media/lookbook/yog06040", position: "100% 50%", zoom: 1.9, origin: "100% 54%" },
  bracelets: { base: "/media/lookbook/yog06085", position: "36% 50%", zoom: 1.9, origin: "36% 50%" },
  kippot: { base: "/media/lookbook/yog06092_2", position: "62% 0%", zoom: 2.1, origin: "60% 14%" },
};

function ClipTile({ clip, label }: { clip: (typeof media.clips)[number]; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [holder, near] = useNear<HTMLSpanElement>("400px"); // nothing is requested until the tile is close
  useEffect(() => {
    const v = ref.current;
    if (!near || !v || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) void v.play().catch(() => undefined); else v.pause();
    }, { threshold: 0.35 });
    io.observe(v);
    return () => io.disconnect();
  }, [near]);
  return (
    <span ref={holder} className={s.catHold}>
      {near ? <video ref={ref} className={s.catMedia} src={asset(clip.mp4)} poster={asset(clip.poster)} muted loop playsInline preload="none" aria-label={label} /> : null}
    </span>
  );
}

export function Categories() {
  const { locale, t } = useI18n();
  const catalog = useCatalog();
  const cats = catalog.categories.filter((c) => c.visible).sort((a, b) => a.sort - b.sort);
  return (
    <section className={`onBlack section ${s.cats}`}>
      <div className="wrap">
        <h2 className={s.h}>{t.home.categoriesTitle}</h2>
        <ul className={s.catGrid}>
          {cats.map((c) => {
            const name = tr(c.name, locale);
            const clip = media.clips.find((x) => x.key === CLIP[c.key]);
            const still = STILL[c.key] ? (media.lookbook as unknown as Picture[]).find((p) => p.base === STILL[c.key].base) : null;
            const first = catalog.items.find((i) => i.category === c.key && i.pictures[0])?.pictures[0];
            const empty = !catalog.items.some((i) => i.category === c.key);
            return (
              <li key={c.key}>
                <Link className={s.cat} href={`/${locale}/shop/?cat=${c.key}`}>
                  <span className={s.catFrame}>
                    {clip ? <ClipTile clip={clip} label={name} />
                      : still ? <span className={s.catZoom} style={{ transform: `scale(${STILL[c.key].zoom ?? 1})`, transformOrigin: STILL[c.key].origin }}><Pic className={s.catMedia} p={still} alt="" ratio="4 / 5" sizes="(min-width: 1024px) 70vw, 100vw" position={STILL[c.key].position} /></span>
                      : first ? <Pic className={s.catMedia} p={first} alt="" ratio="4 / 5" sizes="(min-width: 1024px) 33vw, 50vw" /> : null}
                  </span>
                  <span className={s.catName}>{name}</span>
                  {empty ? <span className={s.soon}>{t.home.comingSoon}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
