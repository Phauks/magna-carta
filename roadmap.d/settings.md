# Settings & Configuration

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: settings
  name: Settings & configuration framework
  scope: Declarative settings registry, scope-chain resolution, role-gated access enforced in the data-access layer, storage placement per tenancy, and the registry-driven Settings area.
  status: partial
  adrs: ADR-0040
  evidence: Backend setting definitions + scoped resolver + a substantial settings UI system on main; several categories are honest seams or mock-permission previews.

- id: settings.registry
  name: Declarative settings registry
  scope: Each setting declared once (key, type, scope, default, access, validation, audited/effective-dated flags).
  status: partial
  evidence: FirmSettingDefinition entries across packages (timekeeping, matters, locations, inference, file-manager) + packages/data-access/src/setting-statements.ts; audited/effective-dated flags not uniform.

- id: settings.registry.backend-definitions
  name: Backend firm-setting definitions
  scope: Per-package setting definitions with validated write paths and total reads (safe defaults).
  status: shipped
  evidence: packages/{timekeeping,matters,locations,inference}/src/settings.ts + data-access setting statements/tests.

- id: settings.registry.generated-ui
  name: Registry-generated settings pages
  scope: One renderer generating pages from the registry — a standard page is a registry entry plus definitions.
  status: partial
  evidence: Registry-driven settings-page composition + per-setting frontend definitions registry (changelog.d/settings-v2-draft-ledger-permissions.md); bespoke seam pages remain (e.g. beta-access).

- id: settings.scope-resolution
  name: Scope chain resolution
  scope: Most-specific-wins precedence: entity override, user, location, firm default, system default; settings opt into scopes.
  status: shipped
  adrs: ADR-0132
  evidence: packages/data-access/src/scoped-setting-statements.ts + tests.

- id: settings.access-rbac
  name: Per-setting view/edit access
  scope: Role required to view and to edit each setting, enforced server-side in the firm-scoped data-access layer, mirrored in the UI.
  status: partial
  evidence: Permission-gated write paths exist; the settings UI carries a mock permission seam and Request-a-Change on read-only firm rows (changelog.d/settings-v2-draft-ledger-permissions.md).

- id: settings.storage-placement
  name: Storage placement (no duplication)
  scope: Identity prefs on the control plane, per-user firm-scoped prefs on the member row, firm business settings in per-firm D1; framework registers data subsystems own.
  status: shipped
  adrs: ADR-0003
  evidence: Per-firm setting table + member-row settings via packages/data-access; inference/scan-policy settings live in their owning packages.

- id: settings.change-discipline
  name: Audited & effective-dated changes
  scope: Settings writes through the data-access layer; financial/security/firm settings audited; effective-dated where it matters.
  status: partial
  adrs: ADR-0130
  evidence: Effective-dated rate engine shipped; frontend append-only change ledger (Restore-as-new-entry) shipped; uniform server-side settings audit not verified.

- id: settings.area-ui
  name: The Settings area
  scope: Banded settings navigation (My / Firm / Platform), posture badges, draft staging with confirmation recap, change-history pull-out, command-palette listing.
  status: partial
  evidence: apps/web/src/routes/(app)/settings/ (theme, accessibility, text, firm-profile, users, matter-numbering, billing, file-safety, beta-access, versions, developer) per changelog.d/settings-foundation-and-profile-menu.md and settings-v2-draft-ledger-permissions.md.

- id: settings.area-ui.my-account
  name: My Account (identity & security)
  scope: Person-scoped /account secure shell: profile (name, email, avatar) and security (password, 2FA, sessions), no app chrome.
  status: partial
  spec: docs/specs/2026-07-10-account-settings-surface-design.md
  evidence: Surface, rail, and flow live; every control an honest seam activating when authentication UI ships (changelog.d/account-settings-surface.md).

- id: settings.area-ui.personal-preferences
  name: Personal preferences (Theme, Accessibility, Text)
  scope: Apply-immediately user settings with cross-tab sync; real end-to-end High Contrast axis.
  status: shipped
  evidence: settings/theme, /accessibility, /text pages; storage-event sync per changelog.d/settings-foundation-and-profile-menu.md.

- id: settings.area-ui.firm-band
  name: Firm settings band
  scope: Firm Profile, Users, Matter Numbering, Billing, File Safety & Scanning as staged draft pages with Save/Cancel commit flow.
  status: partial
  evidence: Pages exist with draft-ledger staging; some values are Preview posture (demonstration values not yet governing behavior).

- id: settings.area-ui.platform-band
  name: Platform band (Beta Access, Versions, Developer)
  scope: Firm release-channel stance, versioned-component ledger, developer master switch and console.
  status: partial
  evidence: Pages shipped; Beta Access rows and most Versions rows are honest seams pending backend endpoints (page comments cite docs/research/fable-backend-review-2026-07.md).

- id: settings.area-ui.integrations-category
  name: Integrations settings category
  scope: Plugin credential management UI per firm.
  status: not-started
  evidence: No integrations settings page; credential storage exists server-side only.

- id: settings.area-ui.diagnostics-category
  name: Diagnostics settings category
  scope: UI for the diagnostics consent/level setting.
  status: not-started
  evidence: No diagnostics page; the underlying setting also does not exist yet.

- id: settings.area-ui.notifications-category
  name: Notification preferences category
  scope: Per-user type/category-by-channel routing matrix with locked mandatory categories.
  status: not-started
  evidence: No notifications settings surface. The notification type registry it would render is shipped (packages/notifications/src/registry.ts); what this page still waits on is the per-category preference matrix and the firm policy floor, which are a later notifications sub-slice.

- id: settings.area-ui.documents-templates-category
  name: Documents & templates category
  scope: Settings surface for document types and templates.
  status: not-started
  evidence: Document-type/narrative-template API routes exist, but no settings pages for them.
