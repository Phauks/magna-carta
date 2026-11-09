# Slice 3·6 — Financial and trust-compliance reporting — design

**Status:** Design. No product code in this cycle.
**White paper:** _Reports_, _Financial Core_ (Trust accounting, Billing, Time tracking, Costs and
expenses), _Locations_.
**Invariants:** [`docs/conventions/invariants.md`](../conventions/invariants.md), plus the local
`CLAUDE.md` of [`packages/trust`](../../packages/trust/CLAUDE.md),
[`packages/billing`](../../packages/billing/CLAUDE.md), and
[`packages/ledger`](../../packages/ledger/CLAUDE.md).
**Scope answer already given by the owner:** all four report families, with the bar-audit pack
first — recorded in the forward queue at
[`docs/active-work/claude/passive-dev-orchestrator-m7f9jw.md`](../active-work/claude/passive-dev-orchestrator-m7f9jw.md)
("Task 113 — financial reporting surface, all four, bar-audit pack first"). This design follows that
answer; it does not re-derive the scope.

---

## 0. Why this is designable now, and what it is not

The subsystems this reports over are finished. Trust accounting is complete end to end — the
sub-ledger tree, movements, holds, the authority-based posture, the disbursement queue, the bank
statement, matching, the three-way proof, its freeze, the bank-charge carve-out, and the
unclaimed-funds diligence file. Billing is complete as of today — the invoice spine, applications,
all four fee models, and now credit notes, client credits, write-offs and reversals. Time and costs
landed earlier. So the shapes a report reads are settled, and designing over them is cheap rather
than speculative.

What is **not** finished, and therefore bounds this design: the operating general ledger and the
product chart of accounts (slice 3·5) are not on `main`. There is no firm-wide operating book, no
accounts payable, and no timekeeper cost rate anywhere in the schema. Section 7 states exactly what
that costs each report.

**This slice is a projection layer, not a subsystem.** It adds no money concept, no new fact about a
firm's compliance, and no arithmetic that any existing package already owns. Everything it produces
is a re-presentation of rows that already exist, read along axes those rows already carry.

---

## 1. The one rule the whole design hangs off

> **A report never becomes a second answer to a question that already has one.**

Every quantity in this surface falls into exactly one of three classes, and the class is a property
of the read, not of the presentation:

1. **Owned elsewhere.** The trust three-way proof, an invoice's total, a matter's unpaid receivable,
   the contingency entitlement, a trust account's client-ledger total as of a date. These have a
   home, and the report **calls that home's read**. It never re-implements the SQL, never rounds
   differently, never sums a set the owner sums differently. `computeTrustThreeWayProof`,
   `selectTrustClientLedgerTotalAsOfStatement`, `readAccountsReceivableAging`,
   `readContingencyResidual` are not references — they are the implementation.
2. **A decomposition of something owned elsewhere.** A per-client breakdown of the trust
   client-ledger total; a per-matter breakdown of the receivable; a journal whose closing balance is
   a book balance. These are new reads, and each one carries a **fitness test asserting it sums to
   the aggregate its owner produces**, over the load-profile fixture book. A decomposition that
   cannot be proved equal to its aggregate is not shipped.
3. **Genuinely new and owned here.** Counts, ratios, distributions, hours — quantities no financial
   package asserts. These get their arithmetic stated in one place in the reporting package and
   tested there.

Class 1 and class 2 are what stops the reporting surface from contradicting the reconciliation.
Class 3 is where the reporting surface is allowed to be original, and it is deliberately the class
that touches no money the ledger has an opinion about.

**Corollary that matters most.** Nothing in this surface recomputes the three-way reconciliation.
Where a period contains a **closed** reconciliation, the pack prints the frozen attestation
verbatim from `trust_reconciliation` — the totals the firm attested to, `closed_by`, `closed_at`,
which leg disagreed and by how much. Where the live proof at the pack's knowledge instant differs
from that frozen answer, the pack prints both, labelled, and says why they differ (ADR-0246 already
establishes that the difference is the ledger having moved since the attestation, not a fault). It
never prints a third number, and it never silently prefers one.

