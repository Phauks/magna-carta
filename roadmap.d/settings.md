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
  evidence: FirmSettingDefinition entries across eighteen modules in fourteen packages — ai-detection, billing, billing-core, conflicts, costs, discovery, file-manager (three of them), inference, locations, magnus, matters, notifications, search (two) and timekeeping — over packages/data-access/src/setting-statements.ts; audited/effective-dated flags not uniform, and a definition sits beside its own subject rather than in one settings module per package.

- id: settings.registry.backend-definitions
  name: Backend firm-setting definitions
  scope: Per-package setting definitions with validated write paths and total reads (safe defaults).
  status: shipped
  surface: internal
  evidence: packages/{timekeeping,matters,locations,inference,magnus,notifications,search,ai-detection}/src/settings.ts and the same shape under a subject-named module elsewhere (packages/file-manager/src/scan-policy-settings.ts, packages/conflicts/src/recheck-settings.ts, packages/costs/src/recovery-policy.ts), over data-access setting statements and their tests.

- id: settings.registry.generated-ui
  name: Registry-generated settings pages
  scope: One renderer generating pages from the registry — a standard page is a registry entry plus definitions.
  status: partial
  surface: screen
  evidence: apps/web/src/lib/settings/ — settings-sections.ts as the page registry, settings-definitions.ts as the per-setting frontend definitions, and components/settings-page.svelte composing a page out of plates and rows. Bespoke seam pages remain outside the renderer (settings/beta-access).

- id: settings.scope-resolution
  name: Scope chain resolution
  scope: Most-specific-wins precedence: entity override, user, location, firm default, system default; settings opt into scopes.
  status: shipped
  surface: internal
  adrs: ADR-0132
  evidence: packages/data-access/src/scoped-setting-statements.ts + tests.

- id: settings.access-rbac
  name: Per-setting view/edit access
  scope: Role required to view and to edit each setting, enforced server-side in the firm-scoped data-access layer, mirrored in the UI.
  status: partial
  surface: internal
  evidence: Server-side, permission-gated write paths exist through the data-access layer. Client-side the check is still a stated mock — apps/web/src/lib/settings/settings-permissions.ts says so in its own header and returns true only for the billing area, against a fixed cast of members, so Billing demonstrates the editable draft flow and Firm profile demonstrates read-only with the Request-a-Change dialog. The call sites are the ones the real check will keep.

- id: settings.storage-placement
  name: Storage placement (no duplication)
  scope: Identity prefs on the control plane, per-user firm-scoped prefs on the member row, firm business settings in per-firm D1; framework registers data subsystems own.
  status: shipped
  surface: internal
  adrs: ADR-0003
  evidence: Per-firm setting table + member-row settings via packages/data-access; inference/scan-policy settings live in their owning packages.

- id: settings.change-discipline
  name: Audited & effective-dated changes
  scope: Settings writes through the data-access layer; financial/security/firm settings audited; effective-dated where it matters.
  status: partial
  surface: awaiting-screen
  adrs: ADR-0130
  evidence: Effective-dated rate engine shipped; frontend append-only change ledger (Restore-as-new-entry) shipped; uniform server-side settings audit not verified.

- id: settings.area-ui
  name: The Settings area
  scope: Banded settings navigation (My / Firm / Platform), posture badges, draft staging with confirmation recap, change-history pull-out, command-palette listing.
  status: partial
  evidence: apps/web/src/routes/(app)/settings/ holds eleven pages — theme, accessibility, text, firm-profile, users, matter-numbering, billing, file-safety, beta-access, versions, developer — banded by apps/web/src/lib/settings/settings-sections.ts, with the draft staging and change history in settings-draft.svelte.ts and settings-ledger-store.svelte.ts.

- id: settings.area-ui.my-account
  name: My Account (identity & security)
  scope: Person-scoped /account secure shell: profile (name, email, avatar) and security (password, 2FA, sessions), no app chrome.
  status: partial
  surface: screen
  spec: docs/specs/2026-07-10-account-settings-surface-design.md
  evidence: apps/web/src/routes/account/ — its own layout outside the app chrome, with profile and security pages behind it. Surface, rail and flow are live; every control is an honest seam activating when the authentication UI ships.

- id: settings.area-ui.personal-preferences
  name: Personal preferences (Theme, Accessibility, Text)
  scope: Apply-immediately user settings with cross-tab sync; real end-to-end High Contrast axis.
  status: shipped
  surface: screen
  evidence: The settings/theme, /accessibility and /text pages over apps/web/src/lib/preferences/persisted-preference.svelte.ts, which syncs across tabs on the storage event, and apps/web/src/lib/settings/appearance-axes.svelte.ts, whose values are the same storage the no-flash boot script reads.
  notes: The High Contrast axis is end to end as a PREFERENCE — seed-then-own from prefers-contrast, persisted, and stamped on the document as data-contrast="high" — but only two components answer it (the checkbox and the switch), and the token layer's high-contrast context is deliberately unpopulated, so the axis is a working switch over a mostly unwritten theme rather than a finished one.

- id: settings.area-ui.firm-band
  name: Firm settings band
  scope: Firm Profile, Users, Matter Numbering, Billing, File Safety & Scanning as staged draft pages with Save/Cancel commit flow.
  status: partial
  surface: screen
  evidence: Pages exist with draft-ledger staging; some values are Preview posture (demonstration values not yet governing behavior).

- id: settings.area-ui.platform-band
  name: Platform band (Beta Access, Versions, Developer)
  scope: Firm release-channel stance, versioned-component ledger, developer master switch and console.
  status: partial
  surface: screen
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
  evidence: No notifications settings surface, and the page is the only thing missing. The notification type registry is shipped (packages/notifications/src/registry.ts), and so is everything this page would render — GET and PATCH /api/v1/notifications/preferences resolve the per-category matrix, report which in-app switches are locked and by whom, and hold the firm floor's two asymmetries: a firm may raise the in-app floor for a category and may never raise a member's email cadence. The firm band of the same page is GET and PATCH /api/v1/firm/notifications/policy under firm:manageNotificationPolicy — the floor itself, plus the retention window and the digest hour.

- id: settings.area-ui.documents-templates-category
  name: Documents & templates category
  scope: Settings surface for document types and templates.
  status: not-started
  evidence: Document-type/narrative-template API routes exist, but no settings pages for them.
