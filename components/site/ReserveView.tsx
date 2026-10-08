"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HAS_BACKEND, createReservation } from "@/lib/api";
import { bag, useBag } from "@/lib/bag";
import { refreshCatalog, useCatalog } from "@/lib/catalog";
import { fill, formatPrice, isEmail, isPhone, isReservationCode, normalizePhone, priceOf, tr } from "@/lib/format";
import { colon, pick } from "@/lib/i18n";
import { ApiError, type L10n } from "@/lib/types";
import { pictureUrl } from "./Pic";
import { useI18n } from "./Providers";
import s from "./Reserve.module.css";

const LAST = "shv.last";
interface Receipt { code: string; total: number | null; lines: { name: L10n; variant: L10n | null; qty: number; price: number | null }[] }
type Field = "name" | "phone" | "email";

export function ReserveView() {
  const { locale, t } = useI18n();
  const catalog = useCatalog();
  const lines = useBag();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null); // the server refused the details: said at the first field
  const [flagged, setFlagged] = useState(false);              // the server said a piece is no longer available
  const [waLink, setWaLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => { bag.load(); setReady(true); }, []);

  const rows = lines.map((l) => {
    const item = catalog.items.find((i) => i.id === l.itemId && i.status === "published");
    const v = item && l.variantKey ? item.variants.find((x) => x.key === l.variantKey) ?? null : null;
    // the same rule as the server: the piece must exist and be in stock, and its size must be a real, available one
    const left = item ? (item.variants.length ? v?.left : item.left) ?? null : null;
    const over = left != null && left > 0 && l.qty > left; // counted stock: fewer left than asked for
    const gone = !item || item.soldOut || !!item.comingSoon || (item.variants.length ? !v || !v.available : !!l.variantKey) || over;
    return { l, item, v, gone, over, left, price: item ? priceOf(item, l.variantKey) : null };
  });
  const anyGone = rows.some((r) => r.gone);
  const total = rows.every((r) => r.price != null) ? rows.reduce((n, r) => n + (r.price ?? 0) * r.l.qty, 0) : null;
  const open = catalog.settings.reservationsOpen;
  const totalText = pick(t.reserve, "totalPending", t.reserve.totalLater);

  // after a line leaves the bag, focus goes to the line that took its place, or to the heading
  const drop = (itemId: string, variantKey: string | null, i: number) => {
    bag.remove(itemId, variantKey);
    requestAnimationFrame(() => {
      const next = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-remove]")[i];
      (next ?? document.getElementById("bag-h"))?.focus();
    });
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim(), phone = normalizePhone(String(f.get("phone") ?? ""));
    const email = String(f.get("email") ?? "").trim(), note = String(f.get("note") ?? "").trim();
    const errs: Partial<Record<Field, string>> = {};
    if (name.length < 2) errs.name = t.reserve.errName;
    if (!isPhone(phone)) errs.phone = t.reserve.errPhone;
    if (email && !isEmail(email)) errs.email = t.reserve.errEmail;
    setErrors(errs);
    const first = (["name", "phone", "email"] as Field[]).find((k) => errs[k]);
    setInvalid(null);
    if (first) {
      setFailure(t.reserve.errFix);
      (form.current?.elements.namedItem(first) as HTMLElement | null)?.focus();
      return;
    }
    setFailure(null); setWaLink(null); setBusy(true);
    try {
      const res = await createReservation({
        customer: { name, phone, email }, locale, note,
        lines: lines.map((l) => ({ itemId: l.itemId, variantKey: l.variantKey, qty: l.qty })),
        website: String(f.get("website") ?? ""),
      });
      const receipt: Receipt = {
        code: res.code, total: res.total,
        lines: rows.filter((r) => r.item).map((r) => ({ name: r.item!.name, variant: r.v?.label ?? null, qty: r.l.qty, price: r.price })),
      };
      try { window.sessionStorage.setItem(LAST, JSON.stringify(receipt)); } catch { /* ignore */ }
      router.push(`/${locale}/reserve/done/?code=${encodeURIComponent(res.code)}`);
      bag.clear();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "unknown";
      const known = ["invalid", "closed", "item_unavailable", "too_many", "network"] as const;
      const k = (known as readonly string[]).includes(code) ? (`err_${code}` as `err_${(typeof known)[number]}`) : "err_unknown";
      if (code === "invalid") {
        // say it where the details are, and put the cursor there
        setInvalid(t.reserve.err_invalid); setFailure(null); setBusy(false);
        requestAnimationFrame(() => (form.current?.elements.namedItem("name") as HTMLElement | null)?.focus());
        return;
      }
      // a preview build has no database: say so, instead of blaming the visitor's connection
      setFailure(code === "network" && !HAS_BACKEND ? t.reserve.err_preview : t.reserve[k]);
      if (code === "item_unavailable") {
        // the catalogue this page holds is out of date: read it again so the line that is gone is marked
        setFlagged(true);
        void refreshCatalog();
      }
      // the bag and everything typed stay as they are; if the shop has WhatsApp, offer it as another way through
      if (code === "network" && catalog.settings.whatsapp) {
        const text = [
          t.reserve.whatsappLead,
          ...rows.filter((r) => r.item).map((r) => `${r.l.qty} × ${tr(r.item!.name, locale)}${r.v ? ` (${tr(r.v.label, locale)})` : ""} [${r.item!.code}]`),
          `${t.reserve.name}${colon(locale)} ${name}`, `${t.reserve.phone}${colon(locale)} ${phone}`, ...(email ? [`${t.reserve.email}${colon(locale)} ${email}`] : []), ...(note ? [`${t.reserve.note}${colon(locale)} ${note}`] : []),
        ].join("\n");
        setWaLink(`https://wa.me/${catalog.settings.whatsapp}?text=${encodeURIComponent(text)}`);
      }
      setBusy(false);
      requestAnimationFrame(() => alertRef.current?.focus());
    }
  }

  // until the saved bag has been read nothing below the heading is drawn, so the form cannot jump when the lines arrive
  if (!ready) {
    return (
      <div className={`section ${s.page}`} aria-busy="true">
        <div className={`wrap ${s.grid}`}>
          <section className={s.bag} aria-labelledby="bag-h"><h1 id="bag-h" className={s.h1}>{t.reserve.title}</h1></section>
        </div>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className={`section ${s.page}`}>
        <div className={`wrap ${s.empty}`}>
          <h1 id="bag-h" className={s.h1} tabIndex={-1}>{t.reserve.emptyTitle}</h1>
          <p className="muted">{t.reserve.emptyText}</p>
          <Link className="btn" href={`/${locale}/collection/`}>{t.reserve.emptyCta}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`section ${s.page}`}>
      <div className={`wrap ${s.grid}`}>
        <section className={s.bag} aria-labelledby="bag-h">
          <h1 id="bag-h" className={s.h1} tabIndex={-1}>{t.reserve.title}</h1>
          <ul ref={listRef} className={s.lines}>
            {rows.map(({ l, item, v, gone, over, left, price }, i) => {
              const name = item ? tr(item.name, locale) : l.itemId;
              return (
                <li key={`${l.itemId}:${l.variantKey}`} className={`${s.line} ${gone ? s.lineGone : ""}`}>
                  <Link className={s.thumb} href={item ? `/${locale}/item/?i=${encodeURIComponent(item.slug)}` : `/${locale}/shop/`} tabIndex={-1} aria-hidden="true">
                    {item?.pictures[0] ? <img src={pictureUrl(item.pictures[0], 240)} alt="" width={96} height={128} loading="lazy" /> : null}
                  </Link>
                  <div className={s.lineText}>
                    <p className={s.lineName}>{item ? <Link href={`/${locale}/item/?i=${encodeURIComponent(item.slug)}`}>{name}</Link> : <bdi>{name}</bdi>}</p>
                    {v ? <p className="small muted"><bdi>{tr(v.label, locale)}</bdi></p> : null}
                    {/* a line shows a price only when it has one; that prices are confirmed later is said once, in the summary */}
                    {price != null ? <p className="small muted"><bdi dir="ltr">{formatPrice(price)}</bdi></p> : null}
                    {gone ? <p className={`small ${s.gone}`} role={flagged ? "alert" : undefined}>{over ? fill(t.reserve.onlyLeft, { n: left ?? 0 }) : t.reserve.gone}</p> : null}
                    <div className={s.lineActions}>
                      <div className={s.qty} dir="ltr" role="group" aria-label={`${t.reserve.qty}${colon(locale)} ${name}`}>
                        <button type="button" aria-label={t.reserve.less} onClick={() => (l.qty <= 1 ? drop(l.itemId, l.variantKey, i) : bag.setQty(l.itemId, l.variantKey, l.qty - 1))}>−</button>
                        <bdi aria-live="polite">{l.qty}</bdi>
                        <button type="button" aria-label={t.reserve.more} disabled={l.qty >= Math.min(9, left ?? 9)} onClick={() => bag.setQty(l.itemId, l.variantKey, l.qty + 1)}>+</button>
                      </div>
                      <button type="button" className={s.remove} data-remove onClick={() => drop(l.itemId, l.variantKey, i)}>{t.reserve.remove}<span className="srOnly">{colon(locale)} {name}</span></button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {rows.length ? (
            <p className={s.total}>
              <span>{t.reserve.total}</span>
              <span>{total == null ? totalText : <bdi dir="ltr">{formatPrice(total)}</bdi>}</span>
            </p>
          ) : null}
        </section>

        {!open ? (
          <section className={s.formBox} aria-labelledby="paused-h">
            <h2 id="paused-h" className={s.h2}>{t.reserve.pausedTitle}</h2>
            <p className={`muted ${s.formLine}`}>{t.reserve.pausedText}</p>
            <Link className="link" href={`/${locale}/collection/`}>{t.done.back}</Link>
          </section>
        ) : (
        <section className={s.formBox} aria-labelledby="form-h">
          <h2 id="form-h" className={s.h2}>{t.reserve.formTitle}</h2>
          <p className={`muted ${s.formLine}`}>{t.reserve.formLine}</p>
          <form ref={form} className={s.form} onSubmit={submit} noValidate>
            {invalid ? <p id="e-form" role="alert" className={s.formErr}>{invalid}</p> : null}
            <div className={s.field}>
              <label htmlFor="f-name">{t.reserve.name}</label>
              <input id="f-name" name="name" type="text" autoComplete="name" required maxLength={80} aria-invalid={!!errors.name || !!invalid}
                aria-describedby={[errors.name ? "e-name" : "", invalid ? "e-form" : ""].filter(Boolean).join(" ") || undefined} />
              {errors.name ? <p id="e-name" className={s.err}>{errors.name}</p> : null}
            </div>
            <div className={s.field}>
              <label htmlFor="f-phone">{t.reserve.phone}</label>
              <input id="f-phone" name="phone" type="tel" inputMode="tel" dir="ltr" autoComplete="tel" required maxLength={40} aria-invalid={!!errors.phone} aria-describedby={errors.phone ? "e-phone" : "h-phone"} />
              {errors.phone ? <p id="e-phone" className={s.err}>{errors.phone}</p> : <p id="h-phone" className={s.hint}>{t.reserve.phoneHint}</p>}
            </div>
            <div className={s.field}>
              <label htmlFor="f-email">{t.reserve.email} <span className={s.opt}>({t.reserve.optional})</span></label>
              <input id="f-email" name="email" type="email" inputMode="email" dir="ltr" autoComplete="email" maxLength={254} aria-invalid={!!errors.email} aria-describedby={errors.email ? "e-email" : undefined} />
              {errors.email ? <p id="e-email" className={s.err}>{errors.email}</p> : null}
            </div>
            <div className={s.field}>
              <label htmlFor="f-note">{t.reserve.note} <span className={s.opt}>({t.reserve.optional})</span></label>
              <textarea id="f-note" name="note" rows={3} maxLength={600} aria-describedby="h-note" />
              <p id="h-note" className={s.hint}>{t.reserve.noteHint}</p>
            </div>
            <div className={s.hp} aria-hidden="true">
              <label htmlFor="f-website">{t.reserve.website}</label>
              <input id="f-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
            </div>
            <p ref={alertRef} tabIndex={-1} role="alert" className={failure ? s.alert : s.alertEmpty}>{failure}</p>
            {waLink ? <a className="btn btnGhost" href={waLink} target="_blank" rel="noopener noreferrer">{t.reserve.whatsappInstead}</a> : null}
            <button type="submit" className={`btn ${s.send}`} disabled={busy || !open || anyGone || rows.length === 0}>{busy ? t.reserve.sending : t.reserve.send}</button>
            <p className={`small muted ${s.termsLine}`}>{t.reserve.terms} <Link href={`/${locale}/terms/`}>{t.reserve.termsLink}</Link>.</p>
          </form>
        </section>
        )}
      </div>
    </div>
  );
}

export function DoneView({ code }: { code: string | null }) {
  const { locale, t } = useI18n();
  const { settings } = useCatalog();
  // "received" is only said for the code this browser was just given: a well-formed code that matches the receipt
  // kept in this tab. Anything else typed into the address gets a plain "nothing here".
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let r: Receipt | null = null;
    try { r = JSON.parse(window.sessionStorage.getItem(LAST) ?? "null") as Receipt | null; } catch { /* ignore */ }
    setReceipt(r && isReservationCode(code) && r.code === code && Array.isArray(r.lines) ? r : null);
    setChecked(true);
  }, [code]);
  // The tab says "received" only for a confirmed code; the static page carries a neutral title. The framework
  // may write that neutral title again after this page has opened, so it is put back whenever <head> changes.
  const confirmed = !!code && !!receipt;
  useEffect(() => {
    if (!confirmed) return;
    const wanted = `${t.done.title} · ${locale === "he" ? "שבטים" : "Shevatim"}`;
    const before = document.title;
    const apply = () => { if (document.title !== wanted) document.title = wanted; };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); if (document.title === wanted) document.title = before; };
  }, [confirmed, locale, t.done.title]);
  if (!checked) return <div className={`section ${s.page}`} aria-busy="true" />;
  if (!code || !receipt) {
    return (
      <div className={`section ${s.page}`}>
        <div className={`wrap ${s.empty}`}>
          <h1 className={s.h1}>{t.done.tab}</h1>
          <p className="muted">{t.done.noCode}</p>
          <Link className="btn" href={`/${locale}/`}>{t.notFound.home}</Link>
        </div>
      </div>
    );
  }
  const wa = settings.whatsapp
    ? `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(
        [fill(t.done.whatsappText, { code }), ...(receipt?.lines ?? []).map((l) => `${l.qty} × ${tr(l.name, locale)}${l.variant ? ` (${tr(l.variant, locale)})` : ""}`)].join("\n"))}`
    : null;
  return (
    <div className={`section ${s.page}`}>
      <div className={`wrap ${s.done}`}>
        <div>
          <h1 className={s.doneTitle}>{t.done.title}</h1>
          <p className={s.codeLabel}>{t.done.code}</p>
          <p className={s.code}><bdi dir="ltr">{code}</bdi></p>
          <p className="muted">{t.done.keep}</p>
        </div>
        <div className={s.doneSide}>
          <section>
            <h2 className={s.h2}>{t.done.next}</h2>
            <p>{t.done.next1}</p>
            <p>{t.done.next2}</p>
          </section>
          {receipt?.lines.length ? (
            <section>
              <h2 className={s.h2}>{t.done.what}</h2>
              <ul className={s.receipt}>
                {receipt.lines.map((l, i) => (
                  <li key={i}>
                    <span><bdi>{l.qty}</bdi> × {tr(l.name, locale)}{l.variant ? <span className="muted">, <bdi>{tr(l.variant, locale)}</bdi></span> : null}</span>
                    {l.price != null ? <span className="muted small"><bdi dir="ltr">{formatPrice(l.price * l.qty)}</bdi></span> : null}
                  </li>
                ))}
              </ul>
              <p className={s.total}><span>{t.reserve.total}</span><span>{receipt.total == null ? pick(t.reserve, "totalPending", t.reserve.totalLater) : <bdi dir="ltr">{formatPrice(receipt.total)}</bdi>}</span></p>
            </section>
          ) : null}
          <div className={s.doneActions}>
            {wa ? <a className="btn" href={wa} target="_blank" rel="noopener noreferrer">{t.done.whatsapp}</a> : null}
            {settings.calLink ? <a className="btn btnGhost" href={settings.calLink} target="_blank" rel="noopener noreferrer">{t.done.call}</a> : null}
            <Link className="link" href={`/${locale}/collection/`}>{t.done.back}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
export function DoneFromQuery() {
  return <DoneView code={useSearchParams().get("code")} />;
}
