/*
 * The appearance axes — ONE home for the instant-apply personalization machinery the Theme,
 * Accessibility and Text pages share. The axes are PAGE-LOCAL definitions, not registry entries: their
 * values live in the theme-preference storage the no-FOUC boot script reads
 * (@magna-carta/design-system/internal/theme-preference), not the settings store, so
 * registering them would put one fact in two homes. They move into the definitions registry
 * when the firm-wide theme default (and lock) arrives and the backend owns the value.
 *
 * Every apply persists through the one theme-preference seam AND appends to the owning page's
 * change ledger in the same breath; restore from a trail re-APPLIES immediately (appending its
 * own entry) — on an instant page a restore is just another instant change, append-only like
 * every other. History recorded under the retired "appearance" section id (the axes' previous
 * shared page) is left to age out — the ledger caps entries per section; new history appends
 * under "theme" / "accessibility".
 */

import {
  settingValueLabel,
  type SettingDefinition,
  type SettingValue,
} from "./settings-definitions.ts";
import {
  appendSettingsLedgerEntries,
  type SettingsLedgerEntry,
} from "./settings-ledger-store.svelte.ts";
import {
  applyThemePreference,
  readThemePreference,
  type ContrastPreference,
  type DensityPreference,
  type Mode,
  type MotionPreference,
  type ScrollEdgeHintPreference,
  type TypefacePreference,
} from "@magna-carta/design-system/internal/theme-preference";

interface AppearanceValues {
  theme: string;
  mode: Mode;
  motion: MotionPreference;
  density: DensityPreference;
  contrast: ContrastPreference;
  scrollEdgeHints: ScrollEdgeHintPreference;
  typeface: TypefacePreference;
}

function readInitialValues(): AppearanceValues {
  // The app is an SPA, but module init must not assume a browser (tests, prerender safety).
  if (typeof localStorage === "undefined") {
    return {
      theme: "chancery",
      mode: "system",
      motion: "system",
      density: "comfortable",
      contrast: "system",
      scrollEdgeHints: "shown",
      typeface: "atkinson",
    };
  }
  return readThemePreference();
}

const values = $state<AppearanceValues>(readInitialValues());

function persistAndApply(): void {
  applyThemePreference(
    values.theme,
    values.mode,
    values.motion,
    values.density,
    values.contrast,
    values.scrollEdgeHints,
    values.typeface,
  );
}

/** One personalization axis: its definition, its live value, and its typed setter. */
export interface AppearanceAxis {
  /** The settings section whose ledger this axis's changes append to. */
  readonly sectionId: string;
  readonly definition: SettingDefinition;
  readonly current: () => string;
  readonly set: (value: string) => void;
}

/** Apply an axis change and append it to the owning section's trail in the same breath. */
export function applyAppearanceAxis(axis: AppearanceAxis, next: string): void {
  const current = axis.current();
  if (next === current) return;
  axis.set(next);
  persistAndApply();
  appendSettingsLedgerEntries(axis.sectionId, [
    {
      settingId: axis.definition.id,
      label: axis.definition.label,
      from: settingValueLabel(axis.definition, current),
      to: settingValueLabel(axis.definition, next),
    },
  ]);
}

/** The settings-row `instant` contract for an axis. */
export function instantForAxis(axis: AppearanceAxis): {
  value: SettingValue;
  apply: (next: SettingValue) => void;
} {
  return {
    value: axis.current(),
    apply: (next) => applyAppearanceAxis(axis, String(next)),
  };
}

// ─── Theme page axes (Mode lives HERE, not Accessibility: light/dark is the theme's own axis —
//     every theme ships a light and a dark cut, so the pair is one brand decision). ───────────

export const THEME_DEFINITION: SettingDefinition = {
  id: "theme.theme",
  sectionId: "theme",
  label: "Theme",
  description: "Six curated themes, each in light and dark; the firm's brand choice.",
  kind: "select",
  options: [
    { value: "chancery", label: "Chancery — ink & gold (flagship)" },
    { value: "verdigris", label: "Verdigris — aged copper" },
    { value: "parchment", label: "Parchment — warm cream" },
    { value: "oxblood", label: "Oxblood — burgundy" },
    { value: "aubergine", label: "Aubergine — deep plum" },
    { value: "slate", label: "Slate — near neutral" },
  ],
  defaultValue: "chancery",
  sensitivity: "open",
};

