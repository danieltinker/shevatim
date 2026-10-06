"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { bag } from "@/lib/bag";
import { useCatalog } from "@/lib/catalog";
import { fill, priceOf, tr } from "@/lib/format";
import type { Dict } from "@/lib/i18n";
import { LOCALES, type Locale, type Picture } from "@/lib/types";
import { asset } from "@/lib/asset";
import { useNear } from "./HomeParts";
import { pictureSrcSet, pictureUrl } from "./Pic";
import { useI18n } from "./Providers";
import { PriceLine } from "./Tile";
import type { TribeView } from "./tribes";
import s from "./Item.module.css";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
const TzitzitCanvas = dynamic(() => import("@/components/cloth/TzitzitCanvas"), { ssr: false });

function viewLabel(t: Dict, p: Picture, i: number) {
  const k = p.view ? (`view_${p.view}` as "view_front" | "view_back" | "view_side" | "view_detail") : null;
  return k && p.kind !== "render" ? t.item[k] : fill(t.item.picture, { n: i + 1 });
}

export function ItemView({ slug, tribes, pending }: { slug: string | null; tribes: TribeView[]; pending?: boolean }) {
  const { locale, t } = useI18n();
  const catalog = useCatalog();
  const item = slug ? catalog.items.find((i) => i.slug === slug && i.status === "published") : undefined;
  const [pic, setPic] = useState(0);
  const [variant, setVariant] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [clothRef, clothNear] = useNear<HTMLDivElement>("200px");
  useEffect(() => { setPic(0); setVariant(null); setAdded(false); }, [slug]);
  useEffect(() => { if (item) document.title = `${tr(item.name, locale)} · ${locale === "he" ? "שבטים" : "Shevatim"}`; }, [item, locale]);

  if (pending) return <div className={`onBlack ${s.page} ${s.pending}`} aria-busy="true"><p className="srOnly">{t.item.loading}</p></div>;
  if (!item) {
    return (
      <div className={`onBlack section ${s.page}`}>
        <div className={`wrap ${s.missing}`}>
          <h1>{t.item.notFoundTitle}</h1>
          <p className="muted">{t.item.notFoundText}</p>
          <Link className="btn" href={`/${locale}/shop/`}>{t.item.backToShop}</Link>
        </div>
      </div>
    );
  }

  const name = tr(item.name, locale);
  const variants = item.variants;
  const chosen = variants.length ? variants.find((v) => v.key === variant && v.available) ?? variants.find((v) => v.available) ?? null : null;
  const canAdd = !item.soldOut && (variants.length === 0 || !!chosen) && catalog.settings.reservationsOpen;
  const tribe = item.tribe ? tribes.find((x) => x.key === item.tribe) : null;
  const pics = item.pictures.slice(0, 8);
  const shown = Math.min(pic, Math.max(0, pics.length - 1));
  const main: Picture | undefined = pics[shown];
  const category = catalog.categories.find((c) => c.key === item.category);
  const long = variants.length > 0 && variants.some((v) => tr(v.label, locale).length > 4);

  const here = (l: Locale) => `${SITE}${asset(`/${l}/item/`)}?i=${encodeURIComponent(item.slug)}`;
  return (
    <div className={`onBlack ${s.page}`}>
      <link rel="canonical" href={here(locale)} />
      {LOCALES.map((l) => <link key={l} rel="alternate" hrefLang={l} href={here(l)} />)}
      <link rel="alternate" hrefLang="x-default" href={here("he")} />
      <div className={`wrap ${s.grid}`}>
        <div className={`${s.gallery} ${pics.length > 1 ? s.withThumbs : ""}`} role="group" aria-label={t.item.pictures}>
          <div className={s.stageBox}>
            <div className={s.main}>
              {main ? (
                <img key={main.base} src={pictureUrl(main, 960)} srcSet={pictureSrcSet(main)} sizes="(min-width: 1024px) 46vw, 100vw"
                  width={main.w} height={main.h} alt={main.alt?.[locale] || `${name}, ${viewLabel(t, main, shown)}`} fetchPriority="high" />
              ) : (
                <p className={s.noPic}><span>{name}</span><small>{t.item.noPictures}</small></p>
              )}
            </div>
            {/* the line keeps its place so the page does not jump between a rendering and a photograph */}
            {pics.some((p) => p.kind === "render") ? <p className={s.renderNote} aria-live="polite">{main?.kind === "render" ? t.item.render : "\u00a0"}</p> : null}
          </div>
          {pics.length > 1 ? (
            <ul className={s.thumbs}>
              {pics.map((p, i) => (
                <li key={p.base}>
                  <button type="button" aria-pressed={i === shown} aria-label={viewLabel(t, p, i)} onClick={() => setPic(i)}>
                    <img src={pictureUrl(p, 240)} width={p.w} height={p.h} alt="" loading="lazy" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className={s.info}>
          {category ? <Link className={`small muted ${s.crumb}`} href={`/${locale}/shop/?cat=${category.key}`}>{tr(category.name, locale)}</Link> : null}
          <h1 className={s.name}>{name}</h1>
          <PriceLine className={s.price} price={priceOf(item, chosen?.key)} />

          {variants.length ? (
            <fieldset className={s.variants}>
              <legend>{t.item.choose}</legend>
              <div className={long ? s.optsLong : s.opts}>
                {variants.map((v) => (
                  <label key={v.key} className={s.opt}>
                    <input type="radio" name="variant" value={v.key} checked={chosen?.key === v.key} disabled={!v.available}
                      onChange={() => { setVariant(v.key); setAdded(false); }} />
                    <span><bdi>{tr(v.label, locale)}</bdi></span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <button type="button" className={`btn ${s.add}`} disabled={!canAdd}
            onClick={() => { bag.add(item.id, chosen?.key ?? null, 1); setAdded(true); }}>
            {item.soldOut ? t.shop.soldOut : t.item.add}
          </button>
          <p className={s.added} role="status">
            {added ? <>{t.item.added} <Link className="link" href={`/${locale}/reserve/`}>{t.item.toBag}</Link></> : null}
            {!catalog.settings.reservationsOpen ? t.item.noReserve : null}
          </p>

          {tr(item.description, locale) ? <p className={s.desc}>{tr(item.description, locale)}</p> : null}

          {tribe ? (
            <aside className={s.tribe}>
              <p className="small muted">{t.item.tribe}</p>
              <p className={s.tribeName} style={{ color: tribe.onBlack }}>
                <span className={s.dot} style={{ background: tribe.hex }} aria-hidden="true" />{tribe.name}
              </p>
              <p className={`verse ${s.tribeVerse}`} lang="he" dir="rtl">{tribe.tagline.he}</p>
              {tribe.tagline.tr ? <p className="muted">{tribe.tagline.tr}</p> : null}
              <Link className="link" href={`/${locale}/tribes/${tribe.key}/`}>{fill(t.item.tribeLink, { name: tribe.plain })}</Link>
            </aside>
          ) : null}
        </div>
      </div>

      {item.cloth ? (
        <section className={`wrap ${s.play}`}>
          <div className={s.playText}>
            <h2>{t.item.play3d}</h2>
            <p className="muted">{t.item.play3dLine}</p>
          </div>
          <div ref={clothRef} className={s.playStage}>
            {clothNear ? (
              <TzitzitCanvas spec={item.cloth} size={chosen?.key === "kid" ? "kid" : "adult"} label={`${name}, ${t.home.clothLabel}`} hint={t.home.clothHint}
                poster={item.pictures[0] ? pictureUrl(item.pictures[0], 960) : undefined} className={s.canvas} />
            ) : <div className={s.canvasHold} />}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ItemFromQuery({ tribes }: { tribes: TribeView[] }) {
  return <ItemView tribes={tribes} slug={useSearchParams().get("i")} />;
}
