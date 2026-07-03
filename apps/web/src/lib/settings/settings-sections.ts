/*
 * The settings section registry — data, not markup, mirroring the sidebar's destination
 * registry (src/lib/navigation/destinations.ts): the settings surface grows section by
 * section, so the nav renders from one canonical list instead of hand-edited links.
 *
 * Two bands, ten groups. The bands split the surface by who a setting belongs to — "My
 * settings" (this member's own preferences) and "Firm settings" (firm-wide policy) — and the
 * groups inside them are the stable category ids that pages hang off as slices ship. `shipped`
 * is the light-up switch, flipped in the same commit as a section's page. Empty groups (and
 * empty bands) simply do not render — no placeholder entries.
 *
 * Developer sections are spread in only under import.meta.env.DEV so production bundles
 * carry neither the entries nor a dead nav group; the /settings/developer route 404s
 * outside development builds for the same reason.
 *
 * The Ctrl+K command palette (src/lib/components/command-palette.svelte) also renders from
 * this registry — adding a section here is what makes it searchable; never hand-list it there.
 *
 * MODE-PURITY INVARIANT: a section's `commitMode` binds EVERY setting on its page. A page
 * never mixes instant-apply controls with draft-then-save controls — the user cannot be asked
 * to reason about which half of a form is already live. When a category genuinely needs both,
 * split it into two sections (two pages), each pure. A CI fitness check enforces this once the
 * per-setting registry lands; until then this comment is the contract.
 */

/** Who a setting belongs to: the signed-in member ("user") or the whole firm ("firm"). */
export type SettingsScope = "user" | "firm";

/** The nav's two top-level bands — every group lives in exactly one. */
export type SettingsBand = "user" | "firm";

/**
 * How edits land: "instant" applies on interaction (no save button); "draft" stages edits and
 * commits them together. The rule: mode follows scope — user sections are instant (personal
 * preferences, reversible at a click), firm sections are draft (policy changes deserve a
 * deliberate commit). `defaultCommitModeForScope` encodes the rule; a section departs from it
 * only with a stated reason (see `readOnly`).
 */
export type SettingsCommitMode = "instant" | "draft";

/** The default commit mode for a scope — the rule "mode follows scope" as code. */
export function defaultCommitModeForScope(scope: SettingsScope): SettingsCommitMode {
  return scope === "user" ? "instant" : "draft";
}

/** Band headers in canonical order. */
export const SETTINGS_BANDS: ReadonlyArray<{
  id: SettingsBand;
  label: string;
}> = [
  { id: "user", label: "My settings" },
  { id: "firm", label: "Firm settings" },
];

export type SettingsSectionGroup =
  | "appearance"
  | "account"
  | "notifications"
  | "firm"
  | "practice"
  | "billing"
  | "documents"
  | "integrations"
  | "data-platform"
  | "developer";

export interface SettingsSection {
  readonly id: string;
  /** User-facing label (sentence case, the vocabulary users recognize). */
  readonly label: string;
  readonly href: string;
  readonly group: SettingsSectionGroup;
  /** Whose setting this is; drives the band the section renders under and its commit mode. */
  readonly scope: SettingsScope;
  /** How edits land — see the mode-purity invariant above; defaults follow the scope rule. */
  readonly commitMode: SettingsCommitMode;
  /**
   * The permission area whose edit right gates changes on a firm section (firm scope only).
   * A declaration seam today — nothing enforces it yet; the settings permission model reads
   * it when firm settings pages ship.
   */
  readonly editPermissionArea?: "firm" | "billing" | "documents" | "integrations";
  /**
   * The section renders platform/diagnostic data only — no editable settings. `commitMode`
   * is vacuous on such a page and set to "instant" (nothing staged, nothing to commit); the
   * flag keeps the intent machine-readable so the per-setting registry can later assert a
   * read-only section registers no editable settings. Preferred over bending `commitMode`
   * into a third meaning: consumers keep a total two-value mode, and read-only-ness stays
   * its own orthogonal fact.
   */
  readonly readOnly?: true;
  /** Renders in the settings nav only when true — flipped when the section's page ships. */
  readonly shipped: boolean;
}

