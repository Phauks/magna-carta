# Custodian (Safe Custody)

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Physical custody -->

- id: custodian
  name: Custodian
  scope: Register of physical client originals held in safekeeping — what the firm holds, where it is, whose it is — with custody log, labels, scans, and reminders.
  status: partial
  slices: 4-2-custodian
  adrs: ADR-0014
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: packages/custodian + thirty-eight routes in apps/api-worker/src/http/routes/custody/custody.ts, over thirteen per-firm tables. The matter section registry reserves a "custodian" slug (apps/web/src/lib/matters/sections.ts) with nothing behind it yet.
  audience: public
  public-name: Safe custody register
  public-summary: Record every original will, deed and physical item the firm holds, where it is kept, and who has it now.
  notes: Backend only — no UI. Stocktake and the destruction workflow ARE built (slice 4·2·4), and the will-deposit duty catalog with them; what is not built is receipts (blocked on a matter-routed assembly path), portal visibility (blocked on the portal grant model), the succession/transfer manifest, and the death-date seam the will catalog computes against — no packet column records a death today.

- id: custodian.register
  name: Item register
  scope: Item model with type, description, intrinsic-value flag, mandatory Directory owner link(s), co-ownership form, depositor, optional matter link, status.
  status: shipped
  surface: awaiting-screen
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: custody_packet / custody_item / custody_owner / custody_item_type in packages/database/src/per-firm-schema.ts; packages/custodian/src/{packet,item,item-type}-service.ts. Backend only.
  notes: The design splits packet (unit of custody) from item (unit of description); co-ownership is a firm-configurable role label rather than a platform enum of tenancy forms.

- id: custodian.location-hierarchy
  name: Physical location hierarchy
  scope: Recursive container tree rooted at a Location (office), default safe > box > position, arbitrary depth.
  status: shipped
  surface: screen
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: custody_location + packages/custodian/src/location-service.ts (cycle walk, depth cap, occupied-close refusal). Containers are added from the New Packet form's Container field (apps/web/src/lib/custodian/container-picker.svelte); renaming, moving and closing a container still have no screen.
  notes: A root optionally binds a firm Location; an offsite or bank root binds none, so a vault never becomes an office row.

- id: custodian.custody-ledger
  name: Check-in/out custody log
  scope: Append-only ledger of custody events (logged, moved, checked out, returned, released, destroyed) with actor and timestamp.
  status: shipped
  surface: awaiting-screen
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: custody_movement with BEFORE UPDATE / BEFORE DELETE / replace-guard triggers; packages/custodian/src/movement-service.ts is the one write path for every state change. Backend only.
  notes: Recording, not gating, with one deliberate exception — a check-out captures the borrower and a due-back date but blocks nothing, while a release is gated (see custodian.checkout-workflow) because it is the only movement that cannot be undone.

- id: custodian.labels
  name: Labels and barcodes
  scope: Printable barcode/QR labels on items and containers.
  status: shipped
  surface: awaiting-screen
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: packages/custodian/src/label-service.ts + src/labels/ (in-house Code 128 encoder, A4 24-up SVG sheet); GET /api/v1/custody/labels. Backend only — the print screen is authored when the register surface ships.
  notes: Linear Code 128 only. QR was expected to arrive with stocktake as its first consumer; stocktake shipped without it, taking packet identifiers rather than scanned codes, so no QR encoder exists and scan-to-locate is the capability still waiting on one.

- id: custodian.review-reminders
  name: Review dates and the reminder feed
  scope: Firm-set review dates on packets and items with an anniversary-anchored cycle, and one collection point serving both due reviews and overdue check-outs.
  status: partial
  surface: awaiting-screen
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: packages/custodian/src/{review-service,review-statements,reminders}.ts; POST /api/v1/custody/packets/{packetId}/reviews and GET /api/v1/custody/reminders.
  notes: Partial because delivery is not built — the emission point is a query the reports read; Notifications subscribes to it rather than defining what is due a second time.

- id: custodian.reports
  name: Register reports
  scope: Holdings per owner, occupancy per location including subtree counts, holds in force, and overdue check-outs.
  status: shipped
  surface: awaiting-screen
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: packages/custodian/src/reports.ts; GET /api/v1/custody/reports/{holdings-by-owner,holdings-by-location,holds} and GET /api/v1/custody/overdue. Backend only.

- id: custodian.scans
  name: Attached digital scans
  scope: R2 digital scans attached to each custody item.
  status: shipped
  surface: awaiting-screen
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: custody_scan links ordinary File Manager files; packages/custodian/src/scan-service.ts. Bytes ride the existing presigned upload and quarantine chokepoint — there is no upload route in Custodian. Backend only.
  notes: A matterless packet files its scans onto a per-firm system holding matter, so file.matter_id stays NOT NULL. A scan satisfies no gate the original would not.

