# Shevatim — sources and verification notes

Files: `tribes.json` (12 tribes), `intro.json`, `validate.py` (run `python3 validate.py`), `scripts/` (build pipeline and the extract of every fetched passage that was used).

## 1. How the texts were fetched

The live Sefaria API could not be reached from the build sandbox (network proxy returns 403 for sefaria.org; the WebFetch permission prompt for it timed out). The same Sefaria texts were therefore taken from Sefaria's own public data export, pulled with `git` at a fixed commit, and cross-checked against independent copies.

| # | Source actually used | What it gave |
|---|---|---|
| A | `https://github.com/Sefaria/Sefaria-Export-Archive` at commit `a155a11352fea18612328587e6897105a7f6b357` (export dated 2023-04-20), paths under `json/Tanakh/Torah/<Book>/` and `json/Tanakh/Writings/I Chronicles/` | Sefaria versions: `Hebrew/Tanach with Nikkud.json` (tanach.us, public domain), `Hebrew/Tanach with Ta'amei Hamikra.json`, `Hebrew/Miqra according to the Masorah.json` (MAM, he.wikisource), `English/The Holy Scriptures A New Translation JPS 1917.json` (Open Siddur transcription, public domain), `English/Bible du Rabbinat 1899 [fr].json` (fr.wikisource, public domain) |
| B | same repo and commit: `json/Midrash/Aggadah/Midrash Rabbah/Bamidbar Rabbah/Hebrew/merged.json` (version "Midrash Rabbah -- TE"), `.../Bereishit Rabbah/Hebrew/merged.json`, `json/Tanakh/Rishonim on Tanakh/Rashi/Torah/Rashi on {Genesis,Numbers,Deuteronomy}/Hebrew/merged.json` | Bamidbar Rabbah 2:7 (stones, colours, emblems); Bereishit Rabbah 84:19 and Rashi (checks for the `essence` and `meaning` copy) |
| C | `https://github.com/scrollmapper/bible_databases` at commit `e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c`: `formats/txt/JPS.txt`, `formats/txt/WLC.txt`, `misc/extraction_errors/_FreKhan/FreKhan.zip` (CrossWire modules) | Independent second copies of JPS 1917, the Leningrad Hebrew text and the Zadoc Kahn Bible, used only for cross-checking |
| D | `https://mechon-mamre.org/e/et/et0149.htm`, `https://mechon-mamre.org/e/et/et0533.htm` | Third copy of JPS 1917 for Genesis 49 and Deuteronomy 33 (wording check) |
| E | `https://he.wikisource.org/wiki/מ"ג_בראשית_מט_יג` (Mikraot Gedolot page) | Confirms the accepted spelling of Genesis 49:13 |
| F | `https://www.levangile.com/Bible-ZAK-1-29-2-complet-Contexte-non.htm` (Zadoc Kahn text) | Confirms the hyphens in Genesis 29:32–33 |

The canonical live pages for the same texts (not fetched): `https://www.sefaria.org/Genesis.49`, `https://www.sefaria.org/Deuteronomy.33`, `https://www.sefaria.org/Bamidbar_Rabbah.2.7`.

Every raw string that went into the output, in every edition, is kept in `scripts/source_extract.json`. `validate.py` re-checks all 36 verse quotations (34 in `tribes.json`, 32 distinct verses; 2 in `intro.json`) against it word for word (Hebrew: every letter and vowel).

## 2. Per-field sources

