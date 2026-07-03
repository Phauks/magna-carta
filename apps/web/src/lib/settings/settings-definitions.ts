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

export type SettingValue = string | boolean;

export type SettingKind = "select" | "radio" | "switch" | "text";

export interface SettingOption {
  readonly value: string;
  readonly label: string;
}

export interface SettingDefinition {
  /** Dot-namespaced by section, e.g. "billing.time-increment". */
  readonly id: string;
  /** Foreign key to SettingsSection.id (settings-sections.ts). */
  readonly sectionId: string;
  readonly label: string;
  readonly description?: string;
  readonly kind: SettingKind;
  /** select and radio only. */
  readonly options?: readonly SettingOption[];
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

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  // Section "billing"
  {
    id: "billing.time-increment",
    sectionId: "billing",
    label: "Time increment",
    description: "The smallest unit a time entry rounds to on invoices.",
    kind: "select",
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
    label: "Time rounding",
    description: "How a time entry that falls between increments lands.",
    kind: "radio",
    options: [
      { value: "nearest", label: "Round to the nearest increment" },
      { value: "up", label: "Always round up" },
    ],
    defaultValue: "nearest",
    sensitivity: "open",
  },
  {
    id: "billing.retainer-floor-alerts",
    sectionId: "billing",
    label: "Retainer floor alerts",
    description:
      "Alert the responsible attorney when a matter's retainer balance falls below its floor. " +
      "Turning this safeguard off is consequential — work can proceed unfunded without anyone noticing.",
    kind: "switch",
    defaultValue: true,
    sensitivity: "open",
    confirm: true,
    audited: true,
  },
  // Section "firm-profile"
  {
    id: "firm.display-name",
    sectionId: "firm-profile",
    label: "Firm display name",
    description: "The name on invoices, the client portal, and generated documents.",
    kind: "text",
    defaultValue: "Goldsmith & Associates",
    sensitivity: "open",
  },
  {
    id: "firm.matter-numbering",
    sectionId: "firm-profile",
    label: "Matter numbering",
    description: "The scheme new matter numbers follow.",
    kind: "select",
    options: [
      { value: "year-sequence", label: "MAT-2026-0001 — year and sequence" },
      { value: "practice-prefix", label: "LIT-26-0001 — practice-area prefix" },
    ],
    defaultValue: "year-sequence",
    sensitivity: "open",
    audited: true,
  },
  {
    id: "firm.week-start",
    sectionId: "firm-profile",
    label: "Week starts on",
    kind: "select",
    options: [
      { value: "monday", label: "Monday" },
      { value: "sunday", label: "Sunday" },
    ],
    defaultValue: "monday",
    sensitivity: "open",
  },
  {
    // Security posture stays invisible to members without firm administration rights —
    // "restricted", so the setting is absent for them rather than shown locked.
    id: "firm.sso-enforcement",
    sectionId: "firm-profile",
    label: "Enforce single sign-on",
    description:
      "Require every member to sign in through the firm's identity provider; password sign-in is disabled.",
    kind: "switch",
    defaultValue: false,
    sensitivity: "restricted",
    confirm: true,
    audited: true,
  },
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
 * Human label for a value: the option label for select/radio, "On"/"Off" for a switch, the
 * string itself for text.
 */
export function settingValueLabel(definition: SettingDefinition, value: SettingValue): string {
  switch (definition.kind) {
    case "switch":
      return value === true ? "On" : "Off";
    case "select":
    case "radio": {
      const option = definition.options?.find((candidate) => candidate.value === value);
      // A value with no matching option (stale storage from an older build) still needs a
      // label somewhere — the raw value is the honest fallback.
      return option ? option.label : String(value);
    }
    case "text":
      return String(value);
  }
}
