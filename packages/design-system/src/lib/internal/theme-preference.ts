/*
 * The theme/mode/motion/density/contrast/typeface/text-size persistence seam.
 *
 * This module is the ONLY place the persisted appearance preferences are read or written — slice
 * 0.7b swaps the localStorage calls for the settings registry without touching anything else.
 *
 * MIRROR RULE: the inline no-FOUC boot script in apps/web/src/app.html duplicates this read+apply
 * logic (it must run before first paint, so it cannot import a module). Any change here — keys,
 * defaults, the dark-mode or motion resolution rules — must be mirrored there in the same commit.
 */

export type Mode = "light" | "dark" | "system";
/** The user motion axis (design language: full / reduced / off; "system" follows the OS). */
export type MotionPreference = "full" | "reduced" | "off" | "system";
/** The user density axis (design language: comfortable / compact). */
export type DensityPreference = "comfortable" | "compact";
/**
 * The user contrast axis. SEED-THEN-OWN: "system" is the internal UNSET encoding — a user who
 * has never chosen follows the OS `prefers-contrast: more` signal; the first explicit flip of
 * the High Contrast switch persists "standard"/"high" and owns the axis thereafter. The UI is a
 * two-state switch, never a three-option list.
 */
export type ContrastPreference = "standard" | "high" | "system";
/**
 * Whether the gilt scroll-edge rule is drawn (components/scroll-edge-hint). Shown by default: it
 * is the one affordance saying "there is more this way" where a surface hides its scrollbar or
 * cannot show one on that axis. A thin gold line that draws itself in at the edge of the chrome is
 * also movement in the corner of the eye, which is exactly what some people need less of, so it is
 * a preference rather than a fixture.
 */
export type ScrollEdgeHintPreference = "shown" | "hidden";
/**
 * The user typeface axis — the reading face (design language: a curated set, all open-licensed and
 * self-hosted). "atkinson" is the default and the primitive truth; "serif" is the one serif
 * reading profile; "system" is the operating system's own face and loads no web font at all.
 * No OS signal resolves this one: no platform reports a preferred reading face, so there is no
 * "system" seed to follow — "system" here names the FACE, not an unset encoding.
 */
export type TypefacePreference = "atkinson" | "lexend" | "opendyslexic" | "serif" | "system";
/**
 * The user text-size axis — the base size interface text renders at, as a whole PERCENTAGE of the
 * browser's own root size, from TEXT_SIZE_MINIMUM to TEXT_SIZE_MAXIMUM (owner-directed: a
 * percentage, not a set of named steps). 100 is the browser's own size and the primitive truth.
 * It is written as the root font size, so every rem type size follows and a browser or OS
 * text-size setting still compounds with it. Spacing, borders and control floors are px and
 * deliberately do not follow (the units policy in @magna-carta/design-tokens). No OS signal
 * resolves this one: the browser's own setting already IS that signal, and it applies underneath.
 */
export type TextSizePreference = number;
export const TEXT_SIZE_MINIMUM = 50;
export const TEXT_SIZE_MAXIMUM = 200;
export const DEFAULT_TEXT_SIZE: TextSizePreference = 100;

// Exported so the boot-script mirror test (test/boot-script-mirror.test.ts) can pin the literals
// the inline app.html script must contain — the keys are part of the persistence contract.
export const THEME_STORAGE_KEY = "magna-carta.theme";
export const MODE_STORAGE_KEY = "magna-carta.mode";
export const MOTION_STORAGE_KEY = "magna-carta.motion";
export const DENSITY_STORAGE_KEY = "magna-carta.density";
export const CONTRAST_STORAGE_KEY = "magna-carta.contrast";
export const SCROLL_EDGE_HINTS_STORAGE_KEY = "magna-carta.scrollEdgeHints";
export const TYPEFACE_STORAGE_KEY = "magna-carta.typeface";
export const TEXT_SIZE_STORAGE_KEY = "magna-carta.textSize";