- id: custodian.retention-destruction
  name: Retention and destruction dates
  scope: Retention/destruction dating with the intrinsic-value flag blocking routine destruction of irreplaceable originals.
  status: partial
  surface: awaiting-screen
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: Partial because the two halves of this node have come apart. DESTRUCTION is built — packages/custodian/src/destruction-service.ts and destruction-statements.ts over custody_destruction_request, five routes under /api/v1/custody/destruction-requests (raise, list, approve, refuse, execute), the requester and approver forced to differ by database trigger as well as by the service, execution appending its destroyed entry through the one movement write path, and two refusals with no override anywhere — a hold in force stops both the request and the execution, and an irreplaceable original is never destructible at the database itself rather than only in the workflow. RETENTION is not: there is no retention_until column, no default, no derived date and no sweep, which is the half this node's owner question is about.
  awaiting-owner: Does the platform ever ship a retention default? The recommendation is never — a firm sets the retention date per packet or item, and a jurisdiction catalogue supplies suggestions only once it is built and verified. The node says owner-gated in prose and has said so since the design merged; the reason it is not merely unbuilt is that shipping a default here is the platform deciding when a firm's irreplaceable original may be destroyed, which is unrecoverable in the one direction that matters. Custodian design, flag C7.
  notes: The retention half is owner-gated and deliberately unbuilt — the platform ships NO retention period, default, derived date, or sweep, there is no retention_until column at all, and a review date is not a retention clock. The destruction half shipped with slice 4·2·4 once the owner ratified its shape flags. Backend only, no screen.

- id: custodian.will-reminders
  name: Will release-on-death reminders
  scope: Per-state will-deposit deadline engine (jurisdiction-keyed catalog) driving release reminders.
  status: partial
  surface: awaiting-screen
  slices: 4-2-custodian
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: Partial because the engine half is built and the reminder half is not. The jurisdiction-keyed catalog is built — packages/custodian/src/will-deposit-catalog.ts carries the will-deposit duties verbatim with their citations, refuses an unencoded jurisdiction rather than falling back to a baseline (and refuses an unencoded county even under an encoded parent), computes a delivery due date only from a date a person recorded, and is served at GET /api/v1/custody/will-deposit-duties. Three keys are encoded — Nevada and two of its counties — so the per-state catalog is a pattern with one state in it. The REMINDER half is unbuilt and structurally blocked: the register records no date of death, so nothing can compute a trigger, which is why the catalog takes the date as a caller-supplied seam.

- id: custodian.checkout-workflow
  name: Gated release and signed receipts
  scope: Named-borrower check-out/return, gated release with identity and authority captured before an original leaves, and signed deposit/release receipts.
  status: partial
  surface: awaiting-screen
  slices: 4-2-custodian
  spec: docs/specs/2026-08-04-custodian-design.md
  evidence: packages/custodian/src/release-gate.ts + src/settings.ts, four release columns and three BEFORE INSERT triggers on custody_movement (migration 20260805T130000_custody-gated-release). The gate rides the existing movement write path — there is still no release route.
  notes: Partial because receipts are not built. The authority is free text a firm writes and no platform vocabulary — what document suffices to release an original is jurisdiction-specific and remains an owner decision. Two-signatory release is a per-firm policy, off by default. Receipt GENERATION waits on an assembly path that is matter-routed and matter-permissioned; receipt BINDING already ships, since a signed receipt links to its packet as a custody_scan of kind receipt.

- id: custodian.stocktake
  name: Scan-to-locate and stocktake
  scope: Barcode scan-to-locate and stocktake reconciliation over the container tree.
  status: partial
  surface: awaiting-screen
  slices: 4-2-custodian
  spec: docs/specs/2026-06-16-safe-custody-design.md
  evidence: Partial because the stocktake half is built and scan-to-locate is not. Slice 4·2·4 shipped packages/custodian/src/{stocktake-service,stocktake-statements,stocktake-reconciliation}.ts over custody_stocktake and custody_stocktake_sighting, with seven routes under /api/v1/custody/stocktakes — open a count over the whole register or one branch of the container tree, record observations in batches, read a reconciliation of missing, misplaced, unexpected and unregistered, and close it, which freezes the findings. A stocktake observes and reports only: nothing on the path writes the movement ledger, a packet or an item, and a source-scan fitness function holds that boundary. Sighting rows are append-only at the database, with a fourth trigger refusing an observation against a closed count. What is genuinely absent is scan-to-locate — the labels are linear Code 128 and no QR encoder exists.
