"use client";
import { useEffect, useState } from "react";
import type { Category, L10n } from "@/lib/types";
import { ApiError } from "@/lib/types";
import { api } from "./backend";
import { isUnauthorized, useStore } from "./store";
import { Field, L10nFields, SaveButton, Toggle } from "./ui";
import { intlDigits, l10n, pick } from "./util";

const linkOk = (v: string) => v.trim() === "" || /^https:\/\/\S+\.\S+/.test(v.trim());

export function SettingsScreen() {
  const { t, state, call, putSettings, toast, errText, setDirty } = useStore();
  const s = state.catalog.settings;
  const [whatsapp, setWhatsapp] = useState(s.whatsapp ?? "");
  const [email, setEmail] = useState(s.email ?? "");
  const [instagram, setInstagram] = useState(s.instagram ?? "");
  const [calLink, setCalLink] = useState(s.calLink ?? "");
  const [announcement, setAnnouncement] = useState<L10n>(l10n(s.announcement));
  const [heroLine, setHeroLine] = useState<L10n>(l10n(s.heroLine));
  const [open, setOpen] = useState(s.reservationsOpen);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<{ whatsapp?: string; instagram?: string; cal?: string; form?: string }>({});
  const touch = () => { setSaved(false); setDirty(true); };
  useEffect(() => () => setDirty(false), [setDirty]);
  const waDigits = intlDigits(whatsapp);

  const save = async () => {
    const errs: typeof errors = {};
    if (whatsapp.trim() !== "" && (waDigits.length < 10 || waDigits.length > 15)) errs.whatsapp = t.setWhatsappBad;
    if (!linkOk(instagram)) errs.instagram = t.setLinkBad;
    if (!linkOk(calLink)) errs.cal = t.setLinkBad;
    setErrors(errs);
    if (Object.keys(errs).length) { toast(Object.values(errs)[0] as string, "bad"); return; }
    setBusy(true);
    try {
      const out = await call((tok) => api.adminSaveSettings(tok, {
        whatsapp: whatsapp.trim() === "" ? "" : waDigits, email: email.trim(), instagram: instagram.trim(), calLink: calLink.trim(),
        announcement, heroLine, reservationsOpen: open,
      }));
      putSettings(out);
      setWhatsapp(out.whatsapp ?? ""); setEmail(out.email ?? ""); setInstagram(out.instagram ?? ""); setCalLink(out.calLink ?? "");
      setAnnouncement(l10n(out.announcement)); setHeroLine(l10n(out.heroLine)); setOpen(out.reservationsOpen);
      setSaved(true); setDirty(false); toast(t.saved);
    } catch (e) { if (!isUnauthorized(e)) { setErrors({ form: errText(e) }); toast(errText(e), "bad"); } }
    finally { setBusy(false); }
  };

  return (
    <section className="adm-settings">
      <div className="adm-head"><h1>{t.setTitle}</h1></div>

      <div className="adm-panel adm-form">
        <h2>{t.setReserving}</h2>
        <Toggle checked={open} onChange={(v) => { setOpen(v); touch(); }} label={t.setOpen} hint={t.setOpenHint} />
        <h2>{t.setContact}</h2>
        <Field label={t.setWhatsapp} hint={t.setWhatsappHint} error={errors.whatsapp} htmlFor="set-wa">
          <input id="set-wa" className="adm-input" type="tel" inputMode="tel" dir="ltr" value={whatsapp} onChange={(e) => { setWhatsapp(e.target.value); setErrors((x) => ({ ...x, whatsapp: undefined })); touch(); }} />
          {whatsapp.trim() !== "" && waDigits !== whatsapp ? <p className="adm-hint">{t.setWhatsappWillSave}<bdi dir="ltr">{waDigits}</bdi></p> : null}
        </Field>
        <Field label={t.setEmail} htmlFor="set-email">
          <input id="set-email" className="adm-input" type="email" dir="ltr" value={email} onChange={(e) => { setEmail(e.target.value); touch(); }} />
        </Field>
        <Field label={t.setInstagram} hint={t.setInstagramHint} error={errors.instagram} htmlFor="set-ig">
          <input id="set-ig" className="adm-input" type="url" dir="ltr" value={instagram} onChange={(e) => { setInstagram(e.target.value); setErrors((x) => ({ ...x, instagram: undefined })); touch(); }} />
        </Field>
        <Field label={t.setCal} hint={t.setCalHint} error={errors.cal} htmlFor="set-cal">
          <input id="set-cal" className="adm-input" type="url" dir="ltr" value={calLink} onChange={(e) => { setCalLink(e.target.value); setErrors((x) => ({ ...x, cal: undefined })); touch(); }} />
        </Field>
        <h2>{t.setTexts}</h2>
        <L10nFields label={t.setAnnouncement} hint={t.setAnnouncementHint} value={announcement} onChange={(v) => { setAnnouncement(v); touch(); }} />
        <L10nFields label={t.setHero} value={heroLine} onChange={(v) => { setHeroLine(v); touch(); }} />
        {errors.form ? <p className="adm-error" role="alert">{errors.form}</p> : null}
        <div className="adm-btnrow"><SaveButton busy={busy} saved={saved} onClick={() => void save()} /></div>
      </div>

      <Categories />
      <Password />
    </section>
  );
}