---

## 2. As-of semantics — the reproducibility answer

### 2.1 The two axes

A bar-audit pack is evidence. Its central property is that the same period re-run later gives the
same answer, or states precisely why it cannot. That property requires **two** date axes, and the
tables already carry both:

| Axis                           | Column                                                                                                                               | Meaning                                   | Mutable? |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | -------- |
| **Effective** (the period)     | `ledger_entry.effective_date`, `invoice_application.effective_date`, `invoice.issue_date`                                            | When the event is deemed to have happened | No       |
| **Knowledge** (what was known) | `ledger_entry.recorded_at`, `invoice_application.applied_at`, `credit_note.created_at`, `trust_movement`/`trust_transfer` timestamps | When the platform learned of it           | No       |

`effective_date` is backdatable (future-dating is refused) and `recorded_at` is system-set and
immutable — the ledger's own schema comment says so. Both live on append-only tables that no UPDATE
or DELETE ever targets. That is the entire foundation of reproducibility here, and it exists
already.

### 2.2 The contract

Every ledger-backed report in this surface takes a **temporal pair**:

- `periodStart` / `periodEnd` — civil dates on the **effective** axis.
- `knownAsOf` — a UTC instant on the **knowledge** axis.

and filters `effective_date <= periodEnd AND recorded_at <= knownAsOf` (with `>= periodStart` where
the report is a period rather than a position).

**The claim this buys, stated exactly:** for a given `(periodStart, periodEnd, knownAsOf)` triple,
every figure in a ledger-backed report is a pure function of rows that can never change. Re-running
the same triple in five years returns the same integers. Nothing else in the design is allowed to
weaken that claim.

**What a single-axis report would do instead**, and why it is refused: filtering only on
`effective_date` means a reversal posted next month with a backdated effective date silently changes
last month's answer after somebody signed it. That is the precise failure ADR-0246 froze the
reconciliation to prevent, and it would be reintroduced by every report that read one axis.

### 2.3 Live is a first-class, labelled mode

Omitting `knownAsOf` is legal and means "now". A report produced that way is a **live** report: it
is stamped `computedAt` and is explicitly **not** claimed to reproduce. The distinction is carried in
the response payload and rendered on the artifact, because a reader cannot tell them apart from the
figures.

Some reports are live-**only**, by necessity rather than choice — see section 7.1.

### 2.4 What is mutable that the pack still reads

Reproducibility is a claim about **figures**, and honesty requires naming what is outside it. Every
one of these is a label or a piece of context, never an amount:

| Mutable input                                                          | Effect on a re-run                                       | How the pack handles it                                                                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Directory display names (`directory_person`, `directory_organization`) | A client renamed later re-renders under a different name | Every ledger and every line carries the **entity id** beside the name; the id is the identity, the name is a caption |
| Entity merges (`status = 'merged_into'`)                               | Two ledgers may later resolve to one client              | The pack records the entity id as it stood; a merge is visible as two ids, never silently collapsed                  |
| `matter.client_display_name`, matter title                             | Caption drift                                            | Caption only; the matter number is frozen at assignment and is the stable handle                                     |
| `location` name, letterhead, remit-to                                  | Office caption drift                                     | Caption only; snapshotted onto the artifact at production                                                            |
| `trust_account.jurisdiction` and its governing-rule citation           | The cited rule text may be revised in the corpus         | The corpus review state and citation are snapshotted onto the artifact at production                                 |
| `member` names of authorizers                                          | Caption drift                                            | The user handle is the identity                                                                                      |

So the precise statement the pack itself carries, in its own words: **the figures reproduce for the
stated period and knowledge instant; the names and citations are as they stood when the pack was
produced.** A produced pack is filed as an immutable artifact (section 6) so the version an examiner
was given is retrievable byte-for-byte, independent of any re-run.

### 2.5 The two refusals that must propagate

