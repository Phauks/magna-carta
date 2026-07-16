# Custodian (Safe Custody)

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: custodian
  name: Custodian
  scope: Register of physical client originals held in safekeeping — what the firm holds, where it is, whose it is — with custody log, labels, scans, and reminders.
  status: designed
  adrs: ADR-0014
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: Full MVP-first design on main refining ADR-0014; no code. Matter detail skeleton reserves a Custodian section (apps/web/src/lib/matters/sections.ts).
  notes: Spec places it in a later phase paired with Conflicts; not yet sliced. Remote branch safe-custody-design still exists.

- id: custodian.register
  name: Item register
  scope: Item model with type, description, intrinsic-value flag, mandatory Directory owner link(s), co-ownership form, depositor, optional matter link, status.
  status: designed
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: Domain model fully specified in the design; no schema or code.

- id: custodian.location-hierarchy
  name: Physical location hierarchy
  scope: Recursive container tree rooted at a Location (office), default safe > box > position, arbitrary depth.
  status: designed
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: Container model specified; the Location entity it roots at is shipped (packages/locations).

- id: custodian.custody-ledger
  name: Check-in/out custody log
  scope: Append-only ledger of custody events (logged, moved, checked out, returned, released, destroyed) with actor and timestamp.
  status: designed
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: Specified as record-keeping (not enforced workflow) in the MVP; no code.

- id: custodian.labels
  name: Labels and barcodes
  scope: Printable barcode/QR labels on items and containers.
  status: designed
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: Label carrying specified for MVP; no code.

- id: custodian.scans
  name: Attached digital scans
  scope: R2 digital scans attached to each custody item.
  status: designed
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: Specified in the MVP domain model; R2 storage substrate shipped; no custody code.

- id: custodian.retention-destruction
  name: Retention and destruction dates
  scope: Retention/destruction dating with the intrinsic-value flag blocking routine destruction of irreplaceable originals.
  status: designed
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: Captured as data seams in the MVP design; destruction workflow machinery is a later slice.

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
