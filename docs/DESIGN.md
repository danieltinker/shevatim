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
| `--bg` | `#F4EDE0` cream sand | `#231911` deep earth | page ground |
| `--surface` | `#EBE0CD` warm beige | `#2D2118` | alternate sections, cards, the header once scrolled |
| `--stage` | `#DACBB1` dune | `#3B2C20` | behind product pictures (they are cut-outs with transparency) |
| `--fg` | `#33261B` earth | `#F2E8D8` cream | text |
| `--muted` | `#6E5D4B` | `#B9A78F` | secondary text |
| `--accent` | `#8A5A30` clay | `#D5AC7A` sand gold | links, focus ring, the active control, one small detail per view |
| `--accent-ink` | `#FBF6EC` | `#231911` | text on an accent fill |
| `--line` | `rgba(51,38,27,.16)` | `rgba(242,232,216,.16)` | hairlines |
No black (`#000`) and no pure white anywhere, in either theme. No blue, red, green or yellow in the interface:
the tribes are no longer colour-coded. The only "colour" is what the photographs and the cloth bring.
Text contrast: body and secondary text at least 4.5:1 on `--bg`, `--surface` and `--stage`, in both themes.

## The tribes without colours
- A tribe stone is a quiet tile: `--surface` ground, hairline border, the Hebrew name in Frank Ruhl (and the Latin
  name small underneath in English and French). The selected stone is filled with `--accent`, text `--accent-ink`.
  All twelve look the same otherwise.
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
- Radius 0; no shadows on boxes; no gradients as decoration. A cut-out picture may carry one soft ground shadow.
- Sections alternate only between `--bg` and `--surface`; the change is barely visible. No hard black/white flips.

## Home page, in this order (nothing else)
1. **Hero**: the film, full viewport, with a warm earth shade at the bottom (not black). The wordmark (cream),
   the one line (settings.heroLine), ONE button: to the collection. Small round controls at the bottom corner:
   sound and pause. The title's entrance motion stays. No stone strip, no second button, no tiles on this screen.
2. **The collection**: small label, the collection's name, one sentence, four pieces, one button "See the
   collection" and a quiet text link "All pieces" (the shop).
3. **Shop by category**: the six categories as calm picture tiles (3 across on desktop, 2 on phones).
4. **The twelve tribes** (the brand's idea, told calmly): heading and two sentences; the twelve stones; for the
   chosen tribe its name, ONE verse (Hebrew with nikud; translation and reference under it in English and French),
   two lines about the tribe, and one link "The pieces of <tribe>". No product tiles inside this section.
5. **Lookbook**: five or six campaign pictures with air between them.
6. **The crew**: three sentences and a row of four pictures.
7. **How reserving works**: three steps, then the tzitzit verse.
8. Footer.
The live 3D cloth leaves the home page; it stays on each tzitzit's own page.

## Shop pages
- Header: `--bg` (transparent over the hero film, with a warm shade behind it), one hairline. Wordmark centred,
  drawn in `--fg` (use the wordmark PNG as a CSS mask so it follows the theme). Start side: menu (phones) or
  three links. End side: language, theme switch, sound, bag. On phones the header shows menu, wordmark, sound,
  bag; language and theme sit in the menu and in the footer.
- Product tile: the cut-out on `--stage` (3:4, a little padding so the garment does not touch the edge), then the
  name (15px, 500) and the price when there is one. Hover on pointer devices swaps to the second picture.
- Item page: the stage is `--stage`; thumbnails are small `--stage` tiles; the form column is calm: category
  label, name (h1 size), price or the pending-price sentence, size options (outlined; selected = `--fg` border),
  one filled button. The 3D section below it sits on `--surface` with the canvas on `--stage`.
- Buttons: filled = `--fg` ground with `--bg` text; hover inverts to an outline. One filled button per view.
- Reserve pages, about, terms, tribe pages: same grounds and type; nothing coloured.

## Sound
Off until the visitor turns it on (browsers do not allow sound before a tap). One round button (speaker) in the
header and on the hero: on = the film's own sound while the hero is on screen, plus a very quiet looping
background track across the site; off = silence at once. The choice is remembered. The track pauses when the tab
is hidden. `components/site/Sound.tsx` owns all of it.

## Theme switch
One small round button (sun / moon), `components/site/Theme.tsx`. It sets `data-theme` on `<html>` and remembers
the choice. An inline script in the document head applies the saved theme before the first paint.

## Motion
The hero title's entrance stays. Elsewhere motion only answers an action (slide change, hover swap, menu).
`prefers-reduced-motion` is respected everywhere.

## Words
Unchanged from version 1: plain, warm, short; Hebrew first; prices are never invented.
