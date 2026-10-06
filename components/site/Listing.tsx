"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCatalog } from "@/lib/catalog";
import { currentCollection, fill, slotItems, tr } from "@/lib/format";
import type { Item } from "@/lib/types";
import { useI18n } from "./Providers";
import { StoneLabel, stoneStyle } from "./Stone";
import Tile, { Grid } from "./Tile";
import { tribeNameStyle, type TribeView } from "./tribes";
import ch from "./Choshen.module.css";
import tile from "./Tile.module.css";
import s from "./Page.module.css";

// ───────── collection: twelve tribes, up to five pieces each ─────────
export function CollectionView({ tribes, slug }: { tribes: TribeView[]; slug: string | null }) {
  const { locale, t } = useI18n();
  const catalog = useCatalog();
  const col = currentCollection(catalog, slug);
  if (!col) return <div className={`onBlack section ${s.page}`}><p className="muted">{t.shop.empty}</p></div>;
  return (
    <div className={`onBlack ${s.page}`}>
      <header className={`section wrap ${s.pageHead}`}>
        <p className="muted small">{t.home.collectionLabel}</p>
        <h1 className={s.display}>{tr(col.name, locale)}</h1>
        <p className="measure">{tr(col.description, locale)}</p>
      </header>
      <nav className={s.stickyStrip} aria-label={t.tribes.choose}>
        <ul className={`${ch.stripList}`}>
          {tribes.map((x) => <li key={x.key}><a className={ch.stone} style={stoneStyle(x)} href={`#${x.key}`}><StoneLabel t={x} /></a></li>)}
        </ul>
      </nav>
      {tribes.map((x, i) => {
        const items = slotItems(catalog, col, x.key);
        return (
          <section key={x.key} id={x.key} className={`wrap ${s.tribeBlock}`} aria-labelledby={`h-${x.key}`}>
            <header className={s.tribeHead}>
              <div className={s.tribeWho}>
                <h2 id={`h-${x.key}`} className={s.tribeName} style={tribeNameStyle(x, "black")}>
                  <Link href={`/${locale}/tribes/${x.key}/`}>{x.name}</Link>
                </h2>
                <p className={s.stoneLine}>
                  <span className={s.dot} style={{ background: x.hex }} aria-hidden="true" />
                  <span>{x.stone}, {x.stoneGloss}</span>
                </p>
              </div>
              <p className={`verse ${s.oneVerse}`} lang="he" dir="rtl">{x.tagline.he}</p>
              {x.tagline.tr ? <p className={`muted ${s.oneVerseTr}`}>{x.tagline.tr}</p> : null}
            </header>
            {items.length ? (
              <Grid className={tile.five}>{items.map((it, j) => <Tile key={it.id} item={it} eager={i === 0 && j < 2} sizes="(min-width: 1024px) 19vw, (min-width: 768px) 33vw, 50vw" />)}</Grid>
            ) : <p className="muted">{t.shop.empty}</p>}
          </section>
        );
      })}
    </div>
  );
}
export function CollectionFromQuery({ tribes }: { tribes: TribeView[] }) {
  return <CollectionView tribes={tribes} slug={useSearchParams().get("c")} />;
}

// ───────── a tribe's pieces (on its own page) ─────────
export function TribeItems({ tribe }: { tribe: TribeView }) {
  const { locale, t } = useI18n();
  const catalog = useCatalog();
  const col = currentCollection(catalog);
  const five = slotItems(catalog, col, tribe.key);
  const ids = new Set(five.map((i) => i.id));
  const more = catalog.items.filter((i) => i.status === "published" && i.tribe === tribe.key && !ids.has(i.id)).sort((a, b) => a.sort - b.sort);
  return (
    <div className={`onBlack section ${s.tribeItems}`}>
      <div className="wrap">
        {five.length ? (
          <section>
            <h2 className={s.h2}>{fill(t.tribes.inCollection, { name: tribe.plain, collection: col ? tr(col.name, locale) : "" })}</h2>
            <Grid className={tile.five}>{five.map((it) => <Tile key={it.id} item={it} sizes="(min-width: 1024px) 19vw, (min-width: 768px) 33vw, 50vw" />)}</Grid>
          </section>
        ) : null}
        {more.length ? (
          <section className={s.moreBlock}>
            <h2 className={s.h2}>{fill(t.tribes.more, { name: tribe.plain })}</h2>
            <Grid>{more.map((it) => <Tile key={it.id} item={it} />)}</Grid>
          </section>
        ) : null}
        {!five.length && !more.length ? <p className="muted">{t.shop.empty}</p> : null}
      </div>
    </div>
  );
}