- **Truncated outstanding items.** `computeTrustThreeWayProof` refuses
  `reconciliation-outstanding-items-truncated` rather than producing a confidently short answer. The
  pack propagates that refusal unchanged and produces nothing for the account. A pack that quietly
  omitted the section would be worse than no pack.
- **Jurisdiction not resolvable.** The four distinguishable trust refusals
  (`jurisdiction-not-recorded`, `-not-encoded`, `-not-verified`, `-requirement-not-encoded`) reach
  the pack as-is. A pack that printed a governing-rule citation for a jurisdiction nobody has
  reviewed would be asserting a compliance fact the platform does not hold.

---

## 3. The four reports, and what each asserts

The owner's answer is all four families in the white paper's standard library. Each is stated below
as an **assertion** — what a reader is entitled to conclude from it — because that is the property
that has to be defensible, not the column list.

### 3.1 The bar-audit pack (trust compliance) — slice 1

**Assertion:** _For this trust account, over this period, as known at this instant: here is every
movement of client money, here is each client's and each matter's ledger, here is what the firm
attested to at each reconciliation, and here is every item that did not tie out._

It is deliberately **not** a dashboard. It is produced for a regulator or an examiner, and its
sections mirror what the researched rules require a firm to be able to produce: a receipts-and-
disbursements journal, individual client ledgers, and the periodic reconciliation.

Sections:

1. **Cover.** Firm, trust account (its bank identity through the existing protected-field path,
   never a raw account number in a report body), the account's location and jurisdiction with the
   corpus review state, `periodStart`/`periodEnd`, `knownAsOf`, the production record id, and the
   reproducibility statement of section 2.4 in plain words.
2. **Reconciliations.** Every `trust_reconciliation` whose statement period end falls in the report
   period. For each: the **frozen** attestation verbatim (bank, book, client, firm funds,
   outstanding totals, balanced/unbalanced with the leg and difference, `closed_by`, `closed_at`),
   and — where it differs at `knownAsOf` — the live proof beside it with the difference explained as
   ledger movement since the attestation. An **open** reconciliation appears as open, with its live
   proof labelled as not attested. A period with no reconciliation at all says so, in those words.
3. **Client ledgers.** Per client node, per matter leaf under it: opening balance at
   `periodStart − 1`, every entry in the period with effective date, description, direction,
   amount, running balance, and closing balance at `periodEnd`. Every figure on the effective axis,
   bounded by `knownAsOf`. The per-account sum of matter-leaf closing balances is asserted equal to
   `selectTrustClientLedgerTotalAsOfStatement` — the same statement the proof's client leg uses —
   by fitness test, not by inspection.
4. **The journal.** Every ledger entry touching the account's **bank leaf** in the period, in
   effective-date order, with a running bank balance and, where one exists, the `trust_movement` or
   `trust_transfer` that produced it and its `authorized_by`. Keyed on the **ledger entry**, never
   on `trust_movement` — the rule ADR-0246 established, because an earned-fee transfer records a
   `trust_transfer` and no movement row, and a movement-keyed journal would silently omit the single
   operation most likely to be looked at.
5. **The firm's cushion.** Where the bank-charge carve-out is open on the account, the firm-funds
   node as its own section with its own opening/closing position and every `firm_funds_deposit` and
   `bank_charge`. It is never folded into a client total — the same reason the proof gives it a
   fourth leg. Where the carve-out is not open, the section is absent rather than zero.
6. **Exceptions.** Active holds at `periodEnd` and their effect on available balance; outstanding
   recorded items; unmatched statement lines; any matter leaf whose stored balance disagrees with
   its computed line sum (the ledger fitness query, run as a report section); any refusal the pack
   hit.
7. **Provenance.** The production record: who asked, when, the temporal triple, the package version,
   and the content hash of the artifact.

**What it deliberately does not contain**, unless the owner says otherwise (section 8): the
unclaimed-funds diligence file. Dormancy in this platform is a comparison a caller states, not a
fact the platform asserts, and printing it in a document a disciplinary body reads risks asserting a
deadline no researched rule imposes.

### 3.2 Financial reports — slice 2

