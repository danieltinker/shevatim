# Shevatim — design direction, version 2 ("Midbar")

Version 1 (black shop ground, chalk story ground, coloured tribe stones) is replaced. This version follows the
brand owner's notes of 6 Oct 2026, quoted in short:
"brown and beige, desert, sand, earth, nature; less black, and not many different colours (too much red, blue,
green, yellow now); a small, uniform palette"; "one strong message first, then the collections or main products,
only then more about the brand"; "more space between elements, less content in each area, clearer hierarchy,
buttons that lead simply to the shop, the collections and the products"; "some elements are too big and too
simple; more luxurious, minimal, desert, precise; less '100 things on the screen', more a fashion brand";
"gentle background music and some of the film's original sound, easy to mute"; "a small Light / Dark switch;
dark keeps brown, beige and earth, never plain black". He likes the motion on the title and wants it kept.

## Palette (the only colours on the site)
Two themes, set by `data-theme` on `<html>` (`light` is the default; the visitor's choice is remembered).
| Token | Light ("day") | Dark ("night") | Use |
|---|---|---|---|
| `--bg` | `#F4EDE0` cream sand | `#30241A` walnut earth | page ground |
| `--surface` | `#EBE0CD` warm beige | `#3A2D21` | alternate sections, cards, the header once scrolled |
| `--stage` | `#DACBB1` dune | `#48382B` | behind product pictures (they are cut-outs with transparency) |
| `--fg` | `#33261B` earth | `#F2E8D8` cream | text |
| `--muted` | `#625341` | `#B9A78F` | secondary text |
| `--accent` | `#784B25` clay | `#D5AC7A` sand gold | kept as a token; never a hover or selection signal (today it is unused) |
| `--accent-ink` | `#FBF6EC` | `#30241A` | text on an accent fill |
| `--sage` | `#56633D` desert sage | `#AAB88A` | every hover, every current or chosen state, the focus ring |
| `--sage-ink` | `#FBF6EC` | `#30241A` | text on a sage fill |
| `--sage-soft` | `rgba(86,99,61,.12)` | `rgba(170,184,138,.16)` | a faint sage wash under a hovered or chosen control |
| `--sage-on-film` | `#AAB88A` | `#AAB88A` | the sage of hovers and the current page in the header over the film |
| `--line` | `rgba(51,38,27,.16)` | `rgba(242,232,216,.16)` | hairlines |
| `--line-strong` | see `app/globals.css` | | borders of inputs and outlined buttons |
| `--warn` | `#8C3B1F` burnt clay | `#E9A587` | form errors only |
| `--on-film` | `#F2E8D8` | `#F2E8D8` | text and controls laid over the hero film, in both themes |
No black (`#000`) and no pure white anywhere, in either theme. No blue, red or yellow in the interface, and
the only green is the desert sage that answers the visitor (hover, current, chosen, focus): the tribes are no
longer colour-coded. Otherwise the only "colour" is what the photographs and the cloth bring.
Text contrast: body and secondary text at least 4.5:1 on `--bg`, `--surface` and `--stage`, in both themes.

## The tribes without colours
- A tribe stone is a quiet pill: `--surface` ground, hairline border, the Hebrew name in Frank Ruhl (and the Latin
  name small underneath in English and French). Hover: sage edge, sage text, a `--sage-soft` wash. The selected
  stone (home plate, collection strip, shop filter chip) is filled with `--sage`, text `--sage-ink`. All twelve
  look the same otherwise.
- Tribe names in display type are `--fg`. No flag-colour text, no colour bar, no colour swatch.
- The flag colour, emblem and stone of each tribe remain as words on the tribe's own page (they are tradition,
  not decoration).

## Type
- Frank Ruhl Libre for display, Hebrew and verses; Heebo for interface and body. Unchanged.
- Smaller and more exact than version 1: display (tribe name, collection name) `clamp(40px, 6.4vw, 104px)`,
  h1 `clamp(32px, 4.2vw, 60px)`, h2 `clamp(22px, 2.3vw, 34px)`, h3 `clamp(18px, 1.5vw, 22px)`,
  body 16–17px, small 13–14px. Display weight 500–600 (not 800). Line-height: display 1.0–1.1, body 1.6.
- Section labels: small (13px), `--muted`, sentence case, generous space above the heading they introduce.
- Sentence case everywhere; no all-caps, no letter-spaced Latin, no decorative separators.

## Space and rhythm
- One idea per screen. Section padding `clamp(88px, 11vw, 176px)` top and bottom; never two dense blocks side by
  side. Text blocks at most 56ch. Grids: 2 columns on phones, 3 on tablets, 4 on desktop, gaps 20–40px.
- Soft corners everywhere, never a square box; the radii are tokens in `app/globals.css`, never hardcoded:
  `--r-card` (20px) for large boxes (product stage, item stage, category tiles from tablets up, About and crew
  pictures, the reserve form card, the 3D stage); `--r-box` (14px) for small ones (thumbnails, form fields, the
  bag thumbnail, notes, the receipt box, lookbook cells, picture tiles on phones); `--r-pill` for buttons, tribe
  stones, filter chips, size options, the quantity control and the language links. A picture inside a rounded
  box is clipped by it (`overflow: hidden`), and focus rings follow the rounded shape.
