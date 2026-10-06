const BASE = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
/** Prefix a site-relative path ("/media/…") with the base path; absolute URLs pass through. */
export function asset(path: string): string {
  if (/^(https?:)?\/\//.test(path) || path.startsWith("data:") || path.startsWith("blob:")) return path;
  return `${BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}
