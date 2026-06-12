/*
 * The theme/mode persistence seam.
 *
 * This module is the ONLY place the persisted theme preference is read or written — slice 0.7b
 * swaps the localStorage calls for the settings registry without touching anything else.
 *
 * MIRROR RULE: the inline no-FOUC boot script in apps/web/src/app.html duplicates this read+apply
 * logic (it must run before first paint, so it cannot import a module). Any change here — keys,
 * defaults, the dark-mode resolution rule — must be mirrored there in the same commit.
 */

export type Mode = "light" | "dark" | "system";

// Exported so the boot-script mirror test (test/boot-script-mirror.test.ts) can pin the literals
// the inline app.html script must contain — the keys are part of the persistence contract.
export const THEME_STORAGE_KEY = "magna-carta.theme";
export const MODE_STORAGE_KEY = "magna-carta.mode";

export const DEFAULT_THEME = "slate";
const DEFAULT_MODE: Mode = "system";

function isMode(value: string | null): value is Mode {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Reads the persisted theme preference. Unset or unrecognized stored values fall back to the
 * defaults (theme "slate", mode "system") rather than leaking garbage into the Mode union.
 */
export function readThemePreference(): { theme: string; mode: Mode } {
  const storedMode = localStorage.getItem(MODE_STORAGE_KEY);
  return {
    theme: localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME,
    mode: isMode(storedMode) ? storedMode : DEFAULT_MODE,
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
 * Persists the preference (both storage keys) and applies it to the document via
 * `applyThemeToDocument`. The app-facing entry point.
 */
export function applyThemePreference(theme: string, mode: Mode): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  localStorage.setItem(MODE_STORAGE_KEY, mode);
  applyThemeToDocument(theme, mode);
}
