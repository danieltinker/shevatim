"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { bag } from "@/lib/bag";
import { useCatalog } from "@/lib/catalog";
import { fill, priceOf, tr } from "@/lib/format";
import { pick, type Dict } from "@/lib/i18n";
import { LOCALES, type Locale, type Picture } from "@/lib/types";
import { asset } from "@/lib/asset";
import { pictureSrcSet, pictureUrl } from "./Pic";
import { useI18n } from "./Providers";
import { PriceLine } from "./Tile";
import type { TribeView } from "./tribes";
import s from "./Item.module.css";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
// while the 3D code is on its way the stage keeps its box (and shows the poster under this empty holder)
const TzitzitCanvas = dynamic(() => import("@/components/cloth/TzitzitCanvas"), { ssr: false, loading: () => <div className={s.canvasHold} aria-hidden="true" /> });
const CHOOSE: Record<Locale, string> = { he: "בחרו מידה קודם", en: "Choose a size first", fr: "Choisissez d’abord une taille" };

/** True once the element has come near the viewport (and stays true): the 3D code is not asked for before. */
function useNear<T extends Element>(margin: string) {
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
  const [needChoice, setNeedChoice] = useState(false);
  const opts = useRef<HTMLDivElement>(null);
  const [clothRef, clothNear] = useNear<HTMLDivElement>("200px");
  useEffect(() => { setPic(0); setVariant(null); setAdded(false); setNeedChoice(false); }, [slug]);
  // The tab title. The prerendered page carries the generic one, and the framework writes it again after this
  // page has opened from a direct link, so the item's title is put back whenever <head> changes. (A <title>
  // rendered here does not help: it lands behind the generic one and browsers show the first.)
  const itemName = item ? tr(item.name, locale) : null;
  useEffect(() => {
    if (!itemName) return;
    const wanted = `${itemName} · ${locale === "he" ? "שבטים" : "Shevatim"}`;
    const before = document.title;
    const apply = () => { if (document.title !== wanted) document.title = wanted; };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      // leaving for a page whose own title the framework did not need to rewrite: give the old one back
      if (document.title === wanted) document.title = before;
    };
  }, [itemName, locale]);

  if (pending) return <div className={`${s.page} ${s.pending}`} aria-busy="true"><p className="srOnly">{t.item.loading}</p></div>;
  if (!item) {
    return (
      <div className={`section ${s.page}`}>
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
  // one size: it is the choice. Several: nothing is chosen until the visitor chooses.
  const chosen = variants.length === 1 ? (variants[0].available ? variants[0] : null) : variants.find((v) => v.key === variant && v.available) ?? null;
  const soon = !!item.comingSoon;
  const canAdd = !soon && !item.soldOut && (variants.length === 0 || variants.some((v) => v.available)) && catalog.settings.reservationsOpen;
  // counted stock: the last one or two of the chosen size (or of a piece without sizes) are said out loud
  const leftNow = variants.length ? (chosen?.left ?? null) : (item.left ?? null);
  const add = () => {
    if (variants.length && !chosen) {
      setNeedChoice(true); setAdded(false);
      opts.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
      return;
    }
    bag.add(item.id, chosen?.key ?? null, 1); setAdded(true);
  };
  const tribe = item.tribe ? tribes.find((x) => x.key === item.tribe) : null;
  const pics = item.pictures.slice(0, 8);
  const shown = Math.min(pic, Math.max(0, pics.length - 1));
  const main: Picture | undefined = pics[shown];
  const category = catalog.categories.find((c) => c.key === item.category);
  const long = variants.length > 0 && variants.some((v) => tr(v.label, locale).length > 4);

  const here = (l: Locale) => `${SITE}${asset(`/${l}/item/`)}?i=${encodeURIComponent(item.slug)}`;
  return (
    <div className={s.page}>
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
          {category ? <Link className={`label ${s.crumb}`} href={`/${locale}/shop/?cat=${category.key}`}>{tr(category.name, locale)}</Link> : null}
          <h1 className={s.name}>{name}</h1>
          {soon ? null : <PriceLine className={s.price} price={priceOf(item, chosen?.key)} />}
          {!soon && leftNow != null && leftNow > 0 && leftNow <= 2 ? (
            <p className={s.left}>{leftNow === 1 ? t.item.leftOne : fill(t.item.left, { n: leftNow })}</p>
          ) : null}

          {variants.length && !soon ? (
            <fieldset className={s.variants} aria-describedby={needChoice && !chosen ? "e-variant" : undefined}>
              <legend>{t.item.choose}</legend>
              <div ref={opts} className={long ? s.optsLong : s.opts}>
                {variants.map((v) => (
                  <label key={v.key} className={s.opt}>
                    <input type="radio" name="variant" value={v.key} checked={chosen?.key === v.key} disabled={!v.available}
                      onChange={() => { setVariant(v.key); setAdded(false); setNeedChoice(false); }} />
                    <span><bdi>{tr(v.label, locale)}</bdi>{v.available ? null : <span className={s.optGone}> · {t.item.sizeGone}</span>}</span>
                  </label>
                ))}
              </div>
              {needChoice && !chosen ? <p id="e-variant" className={s.needChoice} role="alert">{pick(t.item, "chooseVariant", CHOOSE[locale])}</p> : null}
            </fieldset>
          ) : null}

          {soon ? (
            <div className={s.soonBox}>
              <span className={`btn ${s.soonPill}`} aria-disabled="true">{t.home.comingSoon}</span>
              <p className={s.soonNote}>{t.item.comingSoonNote}</p>
              {catalog.settings.whatsapp ? (
                <a className="link" href={`https://wa.me/${catalog.settings.whatsapp}?text=${encodeURIComponent(`${name} [${item.code}]`)}`} target="_blank" rel="noopener noreferrer">{t.item.comingSoonAsk}</a>
              ) : null}
            </div>
          ) : (
            <>
              <button type="button" className={`btn ${s.add}`} disabled={!canAdd} onClick={add}>
                {item.soldOut ? t.shop.soldOut : t.item.add}
              </button>
              <p className={s.added} role="status">
                {added ? <>{t.item.added} <Link className="link" href={`/${locale}/reserve/`}>{t.item.toBag}</Link></> : null}
                {!catalog.settings.reservationsOpen ? t.item.noReserve : null}
              </p>
            </>
          )}

          {tr(item.description, locale) ? <p className={s.desc}>{tr(item.description, locale)}</p> : null}

          {tribe ? (
            <aside className={s.tribe}>
              <p className="label">{t.item.tribe}</p>
              <p className={s.tribeName}>{tribe.name}</p>
              <p className={`verse ${s.tribeVerse}`} lang="he" dir="rtl">{tribe.tagline.he}</p>
              {tribe.tagline.tr ? <p className={`muted ${s.tribeVerseTr}`}>{tribe.tagline.tr}</p> : null}
              <Link className="link" href={`/${locale}/tribes/${tribe.key}/`}>{fill(t.item.tribeLink, { name: tribe.plain })}</Link>
            </aside>
          ) : null}
        </div>
      </div>

      {item.cloth ? (
        <section className={s.play} aria-labelledby="play-h">
          <div className={`wrap ${s.playIn}`}>
            <div className={s.playText}>
              <h2 id="play-h">{t.item.play3d}</h2>
              <p className="muted">{t.item.play3dLine}</p>
            </div>
            <div ref={clothRef} className={s.playStage}>
              {/* the canvas is transparent and brings its own poster, so this one leaves as soon as the canvas is asked for */}
              {item.pictures[0] && !clothNear ? <img className={s.stagePoster} src={pictureUrl(item.pictures[0], 960)} alt="" loading="lazy" decoding="async" /> : null}
              {clothNear ? (
                <TzitzitCanvas spec={item.cloth} size={chosen?.key === "kid" ? "kid" : "adult"} label={`${name}, ${t.item.clothLabel}`} hint={t.item.clothHint}
                  poster={item.pictures[0] ? pictureUrl(item.pictures[0], 960) : undefined} className={s.canvas} />
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ItemFromQuery({ tribes }: { tribes: TribeView[] }) {
  return <ItemView tribes={tribes} slug={useSearchParams().get("i")} />;
}
