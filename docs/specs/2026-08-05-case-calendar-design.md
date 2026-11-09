# Case calendar and matter timeline — design (slice 6·1)

**Date:** 2026-08-05
**Status:** Design proposed; owner decisions in section 15 are open. No product code in this cycle.
**Scope:** The event model behind a case calendar — what a litigation event is, what a deadline is,
how events that already exist elsewhere in the platform reach one timeline, the time and time-zone
model a hearing needs, the bounded read API a calendar or timeline surface consumes, and the
visibility seam. Excludes: the user interface (named as seams only, section 13), court e-filing and
docket integrations, rule-based deadline computation from court rules, notification scheduling and
delivery, external calendar synchronization, recurring appointments, and matterless personal
appointments — each is a named later slice or an existing subsystem's work, with its seam placed
here.
**White-paper home:** _Calendar and rules-based docketing_, with _Foundational data & runtime
conventions_ (the time model), _Notifications_ (the reminder seam), _Tenancy and data isolation_,
_Authentication, access control & encryption_ (the visibility seam), _Matters and File Manager_,
_Custodian_, _Trust accounting_, _Time tracking_, and _Document automation_ as the surrounding
context — the last five because they are where most transpired events already live.
**Governing decisions:** ADR-0055 (time, dates and time zones — instants in UTC, civil dates as a
plain date plus a jurisdiction zone, never a naive local datetime), ADR-0018 (calendar and
rules-based docketing), ADR-0059 (Notifications owns the decision; reminders are notification types),
ADR-0068 (trusted-insider access control — RBAC gates actions, not visibility; ethical walls are a
deferred, named seam), ADR-0067 (route metadata and the one enforcement chokepoint), ADR-0003
(tenancy and the firm-scoped data-access layer), ADR-0039 (nothing heavy on the hot path), ADR-0083
(load-profile accretion), ADR-0051 (registry, chokepoint, fitness function), ADR-0064 (transactional
outbox), ADR-0017 / ADR-0038 (audit and redaction), ADR-0213 (the custodian's refuse-rather-than-
guess posture on jurisdiction-specific facts).
**Decision inputs:** the shipped per-firm schema in `packages/database/src/per-firm-schema.ts` (the
event-bearing tables surveyed in section 2); the shipped keyset-pagination contract in
`packages/data-access/src/cursor-pagination.ts`; the shipped audit write path in
`packages/data-access/src/audit-statements.ts`; the custodian design
([`2026-08-04-custodian-design.md`](2026-08-04-custodian-design.md)) for the catalog-table,
occurred-versus-recorded, and jurisdiction-refusal idioms; the Nevada will-custody research
([`../research/2026-08-05-nevada-will-custody-statutes.md`](../research/2026-08-05-nevada-will-custody-statutes.md))
for what a verified statutory deadline actually looks like; and the merge-field catalog design
([`2026-08-05-merge-field-catalog-system-design.md`](2026-08-05-merge-field-catalog-system-design.md))
for the subject registry a future "next hearing date" merge field would extend.

## Why now

The owner's ask on 2026-08-05, verbatim: _"a calendar that allows users to see what events have
transpired in the litigation as well as in the events of the case."_

That sentence has two halves and they are not the same problem. **The litigation** is the court
process — hearings, filings, service, orders, statutory deadlines — and the platform records
_none_ of it today: there is no court integration, no docket feed, and no table where a hearing
could go. **The case** is everything the firm did and recorded — documents filed, mail captured,
assemblies run, originals moved in and out of the safe, money moved through trust, time and costs
booked, conflicts run, the matter opened and closed — and the platform records _all_ of it already,
across a dozen tables, each with its own timestamp and its own index.

So half the work is inventing a model, and half is joining up records that already exist. The
central design question is which half the other half is made of, and it is worth answering
deliberately because the wrong answer is expensive in the specific way schema mistakes are
expensive: a projection built now must be backfilled, kept consistent forever, and re-derived every
time a subsystem changes its mind about what it records.

Everything the reading half needs is on `main`. Every table below ships. The feature ledger records
`calendar` as `not-started` with the evidence line "no calendar code, schema, or spec"; the matter
detail skeleton already reserves a Calendar section (`apps/web/src/lib/matters/sections.ts`) with
nothing behind it; and `time_entry.source` already carries a dormant `calendar` value against the
day this subsystem exists.

One obligation from an earlier slice comes due here. ADR-0055 requires civil dates to be stored as a
plain date plus an explicit jurisdiction zone and requires deadlines to be computed in the court's
zone — and `location` carries no time-zone column, so `timeZoneForLocation` in
`packages/document-assembly/src/resolve.ts` returns the string `"UTC"` for every office in the
world. Document assembly could live with that, because a merge field renders a date somebody already
decided. A hearing at nine in the morning cannot: the whole content of the record is _which_ nine in
the morning. This slice is the first code that makes ADR-0055's sentence enforceable, and it is why
the column lands here.

## 1. What this design is, in one paragraph

**Two new recorded tables for the facts that exist nowhere else — a litigation event and a
deadline — plus a read layer that federates them with the eleven subsystem tables that already
record what the firm did, under one comparable sort key, one shared cursor, and one visibility
predicate.** Nothing is copied. Nothing is backfilled. A subsystem joins the timeline by declaring a
source, which is a read-side statement builder and a projection, not a write-side obligation.

## 2. What already records events, and what it can and cannot answer

Before choosing an architecture, the honest inventory. Every table below is shipped and per-firm.