// ───────── shop: category tabs + the Choshen as tribe filter ─────────
export function ShopView({ tribes, cat, tribe }: { tribes: TribeView[]; cat: string | null; tribe: string | null }) {
  const { locale, t } = useI18n();
  const catalog = useCatalog();
  const cats = catalog.categories.filter((c) => c.visible).sort((a, b) => a.sort - b.sort);
  const activeCat = cats.find((c) => c.key === cat) ?? null;
  const activeTribe = tribes.find((x) => x.key === tribe) ?? null;
  const col = currentCollection(catalog);
  const inSlot = new Set(activeTribe && col ? col.slots[activeTribe.key] ?? [] : []);
  const href = (c: string | null, tk: string | null) => {
    const q = new URLSearchParams();
    if (c) q.set("cat", c);
    if (tk) q.set("tribe", tk);
    const qs = q.toString();
    return `/${locale}/shop/${qs ? `?${qs}` : ""}`;
  };
  const items: Item[] = catalog.items
    .filter((i) => i.status === "published")
    .filter((i) => !activeCat || i.category === activeCat.key)
    .filter((i) => !activeTribe || i.tribe === activeTribe.key || inSlot.has(i.id))
    .sort((a, b) => a.sort - b.sort);
  const catEmpty = !!activeCat && !catalog.items.some((i) => i.category === activeCat.key);
  return (
    <div className={`onBlack ${s.page}`}>
      <header className={`section wrap ${s.pageHead} ${s.shopHead}`}>
        <h1>{activeCat ? tr(activeCat.name, locale) : t.shop.title}</h1>
        <nav aria-label={t.shop.categories}>
          <ul className={s.tabs}>
            <li><Link href={href(null, tribe)} scroll={false} aria-current={!activeCat ? "page" : undefined}>{t.shop.all}</Link></li>
            {cats.map((c) => (
              <li key={c.key}><Link href={href(c.key, tribe)} scroll={false} aria-current={activeCat?.key === c.key ? "page" : undefined}>{tr(c.name, locale)}</Link></li>
            ))}
          </ul>
        </nav>
        <div className={s.filter}>
          <p className={`small muted ${s.filterLabel}`}>{t.shop.tribeFilter}</p>
          <ul className={ch.chips}>
            {tribes.map((x) => {
              const on = activeTribe?.key === x.key;
              return (
                <li key={x.key}>
                  <Link className={ch.stone} style={stoneStyle(x)} href={href(cat, on ? null : x.key)} scroll={false} aria-current={on ? "true" : undefined}>
                    <StoneLabel t={x} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        <p className={`small muted ${s.count}`} aria-live="polite" hidden={catEmpty}>
          <bdi>{fill(t.shop.count, { n: items.length })}</bdi>
          {activeTribe ? <> <Link className={s.clear} href={href(cat, null)} scroll={false}>{t.shop.clear}</Link></> : null}
        </p>
      </header>
      <div className={`wrap ${s.listing}`}>
        {items.length ? <Grid>{items.map((it, i) => <Tile key={it.id} item={it} eager={i < 4} />)}</Grid>
          : catEmpty ? (
            <div className={s.empty}><h2>{t.shop.comingTitle}</h2><p className="muted">{t.shop.comingText}</p></div>
          ) : (
            <div className={s.empty}><p className="muted">{t.shop.empty}</p>
              <Link className="link" href={href(cat, null)} scroll={false}>{t.shop.clear}</Link></div>
          )}
      </div>
    </div>
  );
}
export function ShopFromQuery({ tribes }: { tribes: TribeView[] }) {
  const q = useSearchParams();
  return <ShopView tribes={tribes} cat={q.get("cat")} tribe={q.get("tribe")} />;
}
