"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { asset } from "@/lib/asset";
import { bagCount, useBag } from "@/lib/bag";
import { useCatalog } from "@/lib/catalog";
import { fill, tr } from "@/lib/format";
import { LANG_KEY, LANG_LABEL, LANG_NAME, pick } from "@/lib/i18n";
import { LOCALES, type Locale } from "@/lib/types";
import { Wordmark } from "./Pic";
import { useI18n } from "./Providers";
import { SoundToggle } from "./Sound";
import ThemeToggle from "./Theme";
import s from "./Header.module.css";

export function LangSwitch({ className }: { className?: string }) {
  const { locale, t } = useI18n();
  const path = usePathname() || `/${locale}/`;
  const to = (l: Locale) => asset(path.replace(/^\/(he|en|fr)(?=\/|$)/, `/${l}`).replace(/\/?$/, "/"));
  return (
    <ul className={`${s.lang} ${className ?? ""}`} aria-label={t.nav.language}>
      {LOCALES.map((l) => (
        <li key={l}>
          <a
            href={to(l)} lang={l} hrefLang={l} aria-current={l === locale ? "true" : undefined} title={LANG_NAME[l]}
            onClick={(e) => {
              // keep the query string and the hash, so the same item or tribe opens in the other language
              e.currentTarget.href = to(l) + window.location.search + window.location.hash;
              try { window.localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
            }}
          >
            <span aria-hidden="true">{LANG_LABEL[l]}</span><span className="srOnly">{LANG_NAME[l]}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function Header() {
  const { locale, t } = useI18n();
  const catalog = useCatalog();
  const count = bagCount(useBag());
  const path = usePathname() || "";
  const isHome = /^\/(he|en|fr)\/?$/.test(path);
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const ann = tr(catalog.settings.announcement, locale).trim();
  const cats = catalog.categories.filter((c) => c.visible).sort((a, b) => a.sort - b.sort);

  useEffect(() => {
    const on = () => setSolid(window.scrollY > window.innerHeight - 160);
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, []);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    // the open menu is a modal dialog that covers the page and carries its own close button: focus moves into
    // it, Tab stays inside it, Escape closes it, and closing gives focus back to the menu button
    const stops = () => (panel.current ? Array.from(panel.current.querySelectorAll<HTMLElement>("a[href], button")) : [])
      .filter((el) => el.getClientRects().length > 0);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key !== "Tab") return;
      const list = stops();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i < 0 || i === list.length - 1 ? 0 : i + 1);
      e.preventDefault();
      list[next].focus();
    };
    document.addEventListener("keydown", key);
    document.documentElement.style.overflow = "hidden";
    const toggler = btn.current;
    const first = stops();
    (first[1] ?? first[0])?.focus(); // the first link; the close button sits just before it
    return () => {
      document.removeEventListener("keydown", key);
      document.documentElement.style.overflow = "";
      toggler?.focus({ preventScroll: true });
    };
  }, [open]);

  const home = `/${locale}/`;
  const clear = isHome && !solid;
  const here = (p: string) => (path.startsWith(`${home}${p}`) ? "page" as const : undefined);
  const bagLabel = count ? fill(count === 1 ? pick(t.nav, "bagCountOne", t.nav.bagCount) : t.nav.bagCount, { n: count }) : t.nav.bag;
  return (
    <>
      {ann ? <p className={s.ann} data-ann><span>{ann}</span></p> : null}
      <header className={`${s.header} ${clear ? s.clear : ""}`}>
        <div className={s.start}>
          <button ref={btn} type="button" className={`iconBtn ${s.menuBtn}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen(true)}>
            <span className={s.burger} aria-hidden="true"><i /><i /></span>
            <span className="srOnly">{t.nav.menu}</span>
          </button>
          <nav className={s.links} aria-label={t.nav.main}>
            <Link prefetch={false} href={`${home}collection/`} aria-current={here("collection/")}>{t.nav.collection}</Link>
            <Link prefetch={false} href={`${home}#tribes`} aria-current={here("tribes/")}>{t.nav.tribes}</Link>
            <Link prefetch={false} href={`${home}shop/`} aria-current={here("shop/")}>{t.nav.shop}</Link>
          </nav>
        </div>
        <Link prefetch={false} className={s.mark} href={home} aria-label={t.nav.home}><Wordmark className={s.wordmark} /></Link>
        <div className={s.end}>
          <LangSwitch className={s.desk} />
          <ThemeToggle className={s.desk} />
          <SoundToggle />
          <Link prefetch={false} className={s.bag} href={`${home}reserve/`} aria-label={bagLabel} title={bagLabel}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
              <path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
            </svg>
            <bdi className={s.count} aria-hidden="true">{count || ""}</bdi>
          </Link>
        </div>
      </header>
      <div id="site-menu" ref={panel} role="dialog" aria-modal="true" aria-label={t.nav.menu} className={s.panel} hidden={!open}>
        <div className={s.panelBar}>
          <button type="button" className={`iconBtn ${s.closeBtn}`} onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5 5l14 14M19 5 5 19" /></svg>
            <span className="srOnly">{t.nav.close}</span>
          </button>
        </div>
        <nav className={s.panelNav} aria-label={t.nav.main}>
          <ul className={s.big}>
            <li><Link prefetch={false} href={`${home}collection/`} onClick={() => setOpen(false)}>{t.nav.collection}</Link></li>
            <li><Link prefetch={false} href={`${home}#tribes`} onClick={() => setOpen(false)}>{t.nav.tribes}</Link></li>
            <li><Link prefetch={false} href={`${home}shop/`} onClick={() => setOpen(false)}>{t.nav.shop}</Link></li>
          </ul>
          <ul className={s.sub}>
            {cats.map((c) => <li key={c.key}><Link prefetch={false} href={`${home}shop/?cat=${c.key}`} onClick={() => setOpen(false)}>{tr(c.name, locale)}</Link></li>)}
          </ul>
          <ul className={s.sub}>
            <li><Link prefetch={false} href={`${home}reserve/`} onClick={() => setOpen(false)}>{t.nav.bag}</Link></li>
            <li><Link prefetch={false} href={`${home}about/`} onClick={() => setOpen(false)}>{t.nav.about}</Link></li>
            <li><Link prefetch={false} href={`${home}terms/`} onClick={() => setOpen(false)}>{t.nav.terms}</Link></li>
          </ul>
        </nav>
        <div className={s.panelTools}><LangSwitch /><ThemeToggle /></div>
      </div>
    </>
  );
}
