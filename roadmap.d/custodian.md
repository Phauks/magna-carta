# Custodian (Safe Custody)

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: custodian
  name: Custodian
  scope: Register of physical client originals held in safekeeping — what the firm holds, where it is, whose it is — with custody log, labels, scans, and reminders.
  status: partial
  slices: 4-2-custodian
  adrs: ADR-0014
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: packages/custodian + apps/worker/src/routes/custody.ts (register, location tree, movements, reminders, reports, labels, stocktake, destruction — 38 routes), over thirteen per-firm tables. Matter detail skeleton reserves a Custodian section (apps/web/src/lib/matters/sections.ts) with nothing behind it yet.
  notes: Backend only — no UI. Receipts and portal visibility are not built; the will-on-death engine is a catalog only, not yet wired to reminders.

- id: custodian.register
  name: Item register
  scope: Item model with type, description, intrinsic-value flag, mandatory Directory owner link(s), co-ownership form, depositor, optional matter link, status.
  status: shipped
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: custody_packet / custody_item / custody_owner / custody_item_type in packages/database/src/per-firm-schema.ts; packages/custodian/src/{packet,item,item-type}-service.ts. Backend only.
  notes: The design splits packet (unit of custody) from item (unit of description); co-ownership is a firm-configurable role label rather than a platform enum of tenancy forms.

- id: custodian.location-hierarchy
  name: Physical location hierarchy
  scope: Recursive container tree rooted at a Location (office), default safe > box > position, arbitrary depth.
  status: shipped
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: custody_location + packages/custodian/src/location-service.ts (cycle walk, depth cap, occupied-close refusal). Backend only.
  notes: A root optionally binds a firm Location; an offsite or bank root binds none, so a vault never becomes an office row.

- id: custodian.custody-ledger
  name: Check-in/out custody log
  scope: Append-only ledger of custody events (logged, moved, checked out, returned, released, destroyed) with actor and timestamp.
  status: shipped
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: custody_movement with BEFORE UPDATE / BEFORE DELETE / replace-guard triggers; packages/custodian/src/movement-service.ts is the one write path for every state change. Backend only.
  notes: Recording, not gating, with one deliberate exception — a check-out captures the borrower and a due-back date but blocks nothing, while a release is gated (see custodian.checkout-workflow) because it is the only movement that cannot be undone.

- id: custodian.labels
  name: Labels and barcodes
  scope: Printable barcode/QR labels on items and containers.
  status: shipped
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: packages/custodian/src/label-service.ts + src/labels/ (in-house Code 128 encoder, A4 24-up SVG sheet); GET /api/v1/custody/labels. Backend only — the print screen is authored when the register surface ships.
  notes: Linear Code 128 only; QR waits for stocktake, which is the first capability that would use it.

- id: custodian.review-reminders
  name: Review dates and the reminder feed
  scope: Firm-set review dates on packets and items with an anniversary-anchored cycle, and one collection point serving both due reviews and overdue check-outs.
  status: partial
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: packages/custodian/src/{review-service,review-statements,reminders}.ts; POST /api/v1/custody/packets/{packetId}/reviews and GET /api/v1/custody/reminders.
  notes: Partial because delivery is not built — the emission point is a query the reports read; Notifications subscribes to it rather than defining what is due a second time.

- id: custodian.reports
  name: Register reports
  scope: Holdings per owner, occupancy per location including subtree counts, holds in force, and overdue check-outs.
  status: shipped
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: packages/custodian/src/reports.ts; GET /api/v1/custody/reports/{holdings-by-owner,holdings-by-location,holds} and GET /api/v1/custody/overdue. Backend only.

- id: custodian.scans
  name: Attached digital scans
  scope: R2 digital scans attached to each custody item.
  status: shipped
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: custody_scan links ordinary File Manager files; packages/custodian/src/scan-service.ts. Bytes ride the existing presigned upload and quarantine chokepoint — there is no upload route in Custodian. Backend only.
  notes: A matterless packet files its scans onto a per-firm system holding matter, so file.matter_id stays NOT NULL. A scan satisfies no gate the original would not.

- id: custodian.retention-destruction
  name: Retention and destruction dates
  scope: Retention/destruction dating with the intrinsic-value flag blocking routine destruction of irreplaceable originals.
  status: shipped
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: packages/custodian/src/{destruction-service,destruction-statements,close-advisory}.ts, migration 20260805T180000_custodian-destruction.sql. Raise -> approve/refuse -> execute, two-person by construction; the intrinsic-value refusal enforced at three layers including the ordinary movement path; matter-close CloseAdvisory hook that cannot block closure.
  notes: The platform still ships NO retention period, default, derived date, or sweep — there is no retention_until column at all, and a review date is not a retention clock. Owner-ratified scope (C4-C11).

- id: custodian.will-reminders
  name: Will release-on-death reminders
  scope: Per-state will-deposit deadline engine (jurisdiction-keyed catalog) driving release reminders.
  status: partial
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: packages/custodian/src/will-deposit-catalog.ts — jurisdiction-keyed duty catalog and due-date computation from a recorded trigger date; Nevada NV-1..NV-5 encoded verbatim from NRS 136.050 and related statutes.
  notes: The catalog and deadline computation exist but are not yet wired to the reminder feed or any release-reminder surface, and only Nevada is encoded so far.

- id: custodian.checkout-workflow
  name: Gated release and signed receipts
  scope: Named-borrower check-out/return, gated release with identity and authority captured before an original leaves, and signed deposit/release receipts.
  status: partial
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: packages/custodian/src/release-gate.ts + src/settings.ts, four release columns and three BEFORE INSERT triggers on custody_movement (migration 20260805T130000_custody-gated-release). The gate rides the existing movement write path — there is still no release route.
  notes: Partial because receipts are not built. The authority is free text a firm writes and no platform vocabulary — what document suffices to release an original is jurisdiction-specific and remains an owner decision. Two-signatory release is a per-firm policy, off by default. Receipt GENERATION waits on an assembly path that is matter-routed and matter-permissioned; receipt BINDING already ships, since a signed receipt links to its packet as a custody_scan of kind receipt.

- id: custodian.stocktake
  name: Scan-to-locate and stocktake
  scope: Barcode scan-to-locate and stocktake reconciliation over the container tree.
  status: shipped
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: packages/custodian/src/{stocktake-service,stocktake-reconciliation,stocktake-statements}.ts, seven routes on existing custody permissions, migration 20260805T150000_custodian-stocktake.sql. Open a count, record batched observations (sighted/not_found/unregistered), close producing a reconciliation.
  notes: Backend only. Observe-only by construction — corrective movements are proposals only, applied (if at all) by a person through the existing movements endpoint, never auto-applied.