| Table                             | Time column                         | Matter link                       | Already indexed for a matter-scoped read?                 |
| --------------------------------- | ----------------------------------- | --------------------------------- | --------------------------------------------------------- |
| `audit_log`                       | `created_at` (instant)              | `subject_id` only, untyped        | No — indexes are on `created_at` and `event`              |
| `matter`                          | `opened_at`, `closed_at` (instants) | itself                            | Not an event table; three columns, no history             |
| `file` / `file_version`           | `created_at` (instant)              | `file.matter_id`                  | Yes — `file_matter_id_created_at_id_index`                |
| `email_matter_link`               | `created_at` (instant)              | `matter_id`                       | Yes — `email_matter_link_matter_created_id_index`         |
| `document_assembly`               | `created_at` (instant)              | `matter_id`                       | Yes — `document_assembly_matter_id_created_at_id_index`   |
| `time_entry`                      | `work_date` (civil date)            | `matter_id`                       | Partly — the shipped indexes serve the billing reads      |
| `cost_entry`                      | date (civil date)                   | `matter_id`                       | Partly — as above                                         |
| `custody_movement`                | `occurred_at` (instant)             | via `custody_packet.matter_id`    | Yes — per packet, and by date for the firm window         |
| `custody_packet` / `custody_item` | `review_on` (civil date)            | via `custody_packet.matter_id`    | Yes — the hand-written `custody_*_review_index` partials  |
| `custody_movement.due_back_on`    | civil date                          | via the packet                    | Not needed — the read seeks the packets that are out      |
| `trust_movement`                  | `effective_date` (civil date)       | via `trust_ledger_node.matter_id` | Yes per node — `trust_movement_node_effective_date_index` |
| `conflicts_check`                 | `created_at` (instant)              | `subject_matter_id` (nullable)    | No index on the matter column                             |
| `shipment` / `tracking_event`     | carrier timestamps                  | via the custody movement          | Not for this read                                         |
| `incident`                        | `created_at` (instant)              | none                              | Not matter-scoped; a support record, not a case event     |

Three findings fall out of that table and each shapes what follows.

**`audit_log` is not the substrate, and this is the most important negative result in the design.**
It is tempting: it is per-firm, append-only, written in the same batch as every mutation, and it
already has one query shape. It is still wrong, for four independent reasons. First and fatally, it
records **when the row was written, not when the thing happened**. A custody movement back-dated to
Friday and typed on Monday lands on Monday, and the whole of the owner's ask is what _transpired_ —
`occurred_at`, not `recorded_at`. The custody schema separates those two columns precisely because
they diverge, and a timeline built on the wrong one would systematically misdate every physical-world
event in the system. Second, `subject_id` is one untyped column holding whatever the writer thought
the subject was: a movement's subject is the packet, not the matter, so most rows cannot be reached
from a matter at all. Third, its `event` vocabulary is uncurated and unbounded by design — a calendar
built over it shows every settings change and every permission grant beside the hearing. Fourth, it
is a compliance record with its own retention, redaction, and access posture; making it the product's
read surface couples two things that must be able to change independently.

It is still the **only** home for one class of fact — the matter's own lifecycle, `matter.opened`,
`matter.closed`, `matter.reopened`, which exist as two nullable columns on `matter` and a trail in
`audit_log` and nowhere else. So `audit_log` is registered as **one** source over an **allowlist** of
event keys, not as the general substrate, and it needs a composite index it does not have.

**Two sources reach their matter through a join, and both already have the index for the second
hop.** Custody movements reach a matter through `custody_packet.matter_id`; trust movements through
`trust_ledger_node.matter_id`. Neither is a scan: a matter has few packets and at most one trust
matter leaf, so each resolves in a bounded first read whose result binds the second. Section 8 states
the shape.

**Custody already stores future dates, and they are already indexed.** `custody_packet.review_on`,
`custody_item.review_on`, and `custody_movement.due_back_on` all carry hand-written partial indexes
built for a reviews-due report. They are exactly the forward-looking material the owner asked for,
and the calendar reads them through the same indexes rather than growing its own copy.

**What does not exist yet and is therefore not a source.** There is no e-signature seal table in the
per-firm schema — `@magna-carta/signing` is engine code with no persisted per-firm record — so
"e-sign seals" cannot be federated today and are a named later source. Telemetry is deliberately not
a source in any slice: it measures the product, it does not record the firm's business, and pointing
a client-facing timeline at it would make an operational signal into a legal record.

## 3. Derived versus recorded — the verdict, and the argument

**Verdict: hybrid, drawn on the line of where the fact is born. A fact born in another subsystem is
read in place. A fact born here is recorded here.**

Concretely: the eleven subsystem tables in section 2 are **federated** at read time through a
registry of declared sources; litigation events and deadlines — which exist in no table today — get
their **own two tables**. There is no `matter_event` row for a document assembly, no fan-in on the
outbox, and no backfill.

### 3.1 The case for projection, stated fairly

Project every event into one `matter_event` table on write, through the transactional outbox, and
you get one query shape. One index, one keyset predicate, one statement, one plan. A timeline read
becomes indistinguishable from a matter's file list, which is a read the platform already knows how
to make fast. Filtering by kind is a column. Sorting is an index. Adding a twelfth source costs the
reader nothing. And a firm-wide, date-ranged calendar across every matter — the read this design
finds hardest — becomes a single index walk.

That is a real advantage and it should not be waved away. It is the reason projection is the
conventional answer, and if the source count were fifty rather than twelve it would probably win.

### 3.2 What it costs, stated as honestly

