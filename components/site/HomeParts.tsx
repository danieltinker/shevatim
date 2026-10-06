"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import media from "@/content/media.json";
import { asset } from "@/lib/asset";
import { useCatalog } from "@/lib/catalog";
import { currentCollection, slotItems, tr } from "@/lib/format";
import type { Item, Picture, TribeKey } from "@/lib/types";
import Pic from "./Pic";
import { useI18n } from "./Providers";
import Tile, { Grid, useCanHover } from "./Tile";
import { firstSentences } from "./tribes";
import s from "./Home.module.css";

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

/** The collection: its name, one sentence, four pieces, and the way in. */
export function CollectionTeaser() {
  const { locale, t } = useI18n();
  const catalog = useCatalog();
  const col = currentCollection(catalog);
  if (!col) return null;
  const four = FIRST.map((k) => { const items = slotItems(catalog, col, k); return items.find((i) => i.category === "tzitziyot") ?? items[0]; })
    .filter((x): x is Item => !!x);
  const line = firstSentences(tr(col.description, locale), 1);
  return (
    <section className={`section ${s.bg}`} aria-labelledby="home-collection">
      <div className="wrap">
        <header className={s.head}>
          <p className={s.label}>{t.home.collectionLabel}</p>
          <h2 id="home-collection" className={s.display}>{tr(col.name, locale)}</h2>
          {line ? <p className={s.lede}>{line}</p> : null}
        </header>
        <Grid className={s.four}>{four.map((it) => <Tile key={it.id} item={it} />)}</Grid>
        <p className={s.actions}>
          <Link className="btn" href={`/${locale}/collection/`}>{t.home.collectionCta}</Link>
          <Link className={s.quiet} href={`/${locale}/shop/`}>{t.home.allPieces}</Link>
        </p>
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

/** A category tile with a clip: a still picture. Where a pointer can hover, the clip is fetched on the first
 *  hover and plays only while the pointer is on the tile; on touch screens it never loads at all. */
function ClipTile({ clip, active }: { clip: (typeof media.clips)[number]; active: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (active && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) setWanted(true);
  }, [active]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) void v.play().catch(() => undefined); else v.pause();
  }, [active, wanted]);
  return (
    <span className={s.catHold}>
      <img className={s.catMedia} src={asset(clip.poster)} width={clip.w} height={clip.h} alt="" loading="lazy" decoding="async" />
      {wanted ? <video ref={ref} className={`${s.catMedia} ${s.catClip}`} src={asset(clip.mp4)} poster={asset(clip.poster)} muted loop playsInline preload="auto" aria-hidden="true" tabIndex={-1} /> : null}
    </span>
  );
}

function CategoryTile({ href, name, soon, clip, children }: {
  href: string; name: string; soon: string | null; clip?: (typeof media.clips)[number]; children?: React.ReactNode;
}) {
  const canHover = useCanHover();
  const [over, setOver] = useState(false);
  return (
    <Link className={s.cat} href={href}
      onPointerEnter={clip && canHover ? () => setOver(true) : undefined}
      onPointerLeave={clip && canHover ? () => setOver(false) : undefined}>
      <span className={s.catFrame}>{clip ? <ClipTile clip={clip} active={over} /> : children}</span>
      <span className={s.catName}>{name}</span>
      {soon ? <span className={s.soon}>{soon}</span> : null}
    </Link>
  );
}

/** Shop by category: six calm picture tiles. */
export function Categories() {
  const { locale, t } = useI18n();
  const catalog = useCatalog();
  const cats = catalog.categories.filter((c) => c.visible).sort((a, b) => a.sort - b.sort);
  return (
    <section className={`section ${s.surface}`} aria-labelledby="home-categories">
      <div className="wrap">
        <header className={s.head}>
          <h2 id="home-categories">{t.home.categoriesTitle}</h2>
        </header>
        <ul className={s.catGrid}>
          {cats.map((c) => {
            const clip = media.clips.find((x) => x.key === CLIP[c.key]);
            const still = STILL[c.key] ? (media.lookbook as unknown as Picture[]).find((p) => p.base === STILL[c.key].base) : null;
            const first = catalog.items.find((i) => i.category === c.key && i.pictures[0])?.pictures[0];
            const empty = !catalog.items.some((i) => i.category === c.key);
            return (
              <li key={c.key}>
                <CategoryTile href={`/${locale}/shop/?cat=${c.key}`} name={tr(c.name, locale)} soon={empty ? t.home.comingSoon : null} clip={clip}>
                  {still ? <span className={s.catZoom} style={{ transform: `scale(${STILL[c.key].zoom ?? 1})`, transformOrigin: STILL[c.key].origin }}><Pic className={s.catMedia} p={still} alt="" ratio="4 / 5" sizes="(min-width: 1024px) 52vw, 120vw" position={STILL[c.key].position} /></span>
                    : first ? <Pic className={s.catMedia} p={first} alt="" ratio="4 / 5" sizes="(min-width: 1024px) 16vw, 33vw" /> : null}
                </CategoryTile>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
