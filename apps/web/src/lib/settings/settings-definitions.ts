/*
 * The per-setting definitions registry — data, not markup, one row per setting the settings
 * pages render. This module deliberately mirrors the shape the backend's firm-setting
 * definitions will take, so the two converge instead of drifting: when firm accounts arrive,
 * these rows become the seed of the server-side registry and the pages keep rendering from
 * the same contract.
 *
 * PURE DATA. No storage imports, no browser globals — the mode-purity fitness check
 * (apps/web/test/settings-mode-purity.test.ts) imports this module under node and asserts the
 * registry's invariants against the section registry (settings-sections.ts). Committed values
 * and drafts live in settings-draft.svelte.ts; this module only says what the settings ARE.
 */

/**
 * A setting's value, in the vocabulary its kind speaks: a string for select and text, a boolean
 * for switch, a number for number. Deliberately not "always a string": a numeric setting stringly
 * typed compares "500" against 500 at every staging boundary, and the one place that forgets the
 * conversion stages a change the user never made.
 */
export type SettingValue = string | boolean | number;

/**
 * Enumerated settings render as dropdowns, never radio groups — owner preference: a dropdown
 * makes the option set clearer and spends less vertical space. There is deliberately no
 * "radio" kind.
 */
export type SettingKind = "select" | "switch" | "text" | "number";

export interface SettingOption {
  readonly value: string;
  readonly label: string;
}

export interface SettingDefinition {
  /** Dot-namespaced by section, e.g. "billing.time-increment". */
  readonly id: string;
  /** Foreign key to SettingsSection.id (settings-sections.ts). */
  readonly sectionId: string;
  /**
   * The engraved-table plate (category group of rows) this setting renders under on its page.
   * Definitions sharing a plateLabel render as one framed group; omitted definitions gather
   * under "General".
   */
  readonly plateLabel?: string;
  /**
   * User-facing setting name — Title Case ("Time Increment"), owner-directed; descriptions
   * stay sentence case.
   */
  readonly label: string;
  /**
   * One muted line under the name — REQUIRED (owner-directed: every setting carries a
   * descriptor), sentence case, intent not implementation.
   */
  readonly description: string;
  readonly kind: SettingKind;
  /** select only. */
  readonly options?: readonly SettingOption[];
  /**
   * number only: the closed interval the field accepts, mirroring the bounds the backend's own
   * setting schema enforces at the write path. Both are REQUIRED on a number definition (the
   * mode-purity check enforces it): a numeric setting with no stated ceiling renders as a field
   * that will take anything and be refused by the server, which teaches the wrong thing about
   * what the firm may choose.
   */
  readonly minimum?: number;
  readonly maximum?: number;
  /**
   * number only: the unit noun the value counts, singular — "question", "day". The row appends it
   * to the stated value so a bare integer never has to be guessed at ("500 questions", not "500").
   */
  readonly unit?: string;
  readonly defaultValue: SettingValue;
  /**
   * "open": visible read-only to every member even without edit rights. "restricted": absent
   * for members without the edit permission — never a locked box advertising a secret.
   */
  readonly sensitivity: "open" | "restricted";
  /**
   * Consequential: committing a staged change to this setting requires the save-flow
   * confirmation step.
   */
  readonly confirm?: true;
  /** Changes to this setting land in the firm audit trail when the backend arrives. */
  readonly audited?: true;
}

/*
 * ONLY REAL SETTINGS (owner-directed): every row here mirrors something that actually exists
 * server-side. Earlier demonstration rows with no backend counterpart (a retainer-floor alert
 * switch, a week-start select, an SSO-enforcement switch) were deleted for that reason — as a
 * consequence NO current row exercises `confirm: true` or `sensitivity: "restricted"`; both
 * mechanisms stay built and covered (types, draft store, confirm dialog, visibility filtering)
 * and light up with the first real consequential or restricted setting.
 *
 * The week-start select came back as a REAL firm setting (GET/PATCH /api/v1/calendar/settings),
 * and it is deliberately not a row here: this registry's committed values live in local storage,
 * and a firm setting with a server behind it must not keep a per-browser copy that can disagree
 * with it. Its definition sits beside its server-backed draft in
 * src/lib/calendar/calendar-settings-draft.svelte.ts, which the Calendar settings page renders
 * through the same row and footer as every other draft page.
 */
