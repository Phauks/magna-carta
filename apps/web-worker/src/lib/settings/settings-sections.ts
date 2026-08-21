/*
 * The settings section registry — data, not markup, mirroring the sidebar's destination
 * registry (src/lib/navigation/destinations.ts): the settings surface grows section by
 * section, so the nav renders from one canonical list instead of hand-edited links.
 *
 * Three bands, ten groups. The bands split the surface by whose it is — "My Settings" (this
 * member's own preferences), "Firm Settings" (firm-wide policy), and "Platform" (what the
 * platform reports and operates) — and the groups inside them are the stable category ids that
 * pages hang off as slices ship. `shipped` is the light-up switch, flipped in the same commit
 * as a section's page. Empty groups (and empty bands) simply do not render — no placeholder
 * entries.
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

/**
 * The nav's top-level bands — every group lives in exactly one. Banding is PRESENTATION, scope
 * is OWNERSHIP: the "platform" band groups what the platform reports and operates (owner-carved
 * out of Firm Settings), but its sections keep their true scope — Versions stays scope "firm"
 * (facts about the firm's deployment) while rendering under the Platform band.
 */
export type SettingsBand = "user" | "firm" | "platform";

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
  { id: "user", label: "My Settings" },
  { id: "firm", label: "Firm Settings" },
  { id: "platform", label: "Platform" },
];

export type SettingsSectionGroup =
  | "appearance"
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
  /**
   * User-facing label. Setting and page names are Title Case ("Firm Profile") — owner-directed,
   * superseding the earlier sentence-case rule; descriptions stay sentence case.
   */
  readonly label: string;
  readonly href: string;
  /**
   * The Documentation site path for this section's guide — the light-up seam behind the
   * masthead's documentation button. Omitted today (the button renders as a Soon seam); when
   * the Documentation ecosystem site goes live (its href in
   * src/lib/navigation/ecosystem-sites.ts is the base URL this joins to), setting a section's
   * path here turns the button into a real link to that page — the same light-up contract the
   * ecosystem registry uses.
   */
  readonly documentationPath?: string;
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
 * Group headings in canonical order — the stable category ids. Order inside a band is the
 * render order.
 *
 * DELIBERATELY ABSENT: an "account" group. Person-scoped identity and credentials — profile
 * information, password, 2FA, sessions — live in the separate Account Settings surface reached
 * from the profile menu (a higher-ceremony surface with step-up re-authentication when accounts
 * ship), never in this registry: a preference for work is different from an account setting
 * (owner-settled 2026-07-03). The settings surface carries work preferences and firm policy
 * only; Notifications stays because it is a work preference.
 */
export const SETTINGS_SECTION_GROUPS: ReadonlyArray<{
  id: SettingsSectionGroup;
  label: string;
  band: SettingsBand;
}> = [
  // Band "user" — My Settings
  { id: "appearance", label: "Appearance", band: "user" },
  { id: "notifications", label: "Notifications", band: "user" },
  // Band "firm" — Firm Settings
  { id: "firm", label: "Firm", band: "firm" },
  { id: "practice", label: "Practice", band: "firm" },
  { id: "billing", label: "Billing", band: "firm" },
  { id: "documents", label: "Documents", band: "firm" },
  { id: "integrations", label: "Integrations", band: "firm" },
  // Band "platform" — what the platform reports and operates (its own band, owner-directed).
  // Developer lives here too (it configures platform-facing tooling; scope stays "user" —
  // banding is presentation, scope is ownership) and is spread in for development builds only.
  { id: "data-platform", label: "Data & Platform", band: "platform" },
  { id: "developer", label: "Developer", band: "platform" },
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
    // Themes will grow variety (a gallery, the firm default and lock, custom brand generation
    // later), so the theme picker owns a page rather than sharing one (owner-directed). Mode
    // lives with it: light/dark is the theme's own axis.
    id: "theme",
    label: "Theme",
    href: "/settings/theme",
    group: "appearance",
    scope: "user",
    commitMode: defaultCommitModeForScope("user"),
    shipped: true,
  },
  {
    // High Contrast, Motion, and Density (reading ergonomics) — the accessibility axes.
    id: "accessibility",
    label: "Accessibility",
    href: "/settings/accessibility",
    group: "appearance",
    scope: "user",
    commitMode: defaultCommitModeForScope("user"),
    shipped: true,
  },
  {
    // Text preferences (typeface, size). Its rows are honest Soon seams until the type system
    // grows the machinery (font tokens / a text-scale overlay) — see the page.
    id: "text",
    label: "Text",
    href: "/settings/text",
    group: "appearance",
    scope: "user",
    commitMode: defaultCommitModeForScope("user"),
    shipped: true,
  },
  // Firm
  {
    id: "firm-profile",
    label: "Firm Profile",
    href: "/settings/firm-profile",
    group: "firm",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "firm",
    shipped: true,
  },
  // Firm
  {
    // The firm administering its members ("us"). A member's OWN identity and credentials live
    // in the separate Account Settings surface reached from the profile menu ("me") — the two
    // are never mixed (owner-settled).
    id: "users",
    label: "Users",
    href: "/settings/users",
    group: "firm",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "firm",
    shipped: true,
  },
  // Practice
  {
    // Real routes exist (numbering-scheme read/update + preview, audited); the real page is a
    // segment-template editor with live preview — this section reserves its home.
    id: "matter-numbering",
    label: "Matter Numbering",
    href: "/settings/matter-numbering",
    group: "practice",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "firm",
    shipped: true,
  },
  // Billing
  {
    id: "billing",
    label: "Billing",
    href: "/settings/billing",
    group: "billing",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "billing",
    shipped: true,
  },
  // Documents
  {
    // The per-firm scan policy engine and its routes already exist server-side — this section
    // is the first candidate for real wiring when the authenticated settings integration lands.
    id: "file-safety",
    label: "File Safety & Scanning",
    href: "/settings/file-safety",
    group: "documents",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "documents",
    shipped: true,
  },
  // Data & Platform
  {
    // The firm's stance toward pre-release features (release channel + beta opt-in). Draft
    // mode with no registered definitions yet: the rows are honest seams until the
    // release-channel frontend ships, but the section already declares who may edit and how
    // edits will land.
    id: "beta-access",
    label: "Beta Access",
    href: "/settings/beta-access",
    group: "data-platform",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "firm",
    shipped: true,
  },
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
