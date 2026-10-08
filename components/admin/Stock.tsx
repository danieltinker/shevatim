"use client";
// Stock: how many pieces the owner has, per piece and size. Nothing is counted until the owner starts counting a
// size; until then it can be reserved without a limit, as before. A counted size goes down by itself when someone
// reserves it and comes back when the reservation is cancelled. The number the owner types is what is in the
// studio (free + held by open reservations); the database keeps the free part.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Item, StockLine, StockMove } from "@/lib/types";
import { api } from "./backend";
import { fill } from "./strings";
import { isUnauthorized, useStore } from "./store";
import { Sheet, Thumb } from "./ui";
import { dateTime, itemMatches, itemThumb, pick, stockReady } from "./util";

type Filter = "" | "out" | "low" | "uncounted";
const LOW = 2; // the shop says "last ones" from this number down

interface Size { key: string; label: string; line: StockLine }

/** The sizes the owner offers for a piece (switched-off sizes are left out); "" for a piece without sizes. */
function sizesOf(it: Item, oneSize: string, lang: "he" | "en"): Size[] {
  const line = (k: string): StockLine => it.stock?.[k] ?? { qty: null, held: 0, sold: 0 };
  if (it.variants.length === 0) return [{ key: "", label: oneSize, line: line("") }];
  return it.variants.filter((v) => v.available).map((v) => ({ key: v.key, label: pick(v.label, lang) || v.key, line: line(v.key) }));
}
const isOut = (s: Size) => s.line.qty === 0;
const isLow = (s: Size) => s.line.qty != null && s.line.qty > 0 && s.line.qty <= LOW;

const listMemory = { q: "", filter: "" as Filter };

