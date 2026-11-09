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
  notes: A server-backed page composes the same rows and footer through apps/web/src/lib/settings/server-backed-draft.svelte.ts rather than settings-page.svelte, because settings-definitions.ts's committed values are local storage and firm policy may not keep a per-browser copy. Calendar and File Safety both go through it; a third such page declares a field list and writes no machinery.

- id: settings.registry.server-backed-draft
  name: Server-backed settings drafts
  scope: One draft implementation for every settings page whose committed values live on the server — staging, the pending count, the confirmation recap, the save refusal, and the audited write.
  status: shipped
  surface: internal
  evidence: apps/web/src/lib/settings/server-backed-draft.svelte.ts over a declared field list, with apps/web/test/scan-policy-draft.test.ts and calendar-settings-draft.test.ts as its two callers' tests. Fields FOLD into the patch rather than merging, so settings sharing one nested object on the wire (the scan tier and its score floor) arrive as one object carrying both.

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
  status: shipped
  surface: internal
  evidence: Server-side, permission-gated write paths exist through the data-access layer. Client-side apps/web/src/lib/settings/settings-permissions.ts now maps each settings area to the registry key that governs it and asks the session through the shared reader (apps/web/src/lib/access/session-permissions.svelte.ts), replacing the constant that said yes to billing and no to everything else. An area is deliberately coarser than a permission: a page whose own controls are governed by something narrower (tasks:managePlans, intake:manageProcedures, calendar:manage) reads that key itself, and the server refuses on the narrow key regardless.

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
  evidence: apps/web/src/routes/(app)/settings/ holds eleven pages — theme, accessibility, text, firm-profile, users, numbering, billing, file-safety, beta-access, versions, developer — banded by apps/web/src/lib/settings/settings-sections.ts, with the draft staging and change history in settings-draft.svelte.ts and settings-ledger-store.svelte.ts.

- id: settings.area-ui.my-account
  name: My Account (identity & security)
  scope: Person-scoped /account secure shell: profile (name, email, avatar) and security (password, 2FA, sessions), no app chrome.
  status: partial
  spec: docs/specs/2026-07-10-account-settings-surface-design.md
  evidence: apps/web/src/routes/account/ — its own layout outside the app chrome, with profile, security and active-sessions pages behind it. The NAME is live end to end (see settings.area-ui.my-account.name); the photograph (auth.first-party-login.member-photo), the password change (auth.first-party-login.password-change) and two-factor (auth.two-factor.totp) are too, and the email address is stated read-only on purpose. No row on the surface is a seam any more.

- id: settings.area-ui.my-account.name
  name: A member's own name
  scope: The member's name as five parts (prefix, given, middle, family, suffix) with the printed line rendered from them, editable on Account · Profile and mirrored into the firm's roster.
  status: shipped
  surface: screen
  evidence: apps/api-worker/src/http/routes/session/me-name.ts over the five nullable columns added to the control-plane user row (packages/database/drizzle/control-plane/20260908T013359_user-name-parts.sql), with packages/directory/src/person-name.ts owning the join for both the server and the screen, and apps/web/src/routes/account/profile/ over it. Behind firm:editOwnProfile, seeded to every default role — the platform's first self-scoped mutation, closing the gap apps/api-worker/src/http/routes/session/member-profiles.ts named in its own header.
  notes: Nothing splits an existing single-line name on the server. An account that predates the columns answers partsStated false with null parts, and the screen offers splitNameForReview as a form seed the person confirms; registration carries the parts it already collects so an account created from today never meets that path.

- id: settings.area-ui.personal-preferences
  name: Personal preferences (Theme, Accessibility, Text)
  scope: Apply-immediately user settings with cross-tab sync; real end-to-end High Contrast, Scroll Edge Markers and reading-typeface axes.
  status: shipped
  surface: screen
  evidence: The settings/theme, /accessibility and /text pages over apps/web/src/lib/preferences/persisted-preference.svelte.ts, which syncs across tabs on the storage event, and apps/web/src/lib/settings/appearance-axes.svelte.ts, whose values are the same storage the no-flash boot script reads. Scroll Edge Markers is the newest axis on that seam and the one axis the boot script deliberately does not mirror - nothing paints a scroll-edge rule before the application mounts, so there is no flash to end. The reading typeface (Settings · Text, Font Family) is the newest: five faces through the data-typeface overlays in packages/design-tokens/tokens/typeface/, which re-point --mc-font-sans alone, with the boot script applying the stored face before first paint.
  notes: Scroll Edge Markers turns off the gilt rule the sidebar and every register draw at a scroll edge, suppressed in the recipe on a root data attribute rather than threaded as a prop through both consumers and everything after them. The High Contrast axis is end to end as a PREFERENCE — seed-then-own from prefers-contrast, persisted, and stamped on the document as data-contrast="high" — but only two components answer it (the checkbox and the switch), and the token layer's high-contrast context is deliberately unpopulated, so the axis is a working switch over a mostly unwritten theme rather than a finished one. Text Size on the same page is still a Soon seam, waiting on a text-scale overlay.

