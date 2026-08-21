/*
 * The theme/mode/motion persistence seam.
 *
 * This module is the ONLY place the persisted appearance preferences are read or written — slice
 * 0.7b swaps the localStorage calls for the settings registry without touching anything else.
 *
 * MIRROR RULE: the inline no-FOUC boot script in apps/web-worker/src/app.html duplicates this read+apply
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

// Exported so the boot-script mirror test (test/boot-script-mirror.test.ts) can pin the literals
// the inline app.html script must contain — the keys are part of the persistence contract.
export const THEME_STORAGE_KEY = "magna-carta.theme";
export const MODE_STORAGE_KEY = "magna-carta.mode";
export const MOTION_STORAGE_KEY = "magna-carta.motion";
export const DENSITY_STORAGE_KEY = "magna-carta.density";
export const CONTRAST_STORAGE_KEY = "magna-carta.contrast";

export const DEFAULT_THEME = "chancery";
const DEFAULT_MODE: Mode = "system";
const DEFAULT_MOTION: MotionPreference = "system";
const DEFAULT_DENSITY: DensityPreference = "comfortable";
const DEFAULT_CONTRAST: ContrastPreference = "system";

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

/**
 * Reads the persisted appearance preferences. Unset or unrecognized stored values fall back to
 * the defaults (theme "chancery", mode "system", motion "system", density "comfortable",
 * contrast "standard") rather than leaking garbage into the unions.
 */
export function readThemePreference(): {
  theme: string;
  mode: Mode;
  motion: MotionPreference;
  density: DensityPreference;
  contrast: ContrastPreference;
} {
  const storedMode = localStorage.getItem(MODE_STORAGE_KEY);
  const storedMotion = localStorage.getItem(MOTION_STORAGE_KEY);
  const storedDensity = localStorage.getItem(DENSITY_STORAGE_KEY);
  const storedContrast = localStorage.getItem(CONTRAST_STORAGE_KEY);
  return {
    theme: localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME,
    mode: isMode(storedMode) ? storedMode : DEFAULT_MODE,
    motion: isMotionPreference(storedMotion) ? storedMotion : DEFAULT_MOTION,
    density: isDensityPreference(storedDensity) ? storedDensity : DEFAULT_DENSITY,
    contrast: isContrastPreference(storedContrast) ? storedContrast : DEFAULT_CONTRAST,
  };
}

/**
 * Applies a theme and mode to the document WITHOUT persisting anything: sets `data-theme` on
 * `<html>` and toggles the `dark` class (`mode === "dark"`, or `mode === "system"` when the
 * operating system prefers dark). The CSS custom-property cascade in @magna-carta/design-tokens
 * does the rest. Pure DOM application — the Storybook preview's theme/mode toolbar calls this
 * directly so flipping themes in the catalog never writes to the reviewer's localStorage.
 */
export function applyThemeToDocument(theme: string, mode: Mode): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const dark =
    mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
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
// Deliberately an array, not a Set. `unicorn/prefer-set-has` autofixes this to `new Set([...])` and
// leaves the annotation, which does not compile; the membership test runs once per storage event over
// five keys, so there is nothing to win here anyway.
const APPEARANCE_STORAGE_KEYS: readonly string[] = [
  THEME_STORAGE_KEY,
  MODE_STORAGE_KEY,
  MOTION_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  CONTRAST_STORAGE_KEY,
];

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && !APPEARANCE_STORAGE_KEYS.includes(event.key)) return;
    const { theme, mode, motion, density, contrast } = readThemePreference();
    applyThemeToDocument(theme, mode);
    applyMotionToDocument(motion);
    applyDensityToDocument(density);
    applyContrastToDocument(contrast);
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
): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  localStorage.setItem(MODE_STORAGE_KEY, mode);
  localStorage.setItem(MOTION_STORAGE_KEY, motion);
  localStorage.setItem(DENSITY_STORAGE_KEY, density);
  localStorage.setItem(CONTRAST_STORAGE_KEY, contrast);
  applyThemeToDocument(theme, mode);
  applyMotionToDocument(motion);
  applyDensityToDocument(density);
  applyContrastToDocument(contrast);
}