| Field | Source |
|---|---|
| `name.he`, verse `he`, `tagline.he`, `stone.he` | Sliced by script out of the fetched Hebrew text (A). Nothing typed by hand. `stone.he` is the form in Exodus 28:17–20; for Levi the free form with dagesh is taken from the midrash text, because the Torah has it only with a prefix |
| verse `en` | JPS 1917 as carried by Sefaria (A), cross-checked against C and D |
| verse `fr` | Bible du Rabbinat (Zadoc Kahn, 1899) as carried by Sefaria (A), cross-checked against C. **All 36 quotations use the Rabbinat; Louis Segond was not needed anywhere** |
| `stone` ↔ tribe, `flag.color`, `flag.symbol` | Bamidbar Rabbah 2:7 (B), asserted by the build script against the fetched text |
| `mother` | Genesis 29:32–30:24, 35:16–18, 35:23–26 (A) |
| `meaning` | The naming verses, Genesis 29:32–35, 30:6, 30:8, 30:11, 30:13, 30:18, 30:20, 30:24, 35:18 (A); Rashi on Genesis 30:11, 30:20, 35:18 (B) |
| `camp` | Numbers 2:2–31 and 10:25 (A) |
| `essence` | Written for this project. Traditional claims checked in the fetched texts: Reuven and repentance — Bereishit Rabbah 84:19; Shimon's scribes and teachers of children — Rashi on Genesis 49:7; Yissachar bearing the yoke of Torah and setting the calendar — Rashi on Genesis 49:14 and Deuteronomy 33:18; the Zevulun–Yissachar partnership — Rashi on Deuteronomy 33:18; Dan returning lost property — Rashi on Numbers 10:25 (citing the Yerushalmi); the Kinneret in Naftali's portion — Rashi on Deuteronomy 33:23; the Temple in Binyamin's portion and his birth in the Land — Rashi on Deuteronomy 33:12 and Genesis 35:18. Not looked up, general biblical knowledge: Shimon's portion inside Yehuda (Joshua 19:1), Samson from Dan (Judges 13:2), Gad crossing armed (Numbers 32, Joshua 4:12), Levi without territory (Deuteronomy 18:2), David from Yehuda |
| `stone.gloss`, `flag.hex`, `name.en/fr`, `name_alt` | Editorial (see sections 6–8) |

Verse selection: every tribe has a verse from Jacob's blessing; every tribe except Shimon has one from Moses' blessing; the third verse is the naming verse where one was usable.

| Tribe | Verses (type) |
|---|---|
| reuven | Genesis 49:3 (jacob), Deuteronomy 33:6 (moses), Genesis 29:32 (naming) |
| shimon | Genesis 49:5 (jacob), Genesis 29:33 (naming) — no blessing in Deuteronomy 33 |
| levi | Genesis 49:5 (jacob), Deuteronomy 33:10 (moses), Genesis 29:34 (naming) |
| yehuda | Genesis 49:9 (jacob), Deuteronomy 33:7 (moses), Genesis 29:35 (naming) |
| dan | Genesis 49:16 (jacob), Deuteronomy 33:22 (moses), Genesis 30:6 (naming) |
| naftali | Genesis 49:21 (jacob), Deuteronomy 33:23 (moses), Genesis 30:8 (naming) |
| gad | Genesis 49:19 (jacob), Deuteronomy 33:20 (moses) |
| asher | Genesis 49:20 (jacob), Deuteronomy 33:24 (moses), Genesis 30:13 (naming) |
| yissachar | Genesis 49:14 (jacob), Deuteronomy 33:18 (moses), I Chronicles 12:33 (other) |
| zevulun | Genesis 49:13 (jacob), Deuteronomy 33:18 (moses), Genesis 30:20 (naming) |
| yosef | Genesis 49:22 (jacob), Deuteronomy 33:13 (moses), Genesis 30:24 (naming) |
| binyamin | Genesis 49:27 (jacob), Deuteronomy 33:12 (moses), Genesis 35:18 (naming) |
| intro | Exodus 28:21 (choshen), Numbers 15:38 (tzitzit) |

All quotations are complete single verses. No verse was shortened or stitched.

## 3. Hebrew text

Base: Sefaria "Tanach with Nikkud" (public domain). Removed: cantillation, meteg, paseq, sof pasuq, parasha markers. Kept: vowels, dagesh, shin/sin dots, maqaf. The Tetragrammaton is replaced by ה׳ wherever it occurs (8 verses: Genesis 29:32, 29:33, 29:35, 30:24; Deuteronomy 33:7, 33:12, 33:13, 33:23).

**Two words were corrected.** "Tanach with Nikkud" reproduces the Leningrad Codex, which in a few places spells a word differently from the text of Torah scrolls and printed Chumashim. A religious reader would see those as mistakes, so the accepted spelling is used:

| Verse | Leningrad ("Tanach with Nikkud") | Used (accepted text) | Confirmed by |
|---|---|---|---|
| Genesis 49:13 (Zevulun) | אֳנִיּוֹת | אֳנִיֹּת | MAM (A); he.wikisource Mikraot Gedolot (E) |
| Deuteronomy 33:12 (Binyamin) | כְּתֵיפָיו | כְּתֵפָיו | MAM (A); Rashi's quotation of the verse in his comment on it (B) |

Apart from these two words, all four Hebrew copies (Tanach with Nikkud, Tanach with Ta'amei Hamikra, MAM, CrossWire WLC) agree on every letter and vowel of every quoted verse.

Verses with ketiv/qere were avoided: Genesis 30:11 (Gad's naming verse), Genesis 49:10–11, Deuteronomy 33:9. This is why Gad has two verses. Numbers 15:38 was chosen over 15:39 for the tzitzit verse: 15:39 has the Tetragrammaton, a holam-haser code point (U+05BA) that some web fonts lack, and the Leningrad spelling תָתֻרוּ where the Shema in every siddur reads תָתוּרוּ.

## 4. English (JPS 1917)

Text as in Sefaria's copy, which keeps the capital letter at the start of each printed poetic line (e.g. "Dan shall judge his people, As one of the tribes of Israel."). The Mechon-Mamre and CrossWire copies run the same words in lower case. Wording is identical in all three copies for every quoted verse.

Edits made:

| Verse | Change | Reason |
|---|---|---|
| Genesis 49:22, Deuteronomy 33:10 | trailing ` .` removed | transcription artefact in the Sefaria copy only |
| Genesis 49:27 | closing `’` removed | closes Jacob's whole speech; unpaired in a single verse |
| Numbers 15:38 | opening `’` removed | opens a speech that runs to 15:41; unpaired in a single verse |

## 5. French (Bible du Rabbinat, 1899)

Text as in Sefaria's copy (from fr.wikisource); wording identical to the CrossWire "FreKhan" copy for every quoted verse.

Edits made (original string → used):

| Verse | Change | Reason |
|---|---|---|
| Deuteronomy 33:7 | `A Juda,` → `À Juda,` ; `"Ecoute,` → `"Écoute,` | accent on capital letter |
| Deuteronomy 33:18 | `A Zabulon,` → `À Zabulon,` | accent on capital letter |
| Deuteronomy 33:23 | `A Nephtali,` → `À Nephtali,` | accent on capital letter |
| Genesis 29:32 | `dit elle` → `dit-elle` | hyphen lost in the digital copies (confirmed by F) |
| Genesis 29:33 | `celui là` → `celui-là` | same (confirmed by F) |
| Genesis 30:20 | `celui ci` → `celui-ci` | same (by analogy, not separately confirmed) |
| Deuteronomy 33:6, Numbers 15:38 | leading `"` removed | opens a speech spanning several verses |
| Deuteronomy 33:13, 33:18, 33:20, 33:24 | opening `"` after the colon removed | speech closes in a later verse |
| Genesis 49:27 | trailing `"` removed | closes Jacob's whole speech |

Left exactly as published, although it may look odd in a slider:
- The Rabbinat writes "le Seigneur" for the divine Name in Genesis 29:32–33 and Deuteronomy 33:7, 33:12, 33:13, 33:23, "l'Éternel" in Genesis 29:35, and "Dieu" in Genesis 30:24. It was not changed to "l'Éternel". The French taglines for Shimon and Binyamin follow their verse ("Le Seigneur a entendu", "Favori du Seigneur").
- Deuteronomy 33:10 (Levi) begins in lower case ("ils enseignent…") because the Rabbinat runs verses 9–10 as one sentence.
- Deuteronomy 33:13 (Yosef) ends mid-sentence: with a comma in English and a colon in French.
- Tribe names inside the verses are the Rabbinat's (Ruben, Siméon, Juda, Nephtali, Zabulon, Issachar; "Asher" in Genesis 49:20 and Deuteronomy 33:24 but "Aser" in Genesis 30:13).
- Straight double quotes `"` and no space before `: ; ! ?`, as in the source.

## 6. Bamidbar Rabbah 2:7 — result of the check

The mapping in the brief is correct on all twelve tribes. The midrash lists them in stone order (Reuven, Shimon, Levi, Yehuda, Yissachar, Zevulun, Dan, Gad, Naftali, Asher, Yosef, Binyamin). Points of detail from the text:
- Levi: "a third white, a third black and a third red".
- Yehuda: "like the heavens". Yissachar: "black, resembling kohl". Dan: "resembling sapphire". Gad: "neither white nor black but a blend of black and white". Naftali: "like clear wine whose redness is not strong". Asher: "like a precious stone with which women adorn themselves". Yosef: "very black". Binyamin: "like all the colours, the twelve colours".
- Yosef: Egypt is drawn for both princes; Ephraim's flag has an ox (for Joshua), Menashe's a re'em (for Gideon).
- The midrash vocalises יַהֲלֹם; `stone.he` uses the Torah's יָהֲלֹם (Exodus 28:18).

## 7. Flag hex values (editorial)

Contrast ratios are WCAG, against white text / against a white page.

| Tribe | Hex | White text on it | Note |
|---|---|---|---|
| reuven | #B3261E | 6.54 | as given in the brief |
| shimon | #3E7C4F | 5.00 | |
| levi | #91625F | 5.10 | even blend of the three thirds (white, black, red); the midrash names no single colour |
| yehuda | #3A78A8 | 4.74 | sky blue, darkened enough to carry white text |
| dan | #1E4D9B | 8.11 | sapphire |
| naftali | #A8475A | 5.65 | clear, light wine |
| gad | #6E7278 | 4.84 | grey |
| asher | #6B7A2E | 4.72 | olive / chrysolite; the midrash names no hue |
| yissachar | #232B3A | 14.21 | blue-black |
| zevulun | #C9CCD1 | 1.61 | pearl grey as given in the brief; **needs dark text** |
| yosef | #1A1A1C | 17.38 | |
| binyamin | #A85C36 | 4.94 | jasper tone standing in for "all twelve colours" |

## 8. Not verified, and deviations from the brief

1. The live Sefaria API was not reachable; texts come from Sefaria's export of 2023-04-20. A later correction on sefaria.org would not be reflected, though three independent copies agree with it.
2. The 1899 printed page was not seen (fr.wikisource page scans could not be fetched). The French accent and hyphen fixes in section 5 rest on standard spelling and source F, not on the print.
3. The Hebrew follows the accepted Torah-scroll spelling in two words rather than "Tanach with Nikkud" (section 3).
4. Qamats qatan and holam haser are not encoded separately (plain qamats / holam), as in "Tanach with Nikkud".
5. Shimon and Levi share Genesis 49:5, a rebuke rather than a blessing. Yissachar and Zevulun share Deuteronomy 33:18.
6. Yissachar's third verse is I Chronicles 12:33 instead of the naming verse; it is the verse the midrash itself cites for his flag. Christian Bibles number it 12:32.
7. Stone identifications in `stone.gloss` are conventional and uncertain; traditions differ, and JPS 1917 itself renders several differently (nofekh "carbuncle", yahalom "emerald", leshem "jacinth", tarshish "beryl").
8. `name.fr` transliterations other than "Réouven" are editorial (Chimon, Yehouda, Acher, Issakhar, Zevouloun, Yossef).
9. French editorial copy uses « » with no-break spaces (U+00A0) inside, and typographic apostrophes; English editorial copy uses ‘ ’ like JPS.
10. In Hebrew editorial copy the divine Name is always ה׳, including where the verse has אלהים (Dan, Yissachar). Verse fragments quoted inside unpointed copy use full spelling (e.g. "ואל ימות").
11. "Son of the right hand" for Binyamin is one of several traditional explanations (Rashi gives "son of the south" first).

## 9. Rebuild

`scripts/build.py` regenerates `tribes.json` and `intro.json` from `scripts/source_extract.json`. `scripts/extract.py` and `scripts/sources.py` rebuild that extract from the full downloaded books (sources A–C), which were deleted after extraction to keep the folder small.