**A backfill that is never finished.** Every existing row in eleven tables must be projected before
the timeline is trustworthy, and "trustworthy" is the whole product: a timeline missing the 2024
filings is worse than no timeline, because a person will scroll to the bottom and conclude nothing
happened. The backfill has to run per firm, be resumable, and be re-runnable after every schema
change to any source.

**A consistency obligation that is permanent and asymmetric.** The outbox makes the write atomic
with the business change, so the fan-in cannot be lost — but it cannot be made _correct_ by the
outbox. If custody later adds a movement kind, or trust changes what an effective date means, or
email filing starts recording a capture path it did not have, the projection silently keeps emitting
the old shape until somebody notices. The failure mode is a timeline that is subtly wrong, which is
the worst kind: it looks complete.

**A second copy of every fact, with a second redaction surface.** Each projected row duplicates
identifiers and a label, and each label is a fresh chance to copy privileged content into a table
whose access posture was designed for something else. The audit log's `refuseUnredactedMetadata`
chokepoint exists because that mistake is easy to make once; a projection makes it easy to make
twelve times.

**A write-path cost on every mutation in the platform**, paid on the hot path of subsystems that get
no benefit from it. Recording a time entry becomes a two-table write because the calendar might want
it later.

### 3.3 What federation costs, stated as honestly

**N query shapes instead of one.** Twelve statements to write, twelve to index, twelve to keep
correct as their tables evolve. That cost is real and it is paid by the calendar's own maintainers
rather than distributed across the platform — which is the right place for it, but it is not free.

**A merge in application memory.** Each page requires a k-way merge over twelve result sets. That is
bounded work (section 8) but it is work the database would otherwise have done.

**A page that must over-read to under-return.** Each source reads `pageSize + 1` rows so the merge
can pick the top `pageSize`; the rest are discarded. At twelve sources and fifty rows that is 612
rows read to return 50.

**A firm-wide date-ranged read that is twelve windowed scans rather than one.** This is federation's
weakest case and section 12 names the measurement that would overturn it.

### 3.4 Why the line falls where it does

Four arguments decide it.

**The backfill problem does not exist in the federated design, and it is not a one-time cost.** It
recurs on every schema change to every source. Federation's equivalent — a source whose statement
needs updating — fails _visibly_, at compile time or in a fitness test, and affects one source.

**Drift is structurally impossible rather than merely forbidden.** A federated timeline cannot
disagree with `custody_movement`, because it _is_ `custody_movement`. The class of bug where the
calendar says one thing and the register says another cannot be written. For a system whose value in
a dispute is that it is a contemporaneous record — the same argument the custody ledger's
append-only triggers exist for — that property is worth more than a faster firm-wide read.

**The source count is twelve and grows slowly, and the platform already batches.** D1 takes a
statement array in one `batch()`; twelve bounded index reads in one round trip is a shape the
platform uses everywhere. This is not an N+1: N is the number of _declared sources_, fixed in code
and reviewed when it changes, not the number of _rows_. Golden rule 10 forbids work that scales with
data on the hot path; this scales with the registry.

**The custodian's will-deposit duty proves the model.** When owner decision C8 lands, a statutory
deposit obligation attaches to a **packet**, and a packet routinely has **no matter** — that is the
whole point of the subsystem. A projection into a matter-keyed `matter_event` table has nowhere to
put it and would force either a fake matter or a nullable matter column that every reader must then
handle. Federation has the obvious answer: Custodian keeps owning its own obligation, and registers
it as one more source. The architecture that is still correct when the next subsystem shows up with
a fact shaped differently is the one to pick.

### 3.5 The escape hatch, and why it is not a projection

If measurement (section 12) shows the firm-wide date-ranged read misses budget, the answer is a
`matter_timeline_index` **read model**: a materialized table derived from the same registry by a
sweep, addressed by the same API, and **rebuildable from the sources at any time**. That is a
different thing from a projection-as-source-of-truth in exactly the way that matters — drift is
repairable by a rebuild rather than corrupting, and the sources remain authoritative. It is additive
and changes no route, no response shape, and no cursor, because the read API is defined over the
registry rather than over the tables. It is not built now, and the trigger for building it is a
measured budget miss, not a guess.

## 4. The recorded model — litigation events

### 4.1 `matter_event`

One row per thing that happened or will happen in the case that no other subsystem records: a
hearing, a filing, service, an order, a deposition, a mediation, a conference, a trial, a client
meeting, a site visit. Member-entered, because there is no court integration and will not be one in
this slice.

Columns, with the reasoning for the ones that are arguable:

- `id` — `matterEvent_` handle.
- `matter_id` — **required**, foreign key to `matter`. Section 15 flag L1 argues it.
- `event_type_id` — foreign key to `matter_event_type` (section 4.2).
- `title` — the human label. Required and non-empty.
- `description` — free text, nullable.
- `status` — `scheduled` | `occurred` | `cancelled`. Not a fourth "missed" value: an event's status
  says what the firm asserts about it, and nothing derives one.
- `starts_on` — the civil date, `YYYY-MM-DD`, required. **Never a UTC timestamp**, per ADR-0055.
- `starts_at_time` — `HH:MM`, nullable. Null means an all-day event, which is what a filing is.
- `ends_on` / `ends_at_time` — nullable; both null means a point event, `ends_on` set means a range,
  which is what a three-day trial is.
- `time_zone` — an IANA identifier, **required**. Section 6 argues why it is on the row.
- `location_text` — free text (a courtroom, a department number, an address). Not a `location`
  foreign key: a courthouse is not one of the firm's offices, exactly as a bank vault is not, and the
  `location` table drives letterhead, remit-to, matter numbering, and staffing for every other
  subsystem that reads it.