**Assertion:** _Here is what the firm is owed, what it has not yet billed, and how much of what it
billed it has actually realized._

- **Accounts-receivable aging, as-of.** Unpaid balance per bucket, per client, per matter, per
  office, at a stated effective date and knowledge instant. Derived as
  `sum(invoice_matter_balance.total_minor)` over invoices finalized on or before the date, less the
  signed sum of `invoice_application` rows on the effective axis (a `reversal` adds back, every
  other kind subtracts). **The live read `readAccountsReceivableAging` already exists and stays the
  owner of the live answer**; the as-of derivation carries a fitness test asserting that at
  `(asOf = today, knownAsOf = now)` it produces bucket-for-bucket the same integers. Two answers to
  one question is the failure this whole design is organized against, so the equality is proved
  rather than assumed.
- **Work in progress.** Unbilled, unvoided time and cost by matter, client, timekeeper, office.
  **Live only** — section 7.1 explains why, and the report says so on its face.
- **Realization.** For a period: standard value of time recorded, value actually billed, value
  written off or credited, value applied. Sourced from the invoice **line snapshots** (which are
  permanent) and `invoice_application` (append-only), so the billed/credited/applied legs are
  as-of-reproducible; the standard-value leg inherits work-in-progress's live-only limitation and is
  reported as a live figure beside as-of figures, labelled.
- **Profitability.** Not built. Section 7.2.

### 3.3 Productivity — slice 3

**Assertion:** _Here is how much time each timekeeper recorded, of what kind, on what, in this
period — and nothing about whether it was enough._

Hours recorded, billable versus non-billable (and by non-billable category), by timekeeper, matter,
client, UTBMS task/activity code, and office; the billable ratio; the distribution across matters.
Work date is the period axis.

The platform stores **no billable-hour target**, so there is no attainment figure and the report
does not invent one — a target rendered against a number the firm never set would be the platform
grading a lawyer's month. Utilization against a target is named as a later addition to time
tracking, not to reporting.

Time entries are mutable, so productivity is **live only** on the same reasoning as work in
progress.

### 3.4 Operational — slice 4

**Assertion:** _Here is the volume of what the firm did in this period._

Matters opened, closed, by type and office; invoices drafted, finalized, voided; credit notes and
write-offs issued and their reasons; trust accounts, movements by kind, disbursement requests
raised, approved, rejected, withdrawn; cost entries by class; reconciliations opened and closed.
Counts and dates, deliberately not money — where an operational count needs a value beside it, the
value comes from the financial report that owns it rather than being summed again here.

Every operational count that reads an append-only table is as-of reproducible; counts over mutable
tables (matters, time entries) are live and labelled.

---

## 4. Firm scope, the visibility seam, and what a wall does to a total

### 4.1 Firm scope is structural and unchanged

Each firm has its own D1 database. There is no cross-firm read to prevent because there is no
cross-firm query to write: the reporting reads go through `@magna-carta/data-access`'s chokepoint on
the per-firm binding exactly as every other read does, and the reporting package holds no binding of
its own. A report reading "across matters and clients" is reading across rows of one firm's
database, which is the same boundary a matter list already crosses.

### 4.2 Location is a filter, never a gate

Per-office roll-ups subtotal by `matter.location_id` (and, for trust, by the account's own
location). ADR-0031 and the white paper fix location as a view and reporting filter, not an access
gate, and this slice does not move it. A subtotal is never permitted to become the boundary of what
a member may see; a member who may run the report may run it firm-wide.

### 4.3 The permission surface

A new `reports:` namespace, on the reasoning that split `trust:firmFunds` off `trust:manage`: an
aggregate across every matter and client is a different exposure from a per-matter read, and a
member who may read one client's trust balance is not thereby a member who may read the firm's whole
receivable position.