export const MODE_DEFINITION: SettingDefinition = {
  id: "theme.mode",
  sectionId: "theme",
  label: "Mode",
  description: "Light, dark, or follow your system.",
  kind: "select",
  options: [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "Match my system" },
  ],
  defaultValue: "system",
  sensitivity: "open",
};

export const THEME_AXIS: AppearanceAxis = {
  sectionId: "theme",
  definition: THEME_DEFINITION,
  current: () => values.theme,
  set: (value) => (values.theme = value),
};

export const MODE_AXIS: AppearanceAxis = {
  sectionId: "theme",
  definition: MODE_DEFINITION,
  current: () => values.mode,
  set: (value) => (values.mode = value as Mode),
};

// ─── Accessibility page axes (Density lives HERE: how tightly the interface packs is reading
//     ergonomics, not brand). ─────────────────────────────────────────────────────────────────

export const DENSITY_DEFINITION: SettingDefinition = {
  id: "accessibility.density",
  sectionId: "accessibility",
  label: "Density",
  description: "How tightly rows and controls pack.",
  kind: "select",
  options: [
    { value: "comfortable", label: "Comfortable" },
    { value: "compact", label: "Compact — tighter rows and controls" },
  ],
  defaultValue: "comfortable",
  sensitivity: "open",
};

export const MOTION_DEFINITION: SettingDefinition = {
  id: "accessibility.motion",
  sectionId: "accessibility",
  label: "Motion",
  description: "How much the interface moves — full, quieter, or none.",
  kind: "select",
  options: [
    { value: "full", label: "Full" },
    { value: "reduced", label: "Reduced — shorter, quieter" },
    { value: "off", label: "Off — instant" },
    { value: "system", label: "Match my system" },
  ],
  defaultValue: "system",
  sensitivity: "open",
};

export const DENSITY_AXIS: AppearanceAxis = {
  sectionId: "accessibility",
  definition: DENSITY_DEFINITION,
  current: () => values.density,
  set: (value) => (values.density = value as DensityPreference),
};

export const MOTION_AXIS: AppearanceAxis = {
  sectionId: "accessibility",
  definition: MOTION_DEFINITION,
  current: () => values.motion,
  set: (value) => (values.motion = value as MotionPreference),
};

// ─── Text page axis (the reading face: how interface text reads is the person's own, never the
//     firm's — the firm owns the brand, the individual owns how they read). ─────────────────────

/*
 * The setting id keeps the name the Text page's placeholder row carried ("text.font-family"), so
 * the page's change ledger reads as one history from the first live choice on.
 */
export const TYPEFACE_DEFINITION: SettingDefinition = {
  id: "text.font-family",
  sectionId: "text",
  label: "Font Family",
  description:
    "The reading typeface across the interface. Page titles and the firm's mark keep their own faces.",
  kind: "select",
  options: [
    { value: "atkinson", label: "Atkinson Hyperlegible — built for legibility (default)" },
    { value: "lexend", label: "Lexend — built for reading endurance" },
    { value: "opendyslexic", label: "OpenDyslexic — for dyslexic readers" },
    { value: "serif", label: "Literata — a serif for long reading" },
    { value: "system", label: "System — your device's own face" },
  ],
  defaultValue: "atkinson",
  sensitivity: "open",
};

export const TYPEFACE_AXIS: AppearanceAxis = {
  sectionId: "text",
  definition: TYPEFACE_DEFINITION,
  current: () => values.typeface,
  set: (value) => (values.typeface = value as TypefacePreference),
};

/*
 * High Contrast is a SWITCH, not a dropdown: the dropdowns-over-radios rule governs enumerated
 * OPTION LISTS — a genuine boolean is a switch (owner-directed). The OS signal rides the
 * SEED-THEN-OWN contract (theme-preference.ts): an unchosen contrast follows
 * `prefers-contrast: more`; the first flip persists an explicit standard/high and owns the
 * axis thereafter.
 */
export const HIGH_CONTRAST_DEFINITION: SettingDefinition = {
  id: "accessibility.high-contrast",
  sectionId: "accessibility",
  label: "High Contrast",
  description: "Stronger outlines on toggles and controls, so states stay distinct.",
  kind: "switch",
  defaultValue: false,
  sensitivity: "open",
};

