"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { asset } from "@/lib/asset";
import type { AdminState } from "@/lib/types";
import { ApiError } from "@/lib/types";
import { api } from "./backend";
import { STRINGS, type AdminLang } from "./strings";
import { StoreCtx, errorSentence, isUnauthorized, type ConfirmOptions, type Store } from "./store";
import { Reservations } from "./Reservations";
import { Collections } from "./Collections";
import { Items } from "./Items";
import { SettingsScreen } from "./Settings";
import { Stock } from "./Stock";

const SESSION_KEY = "shv-admin-session"; // sessionStorage only: closing the tab signs the owner out
const LANG_KEY = "shv-admin-lang";
const SECTIONS = ["reservations", "collections", "items", "stock", "settings"] as const;
type Section = (typeof SECTIONS)[number];

const readHash = (): string[] => {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  return parts.length && (SECTIONS as readonly string[]).includes(parts[0]) ? parts : ["reservations"];
};
const readSession = (): string | null => { try { return window.sessionStorage.getItem(SESSION_KEY); } catch { return null; } };

export default function AdminApp() {
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<AdminLang>("he");
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<AdminState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [route, setRoute] = useState<string[]>(["reservations"]);
  const [toast, setToast] = useState<{ id: number; message: string; kind: "ok" | "bad" } | null>(null);
  const [ask, setAsk] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const t = STRINGS[lang];
  const tRef = useRef(t); tRef.current = t;
  const tokenRef = useRef<string | null>(null);
  const dirty = useRef(false);
  const routeRef = useRef(route); routeRef.current = route;

  // ── start: language, session, route
  useEffect(() => {
    let l: AdminLang = "he";
    try { if (window.localStorage.getItem(LANG_KEY) === "en") l = "en"; } catch { /* private mode */ }
    setLangState(l);
    const tok = readSession();
    tokenRef.current = tok; setToken(tok);
    setRoute(readHash());
    setReady(true);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  }, [lang]);
  const setLang = (l: AdminLang) => { setLangState(l); try { window.localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ } };

  const expire = useCallback((message: string | null) => {
    try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    tokenRef.current = null; dirty.current = false;
    setToken(null); setState(null); setLoadError(null); setNotice(message);
  }, []);

  const call = useCallback(async <T,>(fn: (token: string) => Promise<T>): Promise<T> => {
    const tok = readSession() ?? null;
    if (!tok || tok !== tokenRef.current) { expire(tRef.current.errSession); throw new ApiError("unauthorized"); }
    try { return await fn(tok); }
    catch (e) { if (isUnauthorized(e)) expire(tRef.current.errSession); throw e; }
  }, [expire]);

  const load = useCallback(async (quiet: boolean) => {
    if (!tokenRef.current) return;
    if (!quiet) setRefreshing(true);
    try {
      const s = await call((tok) => api.adminState(tok));
      setState(s); setLoadError(null);
    } catch (e) {
      if (!isUnauthorized(e) && !quiet) setLoadError(errorSentence(e, tRef.current));
    } finally { if (!quiet) setRefreshing(false); }
  }, [call]);

  useEffect(() => { if (token) void load(false); }, [token, load]);

  // automatic refresh every 60 s while the tab is visible (and when the owner comes back to the tab)
  useEffect(() => {
    if (!token) return;
    const tick = () => { if (document.visibilityState === "visible" && !dirty.current) void load(true); };
    const id = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [token, load]);

  // ── confirm dialog and toast
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setAsk({ ...o, resolve })), []);
  const answer = (v: boolean) => { ask?.resolve(v); setAsk(null); };
  const showToast = useCallback((message: string, kind: "ok" | "bad" = "ok") => {
    const id = Date.now();
    setToast({ id, message, kind });
    window.setTimeout(() => setToast((cur) => (cur && cur.id === id ? null : cur)), kind === "ok" ? 2200 : 6000);
  }, []);

  // ── in-page navigation by hash, guarded when a form has unsaved changes
  const leaveOk = useCallback(async () => {
    if (!dirty.current) return true;
    const x = tRef.current;
    const ok = await confirm({ title: x.unsavedTitle, body: x.unsavedBody, yes: x.unsavedLeave, no: x.unsavedStay, danger: true });
    if (ok) dirty.current = false;
    return ok;
  }, [confirm]);
  const go = useCallback((path: string) => {
    void (async () => { if (await leaveOk()) { window.location.hash = `#/${path}`; window.scrollTo(0, 0); } })();
  }, [leaveOk]);
  useEffect(() => {
    const onHash = () => {
      const next = readHash();
      if (next.join("/") === routeRef.current.join("/")) return;
      if (dirty.current) {
        const back = `#/${routeRef.current.map(encodeURIComponent).join("/")}`;
        window.history.replaceState(null, "", back); // stay, then ask
        void (async () => { if (await leaveOk()) { window.location.hash = `#/${next.map(encodeURIComponent).join("/")}`; } })();
        return;
      }
      setRoute(next);
    };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("beforeunload", onUnload);
    return () => { window.removeEventListener("hashchange", onHash); window.removeEventListener("beforeunload", onUnload); };
  }, [leaveOk]);

  const waiting = state ? state.reservations.filter((r) => r.status === "new").length : 0;
  useEffect(() => {
    document.title = token && waiting > 0 ? `(${waiting}) ${t.resNewWaiting} · ${t.appTitle}` : t.appTitle;
  }, [waiting, token, t]);

  const store = useMemo<Store | null>(() => {
    if (!state) return null;
    const upd = (f: (s: AdminState) => AdminState) => setState((s) => (s ? f(s) : s));
    return {
      lang, t, state, call, refreshing,
      refresh: () => load(false),
      putItem: (it) => upd((s) => {
        const others = s.catalog.items.filter((x) => x.id !== it.id);
        const had = s.catalog.items.some((x) => x.id === it.id);
        const items = it.status === "archived" ? others : had ? s.catalog.items.map((x) => (x.id === it.id ? it : x)) : [...s.catalog.items, it];
        return { ...s, catalog: { ...s.catalog, items } };
      }),
      dropItem: (id) => upd((s) => ({ ...s, catalog: { ...s.catalog, items: s.catalog.items.filter((x) => x.id !== id) } })),
      putCollection: (c) => upd((s) => {
        const had = s.catalog.collections.some((x) => x.id === c.id);
        let list = had ? s.catalog.collections.map((x) => (x.id === c.id ? c : x)) : [...s.catalog.collections, c];
        if (c.isCurrent) list = list.map((x) => (x.id === c.id ? x : { ...x, isCurrent: false }));
        return { ...s, catalog: { ...s.catalog, collections: list } };
      }),
      dropCollection: (id) => upd((s) => ({ ...s, catalog: { ...s.catalog, collections: s.catalog.collections.filter((x) => x.id !== id) } })),
      putReservation: (r) => upd((s) => ({ ...s, reservations: s.reservations.map((x) => (x.id === r.id ? r : x)) })),
      putSettings: (st) => upd((s) => ({ ...s, catalog: { ...s.catalog, settings: st } })),
      putCategory: (c) => upd((s) => ({ ...s, catalog: { ...s.catalog, categories: s.catalog.categories.map((x) => (x.key === c.key ? c : x)) } })),
      toast: showToast, confirm,
      errText: (e) => errorSentence(e, t),
      route, go,
      setDirty: (d) => { dirty.current = d; },
    };
  }, [state, lang, t, call, refreshing, load, showToast, confirm, route, go]);

  const signOut = async () => {
    if (!(await leaveOk())) return;
    const tok = tokenRef.current;
    if (tok) { try { await api.adminLogout(tok); } catch { /* signing out locally is enough */ } }
    window.history.replaceState(null, "", "#/reservations"); // the next sign-in starts at the reservations
    setRoute(["reservations"]);
    expire(t.signedOut);
  };

  const dialog = ask ? (
    <div className="adm-overlay adm-overlay-top">
      <div className="adm-confirm" role="alertdialog" aria-modal="true" aria-labelledby="adm-ask-title" aria-describedby="adm-ask-body">
        <h2 id="adm-ask-title">{ask.title}</h2>
        <p id="adm-ask-body">{ask.body}</p>
        <div className="adm-confirm-actions">
          <button type="button" className={`adm-btn ${ask.danger ? "adm-btn-danger" : "adm-btn-primary"}`} onClick={() => answer(true)}>{ask.yes}</button>
          <button type="button" className="adm-btn" autoFocus onClick={() => answer(false)}>{ask.no ?? t.cancel}</button>
        </div>
      </div>
    </div>
  ) : null;
  const toastEl = (
    <div className="adm-toast-wrap" role="status" aria-live="polite">
      {toast ? <div className={`adm-toast${toast.kind === "bad" ? " is-bad" : ""}`}>{toast.message}</div> : null}
    </div>
  );

  if (!ready) return <div className="adm" lang="he" dir="rtl" />;

  const langButton = (
    <button type="button" className="adm-btn adm-btn-quiet adm-lang" lang={lang === "he" ? "en" : "he"} onClick={() => setLang(lang === "he" ? "en" : "he")}>{t.langSwitch}</button>
  );

  if (!token) {
    return (
      <div className="adm" lang={lang} dir={lang === "he" ? "rtl" : "ltr"}>
        <Login t={t} notice={notice} langButton={langButton} onDone={(tok) => {
          try { window.sessionStorage.setItem(SESSION_KEY, tok); } catch { /* ignore */ }
          tokenRef.current = tok; setNotice(null); setToken(tok);
        }} />
      </div>
    );
  }

  const section = (route[0] as Section) ?? "reservations";
  const nav: { key: Section; label: string; icon: string }[] = [
    { key: "reservations", label: t.navReservations, icon: "M4 5h16v14H4z M4 9h16 M8 13h5" },
    { key: "collections", label: t.navCollections, icon: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z" },
    { key: "items", label: t.navItems, icon: "M8 4l-5 3 2 4 2-1v10h10V10l2 1 2-4-5-3c-1 2-5 2-6 0z" },
    { key: "stock", label: t.navStock, icon: "M3 8l9-4 9 4-9 4z M3 8v8l9 4 9-4V8 M12 12v8" },
    { key: "settings", label: t.navSettings, icon: "M4 7h10 M18 7h2 M4 17h2 M10 17h10 M14 5v4h4V5z M6 15v4h4v-4z" },
  ];
  const navLinks = (cls: string) => nav.map((n) => (
    <a key={n.key} href={`#/${n.key}`} className={`${cls}${section === n.key ? " is-active" : ""}`} aria-current={section === n.key ? "page" : undefined}
      onClick={(e) => { e.preventDefault(); go(n.key); }}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"><path d={n.icon} /></svg>
      <span>{n.label}</span>
      {n.key === "reservations" && waiting > 0 ? <bdi className="adm-badge" aria-label={`${waiting} ${t.resNewWaiting}`}>{waiting}</bdi> : null}
    </a>
  ));

  return (
    <div className="adm" lang={lang} dir={lang === "he" ? "rtl" : "ltr"}>
      <header className="adm-top">
        <a className="adm-wordmark" href="#/reservations" onClick={(e) => { e.preventDefault(); go("reservations"); }}>
          <span className="adm-mark" role="img" aria-label="Shevatim" style={{ ["--wm" as string]: `url("${asset("/media/brand/wordmark-white-600.png")}")` }} />
        </a>
        <nav className="adm-nav" aria-label={t.appTitle}>{navLinks("adm-nav-link")}</nav>
        <div className="adm-top-end">
          <a className="adm-btn adm-btn-quiet adm-viewsite" href={asset("/he/")} target="_blank" rel="noopener">{t.viewSite}</a>
          {langButton}
          <button type="button" className="adm-btn adm-btn-quiet" onClick={() => void signOut()}>{t.signOut}</button>
        </div>
      </header>
      <main className="adm-main">
        {!store ? (
          loadError ? (
            <div className="adm-panel adm-empty" role="alert">
              <p>{t.errLoad} {loadError}</p>
              <button type="button" className="adm-btn adm-btn-primary" onClick={() => void load(false)}>{t.retry}</button>
            </div>
          ) : <p className="adm-loading">{t.loading}</p>
        ) : (
          <StoreCtx.Provider value={store}>
            {section === "reservations" ? <Reservations /> : null}
            {section === "collections" ? <Collections /> : null}
            {section === "items" ? <Items /> : null}
            {section === "stock" ? <Stock /> : null}
            {section === "settings" ? <SettingsScreen /> : null}
          </StoreCtx.Provider>
        )}
      </main>
      <nav className="adm-tabbar" aria-label={t.appTitle}>{navLinks("adm-tab")}</nav>
      {dialog}
      {toastEl}
    </div>
  );
}