- id: settings.area-ui.firm-band
  name: Firm settings band
  scope: Firm Profile, Users, Roles and Permissions, Matter Numbering, Billing, File Safety & Scanning as pages whose posture follows the signed-in member's real capability.
  status: partial
  surface: screen
  evidence: Every page in the band is real end to end - Users and Roles and Permissions (settings.area-ui.member-administration), File Safety & Scanning (settings.area-ui.file-safety), Firm Profile (settings.area-ui.firm-profile), Firm Brand (settings.area-ui.firm-brand) and Billing (settings.area-ui.billing-time-policy). Matter Numbering has its own dedicated section under Practice.

- id: settings.area-ui.billing-time-policy
  name: Billing (time capture)
  scope: How the firm measures the time it bills - the increment a captured duration rounds to, and the direction it rounds in.
  status: shipped
  surface: screen
  evidence: apps/web/src/routes/(app)/settings/billing/ over GET/PATCH /api/v1/firm/time-policy (apps/api-worker/src/http/routes/firm/firm-time-policy.ts) behind time:manageSettings, Admin by seed, staged through the shared server-backed draft. The rounding engine was already live - the timer, the quick-add preview and every capture resolve these two keys - so what was missing was the firm's own door to the firm tier.
  notes: The route reads and writes the FIRM tier only; a matter, client, timekeeper or location override stands above it and is left alone, which the page states rather than leaving somebody to discover. The server takes any whole number of minutes up to an hour and the select offers the seven firms actually bill at, so a firm holding something else has its value stated rather than a control that cannot express it.

- id: settings.area-ui.file-safety
  name: File Safety & Scanning
  scope: The firm's scan policy — scan depth, the suspicion threshold, what a flagged file may do, and whether opening one asks the member to confirm who they are.
  status: shipped
  surface: screen
  evidence: apps/web/src/routes/(app)/settings/file-safety/ over GET/PATCH /api/v1/firm/scan-policy through apps/web/src/lib/file-manager/scan-policy-draft.svelte.ts, gated on firm:manageScanPolicy from the session. The same policy the ingest consumer and the download route already read, so a save reaches both without re-ingest.
  notes: The suspicion threshold is a typed number. The engine publishes the score distribution of its own rule corpus (/api/v1/firm/scan-policy/score-histogram), which is what would make the threshold answerable rather than a number in a vacuum; that plotted control is its own piece of work and the plain field stands until it lands.

- id: settings.area-ui.editing
  name: Editing
  scope: The firm's editing policy — whether every document opened in the browser editor records its changes, with the recording control kept out of members' reach and the marks hidden until somebody asks to see them.
  status: shipped
  surface: screen
  evidence: apps/web/src/routes/(app)/settings/editing/ over GET/PATCH /api/v1/firm/editing-policy (apps/api-worker/src/http/routes/firm/editing-policy.ts) through apps/web/src/lib/documents/editing-policy-draft.svelte.ts, gated on firm:manageEditingPolicy from the session, Admin by seed. The WOPI host reads the same policy on every CheckFileInfo (DisableChangeTrackingRecord), and the launch carries it so the screen framing the editor hides the marks once the document is up.
  notes: On by default. The stored document keeps every mark; accepting them on every copy that leaves the platform is the conversion container's work and is not built yet, so until it lands a download carries the redlines — the decision is recorded and the export step is the next layer of the history spec.

- id: settings.area-ui.firm-profile
  name: Firm Profile
  scope: What the firm is called to its clients — the name on an invoice, in the portal, and on every generated document.
  status: shipped
  surface: screen
  evidence: apps/web/src/routes/(app)/settings/firm-profile/ over PUT /api/v1/firm/profile (apps/api-worker/src/http/routes/firm/firm-profile.ts) behind firm:manageProfile, Admin by seed. The read is the session bootstrap, which resolves the firm's display name for every request already, so the page has one write and no read of its own; the session is re-read after a save because the name is on the chrome around the page too.
  notes: The write reaches firm.display_name and never firm.name, which is the UNIQUE provisioning handle a crashed provisioning run resumes by. Instant with its own Save rather than the firm scope's draft footer — one field, and the staged-count-and-recap anatomy over a single row is more machinery than the act. An address, a telephone number and a letterhead root belong to an office and stay under Offices rather than becoming a second firm-wide answer no letterhead reads. The page no longer summarises the offices or carries the marks: each has its own page under Firm (Offices, Firm Brand), and a copy here was the duplication the owner removed.

