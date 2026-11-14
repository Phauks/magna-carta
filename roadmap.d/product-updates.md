# Product Updates & User-Facing Documentation

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: product-updates
  name: Product updates
  scope: In-app and public changelog, release notes, roadmap, and live known-issues/status — versioned content bundled with the build, live content in control-plane KV.
  status: partial
  adrs: ADR-0048
  evidence: Authoring homes and fragment assembly are shipped, the live-status KV machinery exists, and the artifact's schema and parsers are a real package (packages/product-updates). The changelog is read on the community board (community.magnacarta.esq/changelog); the in-app /updates screen was removed on 2026-11-14 and every Changelog link opens the board's page. What is unbuilt: nothing writes product-updates.json or publishes to KV, there is no What's New or Roadmap view, and there is no public update page.

- id: product-updates.sources
  name: Authoring homes and fragment assembly
  scope: CHANGELOG.md and ROADMAP.md as the single authoring homes, fed by fragment directories assembled on main; propose-only docs-maintenance agent drafts entries.
  status: shipped
  surface: internal
  adrs: ADR-0037, ADR-0104, ADR-0058
  evidence: changelog.d/ + docs/decisions/pending/ + status.d/ with build assemblers, plus the docs-sync routine (docs/specs/2026-07-14-docs-sync-routine-design.md, docs/maintenance/reports/2026-07-14-baseline.md).

- id: product-updates.artifact
  name: Structured product-updates artifact
  scope: Build step deriving product-updates.json (semver entries, categories, release-note highlights, roadmap items) from the markdown homes; malformed input fails CI; published to KV at deploy.
  status: partial
  surface: internal
  adrs: ADR-0048
  evidence: Partial because the artifact exists as a package and as nothing else. The schema and the generators exist — packages/product-updates holds a versioned zod artifact schema plus buildPublicChangelogArtifact and buildPublicRoadmapArtifact, both strict enough that a malformed heading fails rather than silently dropping an entry. The web bundle calls buildPublicChangelogArtifact on docs/public-changelog.md (apps/web/src/lib/product-updates/public-changelog.ts); nothing else does — no product-updates.json is written and nothing publishes to KV at deploy.

- id: product-updates.release-notes
  name: Curated release notes
  scope: Curated highlights maintained with the changelog and surfaced in What's New.
  status: not-started
  evidence: No release-notes content or curation flow exists.

- id: product-updates.updates-route
  name: In-app /updates surface
  scope: Authenticated deep-linkable route with What's New, Changelog, and Roadmap tabs plus a help-menu entry carrying the unread badge.
  status: cut
  adrs: ADR-0048
  notes: The owner removed the in-app Changelog screen on 2026-11-14 so there is one changelog; Websites > Changelog, the command palette and the About window open community.magnacarta.esq/changelog.

- id: product-updates.public-pages
  name: Public changelog/roadmap/status pages
  scope: Logged-out Workers static pages rendered from the published artifact and KV status, presentation identical to in-app.
  status: not-started
  adrs: ADR-0048
  evidence: No public updates pages; the shipped public status page (apps/status-worker) is the observability surface, not this one.
  awaiting-owner: Whether the public changelog and roadmap get a page on the marketing site, and whether that page is indexed by search engines. The public changelog is rendered to docs/public-changelog.md; the public roadmap's renderer is written and linted but deliberately writes nothing to disk, because there are no users yet and a document nobody reads is a document nobody keeps honest.

- id: product-updates.known-issues
  name: Live known issues / status
  scope: Incident/known-issue content in control-plane KV, written through an owner/admin RBAC-gated endpoint (and propose-only agents), read by an in-app banner with no deploy.
  status: partial
  surface: awaiting-screen
  slices: service-status
  adrs: ADR-0048
  evidence: KV status snapshot, platform_operator principal, and status machinery shipped (packages/status, apps/status-worker, status.d/service-status.md — explicitly extends ADR-0048); the in-app banner does not exist.
  notes: The status page/worker itself is owned by observability; this node covers the product-updates read of the same KV source.

- id: product-updates.unread-marker
  name: What's New unread badge
  scope: lastSeenProductUpdate identity-level preference in the Settings framework driving a client-side unread badge.
  status: not-started
  adrs: ADR-0040, ADR-0048
  evidence: The settings foundation it would live in is shipped (apps/web/src/lib/settings/ and apps/web/src/lib/preferences/persisted-preference.svelte.ts); no lastSeenProductUpdate preference and no badge exists.

- id: product-updates.audience-seam
  name: Roadmap audience field
  scope: Optional audience field reserved in the artifact schema so an internal/public roadmap filter switches on at multi-firm.
  status: not-started
  adrs: ADR-0048
  evidence: Seam decided; the artifact schema it lives in does not exist yet.

- id: product-updates.forum-seams
  name: Forum integration seams
  scope: SSO deep-links into the community board, optional read-only vote counts on roadmap items, and the escalation bridge.
  status: not-started
  adrs: ADR-0044, ADR-0048
  evidence: Wired only when the native board lands; board is designed, not built.

- id: user-docs
  name: User-facing documentation
  scope: Public help center, in-app contextual help, and separate admin docs, maintained in the same commit as the feature.
  status: partial
  adrs: ADR-0019
  evidence: docs/user/ holds thirty-one feature guides and two admin guides; no help-center delivery and no in-app help.

- id: user-docs.help-center
  name: Public help center
  scope: SEO-friendly help center served as Workers static assets.
  status: not-started
  adrs: ADR-0019
  evidence: No help-center app or publishing pipeline; content lives only as repo markdown.

- id: user-docs.in-app-help
  name: In-app contextual help
  scope: Contextual help surfaced inside the application.
  status: not-started
  adrs: ADR-0019
  evidence: No contextual-help component or content wiring in apps/web.

- id: user-docs.admin-docs
  name: Admin documentation
  scope: Separate administration docs for the firm owner.
  status: partial
  surface: awaiting-screen
  adrs: ADR-0019
  evidence: Partial because two guides exist and the body of work does not. docs/user/admin/ is no longer only a README — it holds two guides, natural-language-document-search.md and trust-disbursement-approvals.md, both written beside the features that needed them. What does not exist is admin documentation as a body of work: nothing covers firm setup, members and roles, permissions, locations, rate cards, numbering, or any of the other settings a firm owner administers.

- id: user-docs.feature-guides
  name: Per-feature user guides
  scope: End-user guides per shipped feature under docs/user/features/.
  status: partial
  surface: awaiting-screen
  evidence: Thirty-one guides under docs/user/features/ (plus network-speed-test.md, which sits at docs/user/ rather than in the directory), spanning the tools, matters and documents, discovery review sets and coding, billing and trust, the calendar, safe custody, the asset register, conflicts, email filing, and signing in. Coverage still tracks only a subset of shipped surfaces, and the guides run ahead of the screens in several areas — a guide exists for capabilities whose only interface is the API.

- id: user-docs.same-commit-rule
  name: Docs-with-code maintenance rule
  scope: User docs change in the same commit as the feature, audited by the docs-sync routine.
  status: shipped
  surface: internal
  adrs: ADR-0037, ADR-0058
  evidence: Golden rule in CLAUDE.md enforced by process; docs-sync routine operational (docs/maintenance/reports/2026-07-14-baseline.md).