/**
 * Group headings in canonical order — the ten stable category ids. Order inside a band is the
 * render order; `developer` sits in the user band (it configures this developer's own build).
 */
export const SETTINGS_SECTION_GROUPS: ReadonlyArray<{
  id: SettingsSectionGroup;
  label: string;
  band: SettingsBand;
}> = [
  // Band "user" — My settings
  { id: "appearance", label: "Appearance", band: "user" },
  { id: "account", label: "Account", band: "user" },
  { id: "notifications", label: "Notifications", band: "user" },
  // Band "firm" — Firm settings
  { id: "firm", label: "Firm", band: "firm" },
  { id: "practice", label: "Practice", band: "firm" },
  { id: "billing", label: "Billing", band: "firm" },
  { id: "documents", label: "Documents", band: "firm" },
  { id: "integrations", label: "Integrations", band: "firm" },
  { id: "data-platform", label: "Data & platform", band: "firm" },
  // Development builds only (spread in below)
  { id: "developer", label: "Developer", band: "user" },
];

const DEVELOPER_SECTIONS: readonly SettingsSection[] = [
  {
    id: "developer",
    label: "Developer",
    href: "/settings/developer",
    group: "developer",
    scope: "user",
    commitMode: defaultCommitModeForScope("user"),
    shipped: true,
  },
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // Appearance
  {
    id: "appearance",
    label: "Appearance",
    href: "/settings/appearance",
    group: "appearance",
    scope: "user",
    commitMode: defaultCommitModeForScope("user"),
    shipped: true,
  },
  // Data & platform
  {
    id: "versions",
    label: "Versions",
    href: "/settings/versions",
    group: "data-platform",
    // Platform diagnostics about the firm's deployment, readable by every member — firm scope
    // places it under "Firm settings", and readOnly (not "draft") states the truth: there is
    // nothing to stage or commit on this page.
    scope: "firm",
    commitMode: "instant",
    readOnly: true,
    shipped: true,
  },
  // Developer (development builds only)
  ...(import.meta.env.DEV ? DEVELOPER_SECTIONS : []),
];

/** The settings nav's render list: shipped sections, canonical order. */
export function shippedSettingsSections(): readonly SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => section.shipped);
}

/** Shipped sections grouped in canonical order; groups with nothing to show are dropped. */
export function groupedSettingsSections(): ReadonlyArray<{
  id: SettingsSectionGroup;
  label: string;
  band: SettingsBand;
  sections: readonly SettingsSection[];
}> {
  const shipped = shippedSettingsSections();
  return SETTINGS_SECTION_GROUPS.map((group) => ({
    ...group,
    sections: shipped.filter((section) => section.group === group.id),
  })).filter((group) => group.sections.length > 0);
}

/**
 * Non-empty groups nested under their bands in canonical order — the settings nav's render
 * tree. A band with no shipped sections drops out entirely (no orphan header).
 */
export function bandedSettingsSections(): ReadonlyArray<{
  id: SettingsBand;
  label: string;
  groups: ReadonlyArray<{
    id: SettingsSectionGroup;
    label: string;
    sections: readonly SettingsSection[];
  }>;
}> {
  const grouped = groupedSettingsSections();
  return SETTINGS_BANDS.map((band) => ({
    ...band,
    groups: grouped.filter((group) => group.band === band.id),
  })).filter((band) => band.groups.length > 0);
}

/** True when `pathname` lives under the section (drives aria-current / the active accent). */
export function isCurrentSettingsSection(section: SettingsSection, pathname: string): boolean {
  return pathname === section.href || pathname.startsWith(`${section.href}/`);
}