- `court_reference` — free text (a case number in the court's own numbering). Nullable. Not a
  structured court identity: that is a Directory and merge-field-catalog concern (section 14), and
  inventing a court-identity schema here to hold one string would be a second home for a fact.
- `recorded_at` (instant) / `recorded_by` (user handle, not a foreign key) — the custody-movement
  precedent. `starts_on` is when it happens; `recorded_at` is when a person asserted it, and the two
  diverge routinely.
- `created_at` / `updated_at`.

**An event is mutable, and that is deliberate.** The custody movement ledger is append-only because
its value in a dispute is that nobody could make it say otherwise afterwards. A calendar is not that:
it is a plan and a record of a plan, hearings move, and a firm that has to record a compensating row
to fix a typo will stop recording. So an event is edited in place and the `audit_log` row written in
the same batch carries the change. Section 15 flag L4 covers the one case where that reading is
arguable — a hearing that is continued to a new date.

Indexes: `(matter_id, starts_on, id)` serves the matter timeline's filter, its sort, and its keyset
predicate from one composite; `(starts_on, id)` serves the firm-wide date-ranged read;
`(status, starts_on)` serves "what is still scheduled". Check constraints enforce the shape: a
non-empty title, a status in the set, `ends_on >= starts_on` where both are present, and a time
present on the end only if present on the start.

### 4.2 `matter_event_type` — platform-typed with firm extension

**A catalog table, seeded with platform rows, extensible by the firm, soft-deactivated — the
`custody_item_type` and `matter_type` precedent, for the same reason.** A firm whose practice has a
proceeding nobody thought of must not be blocked, and a growing list of similar things is a
declaration, not code.

- `id`, `name` (unique, non-empty), `code` (nullable, unique).
- `category` — `litigation` | `transaction` | `firm` | `other`. **Drives grouping and iconography
  only; nothing in the engine branches on it.** The same discipline `custody_location.kind` carries.
- `origin` — `platform` | `firm`. A platform row's `name` and `code` are immutable (a firm may
  deactivate it, not redefine it); a firm row is the firm's own.
- `active`, `created_at`, `updated_at`.

Seeded platform rows, all `category: litigation` unless noted: hearing, trial, filing, service,
order entered, judgment entered, deposition, mediation, arbitration, settlement conference, status
conference, discovery cut-off, appeal filed, notice received; plus client meeting, site visit, and
call (`category: firm`). The seed list is a starting vocabulary, not a claim about any jurisdiction's
procedure — which is why it is data a firm can extend and deactivate rather than an enum.

### 4.3 `matter_event_participant`

Who was there. The three shapes that really occur are the same three the custody ledger's borrower
model already found, and the same resolution applies:

- `participant_kind` — `member` | `entity` | `external`.
- `member_user_id` — set when the participant is a firm member (an attorney who appeared).
- `entity_id` — a `directoryPerson_` or `directoryOrganization_` handle, **by value with no
  cross-domain foreign key** (the `matter_party` and `custody_owner` precedent).
- `participant_name` — free text, set when the participant is external.
- `role` — a short firm-supplied label (appearing counsel, judge, court reporter, witness,
  interpreter). **Free text, not a platform enum**, for the reason the custody ownership role and the
  release-authority basis are free text: the vocabulary is jurisdiction-specific, there is no engine
  that consumes it, and a closed set here would be this schema inventing procedure.

A judge is an ordinary participant with the role "judge". Forcing a judge into the Directory as a
prerequisite would pollute the conflicts corpus with people who are party to nothing — the exact
argument the custody ledger makes about an external borrower — so `external` is a first-class shape,
and a firm that _does_ want the judge in its Directory uses `entity`.

A check constraint enforces that the kind names a column that is populated, mirroring
`custody_movement_borrower_shape_check`.

## 5. Deadlines as first-class

**A deadline is not an event, and collapsing them would lose the two things that make a deadline
matter: that it can be satisfied, and that it came from somewhere.**

### 5.1 `matter_deadline`

- `id` — `matterDeadline_` handle.
- `matter_id` — required.
- `title` — required, non-empty.
- `due_on` — the civil date, required.
- `due_at_time` — `HH:MM`, nullable. Real: many filing deadlines are five in the afternoon, and a
  deadline whose time is unknown must not be silently rendered as midnight.
- `time_zone` — IANA identifier, required. **The court's zone, not the office's** (section 6).
- `source` — `member` | `court_order` | `statutory_catalog`. Section 5.3.
- `catalog_entry_key` / `catalog_version` — set only when `source = statutory_catalog`; null
  otherwise, enforced by a check.
- `authority_text` — free text: the rule, statute, or order the firm says this comes from. Not
  parsed, not validated, not resolved against anything. It is the firm's own note of authority, and
  it is what a person reads when deciding whether the date is right.