export function Stock() {
  const { t, lang, state, route, refresh, go } = useStore();
  const focusId = route[1] ?? null;
  const focusItem = focusId ? state.catalog.items.find((i) => i.id === focusId) : undefined;
  const [q, setQ] = useState(focusItem ? focusItem.code : listMemory.q);
  const [filter, setFilter] = useState<Filter>(focusItem ? "" : listMemory.filter);
  const [history, setHistory] = useState<{ item: Item | null } | null>(null);
  useEffect(() => { if (!focusItem) Object.assign(listMemory, { q, filter }); }, [q, filter, focusItem]);
  // reservations change the numbers: take fresh ones when the page opens
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => { void refreshRef.current(); }, []);

  const oneSize = t.stOneSize;
  const rows = useMemo(() => state.catalog.items
    .filter((i) => i.status !== "archived")
    .map((it) => ({ it, sizes: sizesOf(it, oneSize, lang) }))
    .filter((r) => r.sizes.length > 0)
    .sort((a, b) => a.it.sort - b.it.sort || a.it.code.localeCompare(b.it.code)), [state.catalog.items, oneSize, lang]);
  const counts = useMemo(() => ({
    out: rows.filter((r) => r.sizes.some(isOut)).length,
    low: rows.filter((r) => r.sizes.some(isLow)).length,
    uncounted: rows.filter((r) => r.sizes.some((s) => s.line.qty == null)).length,
  }), [rows]);
  const list = rows.filter((r) => itemMatches(r.it, q) && (
    filter === "" ? true
      : filter === "out" ? r.sizes.some(isOut)
        : filter === "low" ? r.sizes.some(isLow)
          : r.sizes.some((s) => s.line.qty == null)));

  const chips: { key: Filter; label: string; n?: number }[] = [
    { key: "", label: t.all },
    { key: "out", label: t.stFilterOut, n: counts.out },
    { key: "low", label: t.stFilterLow, n: counts.low },
    { key: "uncounted", label: t.stFilterUncounted, n: counts.uncounted },
  ];

  // the database does not know stock yet (db/004_stock.sql not applied): say so instead of offering controls that fail
  if (!stockReady(state.catalog.items)) {
    return (
      <section className="adm-stock">
        <div className="adm-head"><h1>{t.stTitle}</h1></div>
        <div className="adm-panel adm-empty" role="note"><p>{t.stNotReady}</p></div>
      </section>
    );
  }

  return (
    <section className="adm-stock">
      <div className="adm-head">
        <h1>{t.stTitle}</h1>
        <button type="button" className="adm-btn" onClick={() => setHistory({ item: null })}>{t.stHistoryAll}</button>
      </div>
      <p className="adm-notice adm-stock-intro">{t.stIntro}</p>
      <input className="adm-input adm-search" type="search" value={q} onChange={(e) => { setQ(e.target.value); if (focusId) go("stock"); }}
        placeholder={t.stSearch} aria-label={t.stSearch} />
      <div className="adm-filterchips" role="group" aria-label={t.stTitle}>
        {chips.map((c) => (
          <button key={c.key || "all"} type="button" className={`adm-fchip${filter === c.key ? " is-active" : ""}`} aria-pressed={filter === c.key} onClick={() => setFilter(c.key)}>
            {c.label}{c.n != null ? <span className="adm-fchip-n">{c.n}</span> : null}
          </button>
        ))}
      </div>
      <p className="adm-hint"><bdi>{fill(t.itemsCount, { n: list.length })}</bdi></p>
      {list.length === 0 ? <div className="adm-panel adm-empty"><p>{t.itemsEmpty}</p></div> : (
        <ul className="adm-stocklist">
          {list.map(({ it, sizes }) => (
            <li key={it.id} className="adm-panel adm-stockitem">
              <div className="adm-stockitem-head">
                <Thumb src={itemThumb(it, 240)} alt="" className="adm-thumb-s" />
                <span className="adm-itemrow-text">
                  <a className="adm-pick-name adm-stock-name" dir="auto" href={`#/items/${encodeURIComponent(it.id)}`}
                    onClick={(e) => { e.preventDefault(); go(`items/${encodeURIComponent(it.id)}`); }}>{pick(it.name, lang)}</a>
                  <span className="adm-line-meta"><bdi dir="ltr">{it.code}</bdi></span>
                  <span className="adm-chips">
                    {it.comingSoon ? <span className="adm-chip is-soon">{t.itSoon}</span> : null}
                    {it.status !== "published" ? <span className="adm-chip">{t.itStDraft}</span> : null}
                    {it.soldOut ? <span className="adm-chip">{t.itSoldOut}</span> : null}
                  </span>
                </span>
                <button type="button" className="adm-btn adm-btn-quiet adm-btn-s" onClick={() => setHistory({ item: it })}>{t.stHistory}</button>
              </div>
              <div className="adm-stockrows">
                {sizes.map((s) => <StockRow key={s.key || "one"} item={it} size={s} />)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {history ? <History item={history.item} onClose={() => setHistory(null)} /> : null}
    </section>
  );
}

function StockRow({ item, size }: { item: Item; size: Size }) {
  const { t, call, putItem, toast, confirm, errText } = useStore();
  const { qty, held, sold } = size.line;
  const counted = qty != null;
  const onHand = (qty ?? 0) + held;
  const [draft, setDraft] = useState<string>(counted ? String(onHand) : "");
  const [editing, setEditing] = useState(false); // "start counting" was pressed on a size that is not counted
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // the server's number wins whenever it changes (another tab, a reservation, our own call)
  useEffect(() => { setDraft(counted ? String(onHand) : ""); }, [counted, onHand]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const run = async (fn: (tok: string) => Promise<Item>, ok?: string) => {
    setBusy(true); setError(null);
    try {
      const out = await call(fn);
      putItem(out); setEditing(false);
      if (ok) toast(ok);
    } catch (e) {
      if (!isUnauthorized(e)) { setError(errText(e)); toast(errText(e), "bad"); }
    } finally { setBusy(false); }
  };
  const typed = draft.trim() === "" ? NaN : Number(draft.trim());
  const valid = Number.isInteger(typed) && typed >= 0 && typed <= 100000;
  const changed = valid && (!counted || typed !== onHand);
  const submit = () => {
    if (!valid) { setError(t.stNumberBad); return; }
    if (typed < held) { setError(fill(t.stBelowHeld, { n: held })); return; }
    if (!changed) return;
    void run((tok) => api.adminStockSet(tok, item.id, size.key, typed - held), t.saved);
  };
  const step = (d: 1 | -1) => void run((tok) => api.adminStockAdjust(tok, item.id, size.key, d));
  const stop = async () => {
    const ok = await confirm({ title: fill(t.stStopTitle, { size: size.label }), body: t.stStopBody, yes: t.stStopYes, no: t.no });
    if (ok) void run((tok) => api.adminStockSet(tok, item.id, size.key, null), t.saved);
  };

  const state = !counted ? "" : qty === 0 ? " is-out" : qty! <= LOW ? " is-low" : "";
  const errId = `st-err-${item.id}-${size.key || "one"}`;
  return (
    <div className={`adm-stockrow${state}`}>
      <span className="adm-stockrow-size"><bdi>{size.label}</bdi></span>
      {counted || editing ? (
        <>
          <div className="adm-stockrow-set">
            <div className="adm-stepper" dir="ltr">
              <button type="button" aria-label={fill(t.stMinus, { size: size.label })} disabled={busy || !counted || qty === 0} onClick={() => step(-1)}>−</button>
              <input ref={inputRef} className="adm-stepper-n" type="text" inputMode="numeric" pattern="[0-9]*" value={draft} disabled={busy}
                aria-label={fill(t.stOnHandFor, { size: size.label })} aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}
                onChange={(e) => { setDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 6)); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } if (e.key === "Escape" && editing && !counted) { setEditing(false); setDraft(""); } }} />
              <button type="button" aria-label={fill(t.stPlus, { size: size.label })} disabled={busy || !counted} onClick={() => step(1)}>+</button>
            </div>
            {changed || (editing && !counted) ? (
              <button type="button" className="adm-btn adm-btn-primary adm-btn-s" disabled={busy || !valid} onClick={submit}>{busy ? t.saving : t.stUpdate}</button>
            ) : null}
          </div>
          <span className="adm-stockrow-info">
            {counted ? (
              <>
                <span className="adm-stockrow-free">{qty === 0 ? t.stNoneFree : fill(t.stFree, { n: qty! })}</span>
                {held > 0 ? <span>{fill(t.stHeld, { n: held })}</span> : null}
                {sold > 0 ? <span>{fill(t.stSold, { n: sold })}</span> : null}
              </>
            ) : <span>{t.stTypeHowMany}</span>}
          </span>
          {counted ? (
            <button type="button" className="adm-linkbtn adm-stockrow-stop" disabled={busy} onClick={() => void stop()}>{t.stStop}</button>
          ) : (
            <button type="button" className="adm-linkbtn adm-stockrow-stop" disabled={busy} onClick={() => { setEditing(false); setDraft(""); setError(null); }}>{t.cancel}</button>
          )}
        </>
      ) : (
        <>
          <span className="adm-stockrow-info adm-stockrow-uncounted">{t.stUncounted}</span>
          <button type="button" className="adm-btn adm-btn-s adm-stockrow-start" onClick={() => setEditing(true)}>{t.stStart}</button>
        </>
      )}
      {error ? <p id={errId} className="adm-error adm-stockrow-err" role="alert">{error}</p> : null}
    </div>
  );
}

function History({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const { t, lang, state, call, errText } = useStore();
  const [moves, setMoves] = useState<StockMove[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errRef = useRef(errText); errRef.current = errText;
  const itemId = item?.id;
  useEffect(() => {
    let live = true;
    call((tok) => api.adminStockMoves(tok, itemId))
      .then((m) => { if (live) setMoves(m); })
      .catch((e) => { if (live && !isUnauthorized(e)) setError(errRef.current(e)); });
    return () => { live = false; };
  }, [call, itemId]);
  const byId = useMemo(() => new Map(state.catalog.items.map((i) => [i.id, i])), [state.catalog.items]);
  const why = (m: StockMove) => {
    switch (m.reason) {
      case "count": return m.qtyAfter == null ? t.stWhyStop : t.stWhyCount;
      case "adjust": return t.stWhyAdjust;
      case "reserve": return t.stWhyReserve;
      case "release": return t.stWhyRelease;
      case "retake": return t.stWhyRetake;
      default: return "";
    }
  };
  const sizeLabel = (m: StockMove) => {
    const it = byId.get(m.itemId);
    if (!m.variantKey) return t.stOneSize;
    const v = it?.variants.find((x) => x.key === m.variantKey);
    return v ? pick(v.label, lang) || m.variantKey : m.variantKey;
  };
  return (
    <Sheet title={item ? fill(t.stHistoryTitle, { name: pick(item.name, lang) }) : t.stHistoryAll} onClose={onClose} wide>
      {error ? <p className="adm-error" role="alert">{error}</p>
        : !moves ? <p className="adm-loading">{t.loading}</p>
          : moves.length === 0 ? <p className="adm-empty-line">{t.stHistoryEmpty}</p> : (
            <ol className="adm-moves">
              {moves.map((m, i) => {
                const it = byId.get(m.itemId);
                return (
                  <li key={`${m.at}-${i}`} className="adm-move">
                    <bdi dir="ltr" className={`adm-move-d${m.delta > 0 ? " is-up" : m.delta < 0 ? " is-down" : ""}`}>{m.delta > 0 ? `+${m.delta}` : m.delta < 0 ? `−${-m.delta}` : "0"}</bdi>
                    <span className="adm-move-text">
                      <span className="adm-move-what">
                        {item ? null : <><span dir="auto">{it ? pick(it.name, lang) : m.itemId}</span> · </>}
                        <bdi>{sizeLabel(m)}</bdi> · {why(m)}
                        {m.ref ? <> · <bdi dir="ltr" className="adm-code">{m.ref}</bdi></> : null}
                      </span>
                      <span className="adm-date">
                        {dateTime(m.at, lang)}
                        {m.qtyAfter != null ? <> · {fill(t.stFreeAfter, { n: m.qtyAfter })}</> : null}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
    </Sheet>
  );
}