function Login({ t, notice, langButton, onDone }: { t: (typeof STRINGS)["he"]; notice: string | null; langButton: React.ReactNode; onDone: (token: string) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) { setError(t.loginEmpty); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.adminLogin(password);
      onDone(r.token);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(code === "bad_password" ? t.loginWrong : code === "too_many" ? t.errTooMany : code === "network" ? t.loginNoNet : t.errGeneric);
    } finally { setBusy(false); }
  };
  return (
    <main className="adm-login">
      <div className="adm-login-lang">{langButton}</div>
      <form className="adm-panel adm-login-box" onSubmit={submit} noValidate>
        <span className="adm-mark adm-login-mark" role="img" aria-label="Shevatim" style={{ ["--wm" as string]: `url("${asset("/media/brand/wordmark-white-600.png")}")` }} />
        <h1>{t.loginTitle}</h1>
        {notice && !error ? <p className="adm-notice" role="status">{notice}</p> : null}
        <label className="adm-label" htmlFor="adm-pw">{t.loginPassword}</label>
        <input id="adm-pw" className="adm-input" type="password" dir="ltr" autoComplete="current-password" autoFocus value={password}
          aria-invalid={error ? true : undefined} aria-describedby={error ? "adm-pw-err" : undefined}
          onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }} />
        {error ? <p id="adm-pw-err" className="adm-error" role="alert">{error}</p> : null}
        <button type="submit" className="adm-btn adm-btn-primary adm-btn-block" disabled={busy}>{busy ? t.loginBusy : t.loginButton}</button>
      </form>
    </main>
  );
}
