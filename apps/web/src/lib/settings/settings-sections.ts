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
  readonly editPermissionArea?:
    | "firm"
    | "billing"
    | "documents"
    | "integrations"
    | "calendar"
    | "reports"
    | "ai";
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
    // What the firm is called to its clients. The read is the session — every request resolves the
    // firm's display name already — so the page has one write and no read of its own.
    //
    // Instant rather than the firm scope's draft default: it is one field, and the footer's
    // staged-count-and-recap anatomy over a single row would be more machinery than the act. The
    // rest of "identity" — an address, a telephone number, a letterhead root — belongs to an
    // office, which has its own page, rather than being a second firm-wide answer no letterhead
    // reads.
    id: "firm-profile",
    label: "Firm Profile",
    href: "/settings/firm-profile",
    group: "firm",
    scope: "firm",
    commitMode: "instant",
    editPermissionArea: "firm",
    shipped: true,
  },
  {
    // The firm's offices: each with its address, its contact lines, its time zone, its numbering
    // code, who staffs it, and the mark its letterhead prints. A REGISTER page on the Users
    // pattern — the product's one table over the offices, and every act (open one, correct one,
    // close one, assign a member, set a logo) committed through the office's own record window
    // against the location routes, so the posture is "applies immediately" and nothing is staged.
    // The page's own controls are gated on locations:manage from the session, which is narrower
    // than this section's area.
    id: "offices",
    label: "Offices",
    href: "/settings/offices",
    group: "firm",
    scope: "firm",
    commitMode: "instant",
    editPermissionArea: "firm",
    shipped: true,
  },
  // Notifications
  {
    // What THIS member hears, category by category. A matrix rather than a page of rows: one
    // subject with two independent answers (a feed row, and a line in a summary mail), and the
    // server resolves how the member's tier and the firm's compose before the page renders either.
    // Instant, and its own scope: a Save button between a person and their own mail settings is
    // ceremony over their own business.
    id: "notifications",
    label: "Notifications",
    href: "/settings/notifications",
    group: "notifications",
    scope: "user",
    commitMode: defaultCommitModeForScope("user"),
    shipped: true,
  },
  // Firm
  {
    // The firm administering its members ("us"). A member's OWN identity and credentials live
    // in the separate Account Settings surface reached from the profile menu ("me") — the two
    // are never mixed (owner-settled).
    //
    // A CATALOG page rather than a settings form, so its mode is "instant" and it departs from
    // the mode-follows-scope rule deliberately: inviting somebody, changing what they hold and
    // withdrawing their access are acts committed one at a time through their own dialogs
    // against the member routes, on the Rooms and Resources precedent. There is nothing to
    // stage, and staging a batch of people behind one Save would make "who works here" a
    // document with a draft.
    id: "users",
    label: "Users",
    href: "/settings/users",
    group: "firm",
    scope: "firm",
    commitMode: "instant",
    editPermissionArea: "firm",
    shipped: true,
  },
  {
    // What each role allows, read-only. Its own page rather than a plate on Users because it
    // answers a different question — "what am I about to give this person" rather than "who is
    // here" — and because authoring roles lands here later, which is a write with a different
    // shape from anything on the roster.
    id: "roles",
    label: "Roles and Permissions",
    href: "/settings/roles",
    group: "firm",
    scope: "firm",
    commitMode: "instant",
    readOnly: true,
    editPermissionArea: "firm",
    shipped: true,
  },
  // Practice
  {
    // Every number the firm issues, from the one numbering register: matter, consultation, intake,
    // conflicts check and custody numbers are each a segment-template editor with live preview
    // (numbering-scheme read/update + preview, audited); invoice, time entry and call numbers are
    // stated with their fixed shape. It was "Matter Numbering" while matters were the only
    // sequence with a screen; /settings/matter-numbering still resolves here.
    id: "numbering",
    label: "Numbering",
    href: "/settings/numbering",
    group: "practice",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "firm",
    shipped: true,
  },
  {
    // The firm's calendar settings: which day its week begins on. A FIRM setting rather than a
    // personal preference (owner-ruled 2026-09-02): the week is the unit a firm plans in, and two
    // members looking at the same week must see the same grid. Server-backed from the start — the
    // page reads and writes GET/PATCH /api/v1/calendar/settings and never stages into local
    // storage — and its edit right is the calendar's own `calendar:manage`, checked against the
    // session on the page, because the area seam here is still a mock.
    id: "calendar",
    label: "Calendar",
    href: "/settings/calendar",
    group: "practice",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "calendar",
    shipped: true,
  },
  {
    // The firm's report policy: what its trust-compliance document lists. A FIRM setting rather
    // than a per-run choice (owner-ruled 2026-09-07): a compliance document should read the same
    // every time the firm produces it. Server-backed from the start — the page reads and writes
    // GET/PATCH /api/v1/firm/reports/policy and never stages into local storage — and its edit
    // right is `firm:manageReportPolicy`, checked against the session on the page.
    id: "reports",
    label: "Reports",
    href: "/settings/reports",
    group: "practice",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "reports",
    shipped: true,
  },
  {
    // The event-type catalog: the shared vocabulary the platform ships (immutable in name and code,
    // retirable) and the types the firm adds. A CATALOG page on the resources pattern: each act
    // commits through its own dialog against the event-type routes, gated on the session's
    // `calendar:manage`.
    id: "event-types",
    label: "Event Types",
    href: "/settings/event-types",
    group: "practice",
    scope: "firm",
    commitMode: "instant",
    editPermissionArea: "calendar",
    shipped: true,
  },
  {
    // The firm's bookable resources: rooms, vehicles, equipment. A CATALOG page rather than a
    // settings form: each act (add, change, retire) commits through its own dialog against
    // GET/POST/PATCH /api/v1/calendar/resources, so the posture is "applies immediately" and
    // nothing is staged. Its edit right is the calendar's own `calendar:manage`, read from the
    // session on the page, because the area seam here is still a mock.
    id: "resources",
    label: "Rooms and Resources",
    href: "/settings/resources",
    group: "practice",
    scope: "firm",
    commitMode: "instant",
    editPermissionArea: "calendar",
    shipped: true,
  },
  {
    // The firm's side of what the platform tells people: which categories reach everybody whatever
    // they choose, how long a member's feed keeps what it was told, and when the summary mail
    // lands. Its member-facing twin is the Notifications section under My Settings, and the two
    // are separate surfaces because one binds the person reading it and the other binds everybody
    // else — the permissions differ for the same reason (firm:manageNotificationPolicy here,
    // notifications:read there).
    //
    // Instant rather than draft, the departure Users makes and for the same reason: it is a matrix
    // of twelve rows plus two scalars, every one of them independently meaningful and separately
    // audited, and staging twenty-six of them behind one Save would make the pending count
    // meaningless and its recap unreadable.
    id: "notification-policy",
    label: "Notification Policy",
    href: "/settings/notification-policy",
    group: "practice",
    scope: "firm",
    commitMode: "instant",
    shipped: true,
  },
  {
    // The firm's matter plans: what a kind of matter takes, as a template that PROPOSES tasks. Sits
    // under Practice beside matter numbering because both are statements about how the firm runs its
    // work rather than settings that change a screen. The controls inside are gated on
    // tasks:managePlans from the session, which is narrower than this section's own reach.
    id: "matter-plans",
    label: "Matter Plans",
    href: "/settings/matter-plans",
    group: "practice",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "firm",
    shipped: true,
  },
  {
    // The firm's intake procedures: what a kind of matter must clear before it opens. Firm scope,
    // beside Matter Plans, because the two are the before and after of an opening; the controls
    // inside are gated on intake:manageProcedures from the session.
    id: "intake-procedures",
    label: "Intake Procedures",
    href: "/settings/intake-procedures",
    group: "practice",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "firm",
    shipped: true,
  },
  {
    // The firm's conflicts floor: what every check must search whatever a caller asks for. Firm
    // scope and draft mode, and emphatically not instant — widening the floor makes a shortfall
    // appear on every matter whose last check no longer covers it, which is not a change anybody
    // should make by brushing a control. The page's own controls are gated on conflicts:configure
    // from the session, which is narrower than this section's `editPermissionArea`.
    id: "conflicts",
    label: "Conflicts",
    href: "/settings/conflicts",
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
    // The firm's scan policy: how much of the engine's rule set an upload is checked against, how
    // confident a suspicious match must be to count, and what the firm may do with a file the scan
    // flagged. Server-backed over GET/PATCH /api/v1/firm/scan-policy — the same policy the ingest
    // consumer reads at queue-consume time and the download route reads at access time, so a save
    // here reaches both without re-ingesting anything.
    id: "file-safety",
    label: "File Safety & Scanning",
    href: "/settings/file-safety",
    group: "documents",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "documents",
    shipped: true,
  },
  {
    // The firm's editing policy: whether every document opened in the browser editor records its
    // changes. Server-backed over GET/PATCH /api/v1/firm/editing-policy — the same policy the WOPI
    // host reads on every open, so a save here reaches the next document opened. Draft mode, not
    // instant: switching recording off is the firm deciding its documents stop carrying a record
    // of who changed what, which is not a change anybody should make by brushing a switch.
    id: "editing",
    label: "Editing",
    href: "/settings/editing",
    group: "documents",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "documents",
    shipped: true,
  },
  {
    // How each kind of file opens: the register the file manager decides the one Open gesture from,
    // rendered as a routing table. Read-only today — every family has one way of opening and the
    // table states it — and a firm section because the ways are the firm's, so that when a family
    // gains a second way (a desktop application, another editor) the choice lands here.
    id: "opening-files",
    label: "Opening Files",
    href: "/settings/opening-files",
    group: "documents",
    scope: "firm",
    commitMode: "instant",
    editPermissionArea: "documents",
    readOnly: true,
    shipped: true,
  },
  {
    // How a member takes the files the platform makes them. A MEMBER section, not a firm one:
    // exporting generates onto that person's own shelf and only they decide whether a file is also
    // saved as it is made. Where a file lands is deliberately not here — that is the browser's own
    // setting, and the platform-side answer belongs to the desktop app.
    id: "downloads",
    label: "Downloads",
    href: "/settings/downloads",
    group: "documents",
    scope: "user",
    commitMode: "instant",
    shipped: true,
  },
  // Data & Platform
  {
    // Whether the firm runs the released build or the one ahead of it. The channel was always in
    // the session bootstrap and the write has existed behind firm:manageReleaseChannel since
    // release channels landed, so this section needed no endpoint of its own — and its two former
    // rows ("release channel" and "beta opt-in") were one fact asked twice.
    //
    // Instant rather than draft, and the reason is the consent: entering beta takes an explicit
    // acknowledgement that the firm accepts pre-release behavior on live client data, which the
    // shared footer's generic recap of staged changes is exactly not. The one act that needs
    // saying carries its own dialog saying it.
    id: "beta-access",
    label: "Beta Access",
    href: "/settings/beta-access",
    group: "data-platform",
    scope: "firm",
    commitMode: "instant",
    editPermissionArea: "firm",
    shipped: true,
  },
  {
    // The firm's two AI consent gates and the assistant's daily ceiling. Under Data & Platform
    // rather than Practice because it is a statement about where this firm's content may go, not
    // about how the firm runs its work — the neighbours are Beta Access and Versions, the other
    // two sections about the platform underneath rather than the practice on top.
    //
    // Server-backed from the start on the Reports page's pattern: the draft reads and writes
    // GET/PATCH /api/v1/firm/ai/settings and stages nothing into local storage, because a firm
    // setting with a server behind it must not keep a per-browser copy that can disagree with it.
    // Draft mode, emphatically not instant: opening the processing gate is the firm consenting to
    // privileged client content leaving for a third party, which is not a decision anybody should
    // make by brushing a switch.
    id: "ai",
    label: "AI and the Assistant",
    href: "/settings/ai",
    group: "data-platform",
    scope: "firm",
    commitMode: "draft",
    editPermissionArea: "ai",
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
