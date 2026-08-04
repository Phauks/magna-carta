# Custodian (Safe Custody)

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: custodian
  name: Custodian
  scope: Register of physical client originals held in safekeeping — what the firm holds, where it is, whose it is — with custody log, labels, scans, and reminders.
  status: partial
  slices: 4-2-custodian
  adrs: ADR-0014
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: packages/custodian + twenty-five routes in apps/worker/src/routes/custody.ts, over eleven per-firm tables. Matter detail skeleton reserves a Custodian section (apps/web/src/lib/matters/sections.ts) with nothing behind it yet.
  notes: Backend only — no UI. Gated release, receipts, portal visibility, stocktake, the destruction workflow, and the will-on-death engine are not built.

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
  notes: Recording, not gating — a check-out captures the borrower and a due-back date but blocks nothing. Gated release is a later slice.

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
  status: designed
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: custody_destruction_request exists as a schema seam with no service, no route, and no code path that writes it (packages/database/src/per-firm-schema.ts).
  notes: Owner-gated and deliberately unbuilt. The platform ships NO retention period, default, derived date, or sweep — there is no retention_until column at all, and a review date is not a retention clock.

- id: custodian.will-reminders
  name: Will release-on-death reminders
  scope: Per-state will-deposit deadline engine (jurisdiction-keyed catalog) driving release reminders.
  status: deferred
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: The design explicitly defers the will-on-death engine and per-state statute catalog out of the MVP.

- id: custodian.checkout-workflow
  name: Gated check-out/return workflow
  scope: Named-borrower check-out/return with signed receipts and gated release.
  status: designed
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: Specified as a post-MVP slice with schema seams left in the MVP; no code.

- id: custodian.stocktake
  name: Scan-to-locate and stocktake
  scope: Barcode scan-to-locate and stocktake reconciliation over the container tree.
  status: deferred
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: MVP explicitly ships container data with no stocktake workflow; later slice.
