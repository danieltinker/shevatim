# Shevatim shop — build contract

Read this and `docs/DESIGN.md` before writing anything. Launch target: a working, polished, trilingual
(Hebrew default, English, French) shop where people **reserve** items (no card is charged), plus a back office
where the owner attaches items to collections and tribes, renames and prices them, and handles reservations.

## Architecture (fixed)
- **Static export** of Next.js 16 (App Router, React 19, TypeScript, `output: "export"`, `trailingSlash: true`).
  There is NO server: no route handlers, no server actions, no middleware/proxy, no `headers()`, no cookies on
  the server, no `next/image` optimisation. Every page must prerender to a static file. Pages that depend on
  data or on the query string are client components that read the catalogue in the browser.
  Next 16 notes: `params` is a Promise in pages/layouts (`const { locale } = await params`); dynamic segments
  need `generateStaticParams`; `useSearchParams` must sit under `<Suspense>`. Docs: `node_modules/next/dist/docs/`.
- **Base path**: the site may be served from a sub-folder. `process.env.NEXT_PUBLIC_BASE_PATH` ("" locally).
  `next/link` adds it by itself; for every other URL you write (pictures, video, fonts, `fetch` of a public file)
  use `asset("/media/…")` from `lib/asset.ts`. Never hard-code a leading `/media/...` in `src`/`poster`/CSS url().
- **Backend**: Postgres functions behind a PostgREST endpoint (Supabase in production). The browser calls
  `POST {NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/<fn>` with the public key. `lib/api.ts` is the only file that
  touches the network; its exported functions and `lib/types.ts` are the contract. Locally `npm run db` starts
  `scripts/dev-db.mjs`: the same SQL on an embedded Postgres (pglite) behind the same URLs on
  `http://localhost:54321`, seeded from `db/seed.json`.
- The storefront must render with the database unreachable: it starts from `content/catalog.snapshot.json`
  (same shape as `Catalog`), then refreshes from `getCatalog()`. Only reserving and the back office need the
  database; when it is down they say so plainly.

## Who owns what (do not edit files outside your area; note needed changes in your report)
| Area | Paths |
|---|---|
| Backend | `db/**`, `scripts/dev-db.mjs`, `tests/**`, internals of `lib/api.ts` (signatures are frozen) |
| Storefront | `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/[locale]/**`, `components/site/**`, `lib/i18n.ts`, `lib/asset.ts`, `lib/catalog.ts`, `lib/bag.ts`, `lib/format.ts`, `content/i18n/**` |
| Back office | `app/admin/**`, `components/admin/**`, `lib/resize.ts` |
| Product pictures | `public/media/items/**`, `scripts/pictures/**` |
| 3D cloth | `components/cloth/**`, `cloth-lab/**` |
`lib/types.ts`, `content/tribes.json`, `content/tribes-intro.json`, `content/media.json`, `db/seed.json`,
`db/picture-sources.json` and `docs/**` are the lead's: read-only. `package.json`: you may add a dependency you
truly need; say so in your report.

## Data
- `lib/types.ts`: `Catalog`, `Item`, `Collection`, `Category`, `Settings`, `Picture`, `Reservation`, …
- Money is agorot (integer, ILS × 100). `price: null` means "not priced yet": show
  he "המחיר יאושר כשניצור קשר" / en "Price confirmed when we contact you" / fr "Prix confirmé lors de notre prise de contact".
  A reservation's total is null when any line has no price.
- A `Picture` is pre-sized copies: `${base}-${size}.${ext}`. Helper to write (storefront): `pictureUrl(p, wanted)`
  → nearest size ≥ wanted, with `asset()` applied when `base` starts with "/"; `pictureSrcSet(p)`.
- Tribes: `content/tribes.json` (12, fixed order, trilingual, verses). Tribe keys are `TribeKey`.
- A collection has `slots[tribe] = [itemId…]` (the "mini collection" of that tribe, up to `settings.slotsPerTribe`).
  An item can sit in several collections and tribes. `item.tribe` is only its "home" tribe (may be null).
- Categories: tzitziyot, shirts, pants, necklaces, bracelets, kippot (kippot has no items yet: show the
  category with a calm "coming soon" state). Tzitziyot come as two variants: adult (one size) and kid (one size).
- Seed: 61 real items with working names and NO prices (nobody gave prices; never invent one), one published
  collection "Midbar" marked current with five items per tribe.

## Media (`content/media.json`, files under `public/media/`)
`hero.desktop{mp4, mp4_720, poster}`, `hero.mobile{mp4, poster}`; `clips[]{key, mp4, poster, w, h, about}`;
`lookbook[]` and `team[]` are `Picture`s with extra `source` and `pick: boolean` (the lead's first selection:
use the picked ones first); `brand{wordmarkWhite, wordmarkBlack, …Small, wordmarkAspect, og}`.
Item pictures: `/media/items/<code>/<view>-{480,960,1600}.webp` (3:4). Right now they are on-model placeholders;
they are being replaced by clean item pictures on black at the same paths. Design for an item floating on black.

## Routes (all prerendered)
`/` (redirects in the browser to the saved or default language, `/he/`) · `/[locale]/` home ·
`/[locale]/collection/` (current collection, or `?c=<slug>`) · `/[locale]/tribes/[tribe]/` (12) ·
`/[locale]/shop/` (`?cat=<key>&tribe=<key>`) · `/[locale]/item/?i=<slug>` · `/[locale]/reserve/` (bag + form) ·
`/[locale]/reserve/done/?code=<code>` · `/[locale]/about/` · `/[locale]/terms/` · `/admin/` (back office, one
client-side app with its own in-page navigation via the hash, `noindex`).
`<html lang dir>` must be right for each language (he → rtl). Because the root layout is shared, set `lang`/`dir`
from the `[locale]` segment (root layout renders `<html>` only inside `app/[locale]/layout.tsx` and
`app/admin/layout.tsx`, i.e. two root layouts via route groups, or one root layout with a tiny inline script):
pick the approach that gives correct static HTML per language.

## Reserving (the launch flow)
Bag in `localStorage` (item id, variant key, qty). Form: full name, phone (required, Israeli or international),
e-mail (optional), note (optional), a hidden honeypot field `website`. Submit → `createReservation` → the done
page shows the code (e.g. SHV-4K7Q), what was reserved, and what happens next ("we contact you within a day to
confirm size, price and delivery; nothing is charged now"). If `settings.whatsapp` is set: a button that opens
WhatsApp to the shop with the reservation code and lines prefilled. If `settings.calLink` is set: a button
"Book a call / fitting" that opens it in a new tab. Handle errors: `invalid`, `closed`, `item_unavailable`,
`too_many`, `network`.

## Quality bar
- Works at 360, 390, 768, 1440 wide and a 1470×745 laptop, in all three languages, RTL correct.
- Keyboard reachable, visible focus, real buttons/links, alt text, `prefers-reduced-motion` respected, AA contrast.
- No layout shift from media (set aspect ratios), lazy-load below the fold, video `preload="metadata"`.
- No console errors. `npm run typecheck` and `npm run build` pass.
- Check your own work with Playwright screenshots (Chromium is at `/opt/pw-browsers`; do not run
  `playwright install`) and LOOK at them. Fix what looks wrong before you report. Never claim something was
  checked if it was not.
