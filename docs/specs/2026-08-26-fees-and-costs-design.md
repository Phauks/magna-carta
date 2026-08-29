# Fees and Costs — the delineated matter surfaces

**Date:** 2026-08-26 · **Status:** Draft for owner review · **Surfaces:** the matter Fees tab (new)
and the matter Costs tab (design pass on the built surface) · **Review artifacts:** the two mockup
fragments built beside this spec, structured to merge into The Timesheet mockup in the integration
round.

**Owner's framing, which this design serves:** attorney fees are payments for a lawyer's
professional time, skill, and legal work; attorney costs are separate out-of-pocket expenses paid to
advance a specific case. The two are different kinds of money and the surfaces must say so — while
sharing the Time tab's design language, because the three tabs are one family a firm reads together.

**Binding inputs:** the Time tab rulings
([`docs/conventions/time-tab-rulings.md`](../conventions/time-tab-rulings.md) — the status register,
the editing chain, the details panel, the footer conventions, entry numbers, printable units, and
every generalized file-manager ruling they inherit), the standing design corrections
([`docs/conventions/design-corrections.md`](../conventions/design-corrections.md)), the financial
invariants ([`docs/conventions/invariants.md`](../conventions/invariants.md) — minor-unit integer
money, append-only ledger, fees never touch trust), the billing design
([`2026-08-05-billing-design.md`](2026-08-05-billing-design.md)) and billing automations design
([`2026-08-16-billing-automations-design.md`](2026-08-16-billing-automations-design.md)).

---

## 1. The domain research — what the delineation actually is

### 1.1 The professional-conduct frame

- **Model Rule 1.5(a)** governs both sides by name: a lawyer shall not charge "an unreasonable fee
  or an unreasonable amount for expenses." Fees and expenses are two regulated categories in the
  same sentence — the rule's own structure is the two-tab structure.
  ([ABA Rule 1.5](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_1_5_fees/))
- **Model Rule 1.5(c)** requires a contingent-fee agreement to state, in writing, which litigation
  expenses come out of the recovery **and whether they deduct before or after the fee is
  calculated**. The platform already records exactly this election
  (`matter_billing_arrangement.contingency_basis`: `gross_recovery` | `net_after_costs`), so the
  Fees surface renders it rather than re-deriving it.
- **Model Rule 1.8(e)** permits a lawyer to **advance** court costs and litigation expenses, with
  repayment contingent on the outcome. "Advance" is the operative verb: the money is the firm's
  until recovered, which is why the Costs tab's totals speak of what the firm has _advanced_ and
  what is _recoverable_, not of "expenses".
  ([ABA Rule 1.8](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_1_8_current_clients_specific_rules/))

### 1.2 Advanced costs are loans, not expenses — the tax fact that shapes the ledger