- id: settings.area-ui.firm-brand
  name: Firm Brand
  scope: How the firm looks - its primary mark, which every office's letterhead prints unless the office has a logo of its own, and the additional images kept beside it.
  status: shipped
  surface: screen
  evidence: apps/web/src/routes/(app)/settings/firm-brand/ (the page and brand-images-plate.svelte) over GET, PUT, PATCH and DELETE on /api/v1/firm/profile/brand-images (apps/api-worker/src/http/routes/firm/firm-profile.ts) behind firm:manageProfile, Admin by seed; every act commits at once, so nothing is staged.
  notes: Split out of Firm Profile so the name and the marks each have one home. The office's own letterhead logo stays on the office's record under Offices.

- id: settings.area-ui.member-administration
  name: Users and Roles and Permissions
  scope: The firm's roster with its three acts (invite naming a role, change what a member holds, withdraw and restore access), and the read-only surface stating what each role allows.
  status: shipped
  surface: screen
  evidence: apps/web/src/routes/(app)/settings/users/ and /roles/ over GET /api/v1/roles, PUT /api/v1/members/{userId}/roles and POST /api/v1/members/{userId}/deactivation|reactivation (apps/api-worker/src/http/routes/session/member-administration.ts), with the invite route accepting a role by name so a member arrives holding something. Permission keys are said in the firm's words by apps/web/src/lib/members/permission-language.ts, which derives the phrasing from the key rather than transcribing two hundred sentences that would go stale.
  notes: Sub-roles are built - role.parent_role_id with Partner and Associate seeded under Attorney; a member holding one also holds the parent, the set-roles route refuses a sub-role without its parent or two of one parent, and both screens list a sub-role under its parent (apps/web/src/lib/members/role-families.ts). Authoring custom roles and per-member direct grants are deliberately not built. The schema carries both (role, role_permission, direct_grant in packages/database/src/per-firm-schema.ts) and neither is needed for a firm to operate; the routes are shaped so adding them reshapes nothing.

- id: settings.area-ui.platform-band
  name: Platform band (AI and the Assistant, Beta Access, Versions, Developer)
  scope: The firm's AI consent gates, its release-channel stance, the versioned-component ledger, and the developer master switch and console.
  status: partial
  surface: screen
  evidence: Pages shipped. AI and the Assistant is fully server-backed (GET/PATCH /api/v1/firm/ai/settings, gated on firm:manageAiSettings). Beta Access is live over the session bootstrap's channel and PUT /api/v1/firm/release-channel, gated on firm:manageReleaseChannel (apps/web/src/routes/(app)/settings/beta-access/ and apps/web/src/lib/settings/release-channel-api.ts). Most Versions rows remain honest seams pending backend endpoints (page comments cite docs/research/fable-backend-review-2026-07.md).
  notes: Beta Access is instant with its own consent dialog rather than the shared draft footer — entering beta takes an explicit acknowledgement the footer's generic staged-changes recap cannot express, and leaving takes none because the route asks none. A firm on the platform-only alpha channel is told so and offered no control. AI and the Assistant is draft mode, on the opposite reasoning: opening the processing gate is not a decision to make by brushing a switch.

- id: settings.control-kinds
  name: Setting control kinds
  scope: The closed set of controls a registered setting renders as — a dropdown for an enumeration (never a radio group), a switch for a boolean, a text field, and a bounded integer field carrying the same interval its backend schema enforces.
  status: shipped
  surface: screen
  evidence: SettingKind in apps/web/src/lib/settings/settings-definitions.ts rendered by components/settings-row.svelte; the number kind's bounds are required rather than optional, enforced by apps/web/test/settings-mode-purity.test.ts, so an unbounded numeric field cannot ship and be refused by the server.

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
  scope: Per-user type/category-by-channel routing matrix with locked mandatory categories, and the firm's own tier beside it.
  status: shipped
  surface: screen
  evidence: apps/web/src/routes/(app)/settings/notifications/ over GET and PATCH /api/v1/notifications/preferences (the member's matrix, instant, notifications:read), and apps/web/src/routes/(app)/settings/notification-policy/ over GET and PATCH /api/v1/firm/notifications/policy (the firm's category tiers, the retention window and the digest hour, instant, firm:manageNotificationPolicy). Both are tables rather than the settings row anatomy: one subject with two independent answers per category.
  notes: Neither page composes the two tiers — resolveCategoryPreference in @magna-carta/notifications stays the one place that happens, and the member rows arrive resolved with inAppLockedBy saying whether a switch may be moved and who decided. The member page renders the server's suppression tallies beside the switch that caused them, so a silenced category says what it has held back. The wire vocabulary is mirrored by hand in apps/web/src/lib/notifications/category-vocabulary.ts and checked against the emitted contract by apps/web/test/notification-category-vocabulary.test.ts; the web app deliberately does not depend on @magna-carta/notifications, whose closure would reshape the gate's computed lint scope.

- id: settings.area-ui.documents-templates-category
  name: Documents & templates category
  scope: Settings surface for document types and templates.
  status: not-started
  evidence: Document-type/narrative-template API routes exist, but no settings pages for them.
