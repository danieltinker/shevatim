// Before the official launch the whole shop shows as "coming soon": every piece under the sand veil, no prices, no
// sizes, reserving closed, and a launch line in the bar on top. The database is not touched, so each piece keeps
// its own switch for after the launch.
// To launch: set PRELAUNCH to false, commit, push to main (Vercel redeploys).
import type { L10n } from "./types";

export const PRELAUNCH = true;

/** The line in the bar on top of every page while PRELAUNCH is on (it replaces the owner's announcement). */
export const PRELAUNCH_LINE: L10n = {
  he: "קולקציית מדבר עולה בקרוב",
  en: "The Midbar collection launches soon",
  fr: "La collection Midbar arrive bientôt",
};
