# Phase 3 — Financial Core — slice map

**Status:** Accepted (slice map) · **Date:** 2026-06-21 · **Owner:** Trevor Goldsmith
**White-paper home:** _Financial Core_ (§17 — Time tracking, Trust accounting, Billing, Costs and expenses, Operating accounting / GL) + _Reports_ (§29)
**Kind:** phase-opening **slice map** — scope, ordering, gates, cross-slice coordination, and the phase-wide invariants. It is **not** a subsystem design: each slice below gets its own design → plan → build cycle when it opens (golden rule 8). This document fixes _how Phase 3 is cut and sequenced_ and the seams every slice must honour, so the per-slice design cycles start from a shared, verified map.
**Supersedes:** the provisional Phase 3 bullet list in [`ROADMAP.md`](../../ROADMAP.md) committed under _"docs(roadmap): slice Phases 3–7 provisionally"_. The slice set is unchanged in substance; this firms it up, **flips Costs before Billing**, and adds the dependency/parallelism analysis, the boundary clarifications, and the coordination pins.

Phase 3 is the **Financial Core** — the firm's money: time, trust, billing, costs, operating books, and the financial/trust-compliance reports over them. It is the documents-first spine's immediate successor and, critically, **independent of Phase 2**: every gate it needs is already on `main` — the append-only double-entry ledger (slice 0·3), Matters + Locations + File Manager (1·1), the `protected()` crypto module (1·2), the Directory (1·3), and the AI inference foundation. Documents (Phase 2) are **not** a prerequisite, so Phase 3 opens as a parallel track.

> **Grounding.** This map was grounded by per-slice research against the white paper, the trust-rules catalog ([`docs/research/trust-rules/`](../research/trust-rules/)), and the live codebase, then adversarially verified along three axes — the dependency DAG, seam coverage (no orphan seams), and boundary/invariant placement. The verification confirmed the DAG is acyclic, Costs-before-Billing is correct and required, and every parallelism claim holds; it surfaced the four coordination pins (§3) and the additional invariants (§4) recorded here.

---

## 1. The slice map

Seven slices, in the white-paper order with one execution change (Costs precedes Billing). "Scope, not design" — the bullets bound each slice; the design is the slice's own cycle.

