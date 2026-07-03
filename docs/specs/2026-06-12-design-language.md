# Design Language — Magna Carta (slice 0·7a, Phase B)

**Status:** Owner-approved through the design-language workshop (2026-06-12, visual companion). The human-judgment artifact required before any component is styled (white paper, _Design quality & the design process_; ADR-0053). Pairs with [`2026-06-12-page-archetypes.md`](2026-06-12-page-archetypes.md). Realizes the design-language half of [`2026-06-10-design-system-foundation-design.md`](2026-06-10-design-system-foundation-design.md) §5 (ADR-0076).

**What this is:** the authored, owner-decided foundation that components are styled _to_ — personality, color, type, space, elevation, motion, and the brand's signature moments — plus the personalization model that governs how all of it adapts per firm and per user. It is a **design** document (decisions + rationale), not an implementation plan. Encoding these values into `@magna-carta/design-tokens` (Terrazzo generation, the theme gallery, the gates) and building the component layer is the build step that follows, governed by the slice 0·7a implementation plan (Tasks 7–8 onward).

**Practitioner summary:** the day-to-day "how to apply this" lives in [`docs/conventions/ui-design.md`](../conventions/ui-design.md) (promoted from stub to standard in Phase E). This document is the _why_ and the _what_; that one is the _how_.

---

## 1. Personality — restrained workspace, ceremonial edges

Magna Carta is a dense daily-driver that lawyers live in for nine hours a day, and it carries a heritage brand (a medieval legal charter). Those two facts are reconciled by a single decision:

> **The working UI is calm, fast, and gets out of the way; the heritage character concentrates at the _ceremonial edges_ — sign-in, loading, empty states, headers, print/letterhead, the wordmark — never as workspace decoration.**

This is the documented practice of the institutions that own this text (the US Supreme Court, the ABA): celebrated excerpts and crests at ceremonial moments, never the full charter as wallpaper. It also serves the product: distinctiveness without taxing an all-day tool.

**Design principles** (the tie-breakers when a specific choice is unclear):

1. **Fast first, smooth second.** The interface must feel instant and native, never "foreign" generic-SaaS. Speed and responsiveness outrank visual flourish. Heavy work is off the main thread (golden rule 10); motion is functional, not decorative.
2. **Accessibility is a first-class, user-controlled axis** — not an afterthought. The default reading font is the one literally engineered for legibility; reading comfort (mode, density, typeface, motion) is something each user controls for their own needs.
3. **The firm owns the brand; the individual owns how they read.** Color/theme is a firm identity choice; how the interface reads (mode, density, typeface, motion amount) belongs to the person using it.
4. **Decide well once; expose only what earns it.** A control is user-configurable when it answers an **accessibility need** or a **firm-brand** choice. Everything else is tokenized (so the door stays open) but decided once by judgment — we expose **intent, never implementation** (a user picks "less motion," never "set the menu to 412 ms").
5. **Coherence over recombination.** The product reads as one intentional system; unbounded per-screen or per-knob variation is how coherence (and testability) erodes.

**Best-in-class references** (the bar, by dimension): Linear and Stripe's dashboard (calm density, speed), GitHub Primer (flat hairline structure), Material 3 / Carbon (motion-token discipline), a well-set law journal (the heritage register at the edges). The look is "Linear/Stripe calm + a crested title card," not "Clio/Leap legal-blue" and not "Material depth."

---

## 2. Personalization & governance — the adaptation model

Five **axes** adapt the interface. Each resolves identically at runtime: a **data attribute (or class) on `<html>`** drives a pure token/CSS cascade — no theme-conditional code, no rebuild, no FOUC (an inline boot script applies the persisted preference before first paint).

| Axis                                | Who chooses     | Kind          | Runtime                                              |
| ----------------------------------- | --------------- | ------------- | ---------------------------------------------------- |
| **Color theme**                     | Firm (lockable) | Brand         | `data-theme`                                         |
| **Mode** (light / dark / system)    | User            | Accessibility | `dark` class                                         |
| **Density** (comfortable / compact) | User            | Accessibility | `data-density`                                       |
| **Typeface** (reading font)         | User            | Accessibility | `data-typeface`                                      |
| **Motion** (full / reduced / off)   | User            | Accessibility | `data-motion` (+ honors OS `prefers-reduced-motion`) |

**Governance — one consistent rule across all axes.** A firm admin sets a **firm default** for each axis and, per axis, a **policy**: `locked` (every member gets the firm default) or `user-choosable` (members may override). Effective value = the user's choice when the axis is user-choosable and set, else the firm default.

