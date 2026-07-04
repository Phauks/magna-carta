// Stylesheet for the public status page, served by this worker itself at a content-hashed
// same-origin /assets path (long immutable cache, so the 60-second meta refresh refetches only
// the HTML). Everything the page loads comes from this worker and nowhere else — no font CDN,
// no external asset may stand between a reader and "is it down?" — and the page stays fully
// readable as bare HTML if the stylesheet or font request ever fails.
//
// Type: the real Atkinson Hyperlegible Next (the app's reading face), bundled into the worker
// as a single latin variable woff2 (~34 KB, weights 200-800) and declared with
// font-display: swap over the system stack, so degraded readers get instant text.
//
// Palette: hand-copied approximations of the house palette (ink text on warm paper, gilt accent,
// green/amber/red status hues). Source of truth: packages/design-tokens/tokens/primitives/color.json.
// This worker deliberately does not import the token pipeline (or any package beyond
// @magna-carta/status) — fate isolation outweighs automatic palette sync, so a token change must
// be re-copied here by hand. The values drift rarely; the isolation matters daily.
//
// Scheme handling is CSS-first: readers without JavaScript get their system scheme via
// prefers-color-scheme; the toggle (a small inline enhancement) overrides it by stamping
// data-scheme on the root element, which must win in both directions.

// Stable name, immutable cache: the file is a fixed artifact — if it is ever replaced, rename it.
export const FONT_ASSET_PATH = "/assets/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2";

const LIGHT_VARIABLES = `
  color-scheme: light;
  --paper: #faf9f5;
  --card: #ffffff;
  --sunken: #f2f0ea;
  --text: #22211c;
  --muted: #5d5a50;
  --subtle: #8b877a;

  /* On light paper the brand glyph needs the deep gold for contrast; the app's chrome shows the
     bright accent on dark ink, which the dark scheme restores below. */
  --brand-gold: #8a7434;

  --hair: rgba(35, 33, 26, 0.13);
  --hair-strong: rgba(35, 33, 26, 0.26);

  --ok-fg: #3d6b4f;
  --ok-bg: #eaf2ec;
  --warn-fg: #8a6a2f;
  --warn-bg: #f7efdc;
  --danger-fg: #8f3d33;
  --danger-bg: #f7e7e3;
  /* Maintenance is deliberately OUTSIDE the red/green/yellow severity family: a calm
     informational blue (the genre norm — planned work, not a problem), and distinct from the
     brand golds so nothing planned shares a hue with anything broken or ceremonial. */
  --info-fg: #33608c;
  --info-bg: #e8eff7;
  /* The one no-data gray: legend entry and every no-data row (a provider whose feed is
     unreachable today; any future component without data) share this property, so the key and
     the rows it explains cannot drift apart. */
  --nodata-fg: #5d5a50;
  --neutral-fg: #5d5a50;
  --neutral-bg: #eeede7;
`;

// Dark paper is the app's chrome ink; status foregrounds lighten to hold contrast, washes become
// deep tints. The verdict-band backgrounds stay the same saturated mid-tones in both schemes —
// they are the page's one-second read and they carry on light and dark paper alike.
const DARK_VARIABLES = `
  color-scheme: dark;
  --paper: #191813;
  --card: #23221b;
  --sunken: #14130f;
  --text: #e9e7df;
  --muted: #a5a08c;
  --subtle: #7d7968;

  --brand-gold: #e2c476;

  --hair: rgba(233, 231, 223, 0.12);
  --hair-strong: rgba(233, 231, 223, 0.26);

  --ok-fg: #85b394;
  --ok-bg: #223226;
  --warn-fg: #cfa964;
  --warn-bg: #332c1a;
  --danger-fg: #d08276;
  --danger-bg: #392019;
  --info-fg: #8ab0d4;
  --info-bg: #1e2a37;
  --nodata-fg: #a5a08c;
  --neutral-fg: #a5a08c;
  --neutral-bg: #2a2921;
`;

