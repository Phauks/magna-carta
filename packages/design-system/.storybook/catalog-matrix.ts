/*
 * The catalog's theme x mode matrix — the single source for BOTH the Storybook toolbar
 * (./preview.ts) and the Playwright visual-regression sweep (../visual-regression/catalog.spec.ts).
 *
 * It lives in its own CSS-free module because the visual-regression spec runs under Playwright's
 * test loader, which cannot import ./preview.ts (that file imports preview.css — a Vite-only
 * import). Adding a theme here is the whole job: the toolbar, the decorator, and the
 * visual-regression matrix all follow automatically.
 */
import { type Mode } from "../src/lib/internal/theme-preference.ts";

// The themes the catalog can switch between — the flagship Chancery (Ink & Gold) first, then the
// showcase gallery (each has a tokens/themes/*.json override + a generated [data-theme] block).
// Adding a theme is one entry here: the toolbar, the decorator, and the visual-regression matrix
// all follow. Keep in sync with packages/design-tokens/tokens/themes/.
export const CATALOG_THEMES: readonly string[] = [
  "chancery",
  "slate",
  "verdigris",
  "parchment",
  "oxblood",
  "aubergine",
];

// Modes the catalog toggles. "system" is deliberately absent: the catalog is a review surface,
// so the reviewer picks an explicit mode rather than inheriting the operating system's — and the
// visual-regression sweep needs deterministic modes, not the host's preference.
export const CATALOG_MODES: readonly Mode[] = ["light", "dark"];
