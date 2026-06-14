/*
 * Storybook preview configuration: the global theme x mode toolbar and the a11y gate.
 *
 * The toolbar drives the same pure DOM seam the app uses — applyThemeToDocument sets
 * `data-theme` and toggles the `dark` class on the preview iframe's <html>, persisting nothing
 * (flipping themes in the catalog never writes to the reviewer's localStorage). The token
 * custom-property cascade in preview.css does the rest.
 */
import type { Preview } from "@storybook/svelte-vite";
import {
  applyThemeToDocument,
  DEFAULT_THEME,
  type Mode,
} from "../src/lib/internal/theme-preference.ts";
// The theme x mode matrix lives in ./catalog-matrix.ts (CSS-free, so the Playwright
// visual-regression sweep can import the same single source — see that file's header).
import { CATALOG_MODES, CATALOG_THEMES } from "./catalog-matrix.ts";
import "./preview.css";

function humanLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Firm theme (token set)",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: CATALOG_THEMES.map((theme) => ({ value: theme, title: humanLabel(theme) })),
        dynamicTitle: true,
      },
    },
    mode: {
      description: "Color mode",
      toolbar: {
        title: "Mode",
        icon: "mirror",
        items: CATALOG_MODES.map((mode) => ({ value: mode, title: humanLabel(mode) })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: DEFAULT_THEME,
    mode: "light",
  },
  decorators: [
    (story, context) => {
      applyThemeToDocument(String(context.globals.theme), context.globals.mode as Mode);
      return story();
    },
  ],
  parameters: {
    a11y: {
      // "error": axe violations FAIL the story's test (Storybook UI and the addon-vitest
      // browser run), not just warn — the catalog is a gate, not a dashboard.
      test: "error",
    },
    // `ref` is the bindable element reference (the WithElementRef pattern) — an imperative escape
    // hatch, not a configurable prop. Hide it from every component's Controls + Properties table.
    // (Bits stories already curate via controls.include; this covers the native components.)
    // `sort: "alpha"` forces a consistent property order everywhere — svelte-docgen's own order is
    // non-deterministic across components (Textarea kept declaration order, FileInput went alpha).
    controls: { exclude: ["ref"], sort: "alpha" },
  },
  // Enable autodocs (addon-docs) for every component: each gets a generated Docs tab from its
  // stories. With one story per distinct display, that page reads as a clean spec, not duplicates.
  tags: ["autodocs"],
};

export default preview;
