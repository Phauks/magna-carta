# Brand typography, wordmark animation & logo research

**Status:** Research complete (2026-06-10), verified against foundry pages, Adobe help documentation, and secondary sources (Adobe Fonts pages render via JavaScript and resist scraping — style lists inside the Adobe packages are medium-confidence; verify in-browser before final selection). **Feeds:** the slice 0·7a brand + design-language workshop (owner decides; this report informs). **Owner intent:** a stylized display font for the title card / "Magna Carta" wordmark (not the UI font), Adobe Fonts licensing acceptable, advanced typographic features wanted; wordmark animatable as if written live; eventually a logo mark, favicon set, possibly an animated logo. Owner has Photoshop/GIMP skills and is open to outsourcing.

## Executive summary

- **Strongest fit for the brief: P22 Morris Troy** — digitized from William Morris's own Kelmscott Press types (1891–92). It is literally the Arts-and-Crafts/medieval-manuscript axis the owner is circling, and "Magna Carta" set in a Kelmscott face is a coherent brand story for a platform named after a medieval legal document. **Golden** (the same family's Venetian roman, after Jenson c. 1470) is the calmer companion for taglines/subtext — a built-in hierarchy from one family.
- **Licensing resolves the architecture:** the wordmark is set once and **converted to SVG outlines — explicitly permitted by the Adobe Fonts license, including for trademarked logos**. The outlined artwork needs no ongoing license, survives any Creative Cloud lapse, and is what the animation technique needs anyway. The Adobe CDN web font is only needed for live display text in the face.
- **DIY animation is realistic:** calligraphy-mask technique + GSAP DrawSVG (now free). Outsourcing a polished version: ~$300–1,500 (Lottie/Rive deliverable).
- **No display face survives 16 px** — plan a simplified **"MC" monogram** (illuminated-initial style fits the brand exactly; Gorgias's period initials and LTC Goudy Text's Lombardic capitals are direct source material). Design reduction-first: it must survive 16 px monochrome.

## The owner's four candidates

