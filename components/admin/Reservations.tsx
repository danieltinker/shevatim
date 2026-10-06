"use client";
import { useEffect, useMemo, useState } from "react";
import type { Reservation, ReservationStatus } from "@/lib/types";
import { api } from "./backend";
import { fill, type Strings } from "./strings";
import { isUnauthorized, useStore } from "./store";
import { Price, Thumb } from "./ui";
import { dateTime, intlDigits, itemThumb, norm, pick } from "./util";

type Tab = "new" | "open" | "closed";
const TAB_OF: Record<ReservationStatus, Tab> = { new: "new", contacted: "open", confirmed: "open", paid: "open", ready: "open", done: "closed", cancelled: "closed" };
const FLOW: ReservationStatus[] = ["new", "contacted", "confirmed", "paid", "ready", "done"];
export const statusLabel = (s: ReservationStatus, t: Strings): string =>
  ({ new: t.stNew, contacted: t.stContacted, confirmed: t.stConfirmed, paid: t.stPaid, ready: t.stReady, done: t.stDone, cancelled: t.stCancelled })[s];
const actionLabel = (s: ReservationStatus, t: Strings): string =>
  ({ new: t.resReopen, contacted: t.actContacted, confirmed: t.actConfirmed, paid: t.actPaid, ready: t.actReady, done: t.actDone, cancelled: t.resCancel })[s];

