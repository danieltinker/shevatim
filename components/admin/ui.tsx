"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import type { L10n } from "@/lib/types";
import { useStore } from "./store";
import { shekels } from "./util";

export function Sheet({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { t } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, []);
  return (
    <div className="adm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`adm-sheet${wide ? " adm-sheet-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="adm-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="adm-btn adm-btn-quiet" onClick={onClose}>{t.close}</button>
        </div>
        <div className="adm-sheet-body">{children}</div>
        {footer ? <div className="adm-sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="adm-field">
      <label className="adm-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <p className="adm-error" role="alert">{error}</p> : hint ? <p className="adm-hint">{hint}</p> : null}
    </div>
  );
}

/** One text in three languages, Hebrew first. */
export function L10nFields({ label, value, onChange, multiline, hint, error }: {
  label: string; value: L10n; onChange: (v: L10n) => void; multiline?: boolean; hint?: string; error?: string | null;
}) {
  const { t } = useStore();
  const id = useId();
  const langs: { k: keyof L10n; name: string; dir: "rtl" | "ltr" }[] = [
    { k: "he", name: t.hebrew, dir: "rtl" }, { k: "en", name: t.english, dir: "ltr" }, { k: "fr", name: t.french, dir: "ltr" },
  ];
  return (
    <fieldset className="adm-l10n">
      <legend className="adm-label">{label}</legend>
      {langs.map(({ k, name, dir }) => (
        <div className="adm-l10n-row" key={k}>
          <label htmlFor={`${id}-${k}`}>{name}</label>
          {multiline ? (
            <textarea id={`${id}-${k}`} className="adm-input" rows={2} dir={dir} lang={k} value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
          ) : (
            <input id={`${id}-${k}`} className="adm-input" type="text" dir={dir} lang={k} value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
          )}
        </div>
      ))}
      {error ? <p className="adm-error" role="alert">{error}</p> : hint ? <p className="adm-hint">{hint}</p> : null}
    </fieldset>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <div className="adm-toggle-row">
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`adm-toggle${checked ? " is-on" : ""}`} onClick={() => onChange(!checked)}>
        <span className="adm-toggle-knob" aria-hidden="true" />
      </button>
      <div className="adm-toggle-text" onClick={() => !disabled && onChange(!checked)}>
        <span className="adm-toggle-label">{label}</span>
        {hint ? <span className="adm-hint">{hint}</span> : null}
      </div>
    </div>
  );
}

export function Thumb({ src, alt, className, tag }: { src: string | null; alt: string; className?: string; tag?: string }) {
  const { t } = useStore();
  return (
    <span className={`adm-thumb ${className ?? ""}`}>
      {src ? <img src={src} alt={alt} loading="lazy" decoding="async" /> : <span className="adm-thumb-none">{t.noPicture}</span>}
      {src && tag ? <span className="adm-thumb-tag">{tag}</span> : null}
    </span>
  );
}

export function Price({ value, fallback }: { value: number | null; fallback?: string }) {
  const { t } = useStore();
  if (value == null) return <span className="adm-noprice">{fallback ?? t.noPriceYet}</span>;
  return <bdi dir="ltr" className="adm-price">₪ {shekels(value)}</bdi>;
}

export function SaveButton({ busy, saved, onClick, label, disabled, type }: { busy: boolean; saved: boolean; onClick?: () => void; label?: string; disabled?: boolean; type?: "button" | "submit" }) {
  const { t } = useStore();
  return (
    <button type={type ?? "button"} className="adm-btn adm-btn-primary" onClick={onClick} disabled={busy || disabled} aria-live="polite">
      {busy ? t.saving : saved ? `${t.saved} ✓` : label ?? t.save}
    </button>
  );
}
