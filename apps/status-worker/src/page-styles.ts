// Stylesheet for the public status page, inlined into the rendered HTML so the page arrives as
// one self-contained response — no external asset may stand between a reader and "is it down?".
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
  --neutral-fg: #a5a08c;
  --neutral-bg: #2a2921;
`;

export const PAGE_CSS = `
:root {
${LIGHT_VARIABLES}
  --ok-band: #41724f;
  --warn-band: #9a763a;
  --danger-band: #93483d;
  --info-band: #3b658f;

  --serif: Georgia, "Times New Roman", serif;
  --sans: system-ui, -apple-system, "Segoe UI", sans-serif;
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
   whole page. Standard is the browser default (16px root); the button in the header cycles the
   data-text stamp (persisted, applied pre-paint by the boot script). The no-JS baseline is the
   browser's own zoom — the page is fully readable without the button. */
:root[data-text="large"] { font-size: 18px; }
:root[data-text="larger"] { font-size: 20px; }
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

/* the centered measure */
.col {
  max-width: 920px;
  margin: 0 auto;
  padding-left: 36px;
  padding-right: 36px;
}
@media (max-width: 680px) {
  .col { padding-left: 18px; padding-right: 18px; }
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
  /* Mirrors the app's BrandMark wordmark: 0.75rem, semibold, uppercase, 0.125rem tracking.
     "Status" joins the same lockup in the same treatment, muted a step so the product name
     leads but the pair reads as one word-set. */
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
.dead-link { color: var(--subtle); font-size: 0.78125rem; cursor: default; }
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
  width: 264px;
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
.subscribe-email {
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
.band .lamp {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fdfcf8;
  box-shadow: 0 0 0 4px rgba(253, 252, 248, 0.25);
  flex: none;
  /* A slow breath so the page reads as alive, not frozen. Compositor-only (opacity + scale),
     and the SAME calm period in every state — the band color already carries severity; a
     faster red pulse would be alarm fatigue, not information. */
  animation: lamp-breathe 5s ease-in-out infinite;
}
@keyframes lamp-breathe {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(0.88); }
}
@media (prefers-reduced-motion: reduce) {
  .band .lamp { animation: none; }
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
.update { display: grid; grid-template-columns: 110px 104px 1fr; gap: 12px; padding: 8px 0; }
.update + .update { border-top: 1px solid var(--hair); }
.update .t { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); padding-top: 1px; }
.update .phase { padding-top: 2px; color: var(--muted); }
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
  column-gap: 44px;
}
@media (max-width: 680px) { .grid { grid-template-columns: 1fr; } }
.row { padding: 14px 0 13px; border-bottom: 1px solid var(--hair); }
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
.neutral-row .dot { background: var(--subtle); }
.neutral-row .st { color: var(--neutral-fg); }
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
.prov.neutral-row .dot { background: var(--subtle); }
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

/* footer — just the honesty paragraph, wrapping naturally across the full measure */
.foot {
  border-top: 1px solid var(--hair-strong);
  margin-top: 30px;
  margin-bottom: 40px;
  padding-top: 16px;
  color: var(--muted);
  font-size: 0.78125rem;
}
`;