export function Reservations() {
  const { t, lang, state, refresh, refreshing, toast } = useStore();
  const [tab, setTab] = useState<Tab>("new");
  const [q, setQ] = useState("");
  const counts = useMemo(() => {
    const c = { new: 0, open: 0, closed: 0 };
    for (const r of state.reservations) c[TAB_OF[r.status] ?? "open"]++;
    return c;
  }, [state.reservations]);
  const searching = norm(q) !== "";
  const list = useMemo(() => {
    const n = norm(q);
    const digits = q.replace(/\D/g, "");
    return state.reservations
      .filter((r) => {
        if (!n) return (TAB_OF[r.status] ?? "open") === tab;
        return norm(r.customer.name).includes(n) || norm(r.code).includes(n) || norm(r.code.replace(/[^a-z0-9]/gi, "")).includes(n.replace(/[^a-z0-9]/gi, "") || "\u0000")
          || (digits.length >= 3 && (r.customer.phone.replace(/\D/g, "").includes(digits) || intlDigits(r.customer.phone).includes(digits)));
      })
      .sort((a, b) => (tab === "new" && !n ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
  }, [state.reservations, tab, q]);
  const tabs: { key: Tab; label: string }[] = [{ key: "new", label: t.resTabNew }, { key: "open", label: t.resTabOpen }, { key: "closed", label: t.resTabClosed }];
  const empty = searching ? t.resEmptySearch : tab === "new" ? t.resEmptyNew : tab === "open" ? t.resEmptyOpen : t.resEmptyClosed;

  /** Downloads the reservations now on screen (the open tab, or the search results) as a file for Excel. */
  const exportCsv = () => {
    if (list.length === 0) { toast(t.resExportEmpty, "bad"); return; }
    // Text typed by customers must never be read by Excel as a formula.
    const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const when = (iso: string) => {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    };
    const head = [t.csvCode, t.csvDate, t.csvStatus, t.csvName, t.csvPhone, t.csvEmail, t.csvItems, t.csvTotal, t.csvNote, t.csvPrivate];
    const rows = list.map((r) => [
      r.code,
      when(r.createdAt),
      statusLabel(r.status, t),
      safe(r.customer.name),
      `\t${r.customer.phone}`, // the tab keeps the leading 0 or + when Excel opens the file
      safe(r.customer.email ?? ""),
      safe(r.lines.map((l) => `${pick(l.name, lang) || t.resItemGone} (${l.code}) · ${l.variantLabel ? pick(l.variantLabel, lang) : t.resOneSize} × ${l.qty}`).join("; ")),
      r.total == null ? t.resTotalOpen : String(r.total / 100),
      safe(r.note ?? ""),
      safe(r.adminNote ?? ""),
    ]);
    const csv = "\uFEFF" + [head, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `shevatim-reservations-${when(new Date().toISOString()).slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast(t.resExportDone);
  };

  return (
    <section>
      <div className="adm-head">
        <h1>{t.resTitle}</h1>
        <div className="adm-btnrow">
          <button type="button" className="adm-btn" onClick={exportCsv}>{t.resExport}</button>
          <button type="button" className="adm-btn" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? t.refreshing : t.refresh}</button>
        </div>
      </div>
      <div className="adm-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={!searching && tab === x.key} className={`adm-tabbtn${!searching && tab === x.key ? " is-active" : ""}${x.key === "new" && counts.new > 0 ? " has-waiting" : ""}`}
            onClick={() => { setTab(x.key); setQ(""); }}>
            <span>{x.label}</span> <bdi className="adm-count">{counts[x.key]}</bdi>
          </button>
        ))}
      </div>
      <input className="adm-input adm-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.resSearch} aria-label={t.resSearch} />
      {list.length === 0 ? (
        <div className="adm-panel adm-empty"><p>{empty}</p></div>
      ) : (
        <ul className="adm-reslist">
          {list.map((r) => <li key={r.id}><ReservationCard r={r} showStatus={searching || tab !== "new"} /></li>)}
        </ul>
      )}
    </section>
  );
}

function ReservationCard({ r, showStatus }: { r: Reservation; showStatus: boolean }) {
  const { t, lang, state, call, putReservation, toast, confirm, errText } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(r.adminNote ?? "");
  const [noteState, setNoteState] = useState<"" | "saving" | "saved" | "bad">("");
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setNote(r.adminNote ?? ""); }, [r.adminNote, focused]);

  const setStatus = async (status: ReservationStatus) => {
    if (status === "cancelled") {
      const ok = await confirm({ title: t.resCancelTitle, body: fill(t.resCancelBody, { code: r.code, name: r.customer.name }), yes: t.resCancelYes, no: t.no, danger: true });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const saved = await call((tok) => api.adminUpdateReservation(tok, r.id, { status }));
      putReservation(saved);
      toast(`${t.saved} · ${statusLabel(saved.status, t)}`);
    } catch (e) { if (!isUnauthorized(e)) toast(errText(e), "bad"); }
    finally { setBusy(false); }
  };
  const saveNote = async () => {
    setFocused(false);
    if (note === (r.adminNote ?? "")) return;
    setNoteState("saving");
    try {
      const saved = await call((tok) => api.adminUpdateReservation(tok, r.id, { adminNote: note }));
      putReservation(saved); setNoteState("saved");
    } catch (e) { setNoteState("bad"); if (!isUnauthorized(e)) toast(errText(e), "bad"); }
  };

  const wa = intlDigits(r.customer.phone);
  const idx = FLOW.indexOf(r.status);
  const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null;
  const later = idx >= 0 ? FLOW.slice(idx + 2) : [];
  const closed = r.status === "done" || r.status === "cancelled";
  const langName = r.locale === "he" ? t.hebrew : r.locale === "fr" ? t.french : t.english;

  return (
    <article className={`adm-panel adm-res${r.status === "new" ? " is-new" : ""}`}>
      <header className="adm-res-head">
        <div>
          <bdi dir="ltr" className="adm-code">{r.code}</bdi>
          {showStatus ? <span className={`adm-chip st-${r.status}`}>{statusLabel(r.status, t)}</span> : null}
        </div>
        <bdi dir="ltr" className="adm-date">{dateTime(r.createdAt, lang)}</bdi>
      </header>
      <h2 className="adm-res-name" dir="auto">{r.customer.name}</h2>
      <div className="adm-res-contact">
        <a className="adm-btn" href={`tel:${r.customer.phone.replace(/[^\d+]/g, "")}`}>{t.resCall} <bdi dir="ltr">{r.customer.phone}</bdi></a>
        {wa.length >= 9 ? <a className="adm-btn" href={`https://wa.me/${wa}`} target="_blank" rel="noopener">{t.resWhatsapp}</a> : null}
      </div>
      {r.note ? <p className="adm-res-note"><span className="adm-res-note-by">{t.resCustomerNote}</span> <span dir="auto">{r.note}</span></p> : null}
      <ul className="adm-lines">
        {r.lines.map((l, i) => {
          const it = state.catalog.items.find((x) => x.id === l.itemId);
          const name = pick(l.name, lang) || t.resItemGone;
          return (
            <li key={i} className="adm-line">
              <Thumb src={itemThumb(it)} alt="" className="adm-thumb-s" />
              <div className="adm-line-text">
                <span className="adm-line-name" dir="auto">{name}</span>
                <span className="adm-line-meta">
                  <bdi dir="ltr">{l.code}</bdi> · {l.variantLabel ? <span dir="auto">{pick(l.variantLabel, lang)}</span> : t.resOneSize} · <span className="adm-nowrap">{t.resQty} <bdi dir="ltr">{l.qty}</bdi></span>
                </span>
              </div>
              <div className="adm-line-price"><Price value={l.unitPrice} /></div>
            </li>
          );
        })}
      </ul>
      <p className="adm-res-total">{r.total == null ? t.resTotalOpen : <>{t.resTotal}: <Price value={r.total} /></>}</p>

      {r.status === "new" ? <p className="adm-hint">{t.resNewHint}</p> : null}
      <div className="adm-res-actions">
        {next ? <button type="button" className="adm-btn adm-btn-primary" disabled={busy} onClick={() => void setStatus(next)}>{actionLabel(next, t)}</button> : null}
        {closed ? <button type="button" className="adm-btn" disabled={busy} onClick={() => void setStatus("contacted")}>{t.resReopen}</button> : null}
        <button type="button" className="adm-btn adm-btn-quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t.resLess : t.resMore}</button>
      </div>

      {open ? (
        <div className="adm-res-more">
          <dl className="adm-dl">
            {r.customer.email ? (<><dt>{t.resEmail}</dt><dd><a href={`mailto:${r.customer.email}`} dir="ltr">{r.customer.email}</a></dd></>) : null}
            <dt>{t.resLang}</dt><dd>{langName}</dd>
          </dl>
          <div className="adm-field">
            <label className="adm-label" htmlFor={`note-${r.id}`}>{t.resPrivateNote}</label>
            <textarea id={`note-${r.id}`} className="adm-input" rows={2} dir="auto" value={note} placeholder={t.resPrivateNotePh}
              onFocus={() => setFocused(true)} onChange={(e) => { setNote(e.target.value); setNoteState(""); }} onBlur={() => void saveNote()} />
            <p className="adm-hint" aria-live="polite">{noteState === "saving" ? t.saving : noteState === "saved" ? `${t.saved} ✓` : noteState === "bad" ? t.errGeneric : " "}</p>
          </div>
          {!closed && (later.length > 0) ? (
            <div className="adm-field">
              <span className="adm-label">{t.resMoveTo}</span>
              <div className="adm-btnrow">
                {later.map((s) => <button key={s} type="button" className="adm-btn" disabled={busy} onClick={() => void setStatus(s)}>{actionLabel(s, t)}</button>)}
              </div>
            </div>
          ) : null}
          <div className="adm-field">
            <span className="adm-label">{t.resHistory}</span>
            <ol className="adm-timeline">
              {r.history.map((h, i) => (
                <li key={i}>
                  <bdi dir="ltr" className="adm-date">{dateTime(h.at, lang)}</bdi>
                  <span>{i === 0 && h.status === "new" ? t.histNew : i > 0 && r.history[i - 1].status === h.status ? t.histNote : statusLabel(h.status, t)}{h.note ? <> · <span dir="auto">{h.note}</span></> : null}</span>
                </li>
              ))}
            </ol>
          </div>
          {r.status !== "cancelled" && r.status !== "done" ? (
            <button type="button" className="adm-btn adm-btn-danger-quiet" disabled={busy} onClick={() => void setStatus("cancelled")}>{t.resCancel}</button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
