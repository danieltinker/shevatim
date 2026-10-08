"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Collection, Item, L10n, TribeKey } from "@/lib/types";
import { ApiError } from "@/lib/types";
import { api } from "./backend";
import { fill } from "./strings";
import { isUnauthorized, useStore } from "./store";
import { Field, L10nFields, Price, SaveButton, Sheet, Thumb, Toggle } from "./ui";
import { EMPTY_L10N, TRIBES, itemMatches, itemThumb, l10n, parseShekels, pick, priceText, type TribeInfo } from "./util";

export function Collections() {
  const { route } = useStore();
  return route[1] ? <Board id={route[1]} /> : <CollectionList />;
}

/** How many pieces a collection holds, and in how many tribes. */
function filledCount(c: Collection, per: number): { pieces: number; tribes: number } {
  let pieces = 0, tribes = 0;
  for (const tr of TRIBES) { const n = Math.min(per, (c.slots?.[tr.key] ?? []).length); pieces += n; if (n) tribes++; }
  return { pieces, tribes };
}
/** Pieces per tribe: as many as the owner wants, up to the setting (24 by default). */
const DEFAULT_PER_TRIBE = 24;

function CollectionList() {
  const { t, lang, state, go, call, putCollection, toast, errText } = useStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState<L10n>(EMPTY_L10N);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const per = state.catalog.settings.slotsPerTribe || DEFAULT_PER_TRIBE;
  const list = [...state.catalog.collections].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.sort - b.sort);

  const create = async () => {
    if (!name.he.trim()) { setError(t.colNameRequired); return; }
    setBusy(true); setError(null);
    try {
      const saved = await call((tok) => api.adminSaveCollection(tok, { name: { he: name.he.trim(), en: name.en.trim(), fr: name.fr.trim() }, status: "draft" }));
      putCollection(saved);
      setCreating(false); setName(EMPTY_L10N);
      toast(t.saved);
      go(`collections/${encodeURIComponent(saved.id)}`);
    } catch (e) { if (!isUnauthorized(e)) setError(errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <section>
      <div className="adm-head">
        <h1>{t.colTitle}</h1>
        <button type="button" className="adm-btn adm-btn-primary" onClick={() => setCreating(true)}>{t.colNew}</button>
      </div>
      {list.length === 0 ? <div className="adm-panel adm-empty"><p>{t.colEmpty}</p></div> : (
        <ul className="adm-collist">
          {list.map((c) => (
            <li key={c.id}>
              <a className="adm-panel adm-colrow" href={`#/collections/${encodeURIComponent(c.id)}`}>
                <div>
                  <h2 dir="auto">{pick(c.name, lang)}</h2>
                  <p className="adm-hint"><bdi>{(() => { const f = filledCount(c, per); return fill(t.colProgress, { filled: f.pieces, tribes: f.tribes }); })()}</bdi></p>
                </div>
                <div className="adm-chips">
                  {c.isCurrent ? <span className="adm-chip is-accent">{t.colCurrent}</span> : null}
                  <span className={`adm-chip${c.status === "published" ? " is-on" : ""}`}>{c.status === "published" ? t.colPublished : t.colDraft}</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <Sheet title={t.colNewTitle} onClose={() => setCreating(false)}
          footer={<><SaveButton busy={busy} saved={false} label={t.colCreate} onClick={() => void create()} /><button type="button" className="adm-btn" onClick={() => setCreating(false)}>{t.cancel}</button></>}>
          <L10nFields label={t.colName} value={name} onChange={setName} error={error} hint={t.colNewHint} />
        </Sheet>
      ) : null}
    </section>
  );
}

type PickerState = { tribe: TribeInfo; replaceIndex: number | null } | null;
type SlotState = { tribe: TribeInfo; index: number } | null;

function Board({ id }: { id: string }) {
  const { t, lang, state, go, call, putCollection, toast, errText } = useStore();
  const col = state.catalog.collections.find((c) => c.id === id);
  const per = state.catalog.settings.slotsPerTribe || DEFAULT_PER_TRIBE;
  const [picker, setPicker] = useState<PickerState>(null);
  const [slot, setSlot] = useState<SlotState>(null);
  const [busyTribe, setBusyTribe] = useState<TribeKey | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const drag = useRef<{ tribe: TribeKey; index: number } | null>(null);
  const itemsById = useMemo(() => new Map(state.catalog.items.map((i) => [i.id, i])), [state.catalog.items]);

  if (!col) {
    return (
      <section>
        <a className="adm-backlink" href="#/collections">‹ {t.colBack}</a>
        <div className="adm-panel adm-empty"><p>{t.colGone}</p></div>
      </section>
    );
  }
  const idsOf = (tribe: TribeKey): string[] => col.slots?.[tribe] ?? [];

  /** Every slot change sends the tribe's full ordered list and redraws from what the server answers. */
  const setSlots = async (tribe: TribeKey, ids: string[]): Promise<boolean> => {
    if (ids.length > per) { toast(fill(t.errRowFull, { total: per }), "bad"); return false; }
    setBusyTribe(tribe);
    try {
      const saved = await call((tok) => api.adminSetSlots(tok, col.id, tribe, ids));
      putCollection(saved);
      toast(t.saved);
      return true;
    } catch (e) { if (!isUnauthorized(e)) toast(errText(e), "bad"); return false; }
    finally { setBusyTribe(null); }
  };
  const move = async (tribe: TribeKey, from: number, to: number) => {
    const ids = [...idsOf(tribe)];
    if (to < 0 || to >= ids.length || from === to) return false;
    const [x] = ids.splice(from, 1); ids.splice(to, 0, x);
    return setSlots(tribe, ids);
  };

  const filled = filledCount(col, per);
  return (
    <section>
      <a className="adm-backlink" href="#/collections" onClick={(e) => { e.preventDefault(); go("collections"); }}>‹ {t.colBack}</a>
      <div className="adm-head">
        <div>
          <h1 dir="auto">{pick(col.name, lang)}</h1>
          <div className="adm-chips">
            {col.isCurrent ? <span className="adm-chip is-accent">{t.colCurrent}</span> : null}
            <span className={`adm-chip${col.status === "published" ? " is-on" : ""}`}>{col.status === "published" ? t.colPublished : t.colDraft}</span>
          </div>
        </div>
        <button type="button" className="adm-btn" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)}>{showSettings ? t.colSettingsHide : t.colSettings}</button>
      </div>
      {showSettings ? <CollectionSettings key={col.id} col={col} /> : null}

      <div className="adm-progress">
        <p><bdi>{fill(t.colProgress, { filled: filled.pieces, tribes: filled.tribes })}</bdi></p>
        <div className="adm-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={12} aria-valuenow={filled.tribes}><span style={{ inlineSize: `${(filled.tribes / 12) * 100}%` }} /></div>
      </div>

      <div className="adm-board">
        {TRIBES.map((tr) => {
          const ids = idsOf(tr.key);
          return (
            <section key={tr.key} className={`adm-panel adm-tribe${busyTribe === tr.key ? " is-busy" : ""}`} aria-label={lang === "he" ? tr.he : tr.en}>
              <header className="adm-tribe-head">
                <span className="adm-stone" style={{ background: tr.hex }} aria-hidden="true" />
                <h2>{lang === "he" ? tr.he : tr.en}</h2>
                <bdi className="adm-tribe-count">{fill(t.slotOf, { n: Math.min(ids.length, per) })}</bdi>
              </header>
              <ol className="adm-slots">
                {/* the pieces already in the tribe, then one "add" button for as long as there is room */}
                {[...ids.map((itemId, i) => ({ itemId, i })), ...(ids.length < per ? [{ itemId: "", i: ids.length }] : [])].map(({ itemId, i }) => {
                  if (!itemId) {
                    return (
                      <li key="add">
                        <button type="button" className="adm-slot adm-slot-empty" onClick={() => setPicker({ tribe: tr, replaceIndex: null })}>
                          <span className="adm-slot-plus" aria-hidden="true">+</span>
                          <span>{t.slotAdd}</span>
                        </button>
                      </li>
                    );
                  }
                  const it = itemsById.get(itemId);
                  return (
                    <li key={`${itemId}-${i}`}>
                      <button type="button" className="adm-slot adm-slot-filled" draggable
                        onDragStart={(e) => { drag.current = { tribe: tr.key, index: i }; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", itemId); } catch { /* ignore */ } }}
                        onDragOver={(e) => { if (drag.current && drag.current.tribe === tr.key) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
                        onDrop={(e) => { e.preventDefault(); const d = drag.current; drag.current = null; if (d && d.tribe === tr.key) void move(tr.key, d.index, i); }}
                        onDragEnd={() => { drag.current = null; }}
                        onClick={() => setSlot({ tribe: tr, index: i })}>
                        <Thumb src={itemThumb(it)} alt="" className="adm-thumb-slot" tag={it?.pictures?.[0]?.kind === "render" ? t.pictureRender : undefined} />
                        <span className="adm-slot-name" dir="auto">{it ? pick(it.name, lang) : t.slotMissing}</span>
                        <span className="adm-slot-price">{it ? <Price value={it.price} /> : null}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      {picker ? (
        <Picker col={col} tribe={picker.tribe} per={per} replaceIndex={picker.replaceIndex} busy={busyTribe === picker.tribe.key}
          onClose={() => setPicker(null)}
          onPick={async (itemId) => {
            const ids = [...idsOf(picker.tribe.key)];
            if (picker.replaceIndex != null) {
              ids[picker.replaceIndex] = itemId;
              if (await setSlots(picker.tribe.key, ids)) setPicker(null);
            } else {
              await setSlots(picker.tribe.key, [...ids, itemId]);
            }
          }} />
      ) : null}
      {slot && idsOf(slot.tribe.key)[slot.index] ? (
        <SlotSheet key={`${slot.tribe.key}-${slot.index}-${idsOf(slot.tribe.key)[slot.index]}`} tribe={slot.tribe} index={slot.index} count={idsOf(slot.tribe.key).length}
          item={itemsById.get(idsOf(slot.tribe.key)[slot.index])} busy={busyTribe === slot.tribe.key}
          onClose={() => setSlot(null)}
          onReplace={() => { setPicker({ tribe: slot.tribe, replaceIndex: slot.index }); setSlot(null); }}
          onDetach={async () => { const ids = idsOf(slot.tribe.key).filter((_, i) => i !== slot.index); if (await setSlots(slot.tribe.key, ids)) setSlot(null); }}
          onMove={async (delta) => { if (await move(slot.tribe.key, slot.index, slot.index + delta)) setSlot({ tribe: slot.tribe, index: slot.index + delta }); }} />
      ) : null}
    </section>
  );
}

function Picker({ col, tribe, per, replaceIndex, busy, onClose, onPick }: {
  col: Collection; tribe: TribeInfo; per: number; replaceIndex: number | null; busy: boolean; onClose: () => void; onPick: (itemId: string) => Promise<void>;
}) {
  const { t, lang, state } = useStore();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const inTribe = col.slots?.[tribe.key] ?? [];
  const full = replaceIndex == null && inTribe.length >= per;
  const cats = [...state.catalog.categories].sort((a, b) => a.sort - b.sort);
  const items = state.catalog.items
    .filter((i) => i.status !== "archived" && (!cat || i.category === cat) && itemMatches(i, q))
    .sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
  const tribeLabel = lang === "he" ? tribe.he : tribe.en;
  // where each item already sits in this collection (an item may sit in several tribes: this is only a reminder)
  const elsewhere = new Map<string, string[]>();
  for (const tr of TRIBES) {
    if (tr.key === tribe.key) continue;
    for (const id of col.slots?.[tr.key] ?? []) elsewhere.set(id, [...(elsewhere.get(id) ?? []), lang === "he" ? tr.he : tr.en]);
  }
  return (
    <Sheet wide title={fill(replaceIndex == null ? t.pickTitle : t.pickReplaceTitle, { tribe: tribeLabel })} onClose={onClose}
      footer={<><p className="adm-pick-count" aria-live="polite"><span className="adm-stone" style={{ background: tribe.hex }} aria-hidden="true" /> <bdi>{fill(t.pickCount, { n: inTribe.length, total: per })}</bdi></p><button type="button" className="adm-btn adm-btn-primary" onClick={onClose}>{t.done}</button></>}>
      <input className="adm-input adm-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.pickSearch} aria-label={t.pickSearch} />
      <div className="adm-filterchips" role="group" aria-label={t.itemsCategory}>
        <button type="button" className={`adm-fchip${cat === "" ? " is-active" : ""}`} aria-pressed={cat === ""} onClick={() => setCat("")}>{t.all}</button>
        {cats.map((c) => <button key={c.key} type="button" className={`adm-fchip${cat === c.key ? " is-active" : ""}`} aria-pressed={cat === c.key} onClick={() => setCat(c.key)}>{pick(c.name, lang)}</button>)}
      </div>
      {full ? <p className="adm-notice" role="status"><bdi>{fill(t.pickFull, { n: per })}</bdi></p> : replaceIndex == null ? <p className="adm-hint">{t.pickTap}</p> : null}
      {items.length === 0 ? <p className="adm-empty-line">{t.pickEmpty}</p> : (
        <ul className="adm-picklist">
          {items.map((it) => {
            const already = inTribe.includes(it.id);
            return (
              <li key={it.id}>
                <button type="button" className={`adm-pick${already ? " is-already" : ""}`} disabled={already || full || busy}
                  onClick={async () => { await onPick(it.id); setJustAdded(it.id); }}>
                  <Thumb src={itemThumb(it)} alt="" className="adm-thumb-s" />
                  <span className="adm-pick-text">
                    <span className="adm-pick-name" dir="auto">{pick(it.name, lang)}</span>
                    <span className="adm-line-meta"><bdi dir="ltr">{it.code}</bdi> · <Price value={it.price} />{it.status === "draft" ? <> · {t.pickDraft}</> : null}</span>
                    {elsewhere.has(it.id) ? <span className="adm-line-meta">{t.pickElsewhere} {elsewhere.get(it.id)!.join(", ")}</span> : null}
                  </span>
                  {already ? <span className="adm-chip is-on">{justAdded === it.id ? `${t.pickAdded} ✓` : t.pickAlready}</span> : <span className="adm-pick-plus" aria-hidden="true">+</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

function SlotSheet({ tribe, index, count, item, busy, onClose, onReplace, onDetach, onMove }: {
  tribe: TribeInfo; index: number; count: number; item: Item | undefined; busy: boolean;
  onClose: () => void; onReplace: () => void; onDetach: () => Promise<void>; onMove: (delta: number) => Promise<void>;
}) {
  const { t, lang, call, putItem, toast, errText, go } = useStore();
  const [name, setName] = useState<L10n>(l10n(item?.name));
  const [price, setPrice] = useState(priceText(item?.price ?? null));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const changed = !!item && (name.he !== item.name.he || name.en !== item.name.en || name.fr !== item.name.fr || price !== priceText(item.price));

  const save = async () => {
    if (!item) return;
    const p = parseShekels(price);
    if (!name.he.trim()) { setError(t.itNameRequired); return; }
    if (Number.isNaN(p)) { setPriceError(t.itPriceBad); return; }
    setSaving(true); setError(null); setPriceError(null);
    try {
      const out = await call((tok) => api.adminSaveItem(tok, { id: item.id, name: { he: name.he.trim(), en: name.en.trim(), fr: name.fr.trim() }, price: p }));
      putItem(out); setName(l10n(out.name)); setPrice(priceText(out.price));
      setSaved(true); toast(t.saved);
    } catch (e) { if (!isUnauthorized(e)) setError(errText(e)); }
    finally { setSaving(false); }
  };

  return (
    <Sheet title={`${lang === "he" ? tribe.he : tribe.en} · ${fill(t.slotOf, { n: index + 1, total: count })}`} onClose={onClose}>
      {!item ? <p className="adm-notice">{t.slotMissing}</p> : (
        <>
          <div className="adm-slotsheet-top">
            <Thumb src={itemThumb(item)} alt="" className="adm-thumb-m" />
            <div>
              <p className="adm-line-meta"><bdi dir="ltr">{item.code}</bdi></p>
              <button type="button" className="adm-linkbtn" onClick={() => { onClose(); go(`items/${encodeURIComponent(item.id)}`); }}>{t.slotEditFull}</button>
            </div>
          </div>
          <L10nFields label={t.itName} value={name} onChange={(v) => { setName(v); setError(null); setSaved(false); }} hint={t.slotRenameHint} error={error} />
          <Field label={t.itPrice} hint={t.itPriceHint} error={priceError} htmlFor="slot-price">
            <input id="slot-price" className="adm-input adm-input-short" type="text" inputMode="decimal" dir="ltr" value={price} onChange={(e) => { setPrice(e.target.value); setPriceError(null); setSaved(false); }} />
          </Field>
          <SaveButton busy={saving} saved={saved && !changed} label={t.slotSaveName} onClick={() => void save()} />
        </>
      )}
      <hr className="adm-rule" />
      <div className="adm-btnrow">
        <button type="button" className="adm-btn" disabled={busy || index === 0} onClick={() => void onMove(-1)}>{t.slotMoveEarlier}</button>
        <button type="button" className="adm-btn" disabled={busy || index >= count - 1} onClick={() => void onMove(1)}>{t.slotMoveLater}</button>
        <button type="button" className="adm-btn" disabled={busy} onClick={onReplace}>{t.slotReplace}</button>
      </div>
      <div className="adm-field">
        <button type="button" className="adm-btn adm-btn-danger-quiet" disabled={busy} onClick={() => void onDetach()}>{t.slotDetach}</button>
        <p className="adm-hint">{t.slotDetachHint}</p>
      </div>
    </Sheet>
  );
}

function CollectionSettings({ col }: { col: Collection }) {
  const { t, lang, call, putCollection, dropCollection, toast, confirm, errText, go, setDirty, refresh } = useStore();
  const [name, setName] = useState<L10n>(l10n(col.name));
  const [desc, setDesc] = useState<L10n>(l10n(col.description));
  const [published, setPublished] = useState(col.status === "published");
  const [current, setCurrent] = useState(col.isCurrent);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touch = () => { setSaved(false); setDirty(true); };
  useEffect(() => () => setDirty(false), [setDirty]);

  const save = async () => {
    if (!name.he.trim()) { setError(t.colNameRequired); return; }
    setBusy(true); setError(null);
    try {
      const out = await call((tok) => api.adminSaveCollection(tok, { id: col.id, name, description: desc, status: published ? "published" : "draft", isCurrent: current }));
      putCollection(out);
      setName(l10n(out.name)); setDesc(l10n(out.description)); setPublished(out.status === "published"); setCurrent(out.isCurrent);
      setSaved(true); setDirty(false); toast(t.saved);
      if (out.isCurrent !== col.isCurrent) void refresh(); // the other collections changed too: take them from the server
    } catch (e) { if (!isUnauthorized(e)) setError(errText(e)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (col.isCurrent) { await confirm({ title: t.colDelete, body: t.colDeleteCurrent, yes: t.close, no: t.cancel }); return; }
    const ok = await confirm({ title: t.colDeleteTitle, body: fill(t.colDeleteBody, { name: pick(col.name, lang) }), yes: t.colDeleteYes, no: t.no, danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await call((tok) => api.adminDeleteCollection(tok, col.id));
      setDirty(false); dropCollection(col.id); toast(t.saved); go("collections");
    } catch (e) {
      // the server refuses too (another tab may have made this one the home-page collection meanwhile)
      if (e instanceof ApiError && e.code === "is_current") { setError(t.colDeleteCurrent); void refresh(); }
      else if (!isUnauthorized(e)) setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <div className="adm-panel adm-form">
      <L10nFields label={t.colName} value={name} onChange={(v) => { setName(v); touch(); }} />
      <L10nFields label={t.colDesc} value={desc} onChange={(v) => { setDesc(v); touch(); }} multiline />
      <Toggle checked={published} onChange={(v) => { setPublished(v); touch(); }} label={t.colPublishedToggle} hint={t.colPublishedHint} />
      <Toggle checked={current} onChange={(v) => { setCurrent(v); touch(); }} label={t.colCurrentToggle} hint={col.isCurrent ? t.colCurrentIsHint : t.colCurrentHint} disabled={col.isCurrent} />
      {error ? <p className="adm-error" role="alert">{error}</p> : null}
      <div className="adm-btnrow adm-btnrow-split">
        <SaveButton busy={busy} saved={saved} onClick={() => void save()} />
        <button type="button" className="adm-btn adm-btn-danger-quiet" disabled={busy} onClick={() => void remove()}>{t.colDelete}</button>
      </div>
    </div>
  );
}