| # | Slice | Scope | Gates (all on `main` unless noted) |
|---|-------|-------|------------------------------------|
| **3·1** | **Time tracking + WIP + rate engine** | The daily driver, **one** backend slice (like 1·1). Per-firm work-in-progress store (duration as a minute **quantity**); the four capture methods (single server-persisted live timer, manual/quick-add, weekly grid, calendar-derived drafts); the effective-dated **rate engine** (matter→client→timekeeper→role across rate cards) and increment/rounding settings via the precedence chain; a net-new **UTBMS** task/activity catalog; the Draft→Billed lifecycle; the "My Day" visibility surfaces. Carries the **candidate first AI feature** (time-narrative drafting / UTBMS suggestion through `InferencePort`, consent-gated). | Ledger (0·3), Matters+Locations (1·1), `money`, `InferencePort`, the `setting` seam. **New substrate:** the codebase's first Durable Object (live timer). |
| **3·2** | **Trust accounting + jurisdiction compliance engine** | Per-client (per-matter) trust subledgers as leaf accounts under a per-trust-account roll-up parent, the **no-negative-balance** floor enforced by the existing `account_balance` bounds CHECK; the data-driven **jurisdiction profile** engine (seeded Nevada, rule numbers never hard-coded); trust account ↔ Location binding; the interactive **three-way reconciliation** workflow + signed archived artifact. Registers the **zero-balance close rule** on the 1·1 close-precondition hook. | Ledger (0·3), Locations (1·1), the close-precondition hook (1·1), `protected()` (1·2). Trust-rules research (partial — Nevada verified). |
| **3·3** | **Costs & expenses (disbursements)** | Per-matter cost entries (type, Directory-linked vendor, date, hard/soft, billable, optional UTBMS **E-code**); hard costs advanced as a client receivable, soft costs tracked separately; costs stay **unbilled WIP** until invoiced. Consumes the shipping **`shipment.purchased` cost-recovery** outbox seam — the codebase's **first per-firm queue consumer**. | Ledger (0·3), the outbox→queue relay, Directory (1·3) vendor entity, Matters. Shares the UTBMS catalog with 3·1. |
| **3·4** | **Billing & invoicing** | The convergence slice. Bill generation (time + costs + taxes); the four fee models (hourly, flat/fixed, contingency settlement-disbursement statements, retainer/evergreen); the draft→finalize lifecycle; **WIP→A/R posting at finalize** (the only ledger touch-point) atomically with the Draft→Billed lock; per-Location letterhead/remit-to **snapshot**; **LEDES 1998B + XML 2.0/2.1** export with UTBMS codes and **billing-guideline validation**. Records (not processes) applied trust/retainer funds and payments received (A/R→cash). | **3·1** (WIP fee entries + rates), **3·3** (cost entries), **3·2** (apply-funds convergence), Locations, the effect-batch chokepoint, Directory (guideline home). |
| **3·5** | **Operating accounting / general ledger** | Extends the ledger to full firm operating books: the **chart-of-accounts product** the schema defers, accounts payable as a subledger, operating GL postings, financial-statement read primitives (trial balance / balance sheet / income statement). QuickBooks as an optional **sync, not system-of-record**; bank-feed a reserved seam. **Loosely coupled — slots flexibly.** | Ledger (0·3), the integration framework + credential store. |
| **3·6** | **Financial & trust-compliance Reports** | The **centralized** standard report library (owner decision): pure read-only projections over the ledger + the 3·1–3·5 subledgers, reproducible for any past effective date. Trust-compliance (three-way reconciliation **rendered** here, client ledgers, journal); financial (WIP, A/R aging, realization, profitability); productivity; operational; per-office roll-ups; scheduled generation + archival; PDF/Excel/CSV export. | Reads 3·1–3·5. Read-only seams (ledger statements, fitness, meter rollup, cron, Location dimension) all on `main`. |
| **3·7** | **Billing automations** | Recurring/batch bill generation, payment reminders, payment plans, evergreen/retainer below-threshold replenishment alerts — the scheduled "no client present" layer over 3·4, riding the per-firm cron fan-out + transactional outbox. | **3·4** (hard), therefore **3·3**; reads 3·2 (threshold); hands report triggers to 3·6; the Notifications subsystem (ADR-0059, Backlog) is the delivery path. |

**Owner decisions baked in (this session):** Reports is **one centralized end slice** (3·6), not distributed; Time (3·1) stays **one** backend slice, not split; **Costs (3·3) precedes Billing (3·4)** — an invoice bills costs.

---

## 2. Dependency & ordering (verified acyclic)

```
            (all gate only on already-shipped slices)
   3·1 Time/WIP ──┐
   3·2 Trust   ───┼──► 3·4 Billing ──► 3·7 Automations
   3·3 Costs   ──►┘        │
   3·5 GL  (loosely coupled, slots anywhere)   │
                                    3·1..3·5 ──► 3·6 Reports
```

- **Three independent parallel streams open at once:** **3·1 (Time/WIP)**, **3·2 (Trust)**, and **3·5 (GL)** each depend only on already-shipped gates and never read each other's tables (time never posts to a trust ledger; trust never reads WIP). They are parallel-stream-eligible — the natural way to run Phase 3 as the separate track it is.
- **3·3 (Costs)** runs alongside, sharing only the UTBMS catalog with 3·1, and **must precede 3·4** — an invoice bills costs, the cost→A/R conversion happens at finalize, and the `shipment.purchased` cost-recovery seam feeds costs an invoice later bills.
- **3·4 (Billing) is the one hard serialization point** — it cannot complete until 3·1 (WIP fee entries + effective-dated rates) **and** 3·3 (billable cost entries) exist, with 3·2 converging for the apply-trust-funds path. Within 3·4, the finalize/WIP→A/R path and the LEDES-export/validation engine are two parallel sub-streams.
- **3·6 (Reports) and 3·7 (Automations) are terminal** — 3·6 reads all of 3·1–3·5 (its scaffolding can be specced in parallel, but report bodies land last); 3·7 hard-depends on 3·4.

**Mechanical contention (not a build-order edge, but real):** every stream that adds schema contends for the **next per-firm migration slot** (latest is `0014_inference-token-usage`; no `0015` exists yet), adds keys to `packages/access-control/src/registry.ts`, and 3·3/3·7 both extend the `apps/worker` `queue()` dispatch. Gate every cross-cutting edit on `vp run worktrees` + a `main` sync, per the worktree convention.

---

