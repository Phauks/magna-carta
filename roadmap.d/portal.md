# Client Portal

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Client portal -->

- id: portal
  name: Client portal
  scope: External-facing surface for clients, co-counsel, experts, and other Directory contacts — document sharing, invoice viewing/payment, secure messaging, e-signature, bug reporting.
  status: partial
  adrs: ADR-0036
  evidence: Shares (the grant half) are built in packages/sharing with the matter share routes and the File Manager screens; the recipient-facing portal is not.
  audience: public
  public-summary: Share documents, updates and bills with a client through access you can time-limit and withdraw.
  notes: Recipients are always Directory entities (no shadow user list); Directory is shipped.

- id: portal.grant-model
  name: Unified PortalGrant model
  scope: One first-class grant record per share (matter/folder/file scope) carrying recipient, capability set, assurance level, expiry, status, and audit fields.
  status: shipped
  surface: screen
  adrs: ADR-0036
  spec: docs/specs/2026-11-20-file-and-folder-sharing-design.md
  evidence: The per-firm share table (packages/database/src/per-firm-schema.ts) and packages/sharing/src/share-service.ts; any Directory person as recipient, role plus download in place of a free capability set.

- id: portal.scopes
  name: Scope semantics
  scope: File scope with optional version pin; folder scope live but child-folders private until shared; matter scope as sugar over shareable folders; shareability visible in the File Manager.
  status: shipped
  surface: screen
  spec: docs/specs/2026-11-20-file-and-folder-sharing-design.md
  evidence: packages/sharing/src/share-access.ts and apps/web/src/lib/file-manager/sharing-index.ts encode one rule; matter scope covers the files in no folder (Home) rather than every folder.

- id: portal.capabilities
  name: Per-grant capabilities
  scope: view, download, upload, comment/message, and esign as a per-grant subset.
  status: not-started
  evidence: No capability model exists; each capability's underlying engine is tracked below.

- id: portal.capabilities.view
  name: Inline view
  scope: View-only access through the inline preview viewer behind portal auth.
  status: not-started
  slices: 2-3-inline-preview-safe-delivery-sandbox
  evidence: The inline preview / safe-delivery engine it reuses is shipped; no portal-scoped path.

- id: portal.capabilities.download
  name: Download
  scope: Streaming-zip bulk download reused behind portal auth.
  status: not-started
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  adrs: ADR-0082
  evidence: The bulk-download engine it reuses is shipped; no portal-scoped path.

- id: portal.capabilities.upload
  name: Upload with quarantine
  scope: Recipient uploads quarantine into a staff-reviewed incoming queue with full ingest treatment and staff acceptance.
  status: not-started
  slices: 2-1-inbound-upload-untrusted-file-pipeline-async-bulk-download
  evidence: The untrusted ingest/scan pipeline it reuses is shipped; no quarantine queue or acceptance flow.

- id: portal.capabilities.messaging
  name: Secure messaging
  scope: Comment/message capability threaded on the matter record.
  status: not-started
  evidence: No code, no route, and as of the owner ruling of 2026-09-07 no reserved surface either — the matter section named "messaging" is calls and texts (docs/specs/2026-09-07-call-and-text-log-design.md), so a portal message thread now has nowhere declared to render. Where it lands is an open question of that spec.

- id: portal.capabilities.esign
  name: Portal e-signature
  scope: esign capability delivered through the e-signature area.
  status: not-started
  slices: 2-5-pdf-services-e-signature-core
  evidence: Firm-side signing is built (documents.esignature.signing-flow: the Signature tab, emailed signing links, colleagues signing in the app, sealing on completion); no portal hookup.

- id: portal.identity
  name: Identity and per-share assurance
  scope: Magic-link, account (email OTP), and account+2FA assurance levels; portal accounts as a distinct external principal type in control-plane D1 linked to Directory entities.
  status: not-started
  adrs: ADR-0073
  evidence: Better Auth staff auth is shipped (slice 0-4); no external principal type or assurance escalation exists.

- id: portal.lifecycle
  name: Grant lifecycle
  scope: Instant revocation, optional expiry with auto-transition, and full metadata-only audit of grant events and access.
  status: partial
  surface: screen
  evidence: packages/sharing/src/share-statements.ts checks revocation, end date and sharer standing at read time and audits share created, changed and revoked; recording a recipient's access waits on the portal.

- id: portal.enforcement
  name: DAL enforcement and invariants
  scope: Per-firm isolation, ethical-wall/least-privilege bound (grant never exceeds sharer's access), enforced in the firm-scoped data-access layer.
  status: partial
  surface: internal
  adrs: ADR-0003
  evidence: packages/sharing/src/share-access.ts re-checks the sharer's files:share and the matter's visibility on every read; the portal request lane that calls it is not merged.

- id: portal.sharing-screens
  name: Sharing in the File Manager
  scope: Shared mark, Shared With column, Sharing section in the details panel, Share on the right-click menu, and a Sharing view reviewing every share by person over the matter's folders.
  status: shipped
  surface: screen
  spec: docs/specs/2026-11-20-file-and-folder-sharing-design.md
  evidence: apps/web/src/lib/file-manager/sharing-panel.svelte, sharing-review.svelte and shared-with-cell.svelte
  audience: public
  public-summary: Share a file or folder with a client, opposing counsel or an expert from the Files page, and see at a glance what is shared with whom.

- id: portal.ui
  name: Recipient-facing portal UI
  scope: Aggregated portal rendering the live union of a recipient's active grants.
  status: not-started
  evidence: No portal app or routes exist.

- id: portal.invoices
  name: Invoice viewing and payment
  scope: Recipients view invoices and pay them through the Payments rails.
  status: not-started
  evidence: Billing substrate exists (packages/billing-core); no portal surface and no payment rails.

- id: portal.bug-reporting
  name: Portal bug reporting
  scope: External users report bugs under the same redact-by-default pipeline as staff.
  status: not-started
  adrs: ADR-0038
  evidence: The in-house incident pipeline exists for staff (slice 0-6 incident table); no portal entry point.

- id: portal.deferred
  name: Deferred portal items
  scope: Per-recipient watermarking, ad-hoc non-Directory email recipients, per-file exclusions within a shared folder.
  status: deferred
  evidence: White paper explicitly defers these with seams open.