**Accessibility carve-out (hard rule).** The **color theme is fully lockable** (it is brand — a firm may reasonably enforce it). The **accessibility axes — mode, density, typeface, motion — are always user-overridable**; a firm sets their _default_ but can never lock a user out of an accommodation they may medically need (WCAG-adjacent risk).

**Navigation is also adaptive, but order is canonical.** The sidebar has **one canonical order, identical for everyone**; role/permission differences are **hide-in-place** (an item the user lacks permission for simply does not render — nothing reorders). Visibility is permission-driven and firm-configured; a firm granting full access sees the full nav. A role's _default landing route_ may differ (a receptionist opens to Intake); the _order_ never does. (Detailed in the archetypes doc.)

**Scope (this slice vs later).** The runtime mechanism and the token seams for all five axes are built **now** (0·7a): `rem`-based type, the `density.*` aliases with a real second density, the `data-*` switching, the localStorage preference seam, and the reserved high-contrast axis. The **user-facing controls and admin policy enforcement (RBAC) ship in slice 0·7b**, where the settings registry (ADR-0040) and firm-admin surfaces exist. Nothing is retrofitted; 0·7b only wires controls onto seams that already work.

---

## 3. Color

**Gold is the signature** — the constant heritage thread across every theme and the brand (illumination, gilt, wax seals). It is an **accent**, never a primary action color (gold-on-text fails contrast and reads tacky as a button). Gold-on-dark reads as illuminated leaf on vellum and is a deliberate signature in dark mode.

**Flagship theme — "Chancery" (Ink & Gold).** The default every new firm starts on: near-black warm **ink** as the primary/structural color, warm-neutral surfaces, gold accents (active nav, selected, "held" states, the wordmark). Trustworthy and unmistakably legal without the legal-tech-blue cliché (deliberately not the Clio/Leap blue) and without a red primary button.

**The brand/flagship color is a swappable anchor.** It is fed into the Culori generation script as an anchor decision; **nothing hardcodes it.** Re-skinning the brand later (or a firm re-picking) is a data change, not a refactor — a hard architectural rule.

**Launch gallery (all six ship; themes are pure color data, firm-picked, every theme in both light and dark):**

| Theme         | Character                                  | Role                               |
| ------------- | ------------------------------------------ | ---------------------------------- |
| **Chancery**  | Ink + gold                                 | Flagship / default                 |
| **Verdigris** | Aged-copper green + gold                   | Showcase — the calm differentiator |
| **Parchment** | Warm cream, sepia ink + gold               | Showcase — warm/light, "scholarly" |
| **Oxblood**   | Burgundy + gold                            | Showcase — bold, wax-seal heritage |
| **Aubergine** | Deep plum + gold                           | Showcase — regal/authority         |
| **Slate**     | Near-neutral charcoal, gold the only color | Showcase — quietest                |