## 3. Cross-slice coordination pins (resolve at design time, before parallel streams start)

The dependency check surfaced four couplings that do **not** change the topological order but must be assigned an owner up front, or the parallel streams collide:

1. **The `matter.e_billing` flag — land it early, do not let 3·4 own it.** 3·4 needs the per-matter e-billing flag, but 3·1 (time capture) and 3·3 (cost capture) **read** it to make UTBMS codes *required* at capture. Taken literally that is a 3·4→3·1/3·3 back-edge that would invert the order. It is **not** a true cycle — the dependency is soft/data, not build: 3·1/3·3 ship optional-code capture regardless; the flag only *toggles* required-ness. **Resolution:** land the single nullable `matter.e_billing` column **early**, in whichever of 3·1/3·3/3·4 ships first (build-when-in-the-area), never owned by 3·4.

2. **The UTBMS catalog has one owner: 3·1.** The task/activity + expense (E-) code catalog is net-new and shared by 3·1 (task/activity), 3·3 (expense E-codes), and 3·4 (LEDES export). Since 3·1 and 3·3 run as parallel streams, **3·1 owns and lands the catalog first**; 3·3 consumes it (so 3·1 leads 3·3 slightly, or the catalog is extracted as a tiny shared deliverable landed before either).

3. **The cost→A/R posting service belongs to 3·4.** The ledger schema exists but no cost-posting service does. **3·4 (invoicing) owns all WIP→A/R posting — time *and* cost**; 3·3 only persists cost WIP and emits `cost.recorded`. This keeps the single ledger touch-point in one slice.

4. **Co-design the product chart-of-accounts + firm account-resolver across the 3·4/3·5 boundary.** 3·4 finalize must resolve *which* firm A/R / fee-income / cost-recovery / tax-payable account ids to post into; the demo chart (`fixtures/demo-chart-of-accounts.ts`) is explicitly **not** the product chart, which 3·5 builds. So 3·4 has a latent dependency on a firm-scoped account **resolver** 3·5 owns. Land the COA-classification columns early (cheap-from-getgo) and co-design the chart + resolver rather than treating 3·5 as purely downstream; if 3·5 slots after 3·4, 3·4 needs an interim account-resolution seam.

---

## 4. Phase-wide invariants

The white paper fixes the load-bearing ones; the boundary verification added the rest. Each binds across the slices noted — the per-slice design cycle and the area `CLAUDE.md` must restate the ones it touches.

**From the white paper / [`invariants.md`](../conventions/invariants.md):**

1. **Time (and cost) is WIP, not a ledger posting.** Unbilled time/cost lives in WIP stores and never writes a `ledger_entry`/`ledger_line`; **only at invoice finalize (3·4)** does billable WIP convert to an A/R receivable. The append-only ledger stays purely money-movement. (3·1, 3·3 own WIP; 3·4 owns the conversion.)
2. **WIP→A/R finalize is atomic.** The A/R post **and** the Draft→Billed lock of every contributing entry commit in **one** effect-batch — an entry can never be locked without its receivable, nor billed twice. (3·4.)
3. **No-negative trust balance per client ledger** — enforced on write by `min_balance_minor = 0` + the `account_balance` bounds CHECK aborting the whole batch, never an app-level check. (3·2.)
4. **Fees never touch trust.** Trust/IOLTA deposits land gross; processor/bank fees debit operating only, never netted from a trust deposit. **Structural owner: 3·2** (see §5).
5. **Append-only everywhere.** Ledger, trust, time-entry, cost-entry, and invoice corrections are **new** reversing/adjusting entries (or credit notes), never UPDATE/DELETE on a posted/billed row.
6. **Effective-dated.** A time entry keeps the rate in force on its date; a ledger posting records on its effective date (backdating allowed, future-dating refused). **This is cross-slice** (3·1 rate; 3·2/3·4/3·5 ledger `effective_date`) and feeds 3·6's reproducibility requirement — reports read `effective_date`, never `recorded_at`.
7. **Rule numbers are never hard-coded** — every governing-rule citation, retention period, reconciliation cadence is a jurisdiction-profile value. (3·2.)