export const DEFAULT_THEME = "chancery";
const DEFAULT_MODE: Mode = "system";
const DEFAULT_MOTION: MotionPreference = "system";
const DEFAULT_DENSITY: DensityPreference = "comfortable";
const DEFAULT_CONTRAST: ContrastPreference = "system";
const DEFAULT_SCROLL_EDGE_HINTS: ScrollEdgeHintPreference = "shown";
const DEFAULT_TYPEFACE: TypefacePreference = "atkinson";

function isMode(value: string | null): value is Mode {
  return value === "light" || value === "dark" || value === "system";
}

function isMotionPreference(value: string | null): value is MotionPreference {
  return value === "full" || value === "reduced" || value === "off" || value === "system";
}

function isDensityPreference(value: string | null): value is DensityPreference {
  return value === "comfortable" || value === "compact";
}

function isContrastPreference(value: string | null): value is ContrastPreference {
  return value === "standard" || value === "high" || value === "system";
}

function isScrollEdgeHintPreference(value: string | null): value is ScrollEdgeHintPreference {
  return value === "shown" || value === "hidden";
}

function isTypefacePreference(value: string | null): value is TypefacePreference {
  return (
    value === "atkinson" ||
    value === "lexend" ||
    value === "opendyslexic" ||
    value === "serif" ||
    value === "system"
  );
}

/** A stored size is a whole percentage in range; anything else is not a size. */
function parseTextSize(value: string | null): TextSizePreference | undefined {
  if (value === null || !/^\d{1,3}$/.test(value)) return undefined;
  const percent = Number(value);
  return percent >= TEXT_SIZE_MINIMUM && percent <= TEXT_SIZE_MAXIMUM ? percent : undefined;
}

/**
 * Reads the persisted appearance preferences. Unset or unrecognized stored values fall back to
 * the defaults (theme "chancery", mode "system", motion "system", density "comfortable",
 * contrast "standard", typeface "atkinson", text size 100) rather than leaking garbage into the unions.
 */
export function readThemePreference(): {
  theme: string;
  mode: Mode;
  motion: MotionPreference;
  density: DensityPreference;
  contrast: ContrastPreference;
  scrollEdgeHints: ScrollEdgeHintPreference;
  typeface: TypefacePreference;
  textSize: TextSizePreference;
} {
  const storedMode = localStorage.getItem(MODE_STORAGE_KEY);
  const storedMotion = localStorage.getItem(MOTION_STORAGE_KEY);
  const storedDensity = localStorage.getItem(DENSITY_STORAGE_KEY);
  const storedContrast = localStorage.getItem(CONTRAST_STORAGE_KEY);
  const storedScrollEdgeHints = localStorage.getItem(SCROLL_EDGE_HINTS_STORAGE_KEY);
  const storedTypeface = localStorage.getItem(TYPEFACE_STORAGE_KEY);
  const storedTextSize = localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
  return {
    theme: localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME,
    mode: isMode(storedMode) ? storedMode : DEFAULT_MODE,
    motion: isMotionPreference(storedMotion) ? storedMotion : DEFAULT_MOTION,
    density: isDensityPreference(storedDensity) ? storedDensity : DEFAULT_DENSITY,
    contrast: isContrastPreference(storedContrast) ? storedContrast : DEFAULT_CONTRAST,
    scrollEdgeHints: isScrollEdgeHintPreference(storedScrollEdgeHints)
      ? storedScrollEdgeHints
      : DEFAULT_SCROLL_EDGE_HINTS,
    typeface: isTypefacePreference(storedTypeface) ? storedTypeface : DEFAULT_TYPEFACE,
    textSize: parseTextSize(storedTextSize) ?? DEFAULT_TEXT_SIZE,
  };
}

/**
 * Applies a theme and mode to the document WITHOUT persisting anything: sets `data-theme` on
 * `<html>` and toggles the `dark` class (`mode === "dark"`, or `mode === "system"` when the
 * operating system prefers dark). The CSS custom-property cascade in @magna-carta/design-tokens
 * does the rest. Pure DOM application — the Storybook preview's theme/mode toolbar calls this
 * directly so flipping themes in the catalog never writes to the reviewer's localStorage.
 *
 * It also writes `color-scheme` as an inline style, which styles/base.css declares on this same
 * `dark` class. That is not a second opinion — it is the SAME fact, written where a stylesheet
 * cannot reach: a stylesheet is a separate request, and until it has arrived the browser is still
 * painting its canvas, scrollbars and form controls in the scheme it last knew. With `ssr = false`
 * behind an index.html fallback, that window is the whole boot against an empty body, so it is
 * exactly where the flash the base layer exists to end would otherwise survive. The inline boot
 * script in apps/web/src/app.html mirrors this line for the same reason.
 */