A theme swaps the **whole semantic color layer** (surfaces, text, borders, primary/accent, all status colors — each theme's neutrals are tinted to suit, e.g. Parchment's are cream, Verdigris's stone-green), not a few swatches. Adding a theme later is one resolver input.

**Semantic color roles** (the only names components consume): `surface.{default,raised,sunken,overlay,scrim}` (scrim = the modal-backdrop wash: a shared, non-theme-varying near-black at low alpha — a light 25% dim so the page behind stays legible, with the dialog's elevation carrying focus), `text.{default,muted,subtle,inverse,link}`, `action.{primary,secondary,destructive}` (+ hover/active/disabled/foreground), `border.{default,strong,focus}`, `focus.ring`, `status.{info,success,warning,danger}` (+ foregrounds). Legal-domain statuses register here as their slices land: **trust, hold, conflict** (e.g. the gold "Trust held" chip, the danger "trust below minimum" alert).

**Gates (binding on the token package).** Every semantic foreground/background pairing the design language declares must clear **WCAG 2.2 AA** in **every theme × mode** (APCA computed as advisory only). A **high-contrast axis is reserved** in the resolver (the principled home for "I need stronger boundaries" — it strengthens borders and removes subtle shadows, and honors the OS `prefers-contrast` / forced-colors settings); unpopulated at launch.

---

## 4. Typography

**Reading endurance and accessibility over aesthetics** — the governing principle, owner-directed.

**The type scale is `rem`-based** (relative to the root font size). A user who increases their **OS or browser text size** scales the entire UI up to 200% for free — the single largest low-vision accommodation and a WCAG 1.4.4 requirement. This is structural and is built in now; px type is not used for text.

**Default reading font: Atkinson Hyperlegible Next** (Braille Institute, 2025; variable; **SIL OFL 1.1**; self-hosted). Making the everyday face the one engineered for legibility is the honest expression of principle 2. The brand's heritage does **not** live in the daily reading font.

**Typeface is a user axis** — a curated set, all open-licensed and self-hosted (in-custody, fast, no font-CDN dependency):

- **Atkinson Hyperlegible Next** — default; low-vision-designed (disambiguates I/l/1, O/0, rn/m — exactly the characters that bite in legal/financial data).
- **Lexend** — reading-proficiency-engineered (OFL); the endurance-forward alternate.
- **OpenDyslexic** — dyslexia option (OFL); offered, never the default (its texture is heavy for everyone).
- **System** — the OS-native stack; instant, zero-load.
- A **serif reading profile** is the only home a serif gets (an opt-in for users who prefer it).

**No serif headings in the default.** Headings are single-family and clean (the font axis must govern the whole UI — an OpenDyslexic user cannot have a decorative serif heading fighting their body text). Heritage character moves to color, the ceremonial edges, and the wordmark.

**Tabular figures are mandatory** for money, dates, IDs, and matter numbers — columns must align.

**Type scale (rem; root 16px baseline):** `xs` 0.75 / `sm` 0.875 / `md` 1.0 / `lg` 1.125 / `xl` 1.25 / `2xl` 1.5. Line-heights: tight 1.25, normal 1.5, relaxed 1.625. Weights: regular 400, medium 500, semibold 600/700. (Final per-step tuning happens against real components in the build; these are the workshop anchors.)

---

## 5. Space & density

**Balanced** is the launch default: comfortable targets that stay efficient on dense screens — reads as a polished native app, not a cramped terminal or a roomy toy. Control height **36px**, corner radius **~7px**, on a **4px spacing grid** (`space.0–24`, key stops 4/8/12/16/20/24/32/40/48/64/96).

**Density is a user accessibility axis** (§2): **Comfortable** (the Balanced default) and **Compact** (tighter rows/controls for power users and dense tables). A real second density is defined now so the axis is _proven_, not theoretical; the user control ships in 0·7b. The `density.*` semantic aliases (gutter, stack, control-height) make this additive.

**Radius scale:** none 0 / sm 2 / md 7 / lg 10 / full 9999. Tables and dense surfaces may sit a step tighter than cards.

---

## 6. Elevation & borders — flat and hairline

**Structure comes from 1px hairline rules and surface tints; shadow is reserved _only_ for elements that genuinely float** (dropdowns, dialogs, popovers, toasts). This is calm, print-clean, light, and keeps dense tables legible — and it is the most accessible of the options (crisp high-contrast boundaries beat ambiguous soft shadows for low vision). It suits the "restrained / manuscript" personality and the document/print register.

Elevation and borders are tokens (`--mc-elevation-*`, `--mc-border-*`), so the door is open to revisit — but they are a **decide-once global**, not a user knob (aesthetic micro-preference, neither accessibility nor brand). The legitimate "stronger boundaries" need routes to the reserved **high-contrast axis** instead. Elevation tokens: `0` (flat), `1`/`2`/`3` composite shadows used by floating layers only.

---

## 7. Motion

**Personality: crisp & functional** — purposeful, quick, just enough movement to orient the eye and show where things came from. Fast first, smooth second.

**Duration ladder** (a small named scale; the workshop tuned the entrance rung live): micro/hover **~120 ms**, normal/menus **~200 ms**, **entrance ~300 ms** (lists, dialogs), signature/page **500 ms+**. Owner-selected entrance feel: **linear easing, ~300 ms, ~75 ms stagger**. (Per-context easing is finalized against real components in the build; larger _movement_ may use a gentle decelerate while fades stay linear.)

**Motion is a user axis with three levels** (§2), the two "vibes" the workshop found being the ends of the scale:

- **Full** — expressive entrances (larger travel, the 300 ms feel).
- **Reduced** — motion still orients (shorter, near-zero travel, no large entrances).
- **Off** — instant.
  Default follows the OS `prefers-reduced-motion`. Implemented structurally via a **reduced-motion duration scalar** every animation multiplies by (drops to ~0), so compliance is structural, not per-component. A JS-side `prefersReducedMotion` gate is mandatory (CSS media queries do not stop JS engines; Playwright's `animations:'disabled'` does not freeze requestAnimationFrame).

**Stack** (per [`docs/research/motion-animation-stack.md`](../research/motion-animation-stack.md)): Svelte 5 built-ins + the Baseline View Transitions API cover all functional motion at ~0 kB; GSAP + DrawSVG + SplitText are lazy-loaded for **signature moments only** (the written-live wordmark, hero text). No Lottie/Rive runtime for the wordmark (a self-drawing SVG costs nothing).

---

## 8. Iconography

**Lucide** (`@lucide/svelte`, deep imports only — root-barrel imports banned by lint). Line icons, ~16px in dense UI, `currentColor` stroke. **No emojis anywhere** (golden rule 2).

---

## 9. Brand & signature elements

**Wordmark face: a custom wordmark built on an OFL base.** For launch the display/monogram face is **UnifrakturMaguntia** (blackletter; **SIL OFL**; free, self-hosted) — the authentic illuminated-initial tradition. The brand/display font is a **swappable token anchor** (like the brand color): a future bespoke face (owner side-project) is a drop-in.

> **Licensing note (load-bearing for a legal-software brand).** A wordmark is **artwork**, not a font — we only ever need "Magna Carta" as fixed lettering (SVG outline), never a typeface that types arbitrary text. The legitimate path to an owned, distinctive wordmark is **custom lettering drawn from scratch or customized from an OFL base** (the OFL grants modification/derivative rights). **P22 Morris (Golden)** was evaluated and **deferred**: its desktop EULA appears to restrict outlining glyphs into a standalone logo, and web use is a separate recurring license — using it as a logo would need written confirmation from P22. "Slightly altering" a commercial font to claim ownership is not legitimate (EULA breach + derivative of copyrighted font software) and is off the table. Any final face selection gets IP-counsel sign-off.

**The mark system:**

- **Illuminated "M" monogram** — the primary mark, favicon, and Tauri app icon. Carries every small/icon context (legible to a 16px favicon, where a spelled-out blackletter wordmark is not). Must be **optically centered** (blackletter caps have uneven sidebearings — geometric centering looks off); fixed when the asset is drawn.
- **"MC" monogram** — compact alternate.
- **Full "Magna Carta" wordmark** — ceremonial sizes only.
- **Lockup** — mark + wordmark + tagline.

**The signature heritage moments** (design language fixed here; each is _built_ where its surface lives — auth in 0·7b, empty states in 1·1, etc.):

1. **The "written-live" wordmark** — draws itself (calligraphy-mask + GSAP, lazy; static under reduced motion). Auth / loading.
2. **Illuminated initial monogram** — logo / favicon / Tauri icon (reduction-first).
3. **Clause XXIX hero excerpt** — the 1297 "law of the land" passage (public-domain; the most on-brand language) on auth / about / dashboard quote-of-the-day.
4. **Rotating foundational-law quotes** — loading screens cycle public-domain quotes (Magna Carta 1297, Justinian, Blackstone, _Gideon_, Nevada Constitution) **with accurate citations** (users are lawyers and will check).
5. **1297 statute text as faint background texture** on ceremonial surfaces — the operative OGL-licensed text, **never the 1215 text** (per [`docs/research/magna-carta-text-motif.md`](../research/magna-carta-text-motif.md)).

**Signature look:** **gold-on-vellum** (gold leaf on near-black) for ceremonial dark surfaces (sign-in, loading).

---

## 10. Out of scope / reserved seams

Built or decided elsewhere; named here so they are not re-litigated and the seams are honored now:

- **User-facing controls + admin RBAC policy** for the five axes — **slice 0·7b** (seams built now).
- **High-contrast axis** — reserved in the resolver, unpopulated; the home for stronger-boundary accessibility + OS `prefers-contrast`.
- **Client portal shell** — a future archetype (Phase 6); the requirement it imposes now is that **components are shell-agnostic** (render in app shell _and_ portal shell unchanged).
- **Per-firm arbitrary brand palettes** — the Culori script is built to author the gallery; exposing it to firms is a later upgrade, not a rebuild.
- **Final font selection / bespoke wordmark** — UnifrakturMaguntia is the launch face; a custom face is a drop-in (anchor).
- **Component (third-tier) tokens** — deferred until a real second consumer (Tauri theming, white-label) demands them; the semantic tier is the contract.

---

## 11. From language to tokens (build hand-off)

Encoding this language is the next build step (slice 0·7a plan, Tasks 7–8 onward): set the typography/spacing/radius/shadow/motion primitives to the values above; run the Culori `generate-theme` script for Chancery + the five showcase themes; extend `resolver.json` with the theme contexts and the (reserved) high-contrast axis; re-pin the golden files; keep all gates (purity, completeness, WCAG-AA contrast, golden) green. The component layer is then styled _to_ this language and the archetypes. **Model-split note (memory):** this is foundational work — Fable-built-and-reviewed by policy; with Fable soft-locked, the Opus-build-with-compensating-review-vs-wait decision is the owner's at the Phase D gate.
