---
number: 240
slug: case-calendar-event-model
status: Proposed
date: 2026-08-05
area: Calendar and docketing
summary: "The case calendar is DERIVED WHERE THE FACT ALREADY LIVES AND RECORDED WHERE THE FACT IS BORN — a hybrid drawn on that one line. The eleven per-firm tables that already carry timestamped business events (email filing, document assembly, files, time, costs, custody movements and review dates, trust movements, conflicts checks, and the matter's own lifecycle) are FEDERATED at read time through a source registry, not projected into a matter_event table: no write cost, no backfill, no drift, and no second copy of a privileged fact — the timeline cannot disagree with the custody register because it IS the custody register. Litigation events and deadlines, which exist in no table today, get their own two recorded tables. The audit log is explicitly REJECTED as the substrate because it records when a row was written, not when the thing happened, and the owner asked what transpired. Federation is affordable because the read count scales with the REGISTRY (twelve declared sources, one batch, LIMIT pageSize+1 each, a k-way merge in memory) and not with the firm's data; one cursor serves every source because lexicographic order over canonical ISO-8601 IS chronological order, which makes a civil date and an instant directly comparable as text and is guarded by a fitness test asserting canonical instant precision. Deadlines are first class and separate from events — a due instant, a satisfied/vacated/superseded state with a reason, and a source (member, court order, or a verified statutory catalog) — and OVERDUE IS DERIVED AT READ TIME, never written: the platform reports what it can see and never asserts that a firm missed anything. The platform REFUSES deadline arithmetic outright — no business-day math, no court-holiday calendars, no service-method offsets, no cascade when a trigger moves — until a verified jurisdiction-keyed catalog exists, and even then the catalog PROPOSES and a member CONFIRMS, with the entry key and version frozen on the row so an amended statute surfaces as a review item rather than silently moving a date. Time zones are per ROW and required, not per office: a Nevada firm's hearing in a California court is in the court's zone, which is also why location.time_zone finally lands and timeZoneForLocation stops returning UTC. Ethical walls do not exist and are not invented here; every source's statement builder instead takes a required visible-matter predicate composed into SQL BEFORE the LIMIT (today: exclude the platform holding matter), so a wall is one clause in one place when it is built, and a post-filter — which under-fills pages and turns page size into an existence oracle — is structurally impossible."
---

**The case calendar federates events that already exist and records only the ones that do not, with
deadlines first-class, overdue derived, and no deadline arithmetic.**

**Context:** The owner's ask on 2026-08-05 was for "a calendar that allows users to see what events
have transpired in the litigation as well as in the events of the case." Those are two different
problems. The litigation — hearings, filings, service, orders, statutory deadlines — is recorded
nowhere in the platform: there is no court integration and no table a hearing could go in. The case
— documents filed, mail captured, assemblies run, originals moved, money moved through trust, time
and costs booked, conflicts run, the matter opened and closed — is already recorded across eleven
per-firm tables, each with its own timestamp and, in most cases, an index built for exactly this
filter and sort. So the architectural question is not how to build a calendar but whether the half
that exists should be copied into the half that does not.

**Decision:**

1. **Hybrid, on the born-here line.** A fact born in another subsystem is read in place; a fact born
   in the calendar is recorded in the calendar. Eleven subsystem tables become **federated sources**;
   litigation events and deadlines get two new recorded tables (`matter_event` with its type catalog
   and participants, and `matter_deadline`). Nothing is projected, copied, or backfilled.

2. **Projection is rejected on four grounds, having been argued fairly.** Its one query shape is a
   genuine advantage and would probably win at fifty sources. At twelve it does not, because: the
   backfill is not a one-time cost but recurs on every schema change to every source, and a timeline
   missing the 2024 filings is worse than no timeline; the consistency obligation is permanent and
   fails silently, since the outbox can make a fan-in atomic but cannot make it correct when a source
   changes what it records; a second copy of every fact is a second redaction surface, and the audit
   log's redaction chokepoint exists because that mistake is easy to make once; and it puts a
   write-path cost on the hot path of subsystems that get no benefit. Against that, federation's
   drift is not merely forbidden but structurally impossible — the timeline cannot disagree with the
   custody register because it is the custody register — which for a record whose value in a dispute
   is that it is contemporaneous outweighs a faster firm-wide read.

3. **The audit log is explicitly not the substrate**, despite being per-firm, append-only, and
   already one query shape. It records **when the row was written, not when the thing happened**, and
   a custody movement back-dated to Friday and typed on Monday would land on Monday — the owner asked
   what _transpired_. Its `subject_id` is untyped and usually not the matter, its event vocabulary is
   uncurated by design, and it is a compliance record whose retention and access posture must be able
   to change independently of a product read surface. It is registered as **one** source over a
   strict allowlist of matter-lifecycle event keys, because that is the only fact it alone holds.

4. **Federation is affordable because the read scales with the registry, not the data.** Per page:
   one statement per registered source, each `LIMIT pageSize + 1` under the same keyset predicate,
   all in one `batch()`, then a k-way merge in memory. Twelve sources and a fifty-row page is twelve
   index reads and 612 rows to return 50. N is the number of declared sources, fixed in code and
   reviewed when it changes — not a per-row lookup, which is what the no-N+1 rule forbids.