- `trigger_event_id` — nullable foreign key to `matter_event`. The event that started the clock (the
  date of death, the date of service, the order's entry). **A link, never a computation** — nothing
  derives `due_on` from it, and moving the trigger does not move the deadline.
- `state` — `open` | `satisfied` | `vacated` | `superseded`.
- `satisfied_at` (instant), `satisfied_by` (user), `satisfying_event_id` (nullable foreign key to
  `matter_event` — the filing that discharged it), `satisfaction_note` (free text).
- `state_reason` — required when `vacated` or `superseded`, because "why is this deadline no longer
  in force" is the question a person asks six months later and the only bad answer is silence.
- `superseded_by_deadline_id` — nullable self-reference, set when `superseded`.
- `priority` — a small firm-set ordinal, nullable. Not a platform judgement about severity.
- `recorded_at` / `recorded_by` / `created_at` / `updated_at`.

Indexes: `(state, due_on, id)` serves the upcoming-deadlines read directly (the dominant read, and
it is filtered before it is sorted); `(matter_id, due_on, id)` serves the matter's own deadline list
and the timeline merge.

### 5.2 Overdue is derived, never stored

**Nothing in this design ever writes "missed".** A deadline that is past its `due_on` and still
`open` is _overdue_, computed at read time by comparing the due instant — `due_on` plus `due_at_time`
resolved in `time_zone` — against now. There is no sweep, no scheduled job, no state transition, and
no row that says the firm failed.

Three reasons, and the third is the one that decides it. A stored flag would need a sweep per firm to
maintain, which is machinery for a fact that is a comparison. A stored flag can be wrong — stale by
up to the sweep interval — where a comparison cannot. And a platform that writes "missed" onto a
firm's record has made an assertion about the firm's conduct that it is not in a position to make:
the deadline may have been extended by a stipulation nobody has typed in yet, satisfied by a filing
recorded under a different matter, or vacated by an order that arrived this morning. **The platform
reports what it can see. It does not adjudicate.**

### 5.3 What the platform computes, and what it refuses to

Missed deadlines are the largest single source of legal-malpractice claims. That fact cuts in a
direction people find counter-intuitive: it is an argument for **visibility** and against
**arithmetic**, because a computed deadline that is wrong is worse than no computed deadline at all.
It will be trusted precisely because it was computed, and the firm that would have looked the rule up
will not.

**What the platform does.** Makes every deadline visible in one place; makes it visible from the
matter, from the firm calendar, and from an upcoming-deadlines read; records who entered it and on
what stated authority; records when and by whom it was satisfied, and what satisfied it; keeps a
vacated deadline and its reason on the record rather than deleting it; and surfaces an overdue
deadline as overdue for as long as it stays open.

**What the platform refuses to compute, and this list is the design's position rather than a
to-do.** No business-day arithmetic. No court-holiday calendar. No service-method offsets (the
"three days for mailing" family). No chained or cascading recalculation when a trigger date moves.
No inference of a jurisdiction from the matter's home location. No default deadline created when a
matter opens or a matter type is chosen. None of it, until a **verified, jurisdiction-keyed rule
catalog** exists — the same refuse-rather-than-guess posture the trust-jurisdiction schema takes and
the custodian design takes on retention periods, and for the same reason: a catalog that is ninety
per cent right is worse than none, because it will be trusted.

**What a verified catalog would change, and what it still would not.** The Nevada research is the
worked example: NRS 136.050 sets a **30-day** duty to deliver a will after knowledge of the
testator's death, verified against primary text. That is exactly one catalog entry, and it is enough
to state the whole interaction model. When such an entry exists and applies, the platform
**proposes** a deadline with the date filled in; a **member confirms it**, and the confirmation is
what creates the row. `source` records `statutory_catalog`, `catalog_entry_key` and
`catalog_version` record which entry under which version, and `recorded_by` records who accepted it.
The catalog never writes a row by itself. When the catalog later changes — the statute is amended —
**existing rows are not recomputed**: they carry the version they were confirmed under, and the
change surfaces as a review item rather than as a date that moved while nobody was looking. That is
the frozen-at-assignment idiom the matter number and the time entry's rate snapshot already use.

For a jurisdiction the catalog does not cover, the answer is the explicit **"not encoded for your
jurisdiction"** state, never a silent generic fallback.

**Consequences of missing a deadline are not modelled at all.** What follows from a missed deadline
is a legal judgement about a specific matter in a specific court, and a `consequence` column would
either hold a firm's free-text note (which `description` already holds) or invite the platform to
have an opinion it must not have.

## 6. Time, dates, and time zones

ADR-0055 settled the model; this section states what it means here, because this is the first
subsystem where the distinction has teeth.

**A date is a civil date and is stored as one.** `starts_on`, `ends_on`, and `due_on` are
`YYYY-MM-DD` text. There is no UTC timestamp anywhere in the event or deadline model. Storing
midnight-local-as-UTC is the classic off-by-one-DST defect ADR-0055 exists to prevent, and a hearing
that moves a day when the clocks change is the exact failure a docketing system cannot have.

**A time is separate and optional**, because "all day" is a real and common answer. Modelling an
all-day filing as midnight would make it sort and render as an event at midnight.

**The zone lives on the row, not on the office, and this is the design's substantive departure from
the merge-field model.** Document assembly renders a date in the **matter's office's** zone, which is
right for a letter. A hearing is different: a Nevada firm appearing in a California court has a
hearing in `America/Los_Angeles`, and no property of the firm, the matter, or the office says so. So
`time_zone` is a required column on `matter_event` and `matter_deadline`, defaulted in the user
interface from the matter's office and overridable per row. ADR-0055 says a deadline keys off the
court's zone, not the viewer's — a required column is the only way to say that.

**`location.time_zone` lands in this slice.** An IANA identifier, nullable during expand-contract,
and `timeZoneForLocation` in `packages/document-assembly/src/resolve.ts` — reserved as the single
plug-in point exactly for this — starts returning it instead of `"UTC"`. That function is the one
place the column enters the platform; no default is scattered anywhere else. Fixed offsets are never
stored: they break across DST, which is the whole point.

**Instants stay instants.** `recorded_at`, `satisfied_at`, and every `created_at` in the design are
UTC ISO-8601, written by the injected clock. Section 8.2 depends on that being canonical.

## 7. The source registry

The read layer's one piece of machinery. A **timeline source** is a declaration — a registry row in
the ADR-0051 sense — carrying:

- `key` — stable, e.g. `matterEvent`, `custodyMovement`, `emailFiled`. Appears in API responses and
  in the `kind` filter, so it is a wire contract and permanent.
- `kinds` — the closed set of entry kinds this source can emit (a custody movement emits its
  fifteen movement kinds; a document assembly emits one).
- `timeColumnShape` — `instant` | `civilDate`. Section 8.2 needs it.
- `buildStatements(scope)` — returns the bounded statements for a scope (a matter timeline, a
  date-ranged window, an upcoming-deadline read), **taking the visibility predicate as a required
  argument**.
- `project(row)` — maps a raw row to a timeline entry.
- `label` — a declared, non-privileged summary projection, or an explicit declaration that the
  source has none.

Three properties are enforced by fitness tests rather than trusted (ADR-0051):

1. **Every source composes the visibility predicate.** A source whose statement does not is a leak,
   and the predicate is a required argument rather than an optional one so the mistake is a type
   error first and a test failure second.
2. **Every `instant` column is canonical.** Section 8.2.
3. **Every source's statement carries a `LIMIT`.** An unbounded source is an unbounded page.

### 7.1 A timeline entry is a reference, not a record

A timeline entry carries: the source key, the kind, the sort key, the owning row's identifier, the
matter, the actor where there is one, and the canonical deep link (ADR-0052). It carries **no
privileged content**.

Where a source has a genuinely non-privileged label it declares one — a custody number and a
movement kind, an assembly outcome, a trust movement's kind and amount and effective date (a
valuation is a business number, not a personal identifier, which is the position the custodian design
takes on declared values), a time entry's duration. Where it does not, it **declares that it has
none** and the row renders by kind alone: an email's subject line is privileged content, and putting
it on a firm-wide calendar read that spans every matter is precisely the leak the notification
confidentiality discipline forbids. Absence is a declared decision, not an oversight — the same
discipline the merge-field dictionary's absence behaviour carries.

