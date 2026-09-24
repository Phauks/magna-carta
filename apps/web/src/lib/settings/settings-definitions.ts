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
   * One muted line under the name, sentence case, intent not implementation.
   *
   * OPTIONAL, and the absence is a real answer rather than an omission (owner correction,
   * 2026-09-18). A firm SETTING carries a descriptor, because a firm-wide choice has consequences
   * a name cannot state. A row whose label already says the whole thing — Prefix, Last Name,
   * Email, Password — earns nothing from a sentence under it but the noise of being told what it
   * already read, and a surface built of those rows reads as a manual. The account surface states
   * none for exactly that reason; a settings page that leaves one out is saying the same thing
   * about that row.
   */
  readonly description?: string;
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
 * ONLY REAL SETTINGS (owner-directed): a row exists only where something exists server-side to
 * carry it. Demonstration rows with no backend counterpart (a retainer-floor alert switch, an
 * SSO-enforcement switch) were deleted for that reason, and the rule then finished the job — see
 * the array below, which is empty.
 */
export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  // EMPTY, and that is the finished state rather than a gap. Every settings row on the surface now
  // has a server behind it and declares itself beside the draft that reads and writes it:
  //
  //   Billing      -> src/lib/settings/firm-time-policy-draft.svelte.ts
  //   Calendar     -> src/lib/calendar/calendar-settings-draft.svelte.ts
  //   File Safety  -> src/lib/file-manager/scan-policy-draft.svelte.ts
  //   Firm Profile -> the page itself (one field, read from the session)
  //   Beta Access  -> the page itself (one decision, read from the session)
  //
  // The rule that emptied it: a firm setting with a server behind it must not keep a per-browser
  // copy that can disagree with the firm, and this registry's committed values live in local
  // storage. So a row moves out the moment its endpoint exists, and no new row belongs here.
  //
  // What is left standing above this array is the SHAPE — SettingDefinition and the helpers over
  // it — which every server-backed draft uses. settings-page.svelte, the component that renders a
  // whole page from these rows, now has no call sites. It is kept rather than deleted because it
  // is the only host of the read-only member's "Request a change" affordance
  // (components/request-change-dialog.svelte); retiring it means giving that affordance a home on
  // the server-backed pages first, which is its own piece of work.
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
  return platesForDefinitions(visibleSettingsForSection(sectionId, canEdit));
}

/**
 * A declared list of definitions grouped into plates, in declared order (a plate's position
 * follows its first definition). The one grouping every settings page uses, whether its rows come
 * from the registry above or from a server-backed draft's own field list — a page never re-groups
 * its rows itself.
 */
export function platesForDefinitions(
  definitions: readonly SettingDefinition[],
): ReadonlyArray<{ label: string; definitions: readonly SettingDefinition[] }> {
  const plates: { label: string; definitions: SettingDefinition[] }[] = [];
  for (const definition of definitions) {
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
