# Shevatim shop — status and handover

State as of 6 Oct 2026, 09:30 UTC. Built by Halom for the Shevatim brand.

## Redesign "Midbar" (branch `desert`, 6 Oct 2026): waiting for approval
Made after the brand owner's notes on the first version (too black, too many colours, crowded home page, wanted
sound and a light/dark switch). Design rules: `docs/DESIGN.md`. It is **not on the live site yet**: Vercel builds
every push to `desert` as a preview (https://shevatim-git-desert-danielb534-6388s-projects.vercel.app, behind
the Vercel login); merging `desert` into `main` puts it live. The preview has no database address (the two
variables are set for Production only), so it shows the built-in catalogue and cannot take a reservation.
- Palette: cream sand, beige, dune, clay and earth only. Light theme by default; a small sun/moon button switches
  to a walnut-brown dark theme (remembered per visitor). The tribes are no longer colour-coded.
- Home page order: film with one line and one button, the collection (four pieces), a compact row of the six
  categories, the twelve tribes (one verse each), lookbook, the crew, how reserving works. The 3D cloth moved to
  the tzitziyot's own pages. New page `/tribes/` lists all twelve.
- Product pictures are transparent cut-outs on a dune ground (no black boxes). All 96 3D stills were re-rendered.
- Sound: off until the speaker button is tapped. Then the film's own sound plays while the film is on screen and
  a quiet background loop plays across the site. The loop is an original, generated piece
  (`scripts/audio/midbar_ambient.py`); the film's sound was cut from the camera originals, shot by shot
  (`~/Documents/shevatim/_halom_work/hero_audio/`).
- Back office and site icons follow the same palette.
Not done / to check by a person:
- **Nobody has listened to the sound.** Levels were measured (film about -21 LUFS, loop about -28 LUFS), but the
  film's original sound may contain crew talk or wind, and the loop may simply not be to the owner's taste.
- Not tried on a real iPhone or in Safari (the wordmark is drawn with a CSS mask; sound rules differ on iOS).
- Some photo cut-outs are still rough (ls10 back, ls14 front, ls02 front, ls16, tz13 back, tz26 back, tz29);
  cream garments are low in contrast on the sand ground.
- The six category pictures are crops of campaign pictures and film stills, not product shots.

## Stock and "coming soon" (branch `desert`, 8 Oct 2026): built, database step not applied
- Back office → **Stock** (`#/stock`): per piece and size, how many the owner has in the studio. Sizes start
  "not counted" and behave as before (no limit). A counted size: − / + buttons, or type the number and Update;
  shows free to reserve, held by open reservations, handed over; "stop counting" returns it to no limit; a history
  of every change (count, by hand, reserved SHV-…, back from a cancellation). Filters: out, few left, not counted.
  The number typed is free + held, so the owner counts the shelf; it cannot go below what open reservations hold.
- Reservations take counted pieces at once (refused when not enough); cancelling gives them back; reopening a
  cancelled reservation takes them again or stays cancelled. Reservations made before counting give nothing back.
- The shop sees only availability: a size at 0 shows "· sold out" and cannot be chosen, all sizes at 0 = sold out,
  and the last one or two say "last one" / "2 left". The owner's numbers never reach the shop.
- Item editor → **Coming soon** switch (saved with the item). In the shop the card gets the approved "sand veil"
  (option B): the picture faded under sand, "coming soon · next drop", no price; the piece page has no price, no
  sizes, no button, and a WhatsApp "ask about it" link when WhatsApp is set. Reservations refuse it.
- Database: `db/004_stock.sql` (tables `stock`, `stock_moves`, column `items.coming_soon`, new public function
  `shv_admin_stock`). Backward compatible with the live code. **Order to go live:** apply 004 to Supabase (run it in
  the SQL editor; it has no destructive statements), then merge `desert` → `main`, then set "pieces per tribe" to 24.