export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  // Section "billing" — mirrors the backend's scoped time-capture settings.
  {
    id: "billing.time-increment",
    sectionId: "billing",
    plateLabel: "Time Capture",
    label: "Time Increment",
    description: "The smallest unit a time entry rounds to on invoices.",
    kind: "select",
    // Mirrors backend `time.increment_minutes`, which accepts ANY positive integer and can be
    // scoped per matter/client/timekeeper — the 6/15 menu is the common-case presentation;
    // revisit when this row wires to the real API.
    options: [
      { value: "6", label: "6 minutes (0.1 hour)" },
      { value: "15", label: "15 minutes (0.25 hour)" },
    ],
    defaultValue: "6",
    sensitivity: "open",
  },
  {
    id: "billing.time-rounding",
    sectionId: "billing",
    plateLabel: "Time Capture",
    label: "Time Rounding",
    description: "How a time entry that falls between increments lands.",
    kind: "select",
    // Matches backend `time.rounding_direction` exactly: enum ["up", "nearest", "down"],
    // default "nearest".
    options: [
      { value: "nearest", label: "Round to the nearest increment" },
      { value: "up", label: "Always round up" },
      { value: "down", label: "Always round down" },
    ],
    defaultValue: "nearest",
    sensitivity: "open",
  },
  // Section "firm-profile"
  {
    // The firm's name really exists on the control plane, so the read-only display is honest;
    // member EDITING of it arrives with a real display-name field on the backend.
    id: "firm.display-name",
    sectionId: "firm-profile",
    plateLabel: "Identity",
    label: "Firm Display Name",
    description: "The name on invoices, the client portal, and generated documents.",
    kind: "text",
    defaultValue: "Goldsmith & Associates",
    sensitivity: "open",
  },
  // The earlier interim Matter Numbering row (a two-preset enum summarizing the real
  // segment-template model) moved out: the dedicated Matter Numbering section under Practice
  // supersedes it — see /settings/matter-numbering.
];

/** Every definition registered to a section, in registry order. */
export function settingsForSection(sectionId: string): readonly SettingDefinition[] {
  return SETTING_DEFINITIONS.filter((definition) => definition.sectionId === sectionId);
}

/**
 * Definitions a member without the section's edit permission may see (sensitivity "open").
 * Restricted definitions are dropped entirely — never rendered as a locked box advertising
 * a secret.
 */
export function visibleSettingsForSection(
  sectionId: string,
  canEdit: boolean,
): readonly SettingDefinition[] {
  const definitions = settingsForSection(sectionId);
  return canEdit
    ? definitions
    : definitions.filter((definition) => definition.sensitivity === "open");
}

/**
 * A section's visible settings grouped into engraved-table plates, in registry order (a plate's
 * position follows its first definition). Definitions without a plateLabel gather under
 * "General".
 */
export function platesForSection(
  sectionId: string,
  canEdit: boolean,
): ReadonlyArray<{ label: string; definitions: readonly SettingDefinition[] }> {
  const plates: { label: string; definitions: SettingDefinition[] }[] = [];
  for (const definition of visibleSettingsForSection(sectionId, canEdit)) {
    const label = definition.plateLabel ?? "General";
    const plate = plates.find((candidate) => candidate.label === label);
    if (plate === undefined) {
      plates.push({ label, definitions: [definition] });
    } else {
      plate.definitions.push(definition);
    }
  }
  return plates;
}

/**
 * Human label for a value: the option label for select, "On"/"Off" for a switch, the string
 * itself for text.
 */
export function settingValueLabel(definition: SettingDefinition, value: SettingValue): string {
  switch (definition.kind) {
    case "switch":
      return value === true ? "On" : "Off";
    case "select": {
      const option = definition.options?.find((candidate) => candidate.value === value);
      // A value with no matching option (stale storage from an older build) still needs a
      // label somewhere — the raw value is the honest fallback.
      return option ? option.label : String(value);
    }
    case "text":
      return String(value);
    case "number": {
      // The unit is part of the value's meaning, so it travels with every place the value is
      // stated: the engraved row, the "Was:" badge, and the commit footer's recap. A count of 1
      // takes the singular; everything else, including 0, takes the plural.
      const count = Number(value);
      if (definition.unit === undefined || Number.isNaN(count)) return String(value);
      return `${count.toLocaleString()} ${definition.unit}${count === 1 ? "" : "s"}`;
    }
  }
}
