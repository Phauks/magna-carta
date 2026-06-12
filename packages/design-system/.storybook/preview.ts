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
import "./preview.css";

// The themes the catalog can switch between. Hardcoded to the provisional flagship for now —
// the Phase B design-language workshop extends this list as showcase themes land (each new
// theme is one entry here; the toolbar, decorator, and visual-regression matrix follow).
export const CATALOG_THEMES: readonly string[] = [DEFAULT_THEME];

// Modes the catalog toggles. "system" is deliberately absent: the catalog is a review surface,
// so the reviewer picks an explicit mode rather than inheriting the operating system's.
const CATALOG_MODES: readonly Mode[] = ["light", "dark"];

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
  },
};

export default preview;