## Where everything is
| Thing | Where |
|---|---|
| Live site | https://shevatim.vercel.app (Vercel project `shevatim`, team "danielb534-6388's projects", preset Next.js, repository root) |
| Code | GitHub `danieltinker/shevatim` (private), branch `main`. Every push to `main` redeploys production. |
| Back office | https://shevatim.vercel.app/admin/ |
| Database | Supabase project `halom-studio` (`zemdhczqlhkabfwxccqq`), private schema `shevatim`, four public functions `shv_catalog`, `shv_reserve`, `shv_admin_login`, `shv_admin` (a fifth, `shv_admin_stock`, comes with `db/004_stock.sql`). Pictures the owner uploads go to the bucket `shevatim-media`. |
| Build variables | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_KEY` (publishable key). Share previews follow the Vercel production domain by themselves; set `NEXT_PUBLIC_SITE_URL` only to pin another address. |
| Source media | `~/Documents/shevatim` on the founder's Mac, sorted into `01_brand` … `06_other` (`SORTING.md`, `sorting_manifest.csv`). |
| Earlier build history | branch `shevatim` of `danieltinker/halom-models` (up to 6 Oct 2026, before this repository existed). |

## What is live
- Hebrew (default, right to left), English and French; language switch keeps the page.
- Home: hero film (desktop and phone cuts), the twelve stones, the current collection, the tribes slider with verses,
  the playable 3D cloth, category tiles, lookbook, the crew, how reserving works.
- 61 items from the fitting-room pictures: 32 tzitziyot (adult / kid, one size each), 18 long-sleeve shirts,
  7 tees, 2 pants, 1 necklace, 1 bracelet; kippot shows "coming soon". Collection "Midbar": 12 tribes × 5 items.
- Reserving: bag, form (name, phone, optional e-mail and note), a code such as `SHV-4K7Q`. Nothing is charged.
- Back office: reservations by status, items (names in three languages, prices, sizes, pictures, sold out),
  collections with the 12 × 5 board, categories, settings (WhatsApp, e-mail, Instagram, cal.com link,
  announcement, open/closed).

## Open, in order of urgency
1. **Back-office password**: Daniel reports it was set on 6 Oct (SQL Editor, `shevatim.set_admin_password`). Not
   re-checked from here; log in once at `/admin/` to confirm.
2. **Contact details are empty**: WhatsApp, e-mail, Instagram, cal.com link. Until they are set in the back
   office, the footer shows no contact and the confirmation page has no WhatsApp or booking button.
3. **No reservation has been placed on the live site yet.** The database functions were exercised from a real
   browser (catalogue 200, refusal of bad input), but the full form has only been run against the local copy.
   Place one from a phone and check it appears in the back office.
4. **Prices**: none were given, so none were invented. Every item says the price is confirmed on contact.
5. **Payments**: the shop takes reservations only. A cal.com link, once set, shows as "book a call / fitting".
   Charging money online is not built.
6. **Hosting plan**: the Vercel team is on Hobby, which does not allow commercial use. Move to Pro (or the
   client's own account) before promoting the shop. No custom domain is attached yet.
7. **Database tenancy**: Shevatim's data sits in Halom's own Supabase project next to other Halom tables.
   Fine for launch; a paying client's shop should move to its own project.
8. **Terms page** is a template, not legal text; there is no business name, address or company number on the site.

## Pictures: what was done and what needs a reshoot
- Product pictures are the fitting-room photographs with the model removed, on black, plus three 3D renderings
  for each tzitzit (cloth scanned from the photograph). 26 of 32 tzitziyot have a rendering as their first
  picture; the item page says it is a rendering.
- 16 damaged cut-outs were taken out of the lists on 6 Oct (holes, leftover body parts, sliced hems). Nine
  shirts are down to one picture: ls01, ls02, ls07, ls10, ls11, ls12, ls13, ls14, ls16.
- Not on black: the bracelet (a soft video frame on a wrist, indoors) and the necklace (on a table). They are
  the only pictures of those items.
- Reshoot first: br01, ne01, ls16, ls10, ls11, te06, te07, tz13, tz25, tz26. Shoot flat or on a hanger against
  black, whole garment in frame, hands out of the hem.
- The hero film shows another brand's logo ("FARANG") on a T-shirt sleeve in the opening shot.

## The 3D cloth: what it is and its limits
- A cloth simulation (XPBD: position-based dynamics with compliance, after Matthias Müller's "Ten Minute
  Physics") on a mesh built per cut: hooded poncho, poncho, cropped. Fringe, tassels and the tzitzit strings
  are simulated strands. Dragging pulls with a capped force; threads cannot stretch more than about 10% past
  their settled length; two seconds after release the garment eases back if it is still out of place; a reset
  button appears after the first touch. On phones a vertical swipe scrolls the page, a sideways drag or a
  press-and-hold grabs the cloth.
- Limits: no cloth-on-cloth collision (a hard shake lets the front panel pass through itself); striped and
  ornamented fabrics are mirrored at the centre seam; all 32 tzitziyot use three meshes; measured only on
  software rendering and once on an Apple M5 (60 frames a second at rest). Not measured on a phone.

## Checks that were run
- `npm run typecheck`, `npm test` (83 tests on the SQL and the HTTP layer), `npm run build`: pass.
- Three cold reviews on 6 Oct (design, QA, wording and verses), then fixes. Their numbers are in the project
  notes; the fixes were verified one by one, but no second cold review was run after them.
- Verses: all 32 distinct verses compared with Sefaria letter by letter; Hebrew and references are exact.
- Not done: real iPhone or Android, Safari, Firefox, a screen reader, a reservation on the live site, picture
  upload on the live site, the rate limits behind Vercel and Supabase's edge.

## Owner decisions still open (wording and facts)
- "ציצית פשתן לבנה / White linen tzitzit" (tz13): confirm the real fabric (linen with wool strings raises a
  shaatnez question).
- "פתיל תכלת / tekhelet": real tekhelet dye, or a blue thread?
- Nothing on the site says whether the tzitziyot are tied and checked as kosher. One sentence from the owner.
- The shirts' name "זה מעשה שלי" is rendered "My Story" / "Mon histoire".
- "שריון" as a noun also reads as "armour"; the verb "לשריין" is clear.
- Shimon and Levi open with Jacob's rebuke (Genesis 49:5); a blessing verse could lead instead.
- Stones and flag colours follow Bamidbar Rabbah 2:7; other sources order them differently. The tribe page
  names the source.

## Working on it
`npm install`, `npm run db` (local database on port 54321, back-office password `shevatim-dev-password`),
`npm run dev`. The catalogue the site starts from is `content/catalog.snapshot.json`; the database is seeded
from `db/seed.json` (`npm run seed` rewrites `db/003_seed.sql`). After changing SQL functions on Supabase, check
the grants (`db/README.md`).
