"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Item, L10n, Picture, TribeKey, Variant } from "@/lib/types";
import { resizePicture } from "@/lib/resize";
import { api } from "./backend";
import { fill } from "./strings";
import { isUnauthorized, useStore } from "./store";
import { Field, L10nFields, Price, SaveButton, Thumb, Toggle } from "./ui";
import { TRIBES, itemMatches, itemThumb, l10n, parseShekels, pick, pictureUrl, priceText } from "./util";

export function Items() {
  const { route, state, t } = useStore();
  if (!route[1]) return <ItemList />;
  if (route[1] === "new") return <ItemForm key="new" item={null} />;
  const item = state.catalog.items.find((i) => i.id === route[1]);
  if (!item) {
    return (
      <section>
        <a className="adm-backlink" href="#/items">‹ {t.itemsBack}</a>
        <div className="adm-panel adm-empty"><p>{t.itGone}</p></div>
      </section>
    );
  }
  return <ItemForm key={item.id} item={item} />;
}

// The list's search and filters are kept while the owner opens an item and comes back.
const listMemory = { q: "", cat: "", status: "", noPrice: false, noTribe: false };

function ItemList() {
  const { t, lang, state, go } = useStore();
  const [q, setQ] = useState(listMemory.q);
  const [cat, setCat] = useState(listMemory.cat);
  const [status, setStatus] = useState(listMemory.status);
  const [noPrice, setNoPrice] = useState(listMemory.noPrice);
  const [noTribe, setNoTribe] = useState(listMemory.noTribe);
  useEffect(() => { Object.assign(listMemory, { q, cat, status, noPrice, noTribe }); }, [q, cat, status, noPrice, noTribe]);
  const cats = useMemo(() => [...state.catalog.categories].sort((a, b) => a.sort - b.sort), [state.catalog.categories]);
  const catName = (key: string) => pick(cats.find((c) => c.key === key)?.name, lang) || key;
  // "no tribe" = no home tribe and not placed in any tribe of any collection
  const placed = useMemo(() => {
    const ids = new Set<string>();
    for (const c of state.catalog.collections) for (const tr of TRIBES) for (const id of c.slots?.[tr.key] ?? []) ids.add(id);
    return ids;
  }, [state.catalog.collections]);
  const list = state.catalog.items
    .filter((i) => i.status !== "archived" && (!cat || i.category === cat)
      && (!status || (status === "soldout" ? i.soldOut : status === "soon" ? !!i.comingSoon : i.status === status))
      && (!noPrice || i.price == null) && (!noTribe || (!i.tribe && !placed.has(i.id))) && itemMatches(i, q))
    .sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));

  return (
    <section>
      <div className="adm-head">
        <h1>{t.itemsTitle}</h1>
        <button type="button" className="adm-btn adm-btn-primary" onClick={() => go("items/new")}>{t.itemNew}</button>
      </div>
      <input className="adm-input adm-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.itemsSearch} aria-label={t.itemsSearch} />
      <div className="adm-filters">
        <label className="adm-select-wrap"><span>{t.itemsCategory}</span>
          <select className="adm-input" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">{t.all}</option>
            {cats.map((c) => <option key={c.key} value={c.key}>{pick(c.name, lang)}</option>)}
          </select>
        </label>
        <label className="adm-select-wrap"><span>{t.itemsStatus}</span>
          <select className="adm-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t.all}</option>
            <option value="published">{t.itStPublished}</option>
            <option value="draft">{t.itStDraft}</option>
            <option value="soon">{t.itSoon}</option>
            <option value="soldout">{t.itSoldOut}</option>
          </select>
        </label>
        <button type="button" className={`adm-fchip${noPrice ? " is-active" : ""}`} aria-pressed={noPrice} onClick={() => setNoPrice(!noPrice)}>{t.itemsNoPrice}</button>
        <button type="button" className={`adm-fchip${noTribe ? " is-active" : ""}`} aria-pressed={noTribe} onClick={() => setNoTribe(!noTribe)}>{t.itemsNoTribe}</button>
      </div>
      <p className="adm-hint"><bdi>{fill(t.itemsCount, { n: list.length })}</bdi></p>
      {list.length === 0 ? <div className="adm-panel adm-empty"><p>{t.itemsEmpty}</p></div> : (
        <ul className="adm-itemlist">
          {list.map((it) => (
            <li key={it.id}>
              <a className="adm-itemrow" href={`#/items/${encodeURIComponent(it.id)}`}>
                <Thumb src={itemThumb(it)} alt="" className="adm-thumb-s" />
                <span className="adm-itemrow-text">
                  <span className="adm-pick-name" dir="auto">{pick(it.name, lang)}</span>
                  <span className="adm-line-meta"><bdi dir="ltr">{it.code}</bdi> · {catName(it.category)}</span>
                </span>
                <span className="adm-itemrow-end">
                  <Price value={it.price} />
                  <span className="adm-chips">
                    {it.comingSoon ? <span className="adm-chip is-soon">{t.itSoon}</span> : null}
                    {it.soldOut ? <span className="adm-chip">{t.itSoldOut}</span> : null}
                    <span className={`adm-chip${it.status === "published" ? " is-on" : ""}`}>{it.status === "published" ? t.itStPublished : t.itStDraft}</span>
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface SizeRow { key: string; label: L10n; on: boolean; price: string }
const STANDARD = ["S", "M", "L", "XL"];
const sizeKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);

function ItemForm({ item }: { item: Item | null }) {
  const { t, lang, state, call, putItem, dropItem, toast, confirm, errText, go, setDirty } = useStore();
  const cats = useMemo(() => [...state.catalog.categories].sort((a, b) => a.sort - b.sort), [state.catalog.categories]);
  const [name, setName] = useState<L10n>(l10n(item?.name));
  const [desc, setDesc] = useState<L10n>(l10n(item?.description));
  const [category, setCategory] = useState(item?.category ?? cats[0]?.key ?? "tzitziyot");
  const [price, setPrice] = useState(priceText(item?.price ?? null));
  const [tribe, setTribe] = useState<TribeKey | "">(item?.tribe ?? "");
  const [status, setStatus] = useState<"draft" | "published">(item?.status === "published" ? "published" : "draft");
  const [soldOut, setSoldOut] = useState(item?.soldOut ?? false);
  const [comingSoon, setComingSoon] = useState(item?.comingSoon ?? false);
  const [pictures, setPictures] = useState<Picture[]>(item?.pictures ?? []);
  const find = (k: string) => item?.variants.find((v) => v.key === k);
  const [adult, setAdult] = useState({ on: item ? (find("adult")?.available ?? false) : true, price: priceText(find("adult")?.price ?? null) });
  const [kid, setKid] = useState({ on: item ? (find("kid")?.available ?? false) : true, price: priceText(find("kid")?.price ?? null) });
  const [sizes, setSizes] = useState<SizeRow[]>(() => {
    const own = (item?.variants ?? []).filter((v) => v.key !== "adult" && v.key !== "kid" && v.key !== "one")
      .map((v) => ({ key: v.key, label: l10n(v.label), on: v.available, price: priceText(v.price) }));
    const missing = STANDARD.filter((s) => !own.some((o) => o.key === s.toLowerCase())).map((s) => ({ key: s.toLowerCase(), label: { he: s, en: s, fr: s }, on: false, price: "" }));
    return [...own, ...missing];
  });
  const [newSize, setNewSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; price?: string; form?: string }>({});
  const [upload, setUpload] = useState<{ text: string; bad?: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isTz = category === "tzitziyot";

  const touch = () => { setSaved(false); setDirty(true); };
  useEffect(() => () => setDirty(false), [setDirty]);

  const variantsOut = (): Variant[] | null => {
    if (isTz) {
      const rows: Variant[] = [];
      for (const [key, v, he, en, fr] of [["adult", adult, "מבוגר · מידה אחת", "Adult · one size", "Adulte · taille unique"], ["kid", kid, "ילד · מידה אחת", "Kid · one size", "Enfant · taille unique"]] as const) {
        const p = parseShekels(v.price);
        if (Number.isNaN(p)) return null;
        rows.push({ key, label: find(key)?.label ?? { he, en, fr }, price: v.on ? p : null, available: v.on });
      }
      return rows;
    }
    return sizes.filter((s) => s.on).map((s) => ({ key: s.key, label: s.label, price: find(s.key)?.price ?? null, available: true }));
  };

  const save = async (): Promise<void> => {
    const p = parseShekels(price);
    const v = variantsOut();
    const errs: typeof errors = {};
    if (!name.he.trim()) errs.name = t.itNameRequired;
    if (Number.isNaN(p) || v === null) errs.price = t.itPriceBad;
    setErrors(errs);
    if (errs.name || errs.price || !v) { toast(errs.name ?? errs.price ?? t.errInvalid, "bad"); return; }
    setBusy(true);
    try {
      const payload: Partial<Item> = {
        ...(item ? { id: item.id } : {}),
        name: { he: name.he.trim(), en: name.en.trim(), fr: name.fr.trim() },
        description: { he: desc.he.trim(), en: desc.en.trim(), fr: desc.fr.trim() },
        category, price: p as number | null, variants: v, tribe: tribe || null, status, soldOut, pictures,
      };
      let out = await call((tok) => api.adminSaveItem(tok, payload));
      // "coming soon" has its own call; the editor's save leaves it as it is
      if (comingSoon !== (out.comingSoon ?? false)) { const id = out.id; out = await call((tok) => api.adminSetComingSoon(tok, id, comingSoon)); }
      putItem(out);
      // take the screen from what the server answered
      setName(l10n(out.name)); setDesc(l10n(out.description)); setPrice(priceText(out.price)); setPictures(out.pictures ?? []); setComingSoon(out.comingSoon ?? false);
      setSaved(true); setDirty(false); toast(t.saved);
      if (!item) go(`items/${encodeURIComponent(out.id)}`);
    } catch (e) {
      if (!isUnauthorized(e)) { setErrors({ form: errText(e) }); toast(errText(e), "bad"); }
    } finally { setBusy(false); }
  };

  const archive = async () => {
    if (!item) return;
    const ok = await confirm({ title: t.itArchiveTitle, body: fill(t.itArchiveBody, { name: pick(item.name, lang) }), yes: t.itArchiveYes, no: t.no, danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await call((tok) => api.adminArchiveItem(tok, item.id));
      setDirty(false); dropItem(item.id); toast(t.saved); go("items");
    } catch (e) { if (!isUnauthorized(e)) { setErrors({ form: errText(e) }); } setBusy(false); }
  };

  /** Existing item: a picture change is saved at once (pictures only; typed text is left alone).
   *  New item: pictures wait in the form and are saved with it. */
  const commitPictures = async (next: Picture[]): Promise<boolean> => {
    if (!item) { setPictures(next); touch(); return true; }
    try {
      const out = await call((tok) => api.adminSaveItem(tok, { id: item.id, pictures: next }));
      putItem(out); setPictures(out.pictures ?? []);
      return true;
    } catch (e) { if (!isUnauthorized(e)) setUpload({ text: errText(e), bad: true }); return false; }
  };
  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setUploading(true);
    let current = pictures;
    let failed: string | null = null;
    for (let i = 0; i < list.length; i++) {
      setUpload({ text: `${t.itUploadPreparing} ${list.length > 1 ? `(${i + 1}/${list.length})` : ""}` });
      try {
        const r = await resizePicture(list[i]);
        setUpload({ text: fill(t.itUploading, { i: i + 1, n: list.length }) });
        const pic = await call((tok) => api.adminUploadPicture(tok, r.copies, { w: r.w, h: r.h, kind: "product" }));
        const next = [...current, pic];
        if (await commitPictures(next)) current = next; else { failed = t.itUploadFail; break; }
      } catch (e) {
        if (isUnauthorized(e)) { setUploading(false); return; }
        failed = e instanceof Error && e.message === "not_an_image" ? t.itUploadNotImage : t.itUploadFail;
        break;
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (failed) setUpload({ text: failed, bad: true });
    else { setUpload({ text: item ? `${t.itUploadDone} ✓` : t.itPicturesNewHint }); if (item) toast(t.itUploadDone); }
  };
  const movePicture = (from: number, to: number) => {
    if (to < 0 || to >= pictures.length) return;
    const next = [...pictures]; const [x] = next.splice(from, 1); next.splice(to, 0, x);
    void commitPictures(next);
  };
  const removePicture = async (i: number) => {
    const ok = await confirm({ title: t.itPictureRemoveTitle, body: t.itPictureRemoveBody, yes: t.itPictureRemoveYes, no: t.no, danger: true });
    if (ok) void commitPictures(pictures.filter((_, k) => k !== i));
  };
  const addSize = () => {
    const label = newSize.trim();
    if (!label) return;
    let key = sizeKey(label) || `size-${sizes.length + 1}`;
    if (sizes.some((s) => s.key === key)) { setSizes(sizes.map((s) => (s.key === key ? { ...s, on: true } : s))); setNewSize(""); touch(); return; }
    if (key === "adult" || key === "kid") key = `${key}-2`;
    setSizes([...sizes, { key, label: { he: label, en: label, fr: label }, on: true, price: "" }]); setNewSize(""); touch();
  };

  return (
    <section className="adm-itemform">
      <a className="adm-backlink" href="#/items" onClick={(e) => { e.preventDefault(); go("items"); }}>‹ {t.itemsBack}</a>
      <div className="adm-head">
        <h1 dir="auto">{item ? pick(item.name, lang) : t.itemNew}</h1>
        {item ? <bdi dir="ltr" className="adm-code">{item.code}</bdi> : null}
      </div>

      <div className="adm-formgrid">
        <div className="adm-panel adm-form">
          <L10nFields label={t.itName} value={name} onChange={(v) => { setName(v); setErrors((e) => ({ ...e, name: undefined })); touch(); }} error={errors.name} />
          <L10nFields label={t.itDesc} value={desc} onChange={(v) => { setDesc(v); touch(); }} multiline />
          <Field label={t.itCategory} htmlFor="it-cat">
            <select id="it-cat" className="adm-input" value={category} onChange={(e) => { setCategory(e.target.value); touch(); }}>
              {cats.map((c) => <option key={c.key} value={c.key}>{pick(c.name, lang)}</option>)}
            </select>
          </Field>
          <Field label={t.itPrice} hint={t.itPriceHint} error={errors.price} htmlFor="it-price">
            <div className="adm-money"><span aria-hidden="true">₪</span>
              <input id="it-price" className="adm-input adm-input-short" type="text" inputMode="decimal" dir="ltr" value={price} onChange={(e) => { setPrice(e.target.value); setErrors((x) => ({ ...x, price: undefined })); touch(); }} />
            </div>
          </Field>

          <fieldset className="adm-l10n">
            <legend className="adm-label">{t.itSizes}</legend>
            {isTz ? (
              <>
                {([["adult", adult, setAdult, t.itAdult], ["kid", kid, setKid, t.itKid]] as const).map(([k, v, set, label]) => (
                  <div key={k} className="adm-sizerow">
                    <Toggle checked={v.on} onChange={(on) => { set({ ...v, on }); touch(); }} label={label} />
                    {v.on ? (
                      <label className="adm-sizeprice"><span>{t.itOwnPrice}</span>
                        <span className="adm-money"><span aria-hidden="true">₪</span>
                          <input className="adm-input adm-input-short" type="text" inputMode="decimal" dir="ltr" value={v.price} onChange={(e) => { set({ ...v, price: e.target.value }); touch(); }} />
                        </span>
                      </label>
                    ) : null}
                  </div>
                ))}
                <p className="adm-hint">{t.itOwnPriceHint}</p>
              </>
            ) : (
              <>
                <div className="adm-filterchips">
                  {sizes.map((s) => (
                    <button key={s.key} type="button" className={`adm-fchip adm-sizechip${s.on ? " is-active" : ""}`} aria-pressed={s.on}
                      onClick={() => { setSizes(sizes.map((x) => (x.key === s.key ? { ...x, on: !x.on } : x))); touch(); }}><bdi>{pick(s.label, lang)}</bdi></button>
                  ))}
                </div>
                <div className="adm-addsize">
                  <input className="adm-input adm-input-short" type="text" value={newSize} placeholder={t.itSizeAddPh} aria-label={t.itSizeAdd}
                    onChange={(e) => setNewSize(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSize(); } }} />
                  <button type="button" className="adm-btn" onClick={addSize}>{t.itSizeAdd}</button>
                </div>
                <p className="adm-hint">{t.itSizesHint}</p>
              </>
            )}
          </fieldset>

          <Field label={t.itTribe} hint={t.itTribeHint} htmlFor="it-tribe">
            <select id="it-tribe" className="adm-input" value={tribe} onChange={(e) => { setTribe(e.target.value as TribeKey | ""); touch(); }}>
              <option value="">{t.itTribeNone}</option>
              {TRIBES.map((tr) => <option key={tr.key} value={tr.key}>{lang === "he" ? tr.he : tr.en}</option>)}
            </select>
          </Field>
        </div>

        <div className="adm-formside">
          <div className="adm-panel adm-form">
            <fieldset className="adm-l10n">
              <legend className="adm-label">{t.itPictures}</legend>
              {pictures.length > 0 ? (
                <ol className="adm-pics">
                  {pictures.map((p, i) => (
                    <li key={`${p.base}-${i}`} className="adm-pic">
                      <span className="adm-thumb adm-thumb-pic"><img src={pictureUrl(p, 480)} alt="" loading="lazy" />{p.kind === "render" ? <span className="adm-thumb-tag">{t.pictureRender}</span> : null}</span>
                      <div className="adm-pic-actions">
                        {i === 0 ? <span className="adm-chip is-accent">{t.itPictureMain}</span>
                          : <button type="button" className="adm-btn adm-btn-s" disabled={uploading} onClick={() => movePicture(i, 0)}>{t.itPictureSetMain}</button>}
                        <div className="adm-btnrow">
                          <button type="button" className="adm-btn adm-btn-s" disabled={uploading || i === 0} onClick={() => movePicture(i, i - 1)}>{t.itPictureEarlier}</button>
                          <button type="button" className="adm-btn adm-btn-s" disabled={uploading || i === pictures.length - 1} onClick={() => movePicture(i, i + 1)}>{t.itPictureLater}</button>
                        </div>
                        <button type="button" className="adm-btn adm-btn-s adm-btn-danger-quiet" disabled={uploading} onClick={() => void removePicture(i)}>{t.itPictureRemove}</button>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : <p className="adm-hint">{t.noPicture}</p>}
              <input ref={fileRef} id="it-file" className="adm-visually-hidden" type="file" accept="image/*" multiple onChange={(e) => void onFiles(e.target.files)} />
              <label htmlFor="it-file" className={`adm-btn adm-btn-big${uploading ? " is-disabled" : ""}`} aria-disabled={uploading}>{t.itPictureChoose}</label>
              {upload ? <p className={upload.bad ? "adm-error" : "adm-hint"} role={upload.bad ? "alert" : "status"}>{upload.text}</p> : <p className="adm-hint">{t.itPicturesHint}</p>}
            </fieldset>
          </div>

          <div className="adm-panel adm-form">
            <fieldset className="adm-l10n">
              <legend className="adm-label">{t.itStatus}</legend>
              <div className="adm-choice" role="radiogroup" aria-label={t.itStatus}>
                {(["published", "draft"] as const).map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={status === s} className={`adm-choice-btn${status === s ? " is-active" : ""}`} onClick={() => { setStatus(s); touch(); }}>
                    <strong>{s === "published" ? t.itStPublished : t.itStDraft}</strong>
                    <span>{s === "published" ? t.itStatusPublishedHint : t.itStatusDraftHint}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <Toggle checked={comingSoon} onChange={(v) => { setComingSoon(v); touch(); }} label={t.itSoonToggle}
              hint={comingSoon && status !== "published" ? `${t.itSoonHint} ${t.itSoonDraft}` : t.itSoonHint} />
            <Toggle checked={soldOut} onChange={(v) => { setSoldOut(v); touch(); }} label={t.itSoldOutToggle} hint={t.itSoldOutHint} />
            {item ? (
              <a className="adm-btn" href={`#/stock/${encodeURIComponent(item.id)}`} onClick={(e) => { e.preventDefault(); go(`stock/${encodeURIComponent(item.id)}`); }}>{t.itStockLink}</a>
            ) : null}
            {item ? <button type="button" className="adm-btn adm-btn-danger-quiet" disabled={busy} onClick={() => void archive()}>{t.itArchive}</button> : null}
          </div>
        </div>
      </div>

      <div className="adm-savebar">
        {errors.form ? <p className="adm-error" role="alert">{errors.form}</p> : null}
        <SaveButton busy={busy} saved={saved} onClick={() => void save()} disabled={uploading} />
      </div>
    </section>
  );
}