function Categories() {
  const { t, lang, state, call, putCategory, toast, errText } = useStore();
  const cats = [...state.catalog.categories].sort((a, b) => a.sort - b.sort);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [name, setName] = useState<L10n>({ he: "", en: "", fr: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (c: Partial<Category> & { key: string }) => {
    const out = await call((tok) => api.adminSaveCategory(tok, c));
    putCategory(out);
    return out;
  };
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await f(); toast(t.saved); } catch (e) { if (!isUnauthorized(e)) { setError(errText(e)); toast(errText(e), "bad"); } }
    finally { setBusy(false); }
  };
  const swap = (i: number, j: number) => run(async () => {
    const a = cats[i], b = cats[j];
    if (!a || !b) return;
    const sa = a.sort === b.sort ? b.sort + (j > i ? 1 : -1) : b.sort;
    await patch({ key: a.key, sort: sa });
    await patch({ key: b.key, sort: a.sort });
  });

  return (
    <div className="adm-panel adm-form">
      <h2>{t.setCategories}</h2>
      <p className="adm-hint">{t.setCategoriesHint}</p>
      {error ? <p className="adm-error" role="alert">{error}</p> : null}
      <ol className="adm-cats">
        {cats.map((c, i) => (
          <li key={c.key} className="adm-cat">
            <div className="adm-cat-row">
              <button type="button" className="adm-cat-name" aria-expanded={openKey === c.key} onClick={() => { setOpenKey(openKey === c.key ? null : c.key); setName(l10n(c.name)); }}>
                <span dir="auto">{pick(c.name, lang)}</span>
                <span className="adm-hint">{c.visible ? t.setCatShow : t.setCatHidden}</span>
              </button>
              <div className="adm-btnrow">
                <button type="button" className="adm-btn adm-btn-s" disabled={busy || i === 0} onClick={() => void swap(i, i - 1)} aria-label={`${t.setCatUp}: ${pick(c.name, lang)}`}>↑</button>
                <button type="button" className="adm-btn adm-btn-s" disabled={busy || i === cats.length - 1} onClick={() => void swap(i, i + 1)} aria-label={`${t.setCatDown}: ${pick(c.name, lang)}`}>↓</button>
              </div>
            </div>
            {openKey === c.key ? (
              <div className="adm-cat-edit">
                <L10nFields label={t.setCatName} value={name} onChange={setName} />
                <Toggle checked={c.visible} disabled={busy} onChange={(v) => void run(() => patch({ key: c.key, visible: v }))} label={t.setCatShow} />
                <button type="button" className="adm-btn adm-btn-primary" disabled={busy || !name.he.trim()} onClick={() => void run(async () => { const out = await patch({ key: c.key, name: { he: name.he.trim(), en: name.en.trim(), fr: name.fr.trim() } }); setName(l10n(out.name)); })}>{t.setCatSave}</button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Password() {
  const { t, call, toast, errText } = useStore();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setDone(false);
    if (next.length < 10) { setError(t.setPwShort); return; }
    if (next !== repeat) { setError(t.setPwMismatch); return; }
    setBusy(true); setError(null);
    try {
      await call((tok) => api.adminChangePassword(tok, current, next));
      setCurrent(""); setNext(""); setRepeat(""); setDone(true); toast(t.saved);
    } catch (err) {
      if (isUnauthorized(err)) return;
      const code = err instanceof ApiError ? err.code : "";
      setError(code === "bad_password" ? t.setPwWrong : code === "weak_password" ? t.setPwShort : errText(err));
    } finally { setBusy(false); }
  };
  return (
    <form className="adm-panel adm-form" onSubmit={submit} noValidate>
      <h2>{t.setPassword}</h2>
      <Field label={t.setPwCurrent} htmlFor="pw-cur"><input id="pw-cur" className="adm-input" type="password" dir="ltr" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
      <Field label={t.setPwNew} htmlFor="pw-new"><input id="pw-new" className="adm-input" type="password" dir="ltr" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label={t.setPwRepeat} htmlFor="pw-rep"><input id="pw-rep" className="adm-input" type="password" dir="ltr" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} /></Field>
      {error ? <p className="adm-error" role="alert">{error}</p> : null}
      {done ? <p className="adm-notice" role="status">{t.setPwDone}</p> : null}
      <div className="adm-btnrow"><button type="submit" className="adm-btn adm-btn-primary" disabled={busy || !current || !next}>{busy ? t.saving : t.setPwButton}</button></div>
    </form>
  );
}