| Key                       | Grants                                                         | Seeded to    |
| ------------------------- | -------------------------------------------------------------- | ------------ |
| `reports:trustCompliance` | Read and produce the bar-audit pack for any trust account      | Owner, Admin |
| `reports:financial`       | Aging, work in progress, realization, firm-wide and per-office | Owner, Admin |
| `reports:productivity`    | Timekeeper productivity across the firm                        | Owner, Admin |
| `reports:operational`     | Operational volumes                                            | Owner, Admin |
| `reports:produce`         | Turn a report into a filed artifact                            | Owner, Admin |

Seeded narrowest; a firm that wants a bookkeeper to run reconciliation packs reaches for a direct
grant, which leaves a record. `reports:productivity` is deliberately separate because a report about
people is a different decision from a report about money.

### 4.4 What an ethical wall does to a firm-wide financial total

Ethical walls are a **deferred seam** (ADR-0068 point 6; the white paper names them as the future
content-screening layer, where a screened user sees a matter's header but not its confidential
contents). Nothing in this repository implements one today, so this slice cannot honor a mechanism
that does not exist. What it must not do is design a shape that makes honoring one later impossible.

The choice, when walls arrive, is genuinely binary and both arms are bad in different ways:

- **Complete-but-undrillable.** A firm-wide total includes the walled matter's money; the screened
  member cannot open the matter, and the report says "n matters not itemized". The total ties to the
  books. But the residual — total minus the sum of what is itemized — is the walled matter's
  balance, computed by subtraction. The screen leaks a number.
- **Excluded-and-untying.** The total omits walled matters. Nothing leaks, and the member is looking
  at a firm-wide figure that does not agree with the reconciliation, the receivable control account,
  or another member's copy of the same report. A report that does not tie to the books, handed to
  the wrong person, is worse than one that does not exist.

**This is flagged for the owner (section 8, Q1), not settled here** — it changes what the platform
asserts about a firm's books rather than how it presents an existing fact.

What this slice does now, so the later answer is cheap:

- Every report response carries a **completeness declaration** — `complete: true` today, with the
  shape ready to carry `excludedMatterCount` — so a consumer can never render a screened total as
  an unscreened one by omission.
- The bar-audit pack is **never screened**, in either arm. It is evidence produced for a regulator
  about the firm's handling of client money, and a partial one is not evidence. It is gated by the
  narrow `reports:trustCompliance` key instead — the access answer to a screening question is a
  narrower grant, not a quieter number.

---

## 5. Read-only by construction

"Nothing in a reporting surface should be able to write" has to be a property somebody can check,
not an intention. Four independent mechanisms, none of which is a comment:

1. **The package composes nothing.** `@magna-carta/reporting` is a pure package that exports
   assembly functions and `select…Statement` builders and imports **no composer**. A purity fitness
   function — modelled on `packages/custodian/test/purity.test.ts`, which already scans that
   package's sources for a register mutation and a ledger insert — rejects, over the package's own
   sources: any `INSERT`/`UPDATE`/`DELETE FROM`/`REPLACE` literal; any import of `EffectWrite`,
   `composeEffectBatch`, `run-domain-effect`, or `commitEffectBatch`; and any import whose name
   begins `compose`, `issue`, `post`, `place`, `apply`, `open`, `close`, or `finalize` from a domain
   package. The scan asserts it has sources to check, so it cannot pass vacuously.