1. **P22 Morris** (P22 Type Foundry; Richard Kegler digitizations of Morris's Kelmscott types). *Golden* = Morris's roman after Nicolas Jenson's 1470s Venetian type — the "typewriter-ish" feel is actually incunabula-press texture: dark, slightly rough, bookish. *Troy* = Morris's "semi-Gothic type designed with special regard to legibility" (his words) — church-document feel engineered to stay readable, exactly the needle this brand must thread. Static single-weight display OTFs: common ligatures only, **no variable axes** (barely matters for an outlined wordmark; will not flex as a typographic system). Golden holds to ~18 px; Troy needs ~28 px+. Both have a clear broad-pen ductus — very good for the writing animation. **De-risking: P22 sells the whole 3-font family perpetually for $64.99 desktop direct** — the brand face never depends on a subscription.
2. **Gorgias** (PampaType; José Manuel López Rocha; revival of a 19th-century German Schulfraktur). Four styles (Regular/Black × solid/open "Deco") + ornaments + **a complete set of period initials**. The owner's "a bit much" worry is right for eleven letters of Fraktur — but the period initials are exactly the raw material for an illuminated-initial **M/MC monogram**. The open/Deco forms animate beautifully (outline-then-fill is a classic logo reveal). Caveat: confirm the initials/ornament styles are included in the Adobe Fonts package (foundries sometimes reserve extras for direct sale).
3. **CoFo Raffine** (Contrast Foundry; Olga Kovalenko; 1919 silent-film title lettering). Technically the best-engineered candidate (5 weights + **a variable font**, curated swashes/ligatures) but the emotional register is cinematic Art-Deco glamour, not medieval-legal gravitas — the owner's "likes the g, rest just alright" is the tell. Drop unless the brand pivots toward boutique-firm elegance. High-contrast strokes also make the mask animation fiddly.
4. **Number Five** (Laura Worthington; 1940s–50s American sign-painter script, Smooth/Rough, 433 alternates). What the owner responds to in "Rough" is *liveliness* — hand-made texture — not the mid-century Americana style, which clashes with "Magna Carta" head-on. That liveliness exists inside the brief via Morris's press texture, Alverata Irregular, or Eskapade Fraktur. **Animation warning:** rough/distressed edges are the worst case for the SVG mask technique (thousands of path nodes) and rasterize muddy at small sizes.

## Complementary Adobe Fonts candidates (all verified available)

| Font | Why it fits | Notes |
| --- | --- | --- |
| **Eskapade / Eskapade Fraktur** (TypeTogether, Alisa Nowak) | The purpose-built answer to "blackletter-adjacent but legible": a harmonized roman + simplified Fraktur in one family (16 styles, small caps, ornaments) | Set "Magna" in roman, "Carta" in Fraktur — or Fraktur wordmark + roman everything else, one family |
| **Alverata** (TypeTogether, Gerard Unger) | **Romanesque** — 11th–12th century inscriptions, the century of pre-Magna-Carta England — as a thoroughly modern screen-tested family; the **Irregular** cut randomly alternates letterforms like medieval scribes (the "living" feel, fully legible) | Wide weight range; the rare candidate that could also serve UI headings |
| **LTC Goudy Text Pro** (Lanston/P22) | Goudy's 1928 blackletter after Gutenberg's 42-line Bible, with **Lombardic capitals** — the single best source for an illuminated-initial monogram | More refined and legible than most Fraktur |
| **Adobe Jenson Pro** (Adobe Originals, Slimbach) | The professional-grade Venetian oldstyle (what Morris Golden imitates): 4 weights × 4 optical sizes, small caps, swash italics, historical ligatures | The "engraved legal document" register without costume — the safe-but-characterful choice |
| **Trajan Pro 3 / Trajan Color** (Adobe Originals) | The incised Roman-capitals pole; Trajan Color is an OpenType-SVG color font with engraved/gilded effects | Caution: heavily used by law firms and movie posters — gravitas at the price of distinctiveness |
| **Mason Serif** (Emigre, Barnbrook) | Ecclesiastical-modern wildcard — churchy and engraved without blackletter | Distinctive but polarizing (1990s pedigree, dark-fantasy associations) |
| **Rotunda Veneta** | A rotunda — the rounder, more legible southern-European blackletter | Squarely in-brief; surfaced during verification, worth a browse |

## Adobe Fonts web licensing (verified, June 2026) — and the architecture it dictates

1. Web Projects embed via a single CSS `<link>` from Adobe's CDN (`use.typekit.net`); OpenType features must be checkbox-included in the project, then activated with CSS. No pageview limits on current Creative Cloud plans.
2. **Self-hosting is prohibited** — fonts come only from Adobe's CDN; local hosting requires a direct foundry license.
3. **If the subscription lapses, sites silently fall back** to the next font in the stack.
4. **Logos and outlining are allowed:** text may be set, converted to vector outlines, used and trademarked; the outlined artwork needs no ongoing license. (Modifying the font file or building a new font from outlines is not allowed.)

**Implication:** a CDN-served live-text font cannot drive the handwriting animation anyway (the technique needs glyphs as `<path>` data). So: **wordmark = outlined SVG asset** (made once in Illustrator/Inkscape) — legally clean, animation-ready, immune to subscription lapse; Adobe Web Project only for live display text with a sane fallback stack; if the face becomes load-bearing product-wide, buy the perpetual direct license (P22 $64.99; PampaType/TypeTogether sell self-hosting licenses directly).

## The "written live" wordmark animation

**Technique (calligraphy mask):** outline the wordmark to filled paths → hand-trace a single-stroke **pen path** per letter following the real writing order, fat enough to cover the letter → use the pen paths as an SVG mask over the filled glyphs → animate `stroke-dashoffset` sequentially. Letters with overlapping/wildly varying strokes (blackletter) need multiple masks per glyph. Pen paths are hand-traced in Illustrator/Inkscape — stroke order is a human decision; budget an evening for ten letters of Troy.

**Tooling:** GSAP **DrawSVG** (free) sequences the strokes best; Svelte's built-in `transition:draw` covers simple cases; SVGator has a guided GUI workflow; **vara.js is not suitable** (own-font format, brittle conversion).

**Outsourcing spec** (if chosen): supply the outlined-SVG wordmark (licensing stays ours); demand (a) layered source SVG with id'd paths + the GSAP/JS source, (b) Lottie JSON and/or Rive `.riv`, (c) MP4/WebM + GIF fallbacks, (d) a reduced-motion static variant. Verified cost ranges: gig-platform basic work from ~$20–25; credible custom $100–2,000; realistic target for a polished handwriting wordmark from a vetted freelancer **$300–1,500**.

## Logo, favicon & Tauri icons

- **Monogram over symbol:** the product is named after a document, and the visual tradition the owner is drawn to *is* the illuminated initial — a decorated capital opening a legal text. An MC drawn as an illuminated initial is on-brand, ownable, and reducible; scales/columns/shields/quills are saturated legal-tech clichés. Ornament appears only in the large version.
- **Web favicon set (2026 practice, three files):** `favicon.svg` (primary; may embed a dark-mode media query — Safari ignores it, so pick a base that reads on both), `favicon.ico` (16/32/48 legacy), `apple-touch-icon.png` (exactly 180×180, no transparency). The web app is explicitly not a PWA — skip manifest icons unless a manifest appears.
- **Tauri 2:** one master `app-icon.png` 1024×1024 RGBA → `tauri icon` generates the full set (`icon.ico` Windows multi-layer, `icon.icns` macOS, Linux PNGs) into `src-tauri/icons/`. The monogram master PNG is the single desktop icon source of truth; design at 1024, verify at 16.
- **Deliverable checklist:** wordmark outlined SVG (static + animated + reduced-motion static); monogram SVG master (full + simplified-small + monochrome); the three web favicon files; the Tauri master PNG; a licensing record of which font/version the outlines came from (optionally the P22 perpetual license filed alongside).

## Sources

fonts.adobe.com/fonts/{p22-morris, gorgias, cofo-raffine, number-five, eskapade, alverata, ltc-goudy-text-pro, adobe-jenson, trajan, trajan-color, mason-serif, rotunda-veneta} · p22.com/family-Morris · pampatype.com/typefaces/gorgias · contrastfoundry.com/typeface/cofo-raffine · lauraworthingtondesign.com/font/number-five · type-together.com/{eskapade-font, the-story-behind-alverata} · helpx.adobe.com/fonts/using/{embed-codes, dynamic-subsetting, use-open-type-features, plan-limits, webfont-licensing, font-licensing}.html · css-tricks.com/{how-to-get-handwriting-animation-with-irregular-svg-strokes, animate-calligraphy-with-svg} · motiontricks.com/svg-calligraphy-handwriting-animation · gsap.com/docs/v3/Plugins/DrawSVGPlugin · evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs · v2.tauri.app/develop/icons · creattie.com/blog/how-much-lottie-animations-cost · lottiefiles.com/blog/design-inspiration/cost-hire-motion-graphics-designer