export function applyThemeToDocument(theme: string, mode: Mode): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const dark =
    mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

/**
 * Applies the motion level to the document WITHOUT persisting anything: sets `data-motion` on
 * `<html>`, which the token overlay blocks (`:root[data-motion="…"]`) key on to re-point the
 * duration ladder. "system" resolves the OS `prefers-reduced-motion` signal to reduced/full; a
 * resolved "full" removes the attribute (the primitive truth needs no overlay). JS-driven motion
 * reads the same attribute back through `internal/motion-preference.ts` — one axis, two readers.
 */
export function applyMotionToDocument(motion: MotionPreference): void {
  const resolved =
    motion === "system"
      ? matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "reduced"
        : "full"
      : motion;
  const root = document.documentElement;
  if (resolved === "full") delete root.dataset.motion;
  else root.dataset.motion = resolved;
}

/**
 * Applies the density level to the document WITHOUT persisting anything: sets `data-density` on
 * `<html>`, which the token overlay block (`:root[data-density="compact"]`) keys on to re-point
 * the density.* aliases. "comfortable" removes the attribute (the semantic truth needs no
 * overlay). Distinct from a table's local `data-row-density` View-menu option by design.
 */
export function applyDensityToDocument(density: DensityPreference): void {
  const root = document.documentElement;
  if (density === "comfortable") delete root.dataset.density;
  else root.dataset.density = density;
}

/**
 * Applies the contrast level to the document WITHOUT persisting anything: sets `data-contrast`
 * on `<html>`, which the high-contrast recipe rules (`:root[data-contrast="high"] …` in the
 * component recipes) key on. "system" resolves the OS `prefers-contrast: more` signal to
 * high/standard, mirroring how motion resolves its OS signal; a resolved "standard" removes the
 * attribute (the primitive truth needs no overlay).
 */
export function applyContrastToDocument(contrast: ContrastPreference): void {
  const resolved =
    contrast === "system"
      ? matchMedia("(prefers-contrast: more)").matches
        ? "high"
        : "standard"
      : contrast;
  const root = document.documentElement;
  if (resolved === "standard") delete root.dataset.contrast;
  else root.dataset.contrast = resolved;
}

/**
 * Applies the scroll-edge-hint preference to the document WITHOUT persisting anything: sets
 * `data-scroll-edge-hints` on `<html>`, which the ScrollEdgeHint recipe keys on to stop drawing.
 * "shown" removes the attribute (the primitive truth needs no overlay), exactly as a resolved
 * "full" motion and a "comfortable" density do.
 *
 * NO OS SIGNAL RESOLVES THIS ONE, and that is deliberate: `prefers-reduced-motion` already
 * shortens the rule's draw to instant (the recipe does that itself), and a person who wants less
 * movement has not thereby said they want less information about where a list ends. So this axis
 * is a plain two-state choice with no "system" encoding to seed from.
 *
 * IT IS ALSO THE ONE APPEARANCE AXIS THE NO-FOUC BOOT SCRIPT DOES NOT MIRROR. The boot script
 * exists to dress the FIRST PAINT, and nothing paints a scroll-edge rule before the application
 * mounts: the hint is a component that renders only once its scrollport reports there is more
 * content that way. There is no flash to end, so adding it to the inline script would widen the
 * duplicated surface the MIRROR RULE above governs for no gain.
 */
export function applyScrollEdgeHintsToDocument(preference: ScrollEdgeHintPreference): void {
  const root = document.documentElement;
  if (preference === "shown") delete root.dataset.scrollEdgeHints;
  else root.dataset.scrollEdgeHints = preference;
}

