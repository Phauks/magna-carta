# Product Updates & User-Facing Documentation

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: product-updates
  name: Product updates
  scope: In-app and public changelog, release notes, roadmap, and live known-issues/status — versioned content bundled with the build, live content in control-plane KV.
  status: partial
  adrs: ADR-0048
  evidence: Authoring homes and fragment assembly are shipped and the live-status KV machinery exists; the structured artifact, /updates route, and public update pages are unbuilt.

- id: product-updates.sources
  name: Authoring homes and fragment assembly
  scope: CHANGELOG.md and ROADMAP.md as the single authoring homes, fed by fragment directories assembled on main; propose-only docs-maintenance agent drafts entries.
  status: shipped
  adrs: ADR-0037, ADR-0104, ADR-0058
  evidence: changelog.d/ + docs/decisions/pending/ + status.d/ with build assemblers, plus the docs-sync routine (docs/specs/2026-07-14-docs-sync-routine-design.md, docs/maintenance/reports/2026-07-14-baseline.md).

- id: product-updates.artifact
  name: Structured product-updates artifact
  scope: Build step deriving product-updates.json (semver entries, categories, release-note highlights, roadmap items) from the markdown homes; malformed input fails CI; published to KV at deploy.
  status: not-started
  adrs: ADR-0048
  evidence: No generator, schema, or artifact in the build; decided in ADR-0048 only.

- id: product-updates.release-notes
  name: Curated release notes
  scope: Curated highlights maintained with the changelog and surfaced in What's New.
  status: not-started
  evidence: No release-notes content or curation flow exists.

- id: product-updates.updates-route
  name: In-app /updates surface
  scope: Authenticated deep-linkable route with What's New, Changelog, and Roadmap tabs plus a help-menu entry carrying the unread badge.
  status: not-started
  adrs: ADR-0048
  evidence: No such route in apps/web; design system it must build from is shipped.

- id: product-updates.public-pages
  name: Public changelog/roadmap/status pages
  scope: Logged-out Workers static pages rendered from the published artifact and KV status, presentation identical to in-app.
  status: not-started
  adrs: ADR-0048
  evidence: No public updates pages; the shipped public status page (apps/status-worker) is the observability surface, not this one.
  awaiting-owner: Whether the public changelog and roadmap get a page on the marketing site, and whether that page is indexed by search engines. Both documents are written and rendered; only the page is missing.

- id: product-updates.known-issues
  name: Live known issues / status
  scope: Incident/known-issue content in control-plane KV, written through an owner/admin RBAC-gated endpoint (and propose-only agents), read by an in-app banner with no deploy.
  status: partial
  slices: service-status
  adrs: ADR-0048
  evidence: KV status snapshot, platform_operator principal, and status machinery shipped (packages/status, apps/status-worker, status.d/service-status.md — explicitly extends ADR-0048); the in-app banner does not exist.
  notes: The status page/worker itself is owned by observability; this node covers the product-updates read of the same KV source.

- id: product-updates.unread-marker
  name: What's New unread badge
  scope: lastSeenProductUpdate identity-level preference in the Settings framework driving a client-side unread badge.
  status: not-started
  adrs: ADR-0040, ADR-0048
  evidence: Settings foundation shipped (changelog.d/settings-foundation-and-profile-menu.md); no marker or badge exists.

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
  evidence: docs/user/ exists with seven feature guides; no help-center delivery, in-app help, or real admin docs.

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
  status: not-started
  adrs: ADR-0019
  evidence: docs/user/admin/ contains only a README stub.

- id: user-docs.feature-guides
  name: Per-feature user guides
  scope: End-user guides per shipped feature under docs/user/features/.
  status: partial
  evidence: Guides exist for file-hash-integrity, file-unlock-password-recovery, metadata-inspector-scrubber, safe-website-viewer, shipping, whois-lookup, and network-speed-test; coverage tracks only a subset of shipped surfaces.

- id: user-docs.same-commit-rule
  name: Docs-with-code maintenance rule
  scope: User docs change in the same commit as the feature, audited by the docs-sync routine.
  status: shipped
  adrs: ADR-0037, ADR-0058
  evidence: Golden rule in CLAUDE.md enforced by process; docs-sync routine operational (docs/maintenance/reports/2026-07-14-baseline.md).