**Added by the boundary verification (flag in the owning slice's design cycle):**

8. **No-commingling is distinct from no-negative.** No-negative prevents overdraft-by-disbursement; no-commingling prevents firm money sitting in a client trust ledger **except** the rule-permitted bank-charge carve-out (the jurisdiction-profile "firm-funds-in-trust allowance"). The carve-out needs its own structural guard — the bounds CHECK does not express it. First-class **3·2** invariant.
9. **Letterhead/remit-to is snapshot-not-live.** A finalized invoice **copies** the matter's Location letterhead/remit-to at finalize, so a later Location edit cannot mutate a historical invoice — the document-artifact analogue of append-only. Hard rule, not just an open question. (3·4.)
10. **Matter number frozen at assignment binds in Phase 3** — invoices, trust client-ledger labels, and every time/cost entry reference a stable, unique-per-firm matter number. (3·4 invoices; 3·2 trust ledgers.)
11. **Single registered currency per entry** (all lines share one currency; accounts pin USD today) is an explicit *current-state* assumption — a future multi-currency trust account / foreign-client invoice is a **schema change**, not a silent extension. (3·2, 3·4, 3·5.)
12. **Idempotency is a shared Phase-3 theme.** Phase 3 is where the per-firm queue path gets its **first real consumers** — cost recovery (3·3), AI inference (3·1), billing automations (3·7), report email (3·6). Every new external-consequence path rides the transactional outbox and **must be idempotent / overlap-safe** (consumer dedup on the outbox row id; the AI producer additionally sets a stable `InferenceJob` idempotency key so a redelivery cannot double-bill a frontier model).

---

## 5. Boundary clarifications

- **Payments: Phase 3 records, Phase 6 processes.** Phase 3 owns money-**movement** events as ledger postings — trust deposits, applying retainers, recording payments received (A/R→cash). Payment **rails** (card surcharge, hosted-fields/tokenization, portal pay) stay **Phase 6**, reusing 3·2's jurisdiction-profile machinery for surcharge legality (the same reuse the white paper names for call-recording consent). **Pin:** the A/R→cash cash-receipt posting is named in both 3·4 and 3·7 but is currently under-homed — **assign it to 3·4** (the invoicing slice owns the receivable's whole lifecycle) so it does not fall between 3·4 and Phase 6.
- **Fees-never-touch-trust has a single structural owner: 3·2.** The ledger primitive is **account-agnostic** (it enforces balanced/leaf-only/bounds, with no concept of "trust" vs "operating"), so it cannot enforce this itself. Enforcement must live in the slice that **composes** the entries. **3·2 owns the canonical composition guard + a fitness invariant** (refuse any composition debiting a fee against a trust account; flag any trust-account posting touching a fee account); 3·4 (apply-trust-funds) and Phase 6 (card rail) **inherit** it. Reports (3·6) only *attest* it, never repair it. Reconcile `invariants.md`'s split attribution (Trust heading, Payments/ADR-0032 cite) in 3·2's design cycle.
- **Three-way reconciliation: produced in 3·2, rendered in 3·6.** 3·2 owns the interactive workflow and **archives the signed immutable artifact** (bank side + cleared items); 3·6 renders the centralized standard-library report and re-derives the **book** side from the ledger fitness invariants. Open design-cycle question (not a mis-binning): the exact read contract — does 3·6 re-derive the book side live, or read 3·2's stored reconciliation rows?

---

## 6. Per-slice starting seams

Each slice's design cycle starts from the seams below — real `file:line` anchors in the current codebase (reuse before building, golden rule 1). These are *starting points*, not finished design.

### 3·1 — Time tracking + WIP + rate engine
- **New tables** on `packages/database/src/per-firm-schema.ts` (no expand-contract — all net-new): `time_entry` (WIP: `matter_id`, timekeeper `user_id`, duration in **minutes**, narrative, billable flag, resolved-rate snapshot, optional UTBMS refs, draft/billed CHECK), `rate_card` + effective-dated `rate` rows, `utbms_code` catalog — reusing the matter/member/location FK targets already there.
- **Rate math reuses `@magna-carta/money`** (`packages/money/src/money.ts`): `Rate` (e4), `multiplyByQuantity`, `rounding.ts` — no new money machinery, no floats.
- **Increment/rounding via the setting seam** (`packages/data-access/src/setting-statements.ts`) along the entity→user→location→firm→system precedence chain.
- **AI feature through `InferencePort`** (`packages/inference/src/port.ts` `generate`/`generateStream`), gated on `aiProcessingEligibility` (default OFF) + ADR-0109 (Proposed → must be Accepted). **First real producer** must discharge the inference carry-forward at `apps/worker/src/inference/inference-consumer.ts:72` (stable idempotency key + consumer dedup in the same batch as the metering write; consider cache-read/creation token columns on `token_usage_meter`).
- **New substrate:** the codebase's **first Durable Object** (no `durable_objects` block in `wrangler.jsonc` today) for the live timer — boundary (per-timekeeper vs per-firm), the Tauri offline-sync story, and the wrangler class declaration are a design-cycle decision.
- **Load-profile:** add a `TimeVolume` sub-profile to `packages/fixtures/src/load-profile/profile.ts`, measure My-Day totals / weekly-grid fan / rate resolution (accretion rule).