The IRS and the courts treat client costs advanced with an expectation of reimbursement as **loans**:
not deductible when paid, carried as a receivable, deductible only as bad debt if the case is lost
and the client cannot repay (_Boccardo v. Commissioner_, 56 F.3d 1016 (9th Cir. 1995), which carved
out only true gross-fee agreements where the firm never bills costs at all;
[Withum's practitioner summary](https://www.withum.com/resources/understanding-advanced-client-costs-a-tax-perspective-for-attorneys/),
[Indiana Lawyer on Humphrey](https://www.theindianalawyer.com/articles/33345-bgbc-court-agrees-with-irs-that-advanced-client-expenses-are-loans)).

The billing design already posts exactly this: a **hard-cost invoice line credits "Client Costs
Advanced"** (a receivable-like position, named open in reports), while a **soft-cost line credits
"Cost Recovery Income"**. The consequence for the surface: a cost row is a **receivable in the
making**, not a firm expense — so the Costs tab's footer speaks the receivable language (advanced /
recoverable / absorbed), and the hard/soft class is load-bearing accounting data, never cosmetic.

### 1.3 Hard costs vs soft costs

The industry-settled distinction, which the platform's `disbursement_class` already encodes:

- **Hard cost:** cash actually paid to a third party for this matter — filing fee, court reporter,
  expert, process server. Has a payee, usually has a receipt or vendor invoice, and is the loan of
  section 1.2.
- **Soft cost:** the firm's own resource consumed and charged back — photocopies, postage from the
  firm meter, computerized research. No third-party payee exists; the "amount" is a firm-set
  charge-back rate, which is exactly why some jurisdictions and most client billing guidelines watch
  soft costs (and any markup) closely, and why Rule 1.5(a)'s "unreasonable amount for expenses"
  clause bites here first.

Every practice-management leader presents the split this way — Clio's expense entries carry an
explicit hard/soft toggle with hard costs syncing to accounting as vendor payments
([Clio Help](https://support.clio.com/hc/en-us/articles/360019649094-How-to-Enable-Hard-Costs-aka-Disbursements-and-Soft-Costs-Expenses-in-Clio-),
[Clio expense entries](https://help.clio.com/hc/en-us/articles/9289745356571-Create-and-Manage-Expenses-Entries)),
and CARET/Centerbase/Bill4Time document the same two-way definition. Tabs3 keeps **fees and costs as
two separate transaction ledgers** end to end, meeting only on the bill
([Tabs3 billing methods](https://www.tabs3.com/support/manuals/billingmethodsguide.pdf)) — the
precedent for delineated surfaces rather than one mixed "billables" list. UTBMS **E-codes**
(E101–E124) are the e-billing vocabulary for expenses, already seeded in the platform's
`utbms_code` catalog, exactly parallel to the A-codes the Time tab renders
([Clio on UTBMS](https://help.clio.com/hc/en-us/articles/9289762435099-UTBMS-Codes)).

### 1.4 How each arrangement kind treats the two categories

| Arrangement              | Fees                                                                                              | Costs                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Hourly**               | Time × rate, composed into `fee` invoice lines                                                    | Billed alongside as `cost` lines; recoverable unless absorbed                                                             |
| **Flat fee**             | The arrangement's amount as `flat_fee` lines; time still tracked for realization, claimed at zero | Costs are normally **outside** the flat fee and still billed — which is why they must never be buried inside a fee figure |
| **Contingency**          | A share of recovery, computed at settlement — nothing composes today (recorded, dormant)          | Advanced under Rule 1.8(e); the `contingency_basis` election decides whether they deduct before or after the share        |
| **Retainer / evergreen** | Fees drawn against replenished trust, subject to the earned-fee gate                              | Costs may be advanced and recovered the same way; never netted silently against trust                                     |

The pattern across all four: **fees derive from an agreement; costs derive from events.** A fee has
an arrangement behind it; a cost has a payee and a receipt behind it. That asymmetry is the whole
design.

---

## 2. The delineation — what belongs on each tab

### 2.1 Recommendation in brief

- **Time** (designed): the professional-work WIP ledger. Entries of hours; the raw material of
  hourly fees. Unchanged.
- **Fees** (new): **the agreement and what it has charged.** A read surface over
  (a) the matter's fee arrangement — the version in force and its whole amendment history — and
  (b) every fee-kind charge the matter's invoices carry (`fee`, `flat_fee`, `discount` lines, and
  credit-note lines that credit them), plus the unbilled fee value as a figure and a seam. **Not a
  WIP surface**: the platform deliberately has no fee WIP store (fees become invoice lines at
  compose time — billing design section 5.3), and this tab does not invent one. Its one write is
  **Amend Arrangement** (`billing:configure`-gated), because the arrangement is the fee fact that
  lives on the matter.
- **Costs** (design pass on the built surface): **the disbursement WIP ledger.** Every cost
  advanced or charged back on the matter, in every status, with payee, hard/soft class, E-code,
  receipt, billable disposition, and the same draft→submitted→approved→billed/void chain the
  backend already runs.

Five-line statement of the delineation:

1. **Time** records work; its billable entries are the raw material of hourly fees.
2. **Costs** records money advanced or consumed for the matter — a payee-and-receipt ledger that is
   legally a receivable, riding the same capture-review-bill chain as time.
3. **Fees** shows the agreement (the arrangement in force and its history) and the charges that
   agreement has produced on invoices — a read surface with one gated write (amend), never a WIP
   store, because the platform composes fees at invoicing.
4. All three meet on the invoice: time → `fee` lines, costs → `cost` lines, the arrangement →
   `flat_fee`/`contingency` lines; the invoice is the only place they become one ledger.
5. Same table machinery, chips, details panel, footer grammar everywhere; honestly different columns
   where the domain differs — a cost has a payee and a receipt, a fee has an arrangement and an
   invoice, time has a timekeeper and a rate.

### 2.2 Why the Fees tab is not a WIP surface (the reconciliation asked for)

The billing design settled that fee value materializes as **invoice lines**: an hourly `fee` line
consolidates claimed time entries; a `flat_fee` line carries the arrangement's amount and claims the
contributing time at zero; a contingency fee is computed from recovery records at compose time and
stored nowhere until then. A "fee entry" store parallel to `time_entry`/`cost_entry` would be a
second home for the same fact and would immediately drift from the arrangement (which version was in
force? what did the finalized bill actually say?). So the Fees tab is a **projection**: arrangement
register + fee-kind invoice lines + the derived unbilled-fee figure. The alternatives considered:

- _Pure WIP surface (mirror of Time):_ rejected — there is nothing in WIP to show; hourly fee WIP
  **is** the Time tab, and duplicating it here is the drift TP1 already ruled against ("fees are
  their own surface, never merged; the invoice is where time and fees become one ledger").
- _Pure invoice view:_ rejected as too thin — it would hide the arrangement, which is the fee fact a
  matter owns and the thing a reader opens this tab to check ("what did we agree to charge?").
- **Both, as recommended:** the agreement strip on top (the cause), the charge ledger beneath (the
  effect), the unbilled figure in the footer (the future). Trade-off: two data sources on one tab;
  mitigated by keeping the agreement to one strip and the table unmistakably the page's subject
  (the TL5 principle).

### 2.3 The Costs tab design pass — what changes from the built surface

The built Svelte page is a read-only listing with a disabled "Record a cost". The design pass brings
it to the Time tab's standard, reusing the register wherever it is truthful:

- **Same status register, same tones** (TS1): Draft quiet · Submitted amber · Approved green ·
  Billed info-blue · Void danger-muted with the row struck. The backend chain is literally the same
  five states under the same firm review gate, so sharing the register is truth, not decoration.
  (The built page's neutral-badges-except-void treatment is superseded by this pass.)
- **Same chain stepper and lock language** (TS3): Draft → Submitted → Approved → Billed → Paid, with
  the same finalized-invoice/credit-note far end — a billed cost is evidence on the bill exactly as
  billed time is.
- **One chip per row** (TS2): the chip is workflow status. Hard/soft renders as a text column;
  billable disposition renders through the Amount column ("absorbed" marker) and a Billable column
  (off by default), never a second chip.
- **Columns:** Date (anchor) · Entry Number (off) · Date Entered (off) · Payee · Info · Class
  (Hard/Soft) · Expense Code (E-codes, dotted-underline hover like the A-codes) · Receipt ·
  Amount · Billable (off) · Status. No Rate/Hours — a cost is an exact amount, and the honest
  difference is that the arithmetic cluster is absent rather than emptied.
- **The payee is the vendor** resolved from the Directory, initials-avatar + name like a timekeeper
  (TL6's grammar), with the two null states kept distinct: "Not recorded" vs "No longer in the
  directory" — and a **soft cost has no payee by design** (rendered as an em dash with a hover
  saying why), because no third party was paid.
- **Receipt** is a first-class affordance: a paperclip glyph opens the attached File Manager
  document; attach/replace/remove live in the details panel and context menu (the API ships
  attach/detach today). A hard cost without a receipt shows a quiet "None" — visible, not nagging;
  policy is an owner question (Q5).
- **Record a Cost dialog** mirrors Log Time's shape (wide, no scroll, Save & Close / Save & New,
  "Saves as a draft" footer): Date Incurred · Payee (typable combobox over the Directory, hidden
  for soft) · Class · Amount (typed exactly — no arithmetic cluster; the one derived sentence
  states class consequences: "A hard cost is recorded as advanced to Sierra Forensic Engineering,
  recoverable from the client") · Billing disposition · Expense Code · Info · receipt attach.
- **Auto-captured costs** (`source = 'recovery'`, e.g. shipping recovery) render like any other row;
  their details panel and history say "Captured automatically from Shipping" and edit is disabled
  with the reason. Absence of a distinct chip is deliberate (TS2).
- **Footer** (TL10 grammar, scope-honest, voids never count): entry count and range · filter state ·
  then the money no column carries: **advanced** (all live costs) · **recoverable** (billable,
  unbilled) · **billed** · **absorbed** (non-billable — the firm's decision made visible, the
  cost-api's own reasoning) · the Billing seam. Column sums (Amount) live in the table, not the
  footer.
- **Entry numbers, printable units, two dates, dual attribution, history rail**: all carried over
  (TL7, TA1, TL8, TD9, TV1) — each currently an API gap on costs exactly as it was on time
  (section 5).

### 2.4 The Fees tab composition

- **The agreement strip** (above the table, one row of facts): kind ("Hourly" — including the
  explicit "billed hourly; nothing else was ever agreed" default), in-force-since date, version
  number, who authorized it, kind-specific facts (flat-fee amount and billed-so-far progress;
  contingency share and its before/after-costs election in Rule 1.5(c)'s own words; retainer target
  and floor), and an **Amend** button gated on `billing:configure` (disabled with the reason
  otherwise). The full version history lives in the strip's details panel, not the strip.
- **The charge table:** Date (invoice issue; anchor) · Invoice · Kind (Fee / Flat Fee / Discount /
  Credit Note — text column) · Info (the line's snapshot description) · Amount (credits negative) ·
  Standing. **Standing is the invoice's standing**, not a WIP chain: Draft (quiet) · Finalized
  (info) · Paid (success); a credit-note row shows Credited (neutral). The details panel shows the
  invoice linkage (TV2's grammar), the arrangement version that produced an arrangement-composed
  line, what the line consolidated ("drawn from 12 time entries" — the WIP-claim read, a seam
  today), and the line's history (composed · finalized · paid / credited).
- **No capture, no chain stepper** — a fee line is born as invoice evidence; showing the
  draft→submitted→approved chain here would claim a review lifecycle that does not exist. The
  honest stepper for a fee line is Draft → Finalized → Paid.
- **Footer:** charge count · then: **unbilled fee value** (derived from billable unbilled time
  under an hourly arrangement; under flat fee, the arrangement remainder) with a "from the Time
  tab" hover and the Billing seam · **billed** · **collected**. Voids/credits handled per the
  billing model: a credited amount reduces collected-expected, never rewrites the billed line.

### 2.5 Tab order

Recommend **Time · Fees · Costs** in the matter tab bar — reading order matches the money's causal
order (work → what it charges → what was spent), and the two designed-together surfaces sit
adjacent. Owner call (Q1).

---

## 3. The shared-vs-distinct functionality map

For the integration round: what the three tabs literally share (one implementation each), and what
is honestly distinct.

**Headline entry — the one table machinery (owner ruling, 2026-08-27).** The matter surfaces share
ONE table implementation. The owner caught the Timesheet lacking the Docket's header drag-reorder
and named the duplication; the Timesheet is being brought up to the Docket's full column machinery
this round (drag-reorder, resize with double-click fit, pinning, in-header filters with the
active-state rules). These fragments therefore introduce **no third variant**: they copy the
Timesheet's table structure and idioms exactly, and each surface's whole contribution to the table
is a **declarative column model** (key, label, `always`/`on`/`right`, filter type, getter, cell
renderer) plus a row-detail binding — the shape the shared machinery consumes — so the integration
round swaps the one shared implementation in without rework. Where the fragments do not themselves
implement the Docket-parity interactions (drag-reorder, resize, pinning), the table block is marked
as the shared machinery's slot rather than half-built locally.

**Shared verbatim (already in The Timesheet mockup; the fragments reuse them unchanged):**

1. Matter chrome: shell, masthead, tab bar, mockbar, state panes (empty/loading/error with Error ID
   grammar).
2. Table machinery (the headline entry above): column model (`always`/`on`/`right`/`ftype`),
   sort-on-label, the ONE filter mechanism parameterized by type (set / contains-text / date range /
   numeric range) living inside the header cell, active-filter affordances, clear-all control,
   filtered-empty state, column chooser + zebra toggle — and, once the Timesheet lands Docket
   parity, drag-reorder, resize with double-click fit, and pinning, inherited here by the swap, not
   reimplemented.
3. Row selection → details panel beside the list (N22c), explicit close, click-again-to-release.
4. Status chip component and tone vocabulary (`quiet/warn/success/info/danger`).
5. Chain stepper + lock-note component (used by Time and Costs with the same five states; used by
   Fees with its three-state invoice chain).
6. History rail (event, instant, actor, quoted detail).
7. Person cell (initials avatar + always-visible name; name is history, never a membership join —
   TK1 applies to payees exactly as to timekeepers).
8. Footer grammar: tally + filter state left, labelled money figures right, scope-honest "In view:"
   when filtered, voids never counted, the disabled Billing seam with Soon badge.
9. Dialog system: wide capture dialog with Save & Close / Save & New and the "saves as a draft"
   foothint (Time, Costs); kick-back-with-reason and void dialogs (Time, Costs); typable combobox
   (Time's staff select, Costs' payee select).
10. Entry-number scheme, printable-unit sheet, context menu with every-item-present-disabled-says-why.
11. Code-with-hover idiom for UTBMS codes (A-codes on Time, E-codes on Costs).

**Distinct by domain:**

|                      | Time                                                | Costs                                                         | Fees                                                                      |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Row identity         | Timekeeper + hours × rate                           | Payee + exact amount                                          | Arrangement/invoice + amount                                              |
| Capture              | Log Time (+ timer, quick entry, arithmetic cluster) | Record a Cost (payee combobox, class, receipt; no arithmetic) | None (Amend Arrangement only)                                             |
| Chain                | Draft→Submitted→Approved→Billed→Paid                | Same, same review gate                                        | Draft→Finalized→Paid (invoice's)                                          |
| Special columns      | Worked/Hours/Rate, Activity (A-codes)               | Class, Expense Code (E-codes), Receipt, Payee                 | Invoice, Kind, arrangement version                                        |
| Footer money         | hours · non-billable · unbilled · billed            | advanced · recoverable · billed · absorbed                    | unbilled fee value · billed · collected                                   |
| Unique panel section | Rounding/units facts                                | Receipt, auto-capture provenance                              | Agreement facts + version history, consolidation ("drawn from N entries") |

---

## 4. Lifecycles and the billing seam

**A cost rides the same chain as time — because it already does.** The backend runs the identical
five states under the identical firm review gate (`approvalRequiredDefinition` is read by both
services), with kick-back-with-reason and void-freezes semantics. The design keeps them visually
identical; inventing a simpler cost lifecycle would fork a register the platform has already
unified. What differs is **capture volume** (costs arrive in batches — the grid endpoint ships —
and from integrations via `source='recovery'`), not lifecycle.

**The billing seam, per tab:**

- **Time → invoice:** approved (or, gate off, any live billable) entries are claimed by a draft;
  entries consolidate onto `fee` lines; the entry locks as billed evidence. (Designed; TB1.)
- **Costs → invoice:** same claim mechanics, but one `cost` line per cost entry (a disbursement is
  itemized, not consolidated — the client is entitled to see each advance); hard-cost lines credit
  Client Costs Advanced (the loan coming home), soft-cost lines credit Cost Recovery Income. The
  seam renders exactly as on Time: the recoverable figure beside a disabled "Open in Billing" with
  the Soon badge.
- **Fees ← invoice:** this tab is the _arrival_ side of the seam — it reads what invoices did with
  the other two tabs' WIP. Its seam points at the invoice itself (Open in Billing per row) and at
  compose ("unbilled fee value flows onto the next draft invoice").

Nothing on any tab composes, finalizes, or moves money; corrections downstream of finalization are
credit notes beside the bill (the settled chain language). Nothing here touches trust (fees never
touch trust — the composition guard owns that).

---

## 5. API gaps, consolidated

Cost parity gaps (each is the cost twin of a recorded Time gap; the mockup is honest about all of
them):

1. **Listing omissions:** `receiptFileId`, `createdAt` (Date Entered), `createdBy` (entered-by
   attribution), `invoiceId` + invoice number, `kickBackReason` are stored but not served on
   `CostSummary`. The receipt column, both dates, dual attribution, and the invoice linkage all
   need them.
2. **Entry numbers:** no matter-scoped sequence on `cost_entry` (`@magna-carta/sequence-numbering`
   is the home; scheme is Q2).
3. **Status history endpoint:** the audit trail exists; nothing serves it, and the details panel's
   History rail renders exactly that.
4. **Un-approve:** kick-back is submitted-only; TS4 wants approved → draft here too.
5. **Vendor picker:** the capture dialog needs a Directory typeahead read scoped to
   vendor-appropriate entities (the built page already names this as what "Record a cost" waits on).
6. **E-code catalog read** for the capture select and column hover (the `utbms_code` table is
   seeded; a served vocabulary endpoint for E-codes parallels the A-code need on Time).
7. **Soft-cost unit pricing:** no quantity × unit-rate columns (1,240 copies at $0.20) — amount
   only. Owner question Q4 before any schema change.
8. **Payee-class validation:** the API accepts a hard cost with no vendor and a soft cost with one;
   if Q6 lands as recommended, the create/patch routes gain the rule.

Fees gaps:

1. **Fee-charge listing:** no single read of a matter's fee-kind invoice lines across invoices
   (today: page the invoice list, then N detail reads). One
   `GET /api/v1/billing/matters/{matterId}/fee-lines` (kind ∈ fee, flat_fee, discount + credit-note
   lines crediting them, each with invoice number/status/dates) serves the table in one query.
2. **Consolidation read:** the details panel's "drawn from N time entries" needs the WIP-claim
   count/list per line (`invoice_wip_claim` has it; nothing serves it).
3. **Unbilled fee value:** `GET .../unbilled` exists and serves the figure — confirm it splits fee
   (time) value from cost value so the two tabs' footers do not blur the delineation.
4. Arrangement read/write **exists** (in-force + full history, PUT amend) — the Fees tab is
   servable today on the agreement side; gate the Amend button on `billing:configure`.

---

## 6. Owner decisions

| #   | Question                       | Recommendation                                                                                                                                                                                                                                |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Tab order                      | Time · Fees · Costs (causal reading order; the pair designed together sit adjacent)                                                                                                                                                           |
| Q2  | Cost entry-number scheme       | Same matter-scoped shape with a family letter — `2026-0147.C0007` — so Time's plain numbers stand and a reference names its ledger; alternative is one shared sequence across both stores                                                     |
| Q3  | The cost text column name      | "Info", matching the family idiom (TL2), mapping to `description` in the contract                                                                                                                                                             |
| Q4  | Soft-cost quantity × unit rate | Defer the schema; capture flat amounts now, record the per-unit fact in Info; revisit when a firm's charge-back rate card exists                                                                                                              |
| Q5  | Receipt policy                 | Encouraged, never required: a hard cost shows a quiet "None"; no gate on submit (client guidelines differ; a filing fee has a receipt only sometimes)                                                                                         |
| Q6  | Payee requiredness             | Require a payee on hard costs; forbid on soft (no third party exists); needs the API rule in section 5                                                                                                                                        |
| Q7  | Markup on costs                | None now, matching the white paper ("markup and pay-from-trust not enabled"); costs render at cost. When built, it is a disclosed policy per matter, soft costs only, bounded by Rule 1.5(a) reasonableness — never a silent per-entry uplift |
| Q8  | One review gate or two         | Keep the single firm gate governing both time and costs (the backend already shares `approvalRequiredDefinition`); split only if a real firm asks                                                                                             |
| Q9  | Fees tab writes                | Confirm the tab's one write is Amend Arrangement; fee value is composed only in Billing                                                                                                                                                       |
| Q10 | Contingency presentation       | Render the recorded share and basis election in Rule 1.5(c)'s own vocabulary now, honest that nothing computes until the settlement slice                                                                                                     |

---

## 7. The mockup fragments

Two standalone fragments, each the tab's content pane rendered inside the same matter chrome as The
Timesheet, built for the integration round: chrome copied verbatim and clearly delimited as
disposable; every surface-specific element id prefixed `costs-` / `fees-`. Each fragment is three
script blocks in merge order: the Timesheet's icon set (verbatim), the surface's `SURFACE` object
(fixture + declarative column model + cell renderers + details panel + dialogs — the surface's
whole contribution), and one parameterized copy of the Timesheet's round-four table machinery
(sort, the one filter mechanism, drag-reorder, resize with double-click fit, pinning, selection,
totals row, footer grammar, states) shared byte-identically by both fragments — the seam the
integration round swaps the single shared implementation into. Both fragments verify clean in
headless Chromium across populated/details/dialog/empty/error states. Same fixture matter
(Pemberton v. Hale Construction Co., 2026-0147) so the three tabs tell one story — the costs
fixture is the litigation's real disbursement profile (filing fee, service, transcripts,
videographer, expert retainer, certified copies, photocopies, research, postage, courier,
mediation deposit, witness fee, a void duplicate, one auto-captured shipping recovery), and the
fees fixture is the hourly arrangement plus the fee lines of the two invoices the Time tab already
names (INV-2026-081 paid, INV-2026-097 sent), a courtesy discount, and a credit note.

Sources consulted for section 1:
[ABA Model Rule 1.5](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_1_5_fees/) ·
[Rule 1.5 Comment](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_1_5_fees/comment_on_rule_1_5/) ·
[ABA Model Rule 1.8](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_1_8_current_clients_specific_rules/) ·
[Boccardo v. Commissioner (9th Cir. 1995)](https://law.justia.com/cases/federal/appellate-courts/F3/56/1016/624689/) ·
[Withum, Understanding Advanced Client Costs](https://www.withum.com/resources/understanding-advanced-client-costs-a-tax-perspective-for-attorneys/) ·
[Clio: hard and soft costs](https://support.clio.com/hc/en-us/articles/360019649094-How-to-Enable-Hard-Costs-aka-Disbursements-and-Soft-Costs-Expenses-in-Clio-) ·
[Clio: expense entries](https://help.clio.com/hc/en-us/articles/9289745356571-Create-and-Manage-Expenses-Entries) ·
[Clio: UTBMS codes](https://help.clio.com/hc/en-us/articles/9289762435099-UTBMS-Codes) ·
[Tabs3 Billing Methods Guide](https://www.tabs3.com/support/manuals/billingmethodsguide.pdf) ·
[Centerbase: hard vs soft costs](https://support.centerbase.com/hc/en-us/articles/360054549671-Hard-Costs-vs-Soft-Costs-What-s-the-Difference) ·
[Bill4Time: hard costs, soft costs](https://www.bill4time.com/blog/hard-costs-soft-costs-law-firms/)
