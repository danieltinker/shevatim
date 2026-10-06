"use client";
import { useEffect, useState } from "react";
import { useI18n } from "./Providers";

export const THEME_KEY = "shv-theme";
export type Theme = "light" | "dark";

/** Runs in the document head before the first paint, so the saved theme never flashes. Light is the default. */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");document.documentElement.dataset.theme=t==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`;

const current = (): Theme => (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light");

/** A small round button: sun in the dark theme (go to light), moon in the light theme (go to dark). */
export default function ThemeToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => { setTheme(current()); }, []);
  const flip = () => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { window.localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    setTheme(next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#231911" : "#F4EDE0");
  };
  const label = theme === "dark" ? t.theme.toLight : t.theme.toDark;
  return (
    <button type="button" className={`iconBtn ${className ?? ""}`} onClick={flip} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        {theme === "dark" ? (
          <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>
        ) : (
          <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
        )}
      </svg>
    </button>
  );
}
