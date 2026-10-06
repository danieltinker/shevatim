# Shevatim — design direction (decided by the lead; builders follow it)

## The brand, from its own material
Shevatim (שבטים, "tribes") makes hooded, poncho-cut tzitziyot and desert streetwear: cream and striped woven
cloth, fringe and tassels, gold sequin trim, tzitzit strings with a blue (tekhelet) thread. The campaign was shot
in the Judean desert: chalk-white marl cliffs, a camel, a shofar, a turquoise motorbike, friends laughing.
The wordmark is an ornate, gothic "SHEVATIM" (white on black or black on white PNG, `/media/brand/`).
Product pictures are "ghost" shots: the item alone on pure black, no model.
Reference the designer likes: idolstudios.co — a clean, quiet shop: full-bleed imagery, product grids,
almost no decoration. Ours must feel more Jewish: Hebrew-first, the twelve tribes, verses, the Choshen stones.

## Concept: night studio, day desert
Two grounds, alternating by purpose.
- **Black** `#000` is the shop: product tiles sit on it with no tile edge (the pictures are on black), so the
  items float. Header, hero, grids, item page, bag: black.
- **Chalk** `#E9E5DC` (the marl of the cliffs, a cool limestone white, not cream) is the story: the tribes
  slider, verses, the crew, how reserving works.
- Text: bone `#F3EFE7` on black, ink `#0B0A09` on chalk. Secondary text: `#A9A49A` on black, `#5D584F` on chalk.
- One accent: **tekhelet** `#2F5FA8` on chalk, `#8FB2E6` on black. It marks links, focus rings, the active
  control. Nothing else is coloured, except inside a tribe's own slide or page, where that tribe's flag colour
  (from `content/tribes.json`, `flag.hex`) may tint the tribe name and its stone.
- Hairlines: `rgba(243,239,231,.16)` on black, `rgba(11,10,9,.14)` on chalk. No shadows, no gradients as
  decoration, no rounded cards. Radius 0 everywhere except the Choshen stones (2px) and round icon buttons.

## Type
- **Frank Ruhl Libre** (variable, `@fontsource-variable/frank-ruhl-libre`): Hebrew and Latin display, and all
  Bible verses (Hebrew with nikud). Big, weight 500–800. This is the "Jewish" voice: the face of printed
  Hebrew books, used at fashion scale.
- **Heebo** (variable, `@fontsource-variable/heebo`): interface and body, 400/500/600.
- Scale (clamp between phone and desktop): display 56→168px (tribe names), h1 40→88, h2 28→48, h3 20→26,
  body 16→17, small 13→14. Line-height: display 0.9–1.0, headings 1.1, body 1.55 (verses 1.7).
- No all-caps eyebrow labels, no letter-spaced Latin caps, no "→" glued to link text, no middle-dot strings as
  decoration (a separator inside a product name is fine). Sentence case in English and French.
- Hebrew: numbers, prices, codes, phone numbers and Latin words inside Hebrew text are wrapped in
  `<bdi>`/`dir="ltr"` so they never reorder. Prices: `₪` before the number in all languages, e.g. `₪ 480`.

## Signature: the Choshen
The breastplate's twelve stones, four rows of three, are the tribe navigator. Each stone is a small rectangle
filled with the tribe's flag colour (Zevulun's pearl grey and Binyamin's jasper as given), with the tribe name
set inside in Frank Ruhl. It appears (1) as a thin strip of twelve under the hero, (2) as the 4×3 grid that
drives the tribes slider, (3) as filter chips on category pages. This is the one bold element. Everything
around it stays quiet.

## Layout
- Header (black, sticky, 56px phone / 64px desktop): wordmark centred; on the inline-start side a menu button
  (phone) or text links (desktop: collection, tribes, shop categories); on the inline-end side the language
  switch (עב / EN / FR) and the bag with its count. Over the hero the header is transparent, then turns black.