/** The switch's truth: an explicit choice wins; unset resolves the OS signal (seed-then-own). */
export function highContrastActive(): boolean {
  return (
    values.contrast === "high" ||
    (values.contrast === "system" &&
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-contrast: more)").matches)
  );
}

export function applyHighContrast(next: boolean): void {
  const current = highContrastActive();
  if (next === current) return;
  // The explicit flip owns the axis from here on — never write "system" back.
  values.contrast = next ? "high" : "standard";
  persistAndApply();
  appendSettingsLedgerEntries(HIGH_CONTRAST_DEFINITION.sectionId, [
    {
      settingId: HIGH_CONTRAST_DEFINITION.id,
      label: HIGH_CONTRAST_DEFINITION.label,
      from: settingValueLabel(HIGH_CONTRAST_DEFINITION, current),
      to: settingValueLabel(HIGH_CONTRAST_DEFINITION, next),
    },
  ]);
}

/**
 * A history-restore resolver over a page's axes: labels map back to raw values through each
 * axis's own options; the two switches (High Contrast, Scroll Edge Markers) restore through their
 * On/Off labels. A label that no longer maps yields null (the trail hides Restore for it).
 */
/*
 * Scroll Edge Markers — the gilt rule that draws at the edge of a scroll area while there is more
 * content that way (above and below the sidebar's nav list, left and right of a register). A
 * SWITCH, on the High Contrast reasoning: a genuine boolean is a switch, and the dropdowns-over-
 * radios rule governs enumerated option lists.
 *
 * NO SEED-THEN-OWN HERE, unlike contrast. Reduced motion already shortens the rule's draw to
 * instant in the recipe itself, and wanting less movement is not the same as wanting less
 * information about where a list ends — so there is no OS signal to follow and no "system"
 * encoding, just shown or hidden.
 */
export const SCROLL_EDGE_HINTS_DEFINITION: SettingDefinition = {
  id: "accessibility.scroll-edge-hints",
  sectionId: "accessibility",
  label: "Scroll Edge Markers",
  description:
    "A thin gold rule at the edge of a list or table while there is more to see that way.",
  kind: "switch",
  defaultValue: true,
  sensitivity: "open",
};

export function scrollEdgeHintsShown(): boolean {
  return values.scrollEdgeHints === "shown";
}

export function applyScrollEdgeHints(next: boolean): void {
  const current = scrollEdgeHintsShown();
  if (next === current) return;
  values.scrollEdgeHints = next ? "shown" : "hidden";
  persistAndApply();
  appendSettingsLedgerEntries(SCROLL_EDGE_HINTS_DEFINITION.sectionId, [
    {
      settingId: SCROLL_EDGE_HINTS_DEFINITION.id,
      label: SCROLL_EDGE_HINTS_DEFINITION.label,
      from: settingValueLabel(SCROLL_EDGE_HINTS_DEFINITION, current),
      to: settingValueLabel(SCROLL_EDGE_HINTS_DEFINITION, next),
    },
  ]);
}

export function appearanceRestoreAction(
  axes: readonly AppearanceAxis[],
): (entry: SettingsLedgerEntry) => (() => void) | null {
  return (entry) => {
    if (entry.settingId === SCROLL_EDGE_HINTS_DEFINITION.id) {
      if (entry.from !== "On" && entry.from !== "Off") return null;
      const restoredScrollEdgeHints = entry.from === "On";
      return () => applyScrollEdgeHints(restoredScrollEdgeHints);
    }
    if (entry.settingId === HIGH_CONTRAST_DEFINITION.id) {
      if (entry.from !== "On" && entry.from !== "Off") return null;
      const restoredHighContrast = entry.from === "On";
      return () => applyHighContrast(restoredHighContrast);
    }
    const axis = axes.find((candidate) => candidate.definition.id === entry.settingId);
    if (axis === undefined) return null;
    const restoredValue = axis.definition.options?.find(
      (option) => option.label === entry.from,
    )?.value;
    if (restoredValue === undefined) return null;
    return () => applyAppearanceAxis(axis, restoredValue);
  };
}