2. **The routes are GETs.** Every read route under `/api/v1/reports/*` is a GET through the existing
   slice 0·5 chokepoint. The conformance test asserts that the reports namespace declares exactly
   one non-GET route (section 6's production enqueue) and that every other one is a GET carrying
   only a `reports:` read key.
3. **The permission keys grant nothing else.** A fitness assertion in `@magna-carta/access-control`
   that no `reports:` key appears in any write path's guard, so a future route cannot borrow one.
4. **The one write is named, small, and outside the package.** Producing a pack writes: one
   append-only `report_production` row, one outbox message, and — when the job completes — a File
   Manager version holding the artifact. All three are composed by the caller (the route and the
   queue consumer), through the ordinary chokepoint, with the ordinary audit trail. The reporting
   package still writes nothing, and saying "the reporting surface is read-only" without this
   sentence would be a slogan rather than a fact.

Mechanism 4 is the honest part. A reporting surface that could not file its own output would be a
surface that cannot produce evidence.

---

## 6. Production, delivery, and where the work runs

Golden rule 10 binds: no heavy work in a request handler.

- **A read route returns JSON** for a bounded scope — one trust account, one period, one office —
  and is measured against the load profile. A read that cannot be served inside a request budget
  refuses by name and points at production, rather than degrading.
- **Producing a pack is asynchronous.** `POST /api/v1/reports/productions` validates the request,
  writes the append-only `report_production` row (requester, temporal triple, scope, status derived
  from the presence of a completion row rather than a status column, per house pattern) and an
  outbox message in one batch. A queue consumer assembles the pack, renders it, files it through the
  File Manager (which computes and stores the SHA-256 content hash at write, ADR-0078), and writes
  the completion row. Idempotent on the outbox row id, like every other consumer.
- **Rendering rides the existing edges.** A pack renders to a document through the assembly and
  conversion path that already produces PDFs (the document-automation tail landed that edge);
  CSV/Excel is a later addition in the delivery slice. No new rendering engine.
- **Scheduling** rides the existing daily per-firm cron fan-out, and delivery rides the transactional
  outbox to the notifications/email seam. Both belong to the delivery slice, not to slice 1 — a
  bar-audit pack is produced when an examiner asks, which is not a schedule.
- **A produced artifact is a firm record.** It is immutable, retrievable byte-for-byte, and listed.
  Whether it may be deleted, and what retention it inherits, is flagged (section 8, Q6).

---

## 7. What the ledgers cannot currently support

This is the section a reader should trust most, because a reporting design that does not say what it
cannot do will produce a report that says it anyway.

### 7.1 Work in progress cannot be reproduced as of a past date

`time_entry` and `cost_entry` are **mutable working stores**, by design — bill review is exactly when
a firm fixes a narrative or a duration, and the entry only freezes at `billed` or `void`. They carry
a `status` column, no `billed_at`, no `voided_at`, and `amount_minor` is recomputed on an explicit
re-rate. Consequences, precisely:

- An entry voided today disappears from last month's work-in-progress figure when that figure is
  re-run.
- An entry re-rated today changes last month's figure.
- An entry created today with a backdated work date appears in last month's figure.

So "unbilled work in progress as of 30 June", asked in August, is not answerable from stored data.
The design's response is to **refuse to pretend**: work in progress, realization's standard-value
leg, and productivity are live-only, stamped `computedAt`, and never accept a `knownAsOf`. The
parameter is absent from those endpoints rather than accepted and ignored.

The named remedy, for whoever opens time tracking next: `billed_at` and `voided_at` stamps on both
work-in-progress stores, and re-rate recorded as an append-only adjustment rather than a column
rewrite. That is a schema change in the owning slice, not something a reporting slice may bolt on —
and it is cheap there and expensive later, which is exactly the build-when-in-the-area case. A
period-close work-in-progress snapshot is the alternative and is worse: it is a materialised figure,
which section 1 and ADR `nothing-is-materialised-for-a-report` refuse.

### 7.2 Profitability is not computable

There is no timekeeper **cost** rate anywhere in the schema. `rate_card`/`rate` are billing rates —
what a client is charged, effective-dated, resolved matter → client → timekeeper → role. Nothing
records what an hour costs the firm. Profitability by matter, client, or practice area is therefore
deferred with its reason stated, not approximated from billing rates, which would produce a number
that looks like margin and is not.

### 7.3 There is no firm-wide operating position

The product chart of accounts and the operating general ledger (slice 3·5) are not on `main`; only
`firm_account_role` exists, mapping the handful of roles invoicing needs, and an unmapped role
refuses by name. A trial balance, income statement, or balance sheet over the accounts that do exist
would be a partial book presented as a whole one. Deferred to 3·5, which owns the chart; the
reporting surface will render its statements when they exist, per the slice map's split of
assembly (3·5) from rendering (3·6).

### 7.4 Collections is "applied", not "collected"

No payment rail records cash receipts yet (Phase 6 processes; Phase 3 records). `invoice_application`
carries a `payment` kind, so a manually recorded receipt is representable, but the surface must say
**applied** rather than **collected** — the vocabulary difference is the difference between a fact
the platform holds and one it does not.

### 7.5 Smaller things worth knowing

- **A client ledger is per (trust account, client).** The sub-ledger tree hangs under one account, so
  a client with money in two accounts has two ledgers. That is correct — the accounts may be in
  different jurisdictions — and the pack presents it that way rather than summing across accounts.
- **One currency.** Single registered currency per entry; accounts pin USD. Reports assert the
  currency and refuse to sum across currencies rather than converting.
- **Aggregated bank lines** (one deposit slip covering three checks) remain inexpressible as one
  match and read as one match plus outstanding items. The pack reports the resulting difference
  rather than hiding it — the honest degradation ADR-0246 already accepted.
- **A backdated posting into a closed reconciliation's period** is legal and moves the live proof.
  The pack's frozen/live split is exactly the surface where a firm sees that.
- **Credit notes carry no number** — an open owner question from the billing slice. The pack
  references them by id until that is answered.

---

## 8. Flagged for the owner

Each of these would change what the platform **asserts** about a firm's compliance, not how it
presents an existing fact. They are not settled here.

- **Q1 — Ethical walls and firm-wide totals.** When walls are built, does a firm-wide financial
  total include a walled matter's money and screen only the drill-down (complete, but the residual
  leaks the walled balance by subtraction), or exclude it (nothing leaks, and the member sees a
  firm-wide figure that does not tie to the reconciliation)? Recommendation on file: never screen the
  bar-audit pack in either arm, and gate it by grant instead.