/**
 * Applies the reading face to the document WITHOUT persisting anything: sets `data-typeface` on
 * `<html>`, which the token overlay blocks (`:root[data-typeface="…"]`) key on to re-point
 * --mc-font-sans. "atkinson" removes the attribute (the primitive truth needs no overlay). Only
 * the reading face moves: the display serif, the blackletter mark and the monospace face keep
 * their own variables.
 */
export function applyTypefaceToDocument(typeface: TypefacePreference): void {
  const root = document.documentElement;
  if (typeface === "atkinson") delete root.dataset.typeface;
  else root.dataset.typeface = typeface;
}

/**
 * Applies the text size to the document WITHOUT persisting anything: writes the root font size as
 * an inline style on `<html>`, so every rem type size scales. An inline style rather than a
 * stylesheet rule keyed on an attribute, because the size is a number anywhere in its range, not
 * one of a few named steps. 100 clears it (the browser's own root size needs no declaration).
 */
export function applyTextSizeToDocument(textSize: TextSizePreference): void {
  const root = document.documentElement;
  root.style.fontSize = textSize === DEFAULT_TEXT_SIZE ? "" : `${textSize}%`;
}

/*
 * CROSS-TAB FOLLOW. The browser fires "storage" in every OTHER same-origin tab when a
 * localStorage key changes, so re-reading and re-applying here makes a theme/mode/motion/density
 * choice in one tab land in all of them instantly. The contract: last write wins (there is one
 * storage record; whichever tab persisted last is the truth every tab converges on), the
 * re-apply is pure DOM attribute writes and idempotent (re-applying the current value is a
 * no-op), and the writer tab never receives its own event — it already applied before
 * persisting. Registered once at module scope (one module instance per app), guarded so the
 * module stays importable during SSR/tests where `window` does not exist. `event.key === null`
 * means `storage.clear()` — every key may have changed, so re-apply then too.
 */
const APPEARANCE_STORAGE_KEYS: readonly string[] = [
  THEME_STORAGE_KEY,
  MODE_STORAGE_KEY,
  MOTION_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  CONTRAST_STORAGE_KEY,
  SCROLL_EDGE_HINTS_STORAGE_KEY,
  TYPEFACE_STORAGE_KEY,
  TEXT_SIZE_STORAGE_KEY,
];

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && !APPEARANCE_STORAGE_KEYS.includes(event.key)) return;
    const { theme, mode, motion, density, contrast, scrollEdgeHints, typeface, textSize } =
      readThemePreference();
    applyThemeToDocument(theme, mode);
    applyMotionToDocument(motion);
    applyDensityToDocument(density);
    applyContrastToDocument(contrast);
    applyScrollEdgeHintsToDocument(scrollEdgeHints);
    applyTypefaceToDocument(typeface);
    applyTextSizeToDocument(textSize);
  });
}

/**
 * Persists the preferences (all storage keys) and applies them to the document via the
 * `apply…ToDocument` seams. The app-facing entry point.
 */
export function applyThemePreference(
  theme: string,
  mode: Mode,
  motion: MotionPreference = "system",
  density: DensityPreference = "comfortable",
  contrast: ContrastPreference = "standard",
  scrollEdgeHints: ScrollEdgeHintPreference = "shown",
  typeface: TypefacePreference = "atkinson",
  textSize: TextSizePreference = DEFAULT_TEXT_SIZE,
): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  localStorage.setItem(MODE_STORAGE_KEY, mode);
  localStorage.setItem(MOTION_STORAGE_KEY, motion);
  localStorage.setItem(DENSITY_STORAGE_KEY, density);
  localStorage.setItem(CONTRAST_STORAGE_KEY, contrast);
  localStorage.setItem(SCROLL_EDGE_HINTS_STORAGE_KEY, scrollEdgeHints);
  localStorage.setItem(TYPEFACE_STORAGE_KEY, typeface);
  localStorage.setItem(TEXT_SIZE_STORAGE_KEY, String(textSize));
  applyThemeToDocument(theme, mode);
  applyMotionToDocument(motion);
  applyDensityToDocument(density);
  applyContrastToDocument(contrast);
  applyScrollEdgeHintsToDocument(scrollEdgeHints);
  applyTypefaceToDocument(typeface);
  applyTextSizeToDocument(textSize);
}