- Optional announcement bar above the header (from settings), one line, 32px.
- Page gutters: 16px phone, 32px tablet, 48px desktop. Max text measure 62ch. Grids: 2 columns phone,
  3 tablet, 4 desktop; 1px gaps are not used: use 16–24px gaps on black.
- Product tile: picture 3:4, then the name (Heebo 15/500) and the price or "price on confirmation" (13px,
  secondary). Hover (pointer devices only): swap to the second picture. No badges except "sold out".
- Everything is mirrored for Hebrew (`dir="rtl"`): use logical CSS properties only (`margin-inline`, `inset-inline`,
  `text-align: start`), never left/right.

## Home page, in order
1. **Hero film**, full viewport. Desktop: `/media/hero/hero-desktop.mp4` (16:9). Phone: `hero-mobile.mp4`
   (9:16). Muted, looped, `playsinline`, poster first, no controls except a small pause/play button (inline-end,
   bottom). Wordmark large, centred low; under it the hero line (settings.heroLine) and one button: "Reserve
   from the collection" → the current collection. A soft black gradient only at the very bottom for legibility.
   If `prefers-reduced-motion`, show the poster only.
2. **Choshen strip**: twelve stones in a row (scrolls sideways on phones), each jumps to that tribe's slide.
3. **The collection** (black): its name large, its two-sentence description, four tiles (the first tzitzit of
   Yehuda, Asher, Gad, Shimon), link "See all twelve tribes".
4. **Tribes slider** (chalk): see below.
5. **Touch the cloth** (black): the live 3D tzitzit (`components/cloth`), with a one-line invitation to drag it.
6. **Categories** (black): tiles for each visible category; where a clip exists (`content/media.json` → clips)
   the tile plays it muted on hover/in view; otherwise a picture.
7. **Lookbook** (black, full-bleed pictures from media.json → lookbook): an editorial strip; sideways scroll on
   phones, a 12-column collage on desktop. No captions.
8. **The crew** (chalk): the team pictures (media.json → team) and three short sentences about who makes
   Shevatim. The user asked for the team pictures to come after the film and the home content.
9. **How reserving works** (chalk): three real steps (choose, leave your details, we contact you to confirm
   size, price and delivery). Numbered, because it is a sequence. Then the tzitzit verse (Numbers 15:39).
10. Footer (black): wordmark, category links, language, WhatsApp / Instagram / e-mail when set, small legal links.

## Tribes slider
One tribe per slide, twelve slides, order from `tribes.json`.
- Inline-start: the tribe name huge (Frank Ruhl 800, in the tribe colour; Zevulun and any colour that fails
  3:1 on chalk falls back to ink with a colour underline), the stone (Hebrew name + gloss) and the flag
  emblem as one quiet line, then "essence".
- Centre: the verses. Hebrew with nikud always shown (Frank Ruhl 500, 24→34px, line-height 1.7,
  `dir="rtl" lang="he"`); in English and French the translation follows under each verse in Heebo, with the
  reference. In Hebrew only the Hebrew and the reference.
- Inline-end / below: "the tribe's five": up to five tiles from the current collection's slots for this tribe,
  and a link to the tribe's page.
- Controls: the 4×3 Choshen (desktop: beside the slide; phone: a sideways strip above), previous/next buttons,
  swipe, arrow keys, and the URL hash (`#reuven`). The slide change is a short cross-fade + 12px slide; no autoplay.

## Motion
One orchestrated moment: the hero (wordmark and line fade up once). Elsewhere motion only answers an action
(slide change, tile hover swap, bag drawer). Respect `prefers-reduced-motion` everywhere.

## Words
Plain, warm, short. Hebrew is the source language; English and French are written naturally, not translated
word for word. Buttons say what happens: "Add to reservation", "Send reservation". Errors say what went wrong
and what to do. No price is ever invented: an item without a price shows "price confirmed when we contact you".