### 3·2 — Trust accounting + jurisdiction engine
- **No-negative floor reuses the existing primitive:** `setAccountBoundsStatement` (`packages/ledger/src/statements.ts:114`) + the `account_balance_bounds_check` DDL (`0001_ledger-core.sql:8`) — write `min_balance_minor = 0` on each client trust leaf in the **same batch** the account+balance row is created.
- **Account tree:** model each trust account as a parent (liability) account, each client/matter trust ledger as a child leaf via `createAccount` (`packages/ledger/src/create-account.ts:31`); sum-over-children is the reconciliation total.
- **Postings:** `postEntry` (`post-entry.ts:79`); corrections via `reverseEntry` (`reverse-entry.ts:38`) — heed the documented hazard (reversing a since-disbursed deposit fails the bounds CHECK at commit).
- **Close hook:** append a `ClosePrecondition` to `CLOSE_PRECONDITIONS` (`packages/matters/src/close-preconditions.ts:22`) returning a `trust-balance-nonzero` failure — the registry's first consumer (ADR-0080).
- **Jurisdiction profile** seeded from `docs/research/trust-rules/` (Nevada verified); Location binding via `location.jurisdiction`/`remit_to` (pass resolved strings in, don't import `@magna-carta/locations` into the trust package). Permissions: `trust:*` in `packages/access-control/src/registry.ts`. Protected bank-account identifiers via the `protected-fields` chokepoint if sealed.

### 3·3 — Costs & expenses
- **Cost-recovery consumer:** the `shipment.purchased` producer at `packages/data-access/src/shipment-service.ts:127-138` carries `{shipmentId, postageCostMinor, serviceFeeMinor, currency}`; the consumer joins the shipment row (`per-firm-schema.ts:1090`) for `matter_ref`/carrier, writes one hard cost (postage = advanced client cost) + a separate firm service-fee line (**unblended**), idempotent on `shipmentId`. A null `matter_ref` = firm-administrative shipment (no receivable).
- **First per-firm queue consumer:** register the per-firm `QUEUE` branch in `apps/worker/src/index.ts:36-43` (the symmetric analogue of `CONTROL_PLANE_CONSUMERS`), resolving firm from `message.firmId`, dispatching on `message.topic`, dedup on `message.id` (`scheduled.ts:169-170` notes nothing consumes it yet).
- **Service shape** mirrors `shipment-service.ts` (ClockPort + actor + `domainAuditStatement` + `newIdentifier`, returns `EffectWrite`); emit `cost.recorded` for 3·4. Vendor = a nullable Directory entity id (reuse `directory_organization`/`directory_person` + a `vendor` party-role seed; **no new vendor table**).

### 3·4 — Billing & invoicing
- **The WIP→A/R post:** compose `postEntry` (Dr A/R / Cr Fee Income + Cr Cost Recovery Income + tax) and merge `effect.statements` into the **same** `runIdempotentEffect` batch as the entry-lock + invoice inserts (`packages/data-access/src/effect-batch.ts:26`/`:43`) — atomic and replay-safe.
- **Chart targets** are demo-only today (`fixtures/demo-chart-of-accounts.ts:17`) — resolve via the real product chart + firm account-resolver co-designed with 3·5 (pin §3.4).
- **Letterhead snapshot** from `matter.location_id` → `location.address_block/footer/remit_to` (`0004_matters-locations-file-manager.sql:87`), copied onto the invoice at finalize (invariant §4.9); firm-default fallback when `location_id` is null.
- **`matter.e_billing`** column added here-or-earlier (pin §3.1); **LEDES** exporters as adapters behind a small port over a canonical invoice shape (the `@magna-carta/shipping` port/canonical pattern); billing guidelines on the client Directory entity. Permissions: `billing:*` in the registry, seeded to the existing Billing role (`0002_member-rbac.sql:51`). New identifier prefixes (`invoiceLine`, `creditNote`, `billingGuideline`) in `packages/identifiers/src/registry.ts`.

### 3·5 — Operating accounting / GL
- **Chart-of-accounts product** accreted on `ledger_account` (`per-firm-schema.ts:189`, comment at `:187`): add code/number + statement-classification columns **without widening the 5-value `type` CHECK** (normal balance stays code-derived, `normal-balance.ts:4`); A/P as a liability subledger over `parent_account_id`. Build via `createAccount` (leaf-only/parent-match guards), not raw INSERTs.
- **Statement primitives** (trial balance / balance sheet / income statement) added to `packages/ledger/src/statements.ts:162` (own *assembly*, leave *rendering* to 3·6). Consume `LEDGER_ENTRY_POSTED_TOPIC` (`post-entry.ts:155`) as the QuickBooks change-feed.
- **QuickBooks/bank-feed** as integration Ports with CapabilityDescriptors (`packages/integrations/src/port.ts`), credentials in `firm_secret` (`per-firm-schema.ts:716`) + `integration_connection`; the adapter/Worker itself is Phase 7·2 — 3·5 reserves the `accounting` category + export seam. **Sync, never system-of-record.**

### 3·6 — Reports (centralized)
- **Read seams stay in the ledger package** (under the schema-name-sync net): add A/R-aging / trial-balance / journal-by-effective-date builders near `statements.ts:162`, reusing `fitness.ts` (`:26`/`:39`/`:56`) as the book-side reconciliation proof.
- **Rollup idiom:** the `token_usage_meter` delta-upsert + GROUP BY (`token-usage-statements.ts:18`); the firm-wide verdict rollup mirrors `file-manager/src/usage.ts:44` — **note:** the `inline_playable` column (ADR-0029) lands from slice 2·3 and is **not** on this worktree yet (only `file_version.scan_verdict` exists); roll up whichever verdict columns are merged at build time.
- **Scheduling** on the existing daily `0 3 * * *` cron (`scheduled.ts:374` pattern, `listReachableActiveFirms` fan-out); heavy PDF/Excel rendering offloaded to a Queue/Container job (golden rule 10), archived through the File Manager storage seam, delivered via `SEND_EMAIL` through the outbox. Per-office roll-ups via `matter.location_id`. Add `reports-measurements.ts` to the load profile.

### 3·7 — Billing automations
- **Cron + per-firm fan-out:** route a `runBillingAutomations` pass off the daily cron (`apps/worker/src/index.ts:25`, `scheduled.ts:105`/`:212`), one firm at a time with per-firm try/catch isolation. Every consequence is an outbox message in the same `commitEffectBatch` (`effect-batch.ts:26`) — handlers never call email/SMS directly; the relay (`outbox-relay.ts:36`, at-least-once, dead-letter) dispatches. New topics (`comms.send`, `billing.invoice.generate`, `trust.replenish.alert`) carry **ids + non-privileged fields only**.
- **Replenishment** reads each balance against a firm-configured threshold (a 3·2/automation-rule config, **not** `min_balance_minor`) — read-only, no trust write. **Delivery** targets the `notify()` seam (ADR-0059); if Notifications has not shipped, emit the outbox topic + a minimal `SEND_EMAIL` dispatch behind the same call site.

---

## 7. What's next

1. **This document + the ROADMAP/STATUS edits land on the `phase-3-financial-core` worktree.** ROADMAP's Phase 3 section is replaced with the firmed-up map; STATUS gains a Phase 3 table.
2. **Open the slice 3·1 (Time) design cycle** — its own brainstorm → spec → plan → build. The competitive **time-tracking deep-dive** research ([`docs/research/`](../research/) — how Clio, Smokeball, MyCase, and peers implement *and surface* time tracking, with the passive-capture mechanics we are deliberately deferring) is a direct input to that cycle.
3. **3·2 (Trust) and 3·5 (GL)** can open in parallel as independent streams whenever a hand is free — neither waits on 3·1.

Per-slice ADRs are recorded in each slice's own design cycle (golden rule 8); this map cites the existing ADRs the slices build on and introduces no new architectural decision beyond the Costs-before-Billing execution order and the four coordination pins (§3), both recorded here and in the ROADMAP narrative.