export const PAGE_CSS = `
/* The app's reading face, self-served (latin subset; the variable file covers every weight the
   page uses). font-display: swap + the system stack behind it keeps text instant if the font
   request is slow or fails; operator text outside latin falls back to the system stack. */
@font-face {
  font-family: "Atkinson Hyperlegible Next";
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url("${FONT_ASSET_PATH}") format("woff2-variations");
}
:root {
${LIGHT_VARIABLES}
  --ok-band: #41724f;
  --warn-band: #9a763a;
  --danger-band: #93483d;
  --info-band: #3b658f;

  --serif: Georgia, "Times New Roman", serif;
  --sans: "Atkinson Hyperlegible Next", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
:root[data-scheme="dark"] {
${DARK_VARIABLES}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-scheme="light"]) {
${DARK_VARIABLES}
  }
}
/* Text-size ladder: every text size below is in rem, so stepping the root font-size scales the
   whole page. Standard sits one step above the browser default — percentages, so a reader's
   own configured base is respected rather than overridden (106.25% = 17px on the common 16px
   default) — and the header button cycles the data-text stamp (persisted, applied pre-paint by
   the boot script) through the 17 / 19 / 21px equivalents. The no-JS baseline is the browser's
   own zoom — the page is fully readable without the button. */
:root { font-size: 106.25%; }
:root[data-text="large"] { font-size: 118.75%; }
:root[data-text="larger"] { font-size: 131.25%; }
* { margin: 0; box-sizing: border-box; }
body {
  font-family: var(--sans);
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text);
  background: var(--paper);
}
a { color: inherit; }
.caps {
  font-size: 0.6875rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  font-weight: 600;
}
.num { font-variant-numeric: tabular-nums; }

/* The centered measure: substantially wider than the genre's ~900px letterbox, but still a
   measure — fluid viewport-relative gutters keep it off the screen edges, and the extra width
   is spent on breathing room (wider column gap, roomier rows), never on more density (the
   original full-width complaint was density, not width). */
.col {
  max-width: 1320px;
  margin: 0 auto;
  padding-left: clamp(20px, 5vw, 72px);
  padding-right: clamp(20px, 5vw, 72px);
}

/* top bar — the app's brand lockup (inline-SVG glyph + letterspaced wordmark), quiet otherwise */
.topbar { border-bottom: 1px solid var(--hair); margin-bottom: 26px; }
.topbar .col {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 14px;
  padding-bottom: 14px;
}
/* The lockup is a plain home anchor back to this page — quiet (no underline, inherited ink),
   since it already reads as the masthead. */
.home { display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit; }
.topbar .mark { display: flex; align-items: center; color: var(--brand-gold); }
.brand-glyph { height: 1.25rem; width: auto; display: block; }
.topbar .word {
  /* The app's BrandMark wordmark treatment, now in the true face: Atkinson Hyperlegible Next,
     0.75rem, semibold, uppercase, 0.125rem tracking. "Status" joins the same lockup in the same
     treatment, muted a step so the product name leads but the pair reads as one word-set. */
  font-size: 0.75rem;
  letter-spacing: 0.125rem;
  text-transform: uppercase;
  font-weight: 600;
}
.word-status { color: var(--muted); }
.topbar .right { margin-left: auto; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: flex-end; }

/* Dead affordances: muted ink, no pointer cursor, title attribute as the accessibility
   baseline, and a CSS-only hover reveal of "Soon" — quiet at rest, honest on approach,
   never mistakable for a live link. */
.dead { display: inline-flex; align-items: center; position: relative; }
/* Header links tuned to the face: Atkinson reads light at small sizes, so the medium weight
   with a touch of tracking keeps the control row crisp without competing with the wordmark. */
.dead-link { color: var(--subtle); font-size: 0.75rem; font-weight: 500; letter-spacing: 0.01em; cursor: default; }
.dead::after {
  content: "Soon";
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.59375rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  font-weight: 600;
  padding: 1px 6px;
  border: 1px solid var(--hair-strong);
  border-radius: 2px;
  background: var(--card);
  color: var(--subtle);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease-out;
  z-index: 1;
}
.dead:hover::after,
.dead:focus-within::after { opacity: 1; }

/* icon buttons: the bell (disabled subscribe seam) and the scheme toggle (revealed by the
   enhancement script; absent for no-JS readers, who rely on prefers-color-scheme) */
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 0;
  padding: 4px;
  color: var(--muted);
}
.icon-button svg { width: 1rem; height: 1rem; }
.icon-button:disabled { color: var(--subtle); cursor: default; }
button.icon-button:not(:disabled) { cursor: pointer; }
button.icon-button:not(:disabled):hover { color: var(--text); }
/* The toggle carries both icons; CSS shows the one for the scheme you would switch TO, and the
   data-scheme stamp must win over the system preference in both directions. */
.toggle .icon-sun { display: none; }
.toggle .icon-moon { display: block; }
:root[data-scheme="dark"] .toggle .icon-sun { display: block; }
:root[data-scheme="dark"] .toggle .icon-moon { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-scheme="light"]) .toggle .icon-sun { display: block; }
  :root:not([data-scheme="light"]) .toggle .icon-moon { display: none; }
}

/* Subscribe panel — the designed front door for notifications, opened by the bell. The submit
   stays disabled with the hover-Soon treatment until the subscribe backend exists; nothing here
   fakes a subscription. */
.subscribe-wrap { position: relative; display: inline-flex; }
.subscribe-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  /* Wide enough that the country popup can show the longest country names without clipping;
     rem so the panel grows with the text-size ladder instead of squeezing its controls. */
  width: min(20rem, 90vw);
  background: var(--card);
  border: 1px solid var(--hair-strong);
  border-radius: 6px;
  padding: 14px;
  box-shadow: 0 4px 14px rgba(35, 33, 26, 0.12);
  text-align: left;
  z-index: 5;
}
.subscribe-panel h2 { font-size: 0.8125rem; font-weight: 650; margin-bottom: 6px; }
.subscribe-note { color: var(--muted); font-size: 0.75rem; margin-bottom: 10px; }
.subscribe-label {
  display: block;
  font-size: 0.6875rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 4px;
}
/* Scope choice: native radios (all updates, or only the current issue). The current-issue
   option stays visible when no incident is live — disabled with a quiet note — so the panel
   always teaches what subscribing can do. */
.scope-group { border: 0; padding: 0; margin: 0 0 12px; }
.scope-option {
  display: flex;
  gap: 7px;
  align-items: baseline;
  font-size: 0.78125rem;
  margin-top: 5px;
}
.scope-option input { margin: 0; flex: none; }
.scope-option.is-disabled { color: var(--subtle); }
.scope-detail { display: block; color: var(--subtle); font-size: 0.6875rem; }

/* Channel toggle: a real two-segment control (presentation only — the backend seam stays in
   the submit). One field shows at a time; both field blocks share an identical structure so
   swapping them never resizes the panel. */
.channel-toggle {
  display: flex;
  border: 1px solid var(--hair-strong);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 10px;
}
.channel-segment {
  flex: 1;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 5px 8px;
  background: var(--paper);
  color: var(--muted);
  border: 0;
  cursor: pointer;
}
.channel-segment + .channel-segment { border-left: 1px solid var(--hair-strong); }
.channel-segment[aria-pressed="true"] { background: var(--sunken); color: var(--text); }
.subscribe-input {
  width: 100%;
  font: inherit;
  font-size: 0.8125rem;
  padding: 6px 8px;
  border: 1px solid var(--hair-strong);
  border-radius: 3px;
  background: var(--paper);
  color: var(--text);
  margin-bottom: 10px;
}
/* Phone channel: dial-code control beside the national-number input, one control row so the
   email and phone field blocks keep identical geometry. The no-JS baseline is the plain select
   (full names; only its closed state truncates, title keeps it readable); the enhancement
   script swaps in the compact listbox button whose CLOSED form is just "ISO dial" so nothing
   can overflow at any text-size step. */
.phone-row { display: flex; gap: 8px; position: relative; }
.phone-row .subscribe-input { flex: 1; min-width: 0; }
.subscribe-country {
  flex: 0 0 42%;
  min-width: 0;
  font: inherit;
  font-size: 0.8125rem;
  padding: 6px 4px;
  border: 1px solid var(--hair-strong);
  border-radius: 3px;
  background: var(--paper);
  color: var(--text);
  margin-bottom: 10px;
}
.country-button {
  flex: none;
  font: inherit;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  padding: 6px 10px;
  border: 1px solid var(--hair-strong);
  border-radius: 3px;
  background: var(--paper);
  color: var(--text);
  cursor: pointer;
  margin-bottom: 10px;
  white-space: nowrap;
}
/* The open list is anchored to the control's start edge and sizes to its content (the longest
   country names), bounded by the panel and scrolling vertically through the full ITU list. */
.country-listbox {
  position: absolute;
  left: 0;
  top: calc(100% - 4px);
  z-index: 6;
  width: max-content;
  max-width: 100%;
  max-height: 240px;
  overflow-y: auto;
  background: var(--card);
  border: 1px solid var(--hair-strong);
  border-radius: 4px;
  box-shadow: 0 4px 14px rgba(35, 33, 26, 0.12);
}
.country-option {
  padding: 5px 10px;
  font-size: 0.78125rem;
  cursor: pointer;
  white-space: nowrap;
}
.country-option:hover { background: var(--sunken); }
.country-option[aria-selected="true"] { background: var(--sunken); font-weight: 600; }
.subscribe-submit {
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 6px 12px;
  border: 1px solid var(--hair-strong);
  border-radius: 3px;
  background: var(--sunken);
  color: var(--subtle);
}
.subscribe-submit:disabled { cursor: default; }

/* the verdict band — constrained to the column so the page breathes on open paper */
.band {
  color: #fdfcf8;
  padding: 24px 26px;
  display: flex;
  align-items: center;
  gap: 15px;
  position: relative;
  margin-bottom: 28px;
  flex-wrap: wrap;
  border-radius: 8px;
}
/* The lamp: a perfectly STATIC solid dot over a lighter halo that alone does the breathing —
   a slow, compositor-only scale, the SAME calm period in every state (the band color already
   carries severity; a faster red pulse would be alarm fatigue, not information).

   Concentricity is enforced structurally, not by matching offsets: the wrapper is a fixed
   square, BOTH circles are absolutely positioned at its exact center (left/top 50% plus a
   centering translate), and each carries an explicit width = height. The centering translate
   lives INSIDE every keyframe alongside the scale — a keyframe owns the whole transform, so a
   bare scale() in the animation would drop translate-based centering and shove the halo toward
   the top-left; composing them in one stack makes drift impossible. Sizes are deliberately px,
   not rem: the lamp is a fixed ornament, so the text-size ladder can never skew the pair. */
.band .lamp {
  position: relative;
  width: 24px;
  height: 24px;
  flex: none;
}
.band .lamp-dot,
.band .lamp-halo {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
}
.band .lamp-dot {
  width: 14px;
  height: 14px;
  background: #fdfcf8;
}
.band .lamp-halo {
  width: 24px;
  height: 24px;
  background: rgba(253, 252, 248, 0.25);
  animation: halo-breathe 5s ease-in-out infinite;
}
@keyframes halo-breathe {
  0%, 100% { transform: translate(-50%, -50%) scale(0.72); }
  50% { transform: translate(-50%, -50%) scale(1.15); }
}
@media (prefers-reduced-motion: reduce) {
  /* A static halo at rest scale — the lamp keeps its ringed anatomy, it just holds still. */
  .band .lamp-halo { animation: none; transform: translate(-50%, -50%) scale(0.85); }
}
.band h1 { font-size: 1.4375rem; font-weight: 650; }
.band .sub { margin-left: auto; text-align: right; font-size: 0.75rem; opacity: 0.92; }
.band .sub .big { font-size: 0.8125rem; font-weight: 600; }
.band.ok { background: var(--ok-band); }
.band.warn { background: var(--warn-band); }
.band.danger { background: var(--danger-band); }
.band.info { background: var(--info-band); }
/* When the stale strip tucks under the band, square the band's bottom corners so the pair
   reads as one rounded block (cosmetic only — browsers without :has just show a hairline gap). */
.band:has(+ .stale-strip) { border-radius: 8px 8px 0 0; }

.stale-strip {
  background: var(--neutral-bg);
  color: var(--neutral-fg);
  border: 1px solid var(--hair);
  border-top: 0;
  padding: 8px 26px;
  font-size: 0.75rem;
  margin: -28px 0 28px;
  border-radius: 0 0 6px 6px;
}
.stale-strip b { font-weight: 600; }

/* live event card — present only while an event is unresolved */
.live {
  border: 1px solid var(--hair-strong);
  border-left: 3px solid var(--warn-fg);
  background: var(--card);
  padding: 18px 20px;
  margin-bottom: 14px;
}
.live.danger { border-left-color: var(--danger-fg); }
.live.info { border-left-color: var(--info-fg); }
.live h2 { font-size: 1.03125rem; font-weight: 650; margin-bottom: 4px; }
.live .meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.chip {
  font-size: 0.65625rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  font-weight: 600;
  padding: 2px 8px;
  border: 1px solid var(--hair-strong);
  color: var(--muted);
  background: var(--paper);
}
.chip.warn { border-color: var(--warn-fg); color: var(--warn-fg); background: var(--warn-bg); }
.chip.danger { border-color: var(--danger-fg); color: var(--danger-fg); background: var(--danger-bg); }
.chip.info { border-color: var(--info-fg); color: var(--info-fg); background: var(--info-bg); }
.chip.ok { border-color: var(--ok-fg); color: var(--ok-fg); background: var(--ok-bg); }
.affected { color: var(--subtle); font-size: 0.75rem; }
.update { display: grid; grid-template-columns: 7rem 6.5rem 1fr; gap: 12px; padding: 8px 0; }
.update + .update { border-top: 1px solid var(--hair); }
.update .t { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); padding-top: 1px; }
.update .phase { padding-top: 2px; color: var(--muted); }
/* Update bodies are the page's only real prose: they keep a readable line length inside the
   wider measure — unbounded 1300px prose lines are hard to track back to the left edge. */
.update > span:last-child { max-width: 72ch; }
@media (max-width: 680px) {
  .update { grid-template-columns: 84px 1fr; }
  .update .phase { display: none; }
}

/* component groups — two columns within the measure (single column on narrow screens) */
.group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 26px 0 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--hair-strong);
}
.group-head .caps { color: var(--muted); }
/* The page's one color key (see COLOR_KEY_HTML): muted, not subtle, so it stays readable as a
   key in both schemes without competing with the rows it explains. */
.group-head .legend { display: flex; gap: 14px; font-size: 0.6875rem; color: var(--muted); align-items: center; flex-wrap: wrap; }
.legend .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; }
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  /* The wider measure is spent here: a generous inter-column channel, not more density. */
  column-gap: clamp(44px, 7vw, 110px);
}
@media (max-width: 680px) { .grid { grid-template-columns: 1fr; } }
.row { padding: 16px 0 15px; border-bottom: 1px solid var(--hair); }
.row .line { display: flex; align-items: center; gap: 10px; }
.row .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.row .name { font-weight: 600; }
.row .st { margin-left: auto; font-size: 0.6875rem; letter-spacing: 0.09em; text-transform: uppercase; font-weight: 600; text-align: right; }
.row .note { color: var(--muted); font-size: 0.78125rem; margin: 5px 0 0 19px; }
.ok-row .dot { background: var(--ok-fg); }
.ok-row .st { color: var(--ok-fg); }
.warn-row .dot { background: var(--warn-fg); }
.warn-row .st { color: var(--warn-fg); }
.warn-row .note { border-left: 2px solid var(--warn-fg); padding-left: 10px; }
.danger-row .dot { background: var(--danger-fg); }
.danger-row .st { color: var(--danger-fg); }
.danger-row .note { border-left: 2px solid var(--danger-fg); padding-left: 10px; }
.info-row .dot { background: var(--info-fg); }
.info-row .st { color: var(--info-fg); }
.info-row .note { border-left: 2px solid var(--info-fg); padding-left: 10px; }
.neutral-row .dot { background: var(--nodata-fg); }
.neutral-row .st { color: var(--nodata-fg); }
.empty-note { color: var(--subtle); font-size: 0.78125rem; padding: 14px 0; }

/* providers */
.providers { display: flex; gap: 10px; flex-wrap: wrap; margin: 14px 0 4px; }
.prov {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--hair);
  background: var(--card);
  padding: 8px 13px;
  font-size: 0.78125rem;
}
.prov .dot { width: 8px; height: 8px; border-radius: 50%; }
.prov.ok-row .dot { background: var(--ok-fg); }
.prov.warn-row .dot { background: var(--warn-fg); }
.prov.danger-row .dot { background: var(--danger-fg); }
.prov.info-row .dot { background: var(--info-fg); }
.prov.neutral-row .dot { background: var(--nodata-fg); }
.prov .st { color: var(--muted); }
.prov-note { color: var(--subtle); font-size: 0.75rem; margin-top: 8px; }

/* history */
h2.section { font-size: 0.9375rem; font-weight: 650; margin: 34px 0 2px; }
.section-sub { color: var(--subtle); font-size: 0.75rem; margin-bottom: 12px; }
.day { border-top: 1px solid var(--hair); padding: 12px 0; }
.day .d { color: var(--muted); font-weight: 600; font-size: 0.78125rem; margin-bottom: 6px; }
.day .none { color: var(--subtle); font-size: 0.78125rem; }
.hist { background: var(--card); border: 1px solid var(--hair); padding: 14px 16px; }
.hist h3 { font-size: 0.875rem; font-weight: 650; margin-bottom: 4px; }
.hist .meta { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; flex-wrap: wrap; }

/* the page ends on the history section; no footer (it develops separately later) */
main.col { padding-bottom: 48px; }
`;

// Content-hashed stylesheet path: the URL changes whenever the CSS changes, so it can be cached
// immutably for a year while the meta-refreshed HTML always references the current version.
// FNV-1a is plenty for cache-busting (this is a version tag, not a security digest).
function fnv1aHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export const STYLES_ASSET_PATH = `/assets/styles.${fnv1aHash(PAGE_CSS)}.css`;