5. **One sort key and one cursor, because ISO-8601 sorts.** Lexicographic order over canonical
   ISO-8601 text _is_ chronological order, so a civil date (`2026-08-05`) and an instant
   (`2026-08-05T09:00:00.000Z`) compare directly, with a day-granular event sorting at the head of
   its own day. No conversion, no per-source normalization, and — because every source sorts by the
   same comparable key — **one cursor for all of them**, which is the shipped `(created_at, id)`
   encoding unchanged. The hazard is named and guarded: a source writing a variant instant precision
   would sort wrong (`'.'` precedes `'Z'`), so a fitness test asserts canonical precision on every
   registered instant column.

6. **Deadlines are first-class and structurally different from events**: a due date and optional
   time, a zone, a state of `open`/`satisfied`/`vacated`/`superseded` with a required reason on the
   last two, a recorded satisfier and the event that discharged it, and a `source` of `member`,
   `court_order`, or `statutory_catalog`. **Overdue is derived at read time and never written** — no
   sweep, no state transition, no row that says the firm failed. A stored flag would need machinery
   for what is a comparison, could be stale where a comparison cannot, and would have the platform
   assert something about a firm's conduct it is not positioned to assert: the deadline may have been
   extended, satisfied elsewhere, or vacated this morning.

7. **The platform refuses deadline arithmetic, and this is a position rather than a deferral.** No
   business-day math, no court-holiday calendar, no service-method offsets, no cascade when a trigger
   date moves, no jurisdiction inferred from the matter's office, no deadline created by opening a
   matter. Missed deadlines being the top malpractice-claim source is an argument **for visibility
   and against arithmetic**: a computed deadline that is wrong is worse than none, because it will be
   trusted precisely because it was computed. When a verified jurisdiction-keyed catalog exists — the
   Nevada 30-day will-delivery duty is the worked example — the catalog **proposes** and a member
   **confirms**; the row records the entry key and the catalog version, and an amended statute
   surfaces as a review item rather than moving a confirmed date. An uncovered jurisdiction gets an
   explicit "not encoded" state, never a silent generic fallback. Consequences of missing a deadline
   are not modelled at all — that is a legal judgement, not a column.

8. **Time zones are per row and required, not per office.** A Nevada firm appearing in a California
   court has a hearing in `America/Los_Angeles`, and no property of the firm, the matter, or the
   office says so. Dates are civil dates, times are separate and optional (all-day is a real answer,
   and midnight is not), and no column stores midnight-local-as-UTC. `location.time_zone` lands with
   this slice and `timeZoneForLocation` stops returning `"UTC"` for every office on earth.

9. **Ethical walls are not invented here; the seam they need is built.** The trusted-insider posture
   defers walls entirely, so building enforcement would be building unused mechanism. Instead, every
   source's statement builder takes a **required** visible-matter predicate and composes it into SQL
   **before the `LIMIT`** — today one real clause, excluding the platform-owned custody holding
   matter. A wall is later one more clause in that one place, inherited by every source untouched,
   and a fitness test refuses a source that does not compose it. Filtering after the `LIMIT` is
   structurally excluded, because it under-fills the page and makes page size an existence oracle.

10. **A timeline entry is a reference, not a record.** Kind, sort key, owning identifier, actor, and
    a canonical deep link — plus each source's **declared** non-privileged label, or its explicit
    declaration that it has none. An email's subject line is privileged content and does not go on a
    firm-wide read; detail comes from following the link into the owning subsystem's own access-gated
    read.

**Considered & rejected:** _projecting every event into one `matter_event` table via the outbox_
(argued at length above — the backfill recurs, the drift is silent, and the redaction surface
doubles); _building the calendar on `audit_log`_ (records the write, not the occurrence); _one
cursor per source_ (unnecessary once every source shares a comparable sort key); _projecting civil
dates into instants inside the SQL statement_ (requires each row's zone in the query, and is exactly
the hot-path work the performance rule forbids); _a stored `missed` state_ (machinery for a
comparison, and an assertion the platform must not make); _computing deadlines from court rules now_
(no verified catalog exists; a ninety-per-cent-right catalog is worse than none); _a platform enum of
participant roles and event types_ (jurisdiction-specific vocabulary with no engine consuming it —
the catalog-table and free-text-role precedents apply); _a `location` foreign key for a courtroom_ (a
courthouse is not one of the firm's offices, and that table drives letterhead, remit-to, numbering,
and staffing); _an append-only event ledger_ (a calendar is a plan, hearings move, and a firm made to
write a compensating row for a typo stops recording).

**Consequences:** the calendar ships with no write-path cost anywhere else in the platform, no
backfill, and a class of bug — the calendar disagreeing with the register — that cannot be written. A
subsystem joins the timeline by declaring one read-side source, which is why the custodian's
will-deposit obligation will be attachable even though it hangs off a packet that routinely has no
matter. The cost is twelve query shapes maintained by the calendar's own authors, an over-read of
`sourceCount × (pageSize + 1)` rows per page, and a firm-wide date-ranged read that is twelve
windowed scans rather than one — the last being the only measured risk, with a **rebuildable read
model** (derived from the same registry, addressed by the same API, never a second source of truth)
as the escape hatch, gated on a measured budget miss rather than a guess.