- **Q2 — An unreconciled period.** May a bar-audit pack be produced for a period the firm never
  reconciled? Producing it says "here is what our books show"; refusing says the platform decides
  when a firm may hand something to an examiner. Recommended default: produce it, with the absence
  stated in those words on the cover.
- **Q3 — Frozen versus live, which leads.** Where a closed attestation and the live proof now
  disagree, the pack prints both. Which one leads the section, and is showing an examiner both the
  right posture, or does it invite a question the firm then has to answer? Recommended default:
  the frozen attestation leads, the live figure follows as "the ledger as it now stands".
- **Q4 — The firm's cushion, in front of a regulator.** Should the bank-charge carve-out appear as
  its own labelled section (transparent, and it explains a book-to-client difference an examiner
  would otherwise ask about), and should an account with the carve-out open be flagged as such on
  the cover?
- **Q5 — Unclaimed funds in the pack.** Should the dormant-balance diligence file be included?
  Excluded by default here, because dormancy is a comparison a caller states rather than a fact the
  platform asserts, and a disciplinary body reading a "dormant since" column may read an obligation
  the researched rules do not impose.
- **Q6 — A produced pack's life.** Is a produced pack a permanent firm record — undeletable, and
  inheriting the jurisdiction profile's trust-record retention period? Or an ordinary file a firm may
  delete?
- **Q7 — Does the pack carry an attestation?** The reconciliation has `closed_by`/`closed_at`. Should
  a produced pack carry the same — a named member attesting to the extract — or is it an unsigned
  extract of already-attested records?
- **Q8 — Naming authorizers.** The ledger records `authorized_by` on every movement out of a client
  ledger, and the journal can print it. It is a compliance strength and also a personnel record going
  to a regulator. Include by default?
- **Q9 — Zero-balance ledgers.** Does the pack list every matter leaf that existed during the period
  including those at zero throughout, or only those with activity or a balance? Completeness argues
  the first; a readable document argues the second.

---

## 9. Package and route shape