- No shadows on boxes; no gradients as decoration. A cut-out picture may carry one soft ground shadow.
- Sections alternate only between `--bg` and `--surface`; the change is barely visible. No hard black/white flips.

## Home page, in this order (nothing else)
1. **Hero**: the film, full viewport, with a warm earth shade at the bottom (not black). The wordmark (cream),
   the one line (settings.heroLine), ONE button: to the collection. Small round controls at the bottom corner:
   sound and pause. The title's entrance motion stays. No stone strip, no second button, no tiles on this screen.
2. **The collection**: small label, the collection's name, one sentence, four pieces, one button "See the
   collection" and a quiet text link "All pieces" (the shop).
3. **Shop by category**: the six categories as a compact index of small picture tiles (six in one row on
   desktop, three across below). They are smaller than the product tiles above them: the products lead.
4. **The twelve tribes** (the brand's idea, told calmly): heading and two sentences; the twelve stones; for the
   chosen tribe its name, ONE verse (Hebrew with nikud; translation and reference under it in English and French),
   two lines about the tribe, and two quiet links: "The pieces of <tribe>" and "The story of <tribe>". No product
   tiles inside this section. All twelve are also listed on `/tribes/`, where the header's "Tribes" link leads.
5. **Lookbook**: one dense, continuous mosaic from edge to edge (the page max width does not apply): eleven
   picked sand-and-cliff campaign pictures (ten on phones) in big 2x2, tall 1x2, wide 2x1 and single cells,
   6–10px seams, every row filled, `--r-box` corners. Four columns and five rows from 640px, two columns and
   eight rows on phones. The cells keep their shape at every width (row height follows the width).
6. **The crew**: three sentences and a row of four pictures.
7. **How reserving works**: three steps, then the tzitzit verse.
8. Footer.
The live 3D cloth leaves the home page; it stays on each tzitzit's own page.

## Shop pages
- Header: `--bg` (transparent over the hero film, with a warm shade behind it), one hairline. Wordmark centred,
  drawn in `--fg` (use the wordmark PNG as a CSS mask so it follows the theme). Start side: menu (phones) or
  three links. End side: language, theme switch, sound, bag. On phones the header shows menu, wordmark, sound,
  bag; language and theme sit in the top bar of the menu and in the footer.
- Product tile: the cut-out on a rounded `--stage` box (3:4, a little padding so the garment does not touch the
  edge), then the name (15px, 500) and the price when there is one. Hover on pointer devices swaps to the second
  picture, lifts the box 3px with a 1px sage ring, and turns the name sage. Category tiles do the same.
- Item page: the stage is a rounded `--stage` box (inside the gutter on phones and tablets); thumbnails are small
  rounded `--stage` tiles, the one on show with a sage edge on a sage wash; the form column is calm: category
  label, name (h1 size), price or the pending-price sentence, size options (outlined pills; hover = sage edge
  and text; selected = sage fill, `--sage-ink` text), one filled button. The 3D section below it sits on
  `--surface` with the canvas on a rounded `--stage` box.
- Buttons are pills: filled = `--fg` ground with `--bg` text, ghost = outline. Hover: the filled one takes a sage
  ground with `--sage-ink` text; the ghost takes a sage edge and text on a sage wash. One filled button per view.
- Reserve pages, about, terms, tribe pages: same grounds and type; nothing coloured.

## Hover, current, chosen, focus: always sage
- Text links (header, footer, menu, quiet links, `.link`): sage text and a sage underline under the pointer.
  At rest `.link` and quiet links carry a hairline underline (`--line-strong` / `--line`).
- The header's current page: a 2px sage underline. The current language: sage text, sage underline. The shop's
  current category tab: sage text on a sage line. Over the film the header uses `--sage-on-film`.
- Chosen controls: tribe stone and shop chip filled sage; size option filled sage; thumbnail sage edge.
- Round icon buttons and the slider arrows: sage colour (and a `--sage-soft` disc / wash) under the pointer.
- Form fields: sage edge under the pointer and in focus.
- Keyboard focus: `outline: 2px solid var(--sage); outline-offset: 3px` everywhere (one rule in globals.css);
  on product and category tiles the ring sits on the rounded picture box.
- Every transition is short (.2–.35s) and switched off under `prefers-reduced-motion`.

## Sound
Off until the visitor turns it on (browsers do not allow sound before a tap). One round button (speaker) in the
header and on the hero: on = the film's own sound while the hero is on screen, plus a very quiet looping
background track across the site; off = silence at once. The choice is remembered. The track pauses when the tab
is hidden. `components/site/Sound.tsx` owns all of it. The levels live in the files (film sound about -21 LUFS,
track about -28 LUFS), because iPhones play every file at full level whatever the page asks for.

## Theme switch
One small round button (sun / moon), `components/site/Theme.tsx`. It sets `data-theme` on `<html>` and remembers
the choice. An inline script in the document head applies the saved theme before the first paint.

## Motion
The hero title's entrance stays. Elsewhere motion only answers an action (slide change, hover swap, menu).
`prefers-reduced-motion` is respected everywhere.

## Words
Unchanged from version 1: plain, warm, short; Hebrew first; prices are never invented.