Detail comes from following the link into the owning subsystem's own access-gated read. That is one
extra request for the one row a person opened, not a redaction problem on every row of every page.

## 8. The read layer

### 8.1 One sort key across heterogeneous sources

Every source declares a single time column, and the merge compares those columns **as text**.

That works because ISO-8601 was designed for it: lexicographic order over canonical ISO-8601 strings
_is_ chronological order. `"2026-08-05"` sorts before `"2026-08-05T09:00:00.000Z"` (a prefix sorts
first), which sorts before `"2026-08-06"`. A day-granular event therefore sorts at the head of its
own day, ahead of everything timed on that day, which is also the right reading for a person: "on the
5th" precedes "at 9am on the 5th".

No conversion, no per-source normalization pass, and no projection of civil dates into instants at
read time — which would have required knowing each row's zone inside the SQL statement, and is
exactly the kind of work golden rule 10 keeps off the hot path.

### 8.2 The canonical-instant obligation

Text comparison is chronological **only if** every `instant` column is canonical. It is:
`Date.prototype.toISOString` emits exactly `YYYY-MM-DDTHH:mm:ss.sssZ` — fixed three-digit fraction,
always `Z` — and every clock in the platform is that call. The hazard is real and worth naming: a
source that began writing `2026-08-05T09:00:00Z` (no fraction) would sort **after**
`2026-08-05T09:00:00.500Z`, because `'.'` precedes `'Z'` in byte order, and the timeline would be
quietly wrong in a way no test of the calendar itself would catch.

So the registry declares each column's shape and a **fitness test asserts the pattern** over every
registered `instant` column across the load-profile corpus. A source that starts writing a variant
precision fails in continuous integration rather than mis-ordering a production timeline. This is
cheap to add now and effectively impossible to retrofit an explanation for later.

### 8.3 One cursor for all sources

Because every source sorts by the same comparable key, **one cursor serves all of them** — there is
no per-source cursor vector. Each source re-applies the identical keyset predicate from the same
global position:

```
WHERE <time_column> < ?1 OR (<time_column> = ?1 AND <id_column> < ?2)
```

The cursor is therefore the shipped `(created_at, id)` pair from
`packages/data-access/src/cursor-pagination.ts`, encoded by the existing `encodeCursor` with its
byte-identical `btoa(JSON)` shape, and the calendar mints no new wire contract. `assemblePage`'s
has-more probe applies to the **merged** result rather than to any one source's.

### 8.4 The bound

Per page, per scope:

- One bounded pre-read for each of the two join-reached sources (a matter's custody packets; a
  matter's trust ledger node) — each returning a small, matter-sized set.
- One statement per registered source, each `LIMIT pageSize + 1` under the cursor predicate, all
  issued in one `batch()`.
- One k-way merge in memory over at most `sourceCount × (pageSize + 1)` rows.

At twelve sources and a fifty-row page: twelve index reads, 612 rows read, 50 returned. **The read
count scales with the registry, not with the firm's data.** That is the distinction golden rule 10
draws, and it is the sentence the load-profile assertion in section 12 has to keep true.

### 8.5 Filter before you page, always

A `kind` filter narrows the **registry** before any statement is built — filtering to
`custodyMovement` issues one statement, not twelve. A filter on the sources' own columns is pushed
into the `WHERE` clause. **Nothing is filtered after the `LIMIT`.** Post-filtering a page under-fills
it (a page of fifty returns eleven), makes `nextCursor` mean something different from page to page,
and leaks the existence of filtered rows through the page's shape — which is the whole reason
filtering happens before ranking rather than after it.

## 9. Visibility, and the ethical-wall seam

**The ask assumed ethical walls exist; they do not, and the honest design says so rather than
inventing them.** ADR-0068 settles the posture: trusted-insider RBAC, information open among
insiders, RBAC gating _actions_ and not _visibility_, the only hard boundary firm isolation, and
ethical walls explicitly **deferred as a named seam with no design**. Building wall enforcement here
would be building unused mechanism against no use case — the thing that ADR was decided against.

What this design does instead, which costs nothing now and is what a wall will need:

**Every source's statement builder takes a `VisibleMatterPredicate` as a required argument**, and
composes it into the `WHERE` clause **before the `LIMIT`**. Today it resolves to one clause:
`matter.system_key IS NULL` — excluding the platform-owned holding matter that Custodian creates for
scans of originals held for someone with no matter, which is a real row that must never appear on a
firm's calendar. That is a genuine filter doing genuine work today, not a placeholder, which is what
keeps it from rotting.

When ADR-0068's deferred overlay is built, the wall is one more clause in that one predicate, and
every registered source inherits it without being touched. The fitness test in section 7 is what
makes that true: a new source that does not compose the predicate does not ship.

Two rules that follow and are worth stating so they are not re-derived. **A firm-wide calendar read
is a matter-scoped read repeated, not a special case** — it composes the same predicate, so a matter
that becomes invisible disappears from the firm calendar by construction. And **the predicate is
composed in SQL, never applied in the Worker after the rows come back**, for the reasons in section
8.5: a post-filter under-fills the page and turns the page size into an existence oracle.

## 10. The API surface

Route module `apps/worker/src/routes/calendar/calendar.ts`; two permissions in the
`@magna-carta/access-control` registry, seeded by migration.

**`calendar:read`** — read timelines, events, and deadlines. Seeded to the practising roles.
**`calendar:manage`** — create, edit, and cancel events; create, satisfy, vacate deadlines.

Two rather than one because reading a case history and asserting when a hearing is are different
capabilities. Two rather than four because a separate `calendar:configure` for the type catalog would
add no gate the manage permission does not already impose — the custodian's argument, unchanged.

### 10.1 Reads

| Route                                     | Shape                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/matters/{matterId}/timeline` | Keyset, newest-first. `kind` (repeatable, filters the registry), `from`/`to` (civil dates), `direction` = `past` \| `future` \| `all`, `cursor` |
| `GET /api/v1/calendar/events`             | Date-ranged across visible matters. `from`/`to` **required**, window capped (section 15 flag L5); `matterId`, `memberId`, `kind`, `cursor`      |
| `GET /api/v1/calendar/deadlines`          | Open deadlines, due **ascending**, horizon capped. `state`, `matterId`, `overdue` (a read-time comparison, section 5.2), `cursor`               |
| `GET /api/v1/matters/{matterId}/events`   | The recorded events only, without the federation — what an edit surface reads                                                                   |

The deadline read is the one that sorts **ascending**, which the shipped keyset helper does not do —
`appendCursorPredicate` hard-codes the DESC comparison. That is a small, real addition to
`packages/data-access/src/cursor-pagination.ts`: an ascending variant beside it, sharing the cursor
encoding so the wire contract does not fork. Named here because it is the kind of thing that
otherwise gets solved by a local copy of the helper.

`memberId` on the firm calendar means "events where this member is a participant, or the matter's
responsible member" — resolved by composing a predicate, never by fetching everything and filtering.

### 10.2 Writes

`POST /api/v1/matters/{matterId}/events` · `PATCH /api/v1/events/{eventId}` ·
`POST /api/v1/events/{eventId}/cancel` · `POST /api/v1/matters/{matterId}/deadlines` ·
`PATCH /api/v1/deadlines/{deadlineId}` · `POST /api/v1/deadlines/{deadlineId}/satisfy` ·
`POST /api/v1/deadlines/{deadlineId}/vacate` · the event-type catalog's create/update/deactivate.

Every mutating route is `audited` and idempotency-keyed through the chokepoint; every mutation
composes an `audit_log` row in the same batch with identifiers only in `metadata` — never a title, a
description, an authority note, or a participant's name.

## 11. Notifications — emission points defined, wiring later

ADR-0059 gives reminders their home, and the white paper already names docketing reminders as a
notification type. This design **declares the emission points and wires none of them**. No scheduler,
no Cron-triggered Workflow, no outbox topic, no delivery.

- `calendar.deadline.horizon` — an open deadline enters the firm's configured lead window.
- `calendar.deadline.due` — an open deadline is due today.
- `calendar.deadline.overdue` — an open deadline is past due.
- `calendar.event.scheduled` / `.rescheduled` / `.cancelled`.

Each is a Notifications registry type when that registry is built, with recipients resolved there and
not here. The reason to name them now rather than later is the reason to name any seam now: the write
paths they raise from are being built in this slice, and adding a raise to an existing write is a
line, where finding every write path afterwards is an archaeology.

## 12. Load profile and measurement

The fixtures corpus gains a synthetic litigation shape, non-privileged and programmatically built: a
long-tailed distribution of matters by timeline depth (most under fifty entries, a tail past two
thousand), events spread unevenly across a decade with a dense recent window, several hundred open
deadlines with a realistic overdue fraction, and one matter deliberately deep in every federated
source at once.

Four measurements, each an assertion rather than a report:

1. **Matter timeline, page 1 and page 20.** Page 20 must not be materially slower than page 1 — that
   is what keyset pagination buys and the thing a regression would silently take away.
2. **Statement count per page is exactly `sourceCount` plus the two join pre-reads**, asserted
   directly. This is the assertion that catches an N+1 the moment somebody adds a per-row lookup to
   a projection.
3. **Rows read per page ≤ `sourceCount × (pageSize + 1)`**, asserted the same way.
4. **The firm-wide 31-day window** across the corpus — federation's weakest read, and the
   measurement that decides whether section 3.5's read model is ever built.

## 13. Named seams, not built here

- **The user interface.** Deferred to the owner. The API is defined so a month grid, a week view, an
  agenda list, and a matter timeline are all the same two reads with different parameters.
- **Court e-filing and docket integrations.** The integration port framework is shipped; a court
  adapter is Phase 7. When one lands, it is a _writer_ into `matter_event` with a provenance column
  distinguishing a docket-sourced event from a member-entered one — the column is not added now
  because nothing can populate it and a nullable provenance nobody sets is worse than none.
- **Rule-based deadline computation.** Section 5.3 is the position, not a deferral of the position.
- **Notification scheduling and delivery.** Section 11.
- **Recurring events.** ADR-0055's wall-clock-recurrence model (local time plus zone, materialized
  per occurrence) is the shape when it is built; no recurrence column lands now.
- **External calendar synchronization.** Two-way Google and Outlook sync via the email/calendar
  plugin, Phase 7. It will need a stable external identifier per event; that is one nullable column
  added with its writer.
- **Matterless personal appointments.** A different audience, a different privacy posture, and a
  different retention story (section 15, flag L1).
- **E-signature seals as a source.** No per-firm signing record exists to federate (section 2).
- **The custodian's statutory deposit obligation as a source.** Gated on owner decision C8; the
  federated model is what makes it attachable without a matter (section 3.4).

## 14. Seams to work in flight

Two design streams are open and this design depends on neither of their outcomes.

**The merge-field catalog.** Its subject-crossed-with-facet model is the natural home for a future
`hearing.date`, `hearing.time`, or `nextDeadline.dueOn` merge field — a subject with date facets,
resolved through one batched read like every other source. This design does nothing to enable that
and nothing to block it: the tables carry the facts, and a subject registration is additive when
somebody wants it. It is a seam, not a dependency, and no key is reserved here.

**Matter assets.** If a matter-assets model lands with dated obligations of its own, it becomes a
registered source under section 7 rather than a schema change here. That is federation's point.

## 15. Owner decisions required

These are opinion-heavy or expensive-to-change, and are not settled by this design.

| Flag   | Decision                                                                                                                                                                                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1** | **Is `matter_event.matter_id` required?** Recommended: **yes, required.** Every read here is "what happened on this case", and the visibility predicate keys off the matter. A matterless personal appointment has a different audience and a different privacy posture; model it as its own thing when the appointment feature is built, not as a null here. |
| **L2** | **Federated read versus a projected `matter_event` table for transpired events.** Recommended: **federated** (section 3), with a rebuildable read model held as the measured escape hatch (section 3.5). The verdict most expensive to reverse, which is why it is flagged rather than assumed.                                                               |
| **L3** | **Does the platform ever compute a deadline date from a court rule?** Recommended: **never, until a verified jurisdiction-keyed catalog exists — and even then, propose-and-confirm, never auto-create** (section 5.3). The single highest-consequence position in the design.                                                                                |
| **L4** | **A continued hearing: edit the row, or a new row linked to the old?** Recommended: **edit, with the audit log carrying the change.** A new row puts two hearings on the calendar and makes every consumer responsible for hiding one. Worth an explicit answer because "we need to see it moved" is a fair counter-argument.                                 |
| **L5** | **The firm-calendar window cap.** Recommended: **366 days**, as a request refusal rather than a silent clamp. Not a correctness question, but it is user-visible and better fixed than discovered.                                                                                                                                                            |
| **L6** | **Do time and cost entries belong on a case timeline at all?** Recommended: **yes, as sources a firm can filter out**, not as sources omitted. They are the densest sources by row count and would dominate an unfiltered timeline — a default-off `kind` filter is the middle answer and it is a user-interface default, not a schema decision.              |
| **L7** | **Should a matter's timeline include the matter's own lifecycle from `audit_log`?** Recommended: **yes, over a strict event-key allowlist**, plus the composite index that read needs (section 2). The alternative is that a matter's timeline cannot say when the matter opened.                                                                             |

## 16. Open questions

1. **Whether the event-type catalog's `category` should be firm-editable on a firm-created row.** A
   firm that adds "arbitration status conference" plainly wants it grouped with litigation; a firm
   that miscategorizes one gets a confusing calendar and no worse. Leaning permissive, but it is the
   kind of thing that is easier to loosen than tighten.
2. **Whether `matter_event` should carry a content hash.** The custodian design asked the same
   question of its movement ledger and answered no without a stated threat model. The answer here is
   more clearly no — an event is explicitly mutable (section 4.1), so a hash would attest to nothing.
   Recorded so it is not re-raised.
3. **How the two join-reached sources behave on a firm-wide window.** Resolving a matter's packets is
   trivially bounded; resolving _every_ matter's packets for a 31-day window is not the same read.
   Custody movements may simply not belong on the firm-wide calendar — review dates and due-backs
   are the forward-looking custody facts, and they are directly date-indexed. Section 12's fourth
   measurement decides it, and the answer changes one registry row.
4. **Whether a deadline should be able to hang off something other than a matter.** Federation makes
   the question mostly moot (section 3.4), but a firm-level compliance deadline — a trust
   reconciliation, an insurance renewal — is a real thing with no matter. It is a different subject
   with a different audience and probably its own table; noted rather than resolved.