```
packages/reporting/                 pure, writes nothing, holds no binding
  src/temporal.ts                   the (periodStart, periodEnd, knownAsOf) type and its validation
  src/trust-compliance/             the pack: client ledgers, journal, cushion, exceptions
  src/financial/                    aging as-of, work in progress, realization
  src/productivity/
  src/operational/
  src/completeness.ts               the completeness declaration every response carries
  src/statements.ts                 select builders, under the schema-name-sync net
  test/purity.test.ts               the read-only fitness function
  test/agreement.test.ts            every decomposition equals the aggregate its owner produces

apps/worker/src/routes/billing/reports.ts   GET reads + the one production enqueue
apps/worker/src/reports-consumer.ts the queue consumer that assembles, renders, files
```

Where a new read is over **trust** or **billing** tables, the `select…Statement` builder is added to
that package rather than here, so the SQL stays inside the schema-name-sync net and beside the
invariants it must respect; `@magna-carta/reporting` composes those reads into report shapes. Reads
over the ledger's own tables go near `packages/ledger/src/statements.ts`, as the phase-3 slice map
directs — which is also the file the dormant `slice-3-5-operating-general-ledger` branch touches, so
that edit is made with a `main` sync in front of it.

Load profile: a `reports-measurements.ts` alongside the existing trust, invoice, and ledger
measurement files, measuring the pack over the fixture book at trust volume — the client-ledger
read, the journal read, and the aging as-of derivation, each at one and at twelve months.

---

## 10. Performance, and the one denormalization that might be justified

No figure is materialised. The reads are bounded by (account, period) and are served by
`ledger_line_account_id_index` and `ledger_entry_effective_date_index`, which already exist. The
shape to avoid is the obvious one the aging read already documents: pulling rows into the Worker and
summing them in JavaScript. Every aggregate in this surface is computed in SQL, and the per-row
sections (client ledger, journal) stream in effective-date order rather than buffering.

The honest weak point: a journal over a trust bank account joins `ledger_line` (by account) to
`ledger_entry` (for the dates), so SQLite drives from the account index and filters dates as a
residual. Over a long-lived account that reads more lines than the period needs.

If the load profile says that matters, the remedy is a **denormalization, not a materialisation**: a
copy of `effective_date` on `ledger_line`, written by the ledger package inside the posting batch,
so a composite `(account_id, effective_date)` index can drive the read. That duplicates an immutable
column of the same row's parent — it can never drift, because both are written once and never
updated — which is categorically different from storing a computed balance. It is not built now:
golden rule 10 says measure first, and the measurement is part of slice 1.

---

## 11. Test plan

- **Agreement tests (the load-bearing ones).** Every class-2 decomposition equals its class-1
  aggregate over the fixture book: the pack's per-matter closing balances sum to
  `selectTrustClientLedgerTotalAsOfStatement`; the journal's closing bank balance equals
  `selectTrustBookBalanceAsOfStatement`; the as-of aging at today equals `readAccountsReceivableAging`
  bucket for bucket; the pack's cushion equals `selectTrustFirmFundsTotalAsOfStatement`.
- **Reproducibility test.** Produce a pack; post a backdated reversal into the period; re-run with
  the same `knownAsOf` and assert byte-identical figures; re-run live and assert the figures moved
  and the live/frozen labelling says so.
- **Purity fitness.** Section 5, mechanism 1.
- **Refusal propagation.** An account past `MAX_TRUST_RECONCILIATION_ROWS` produces no pack section
  and the named refusal; an unrecorded jurisdiction produces the named refusal, not a blank citation.
- **No-second-answer regression.** A test that fails if the reporting package ever contains its own
  SUM over `ledger_line` restricted to trust node accounts — the shape that would quietly become a
  second client-ledger total.
- **Route conformance.** Section 5, mechanism 2.
- **Load profile.** Section 9.

---

## 12. Consequences

A firm can hand an examiner a document produced from its own append-only records, whose figures
re-derive from a stated period and knowledge instant, which quotes its own attestations rather than
recomputing them, and which says out loud what it could not determine. The reporting surface adds no
new assertion about a firm's compliance: everything it prints is a re-presentation of a row some
other package already owns and re-proves. And the three things the platform genuinely cannot compute
today — an as-of work-in-progress position, profitability, and a firm-wide operating book — are named
in the design rather than approximated in the output.
