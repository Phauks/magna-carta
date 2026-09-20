# Review campaign 2 — the operational area

**Date:** 2026-08-06 · **Branch:** `claude/review-campaign-2-operational` · **Posture:** read-only,
adversarial. No test suite was run and no source file was changed.

**Scope reviewed.** The custody register's operational half — stocktake, the gated release, labels,
reports, reviews and reminders, the destruction workflow, and the will-deposit duty catalog — the
case calendar's recorded model and thirteen-source federation, the matter-close advisory hook, the
worker routes over all of it, and the data-access statements underneath. `packages/matter-assets/`
was checked for and is **not merged**: only its design note exists
(`docs/active-work/claude/matter-assets-design.md`, since retired — the package has landed as
`packages/matter-assets/` after this review), there was no `packages/matter-assets/` directory, so it is out of this pass.

Every finding below was verified against the code and, where the claim was about a database
guarantee, against the migration that creates it. Where a design decision looked wrong and turned
out to be deliberate and correct, it is recorded in _What was checked and holds_ rather than
dropped — a review that reports only failures makes the next reviewer re-derive the same ground.

**Counts.** 1 high · 6 medium · 7 low. **All fourteen are fixed** — each finding carries its
status below, and the fix table is in #157. Nothing here was disputed.

---

## High

### H1 — A two-signatory release is composable into one person

**Status: Fixed in #157.** The verifying member is now the authenticated actor and is gone from the wire; the witness must be a different, ACTIVE member of the firm, checked against the roster at the write path and re-asserted by `custody_movement_release_verifier_is_recorder` and `custody_movement_release_witness_is_active_member` in `20260806T040000_operational-fixes.sql`. BEFORE INSERT, so the binding is future-only — rows already on the ledger predate it and stay exactly as they were recorded.

**Where.** [`packages/custodian/src/release-gate.ts:53-118`](../../packages/custodian/src/release-gate.ts) ·
[`packages/custodian/src/movement-service.ts:135-142`](../../packages/custodian/src/movement-service.ts) ·
[`apps/api-worker/src/routes/custody/custody.ts:584-590`](../../apps/api-worker/src/routes/custody/custody.ts) ·
[`packages/database/drizzle/per-firm/20260908T000000_baseline.sql`](../../packages/database/drizzle/per-firm/20260908T000000_baseline.sql)

**What the code does.** `resolveCustodyReleaseCapture` takes `identityVerifiedByUserId` and
`witnessedByUserId` **out of the request body**. It enforces exactly two things about them: that a
witness is present when `policy.requireTwoSignatories` is set, and that the two identifiers differ
(`release-gate.ts:99` and `:105`). The database trigger
`custody_movement_release_witness_distinct` enforces the same distinctness and nothing further.
Nothing anywhere ties either identifier to the authenticated actor, and nothing validates either
against the `member` table — a repo-wide search for a member lookup inside `packages/custodian/src`
returns nothing, and the route's `identifierField("user")` is a prefix-shape check, not an
existence check. The migration's own comment says the rule "mirrors the requester / approver split
the destruction request row already carries", but that split is enforced across **two separately
authenticated requests** (`destruction-service.ts:199-207` reads `options.actorUserId`, which the
route derives from `requireChokepointUserId`). This one is enforced across two fields of one
request from one session.

**Concrete failure.** A firm turns on `requireTwoSignatories` precisely because releasing an
original is irreversible. One member holding `custody:manage` records the release of an original
will, typing a colleague's user identifier into `witnessedByUserId` — or any well-formed
`user_…` string belonging to nobody. The trigger passes (the two differ), the row commits, and the
movement ledger is append-only, so the record now permanently asserts that two people signed off on
a handover only one person witnessed. Because the audit row records only the recording actor, the
discrepancy is not recoverable from the record either: there is no stored fact that contradicts the
false capture. This is the exact class the review brief names — a two-person control that composes
into one person — and it sits on the one movement the subsystem itself calls irreversible.

**Fix shape.** Three layers, cheapest first. (1) Bind one signatory to the session: require
`identityVerifiedByUserId === options.actorUserId`, or accept the actor implicitly and drop the
field from the wire — an assertion about a check you made is not a field you should be able to make
on someone else's behalf. (2) Validate both identifiers against `member` before the identifier is
minted, so a release cannot name a person the firm does not employ; a foreign key on both columns
would do it at the database and matches how `matter_event_participant.member_user_id` is already
declared. (3) If the policy is meant to mean genuine two-person control rather than
one-person-attests-to-two, model it the way destruction is modelled: a released movement staged by
one member and confirmed by a second authenticated request, so the second signature is a second
session and not a second text box.

---

## Medium

### M1 — Editing a deadline has no state guard riding the write

**Status: Fixed in #157.** `updateMatterDeadlineStatement` ends `WHERE id = ?1 AND state = 'open'`, and `assertMatterDeadlineOpenStatement` rides first in the batch so a losing concurrent edit aborts the whole batch rather than matching zero rows and reporting success.

**Where.** [`packages/calendar/src/deadline-statements.ts:94-124`](../../packages/calendar/src/deadline-statements.ts)
(compare `:129-153` and `:158-174`) · service check at
[`packages/calendar/src/deadline-service.ts:150-155`](../../packages/calendar/src/deadline-service.ts)

`updateMatterDeadlineStatement` ends `WHERE id = ?1`. Its two siblings in the same file —
`satisfyMatterDeadlineStatement` and `closeMatterDeadlineStatement` — both end
`WHERE id = ?1 AND state = 'open'`, under a comment that states the rule outright: "D1 has no
interactive transaction, so the state check rides the write itself." The update path is the
outlier. `updateMatterDeadline` reads the row, refuses a non-open state in the service
(`deadline-service.ts:150`), and then issues an unguarded write. The case-calendar migration
declares no trigger on `matter_deadline` at all, so nothing behind the statement catches it, and
`matter_deadline_satisfaction_shape_check` does not fire because the update touches neither `state`
nor the satisfaction columns.

**Concrete failure.** A paralegal opens the deadline to move its due date; an attorney marks it
satisfied in the same few hundred milliseconds. Both reads see `state = 'open'`. The satisfy commits
first. The edit then commits against a satisfied row and rewrites `due_on`, `time_zone`, and the
authority note on a deadline the firm has already recorded as discharged — silently, with a
`calendar.deadline.updated` audit row that looks ordinary. The package's own refusal message ("a
settled deadline is superseded by a new one rather than edited") is exactly what the race defeats.

**Fix.** Append `AND state = 'open'` to `updateMatterDeadlineStatement`, and have
`updateMatterDeadline` treat a zero-row result as the refusal it already knows how to raise. The
same reasoning argues for a `BEFORE UPDATE` trigger freezing a settled row's `due_on`, matching how
every custody freeze in this codebase is backed at the database rather than by discipline.

### M2 — Three custody-derived timeline sources drop status predicates the register's own reads carry

**Status: Fixed in #157.** All three statements carry the missing predicates, including the latest-check-out correlation, and `test/source-fitness.test.ts` now pairs each custody-derived source with the custodian read it mirrors — scanning that read's source text, since the calendar depends on no other domain package.

**Where.** [`packages/calendar/src/sources/all.ts:500-594`](../../packages/calendar/src/sources/all.ts)
(`custodyReviewDueSource`, `custodyDueBackSource`) · compare
[`packages/custodian/src/queries.ts:160-189`](../../packages/custodian/src/queries.ts) and
[`packages/custodian/src/review-statements.ts:57-91`](../../packages/custodian/src/review-statements.ts)

The calendar package's headline claim is that "a federated timeline cannot DISAGREE with the
register it is built from, because it IS that register" (`sources/registry.ts:10-12`). Three
statements break it, each by omitting a predicate the custodian's own equivalent read carries and
documents:

- `custodyDueBackSource` filters only `due_back_on IS NOT NULL`. `selectOverdueCustodyCheckoutsStatement`
  additionally requires `packet.status = 'out'`, `movement.item_id IS NULL`, and that the row is the
  packet's **most recent** check-out by `occurred_at` — with a comment explaining each ("a packet
  that came back is not overdue however overdue its old check-out row once was").
- `custodyReviewDueSource`'s packet statement filters only `review_on IS NOT NULL`.
  `selectCustodyReviewsDueStatement` requires `packet.status IN ('held', 'out')`, under a comment
  saying a reminder about property that left the safe "is noise the register would train people to
  ignore".
- The same source's item statement omits both `item.status IN ('held','out')` and the packet-status
  predicate the reviews-due read applies to the joined packet.

**Concrete failure.** A deed is checked out on Monday, due back Friday, and returned Tuesday. The
custody register's own reminder list correctly says nothing. The firm calendar keeps a `dueBack`
entry on Friday, labelled with the packet's custody number, forever. Worse in the review case: an
original will is released to the executor or destroyed under the two-person workflow, and its
`review_on` is never cleared by either path (no code in `packages/custodian/src` writes `review_on`
on a release or a destruction) — so the firm calendar keeps showing "review due" for a will the
firm no longer holds, naming it by custody number.

**Fix.** Add the missing predicates to the three statement builders, drawing them from the
custodian reads rather than restating them: `custody_packet.status IN ('held','out')` on both
review statements plus `custody_item.status IN ('held','out')` on the item one, and
`custody_packet.status = 'out'` plus the latest-check-out correlation on the due-back source. Worth
a fitness test that pairs each custody-derived source with the custodian read it mirrors, since
this is a divergence that will recur every time either side gains a status.

### M3 — The stocktake reconciliation truncates silently, and the close freezes the truncated numbers

**Status: Fixed in #157.** Both reads request `limit + 1`; `CustodyReconciliation` carries `truncated` and `rowLimit` and the reconciliation route returns them; the sighting read runs newest-first with a first-wins reduction, so the cap drops the oldest observations rather than the corrections; and a non-abandoned close of a truncated reconciliation is refused (`custody-stocktake-truncated`) rather than freezing a partial answer. An abandoned close records the truncation on its audit row.

**Where.** [`packages/custodian/src/stocktake-reconciliation.ts:44`](../../packages/custodian/src/stocktake-reconciliation.ts)
and `:126-129` · [`packages/custodian/src/stocktake-service.ts:304`](../../packages/custodian/src/stocktake-service.ts) ·
[`packages/custodian/src/stocktake-statements.ts:243`](../../packages/custodian/src/stocktake-statements.ts) and `:276-308`

`MAX_RECONCILIATION_ROWS = 10_000` bounds both reads. Its comment says the bound exists "so a
runaway scope truncates to an obviously-short answer" — but nothing makes the truncation obvious:
`CustodyReconciliation` carries no truncated flag, no read count, and no warning, and neither the
reconciliation route nor the close response mentions it. Both reads truncate in the wrong direction
for their own semantics. The sighting read is `ORDER BY observed_at ASC … LIMIT ?2`, and the
reconciliation's "the LAST observation of each packet wins" rule then operates on the **earliest**
10,000 observations — so a correction recorded as the later, truer sighting is exactly the row that
gets dropped. The expected-packets read is `ORDER BY custody_number ASC … LIMIT ?1`, so packets
beyond the cut are not expected at all and can never be reported missing.

Then `closeCustodyStocktake` computes its frozen counts from that same truncated reconciliation
(`stocktake-service.ts:304`) and writes them onto the stocktake row as the number the firm reports —
the one number the design says "must not have drift under it afterwards".

**Concrete failure.** A firm with more than ten thousand held packets takes a whole-register count.
The reconciliation under-reports missing originals (the packets past the cut are invisible) while
over-reporting others (later corrective sightings past the cut are dropped, so a packet corrected to
"found on shelf B" still reads as misplaced or missing). The firm closes the count, the wrong
numbers are frozen, and nothing in the response or the report says the answer was partial.

**Fix.** Return the truncation as data, not as a comment: have both reads request `limit + 1`,
report a `truncated` boolean (and the applied cap) on `CustodyReconciliation`, and surface it on the
reconciliation route. `closeCustodyStocktake` should refuse to freeze counts drawn from a truncated
reconciliation rather than freeze a partial answer — an abandoned close already exists as the shape
for "this walk did not produce a reportable number". Longer term the sighting read wants
`ORDER BY … DESC` with a per-packet reduction, or a keyset walk, so the last-observation rule is
robust to any cap.

### M4 — A closed stocktake is frozen only by the absence of a re-open statement

**Status: Fixed in #157.** `custody_stocktake_frozen_once_closed` (BEFORE UPDATE on a non-open row) and `custody_stocktake_no_replace` land in `20260806T040000_operational-fixes.sql`; both are additive and rebuild nothing.

**Where.** [`packages/database/drizzle/per-firm/20260908T000000_baseline.sql:17-41`](../../packages/database/drizzle/per-firm/20260908T000000_baseline.sql)
(compare the four triggers at `:77-99`) ·
[`packages/custodian/src/stocktake-statements.ts:88-121`](../../packages/custodian/src/stocktake-statements.ts)

`custody_stocktake_sighting` carries four `RAISE(ABORT)` triggers, including a `BEFORE INSERT` guard
specifically closing the `INSERT OR REPLACE` bypass and a guard refusing a sighting against a
non-open count. `custody_stocktake` — the row that holds the **frozen counts** and the `open` status
those sighting guards key off — carries none. Its only structural constraint,
`custody_stocktake_closure_check`, is satisfied equally by `('open', NULL)` and by
`('closed', <timestamp>)`, so an `UPDATE … SET status='open', closed_at=NULL` passes the schema, and
an `INSERT OR REPLACE` on an existing id would replace a closed count without firing anything.

The freeze is therefore held up entirely by the fact that `closeCustodyStocktakeStatement` is the
only UPDATE anybody has written, guarded by `WHERE … status = 'open'`. That is the "enforced in one
caller, with the other callers standing open beside it" pattern the destruction module explicitly
rejects for itself (`destruction-service.ts:33-54`).

**Concrete failure.** A future repair path, an import, or a hand-run fix re-opens a count that a
firm has already reconciled and reported. The `custody_stocktake_sighting_open_only` trigger — the
one guard the whole design leans on to keep a reconciliation stable once read — now accepts new
observations against it, and the next close overwrites the frozen counts. Every guarantee in the
stocktake changelog entry about numbers that "cannot drift" is at that point a convention.

**Fix.** Two triggers mirroring the sighting table's: a `BEFORE UPDATE` on `custody_stocktake`
aborting when `OLD.status <> 'open'` (a closed or abandoned count is frozen), and a `BEFORE INSERT`
existence guard closing the REPLACE path. Both are additive and need no table rebuild.

### M5 — `overdue=true` on the deadlines list is a UTC-date approximation with no post-filter

**Status: Fixed in #157**, by the second half of the fix shape rather than the first: the narrowing is composed PER ZONE and is exact, so no post-filtering is introduced and the no-post-filter rule the package states elsewhere still holds. `overdueCutoffFor` inverts the comparison for one zone (binary search, because the wall clock is not monotonic across a transition while the instant is non-decreasing in the wall clock), the route reads the distinct zones of the coarse candidate set, and `selectMatterDeadlinesStatement` composes one clause per zone. `test/dst-and-overdue-bound.test.ts` asserts the bound against `isOverdue` itself across both DST boundaries rather than against restated expectations.

**Where.** [`apps/api-worker/src/routes/calendar/calendar.ts:1150-1180`](../../apps/api-worker/src/routes/calendar/calendar.ts) ·
[`packages/calendar/src/overdue.ts:34-39`](../../packages/calendar/src/overdue.ts)

The handler composes `overdue=true` as `state = 'open' AND due_on <= today`, where `today` is
`new Date().toISOString().slice(0, 10)` — a UTC civil date. The genuine overdue test lives in
`isOverdue`, which resolves each row's due instant **in that row's own zone** and, for a deadline
with no time, at the end of its civil day. The rows are then mapped through `deadlineDetail(row,
now)` with no filter applied to the result set. The comment says the narrowing "composes both halves
into SQL", but the second half is only an approximation of the real predicate.

**Concrete failure.** At 2026-08-06T11:00Z a Nevada firm asks for its overdue deadlines. A deadline
due `2026-08-06` in `America/Los_Angeles` with no recorded time is not due until
2026-08-07T06:59:59.999Z — a full working day away — but `due_on <= '2026-08-06'` matches, so it is
returned on the overdue list. The consumer sees today's live deadlines reported as already missed,
which is precisely the failure `endOfCivilDayInstant` was written to prevent one row at a time. The
error also eats the page: non-overdue rows consume slots and drive `hasMore`, so a firm can page
through an "overdue" list that is mostly not.

**Fix.** Keep the SQL narrowing as the coarse pre-filter (it is a legitimate index-friendly
superset — widen it by one day on the lower edge for the far-eastern zones) and then apply
`isOverdue` to the returned rows before assembling the page, over-reading enough to fill it. If the
per-row filter is unacceptable on the hot path, the honest alternative is to return the computed
`overdue` flag per row and stop advertising `overdue=true` as a filter.

### M6 — Two event reads bypass the visible-matter seam entirely

**Status: Fixed in #157**, and widened past the two reads named. The predicate is now a REQUIRED argument on every statement builder that selects from `matter_event` or `matter_deadline`, and `CalendarServiceOptions` carries it, so the id-addressed write paths inherit it too. `test/visibility-fitness.test.ts` enumerates every such read, asserts the marker, and scans the two statement files so a read added later fails the count until it is listed.

**Where.** [`apps/api-worker/src/routes/calendar/calendar.ts:1011-1031`](../../apps/api-worker/src/routes/calendar/calendar.ts)
(`readEventsPage`) and `:1079-1110` (`GET /api/v1/events/{eventId}`) ·
[`packages/calendar/src/event-statements.ts:169-188`](../../packages/calendar/src/event-statements.ts)

`visibility.ts` states the seam's whole value proposition: "When an information-barrier overlay is
built, it is ONE MORE CLAUSE in this one predicate, and every registered source inherits it without
being touched." Every timeline source does inherit it — `boundedSelect` composes it structurally and
a source cannot decline. But `GET /api/v1/matters/{matterId}/events` and
`GET /api/v1/events/{eventId}` read `matter_event` directly:
`selectMatterEventsStatement` composes `matter_id = ?1` and no predicate, and the single-event read
resolves by id with no matter check at all. `RouteMeta.resource` does not gate anything — it is
emitted as the `x-mc-resource` contract annotation
([`apps/api-worker/src/contracts/route-meta.ts:24`](../../apps/api-worker/src/contracts/route-meta.ts)) and
the chokepoint performs no per-matter check — so declaring these routes `resource: "matter"` buys
no enforcement.

**Concrete failure.** Today the impact is confined: the sole clause the predicate carries excludes
the platform-owned holding matter, and nothing records events against it. The failure is
prospective and structural — the day the barrier overlay lands as "one more clause", these two reads
ship with the barrier off, and `GET /api/v1/events/{eventId}` is the read that returns an event's
title, description, court reference, and full participant list to any member with `calendar:read`.
The overlay would be built and believed complete because the seam's own documentation says every
read inherits it.

**Fix.** Route both reads through the predicate: give `selectMatterEventsStatement` the same
required `visibilityFragment`/`visibilityBindings` pair `selectMatterDeadlinesStatement` already
takes (`deadline-statements.ts:196-242`), and wrap the single-event read in an
`EXISTS`-over-`matter` check so an invisible matter's event is a 404. A fitness test asserting that
every statement in the package touching `matter_event` or `matter_deadline` carries
`VISIBLE_MATTER_MARKER` would keep the seam honest against the next direct read.

---

## Low

### L1 — The will-deadline calculator conflates "no computable deadline" with "bad trigger date"

**Status: Fixed in #157.** `custody-invalid-trigger-date` is a new, distinct refusal; only a bare `YYYY-MM-DD` is accepted, round-tripped through `Date.UTC` so an impossible date refuses rather than rolling over; `null` now means only "this duty has no computable interval".

[`packages/custodian/src/will-deposit-catalog.ts:340-351`](../../packages/custodian/src/will-deposit-catalog.ts).
`custodyWillDeliveryDueDate` returns `null` for three different things: a duty whose basis is
`setByCourtOrder`, a duty whose basis is `concurrentWithFiling`, and a `triggerDate` the regex could
not read. The module's own doctrine (`:6-11`) is that two refusals fixed differently must never be
conflated — this is that mistake inside the module that names it. Separately the regex
`^(\d{4})-(\d{2})-(\d{2})` accepts an impossible date and `Date.UTC` silently rolls it over: a
trigger date of `2026-02-31` yields a due date of `2026-04-02` rather than a refusal, in a function
whose output is a statutory deadline. It also takes the leading date of any longer string, so
`2026-08-05T23:00:00-07:00` is read as the 5th though its offset makes it the 5th only in UTC.

**Fix.** Throw `CustodyValidationError` on an unparseable or impossible trigger date (round-trip
through `Date.UTC` the way `assertCivilDate` in the calendar does at
[`packages/calendar/src/validation.ts:80-88`](../../packages/calendar/src/validation.ts)), accept
only a bare `YYYY-MM-DD`, and reserve `null` for "this duty has no computable interval".

### L2 — The verified negative rides a boolean rather than the prose

**Status: Fixed in #157.** `summary` is replaced by `question` + `answer`; the Nevada entry's answer reads "No. Nevada provides no procedure for depositing a will with a court for safekeeping during the testator's lifetime."

[`packages/custodian/src/will-deposit-catalog.ts:175-187`](../../packages/custodian/src/will-deposit-catalog.ts) ·
schema at [`apps/api-worker/src/routes/custody/custody.ts:1045-1053`](../../apps/api-worker/src/routes/custody/custody.ts).
The lifetime-deposit capability is encoded with `available: false` and a genuinely excellent `basis`
recording the exhaustiveness of the search. But its `summary` reads "Depositing a will with a court
for safekeeping during the testator's lifetime." — an affirmative description. A surface that renders
`capabilities[].summary` in a list, as surfaces do, shows Nevada offering lifetime court deposit; the
negation lives only in a sibling boolean. Given that the entry exists specifically because
never-enacted uniform-act deposit language circulates as though it were Nevada law, the shape invites
back exactly the error it was written to prevent.

**Fix.** Make the negation unmissable in the text itself — either phrase `summary` as the answer
("Nevada provides no procedure for depositing a will with a court during the testator's lifetime")
or split the field into `question` and `answer` so no rendering can show one without the other.

### L3 — A wall-clock time in a spring-forward gap resolves an hour early, contrary to its own comment

**Status: Fixed in #157**, and the finding understated it: `Math.min` also resolved every unambiguous wall clock in the hour AFTER a fall-back an hour early (02:14 PST became 01:14 PST), which is a whole hour every autumn rather than an edge case. Resolution is now candidates plus a round trip — a repeated hour takes its first occurrence, a time after a transition takes itself, a skipped time moves forward — and `endOfCivilDayInstant` is correct in the midnight-transition zones. Both DST cases have their own named tests.

[`packages/calendar/src/time-zone.ts:69-93`](../../packages/civil-time/src/time-zone.ts) (the module has since moved to `packages/civil-time/`).
`instantForCivilDateTime` documents that a non-existent wall-clock time "resolves to the instant the
clock reached instead", but it returns `Math.min(firstPass, secondPass)`. Worked through for
`2026-03-08 02:30` in `America/Los_Angeles`: the first pass lands at 10:30Z and the second at 09:30Z,
and the minimum — 09:30Z — renders back as **01:30 PST**, an hour before the requested time, not the
03:00 PDT the comment promises. `assertWallClockTime` does not refuse a skipped time, so the row is
storable. `endOfCivilDayInstant` inherits the same arithmetic and is exposed wherever a zone's DST
transition happens at midnight (America/Santiago, America/Havana have both done so), where "the end
of the 14th" would land at 22:59:59.999 local rather than 23:59:59.999.

**Fix.** Either make the code match the comment (take the later instant on a gap and keep `min` only
for the autumn repeat — the two cases are distinguishable by whether the passes disagree in the
direction of the offset change), or refuse a skipped wall-clock time at the write, which is
defensible for a docket. Whichever, the two DST cases deserve their own named tests; the current
comment reads as though they have them.

### L4 — The keyset cursor's wire contract is hand-rolled in two route sites

**Status: Fixed in #157.** Both sites call `encodeCursor`.

[`apps/api-worker/src/routes/calendar/calendar.ts:1028`](../../apps/api-worker/src/routes/calendar/calendar.ts) and `:1171`
write `btoa(JSON.stringify({ c: …, i: … }))` directly. That is byte-identical to `encodeCursor`
today ([`packages/data-access/src/cursor-pagination.ts:20-22`](../../packages/data-access/src/cursor-pagination.ts)),
so nothing is broken — but the calendar's own gotcha says "the calendar mints no wire contract of its
own", and the cursor module's header says the encoding "must stay byte-identical so a cursor minted
by one deploy still decodes on the next". Two hand-rolled copies are two sites that will not move
when the encoding does. **Fix:** import `encodeCursor`.

### L5 — Jurisdiction lookup is exact-match with a refusal that reads like a verdict

**Status: Fixed in #157.** The key is uppercased, trimmed, and underscore-normalized before lookup, and the ancestor probe walks every hyphen segment upward until an encoded ancestor is found.

[`packages/custodian/src/will-deposit-catalog.ts:294-305`](../../packages/custodian/src/will-deposit-catalog.ts).
`BY_KEY.get(key)` is case-sensitive and shape-sensitive, so `us-nv` and `US_NV` produce
`custody-jurisdiction-not-encoded` with the message "no verified will-deposit duties are encoded for
us-nv: … there is no baseline to fall back to". For a catalog whose entire posture is that a firm
must be able to tell "nobody researched this" from "this does not apply", answering a typo with the
former is a small but real dishonesty. The parent probe is also one level only
(`key.slice(0, key.lastIndexOf("-"))`), so `US-NV-08-CLARK` correctly names `US-NV-08` but a
two-level-deep miss loses the "the wider jurisdiction is encoded" half of the message.
**Fix:** normalize the key (uppercase, trim) before lookup and walk the hyphen segments upward until
an encoded ancestor is found or none is.

### L6 — `readCustodyHoldingsByOwner` does unbounded work behind a bounded result

**Status: Fixed in #157.** The correlated subquery is replaced by pre-aggregated per-packet item and hold counts joined against DISTINCT (entity, packet) owner pairs, so the plan is one pass and the grain cannot inflate a count.

[`packages/custodian/src/reports.ts:42-72`](../../packages/custodian/src/reports.ts).
`items_described` is a correlated subquery evaluated per group, and the `LIMIT ?1` applies after
`GROUP BY` and `ORDER BY` — so the subquery (itself an `IN (SELECT …)` over `custody_owner`) runs
once for **every owner entity in the firm**, not once for the fifty rows returned. The file's own
header rule is "every aggregate is ONE query", which it satisfies textually while the work scales
with the register. **Fix:** replace the correlated subquery with a joined aggregate over
`custody_item` grouped by `entity_id`, or a `LEFT JOIN` to a derived per-owner item count, so the
plan is one pass.

### L7 — An interrupted destruction leaves an "approved" request no read can distinguish from a pending one

**Status: Fixed in #157.** `outcome=interrupted` on the destruction-request list pairs each `approved` request against a `destroyed` movement on the same packet recorded at or after the approval.

[`packages/custodian/src/destruction-service.ts:319-397`](../../packages/custodian/src/destruction-service.ts).
The two-commit ordering is right and the reasoning for it is right: the ledger row commits first, so
a failure between the commits leaves a proven destruction and a request stuck at `approved`. The
comment says such a request is "visible and correctable" — but nothing surfaces it as distinct.
`listCustodyDestructionRequests` filtered to `outcome = 'approved'` returns both the requests
genuinely awaiting execution and the ones already carried out, and the only distinguishing fact —
whether a `destroyed` movement naming that packet exists — is in a table the query never joins.
**Fix:** a reconciliation read (or a filter on the existing list) that pairs `approved` requests
against `custody_movement` rows of kind `destroyed` on the same packet since the approval, so the
stuck ones are a list somebody can open rather than a state somebody has to go looking for.

---

## What was checked and holds

Recorded so the next pass does not re-derive it.

- **The stocktake observe-only boundary is real, not aspirational.** Every statement in
  `stocktake-statements.ts` targets `custody_stocktake` or `custody_stocktake_sighting`;
  `stocktake-reconciliation.ts` issues only `SELECT`s and returns corrective movements as
  `proposedMovementKind` on a report; a `missing` line proposes nothing. `test/purity.test.ts:88-108`
  scans the stocktake sources (comments stripped first, so the prose explaining the rule cannot pass
  the scan) for register mutations, status/location/ledger writers, and any destruction identifier.
  There is no path from a count to a register write.
- **Destruction's two-person control is genuinely two authenticated actions.** `approveCustodyDestruction`
  reads `options.actorUserId`, which the route derives from `requireChokepointUserId`, never from the
  body; it refuses `approver === requested_by` **and** the null-requester case the column CHECK cannot
  see; and the trigger pair behind it enforces the same. This is the correct model, and it is the
  contrast that makes H1 a finding rather than a preference.
- **The intrinsic-value refusal has no reachable override.** Enforced in `destruction-service.ts`
  (at request, at approval, and again at execution), independently in `movement-service.ts:368-386`
  so the workflow is not the only guarded door, and by triggers at the database. A packet-scoped
  request is refused when any item carries the flag; an item-scoped one checks that item, and both
  the movement path and the request path first assert the item belongs to the named packet, so the
  item-scoped check cannot be pointed at another packet's item. No parameter, flag, or second route
  reaches past it.
- **The close advisory cannot become a refusal or a leak.** `close-advisory.ts` implements
  `CloseAdvisory` (a `notice`) and not `ClosePrecondition`; it returns a count and a fixed sentence
  with no custody number, packet name, owner, or identifier of any kind.
- **Every timeline source composes the visibility predicate, and cannot decline to.** `boundedSelect`
  pushes `request.visibility.fragmentFor(...)` into the WHERE clause before the `LIMIT` for all
  fourteen statements across the thirteen sources; the predicate is a required field on
  `SourceReadRequest`, so omission is a type error. Every statement also carries the keyset predicate
  and a `LIMIT`.
- **The mixed civil-date / instant sort key is correct in both directions.** Worked through at a day
  boundary: ascending, a cursor of `2026-08-05` correctly admits `2026-08-05T09:00:00.000Z`;
  descending, a cursor of `2026-08-05T09:00:00.000Z` correctly admits `2026-08-05`. The
  `(sortKey, rowId)` tiebreak is total and consistent between the merge and every source's keyset
  predicate, including across sources whose identifier prefixes differ.
- **The audit-log allowlist is tight.** Four frozen keys, bound as parameters; without a matter in
  scope the read is confined by `subject_id LIKE 'matter\_%' ESCAPE '\'`, and because the identifier
  prefix is exactly `matter` (`packages/identifiers/src/registry.ts:10`) with `_` escaped, the
  pattern admits `matter_…` and excludes `matterEvent_…`, `matterDeadline_…`, and
  `matterEventType_…`. The source declares no label and projects `NULL`.
- **Nothing writes overdue or missed.** `overdue.ts` is two pure functions; no column, no sweep, no
  state transition exists for it anywhere in the package. (M5 is about a route's filter, not about
  stored state.)
- **Append-only holds where it is claimed.** `custody_stocktake_sighting` carries update, delete, and
  REPLACE-bypass triggers plus a closed-stocktake guard; `custody_movement` carries the same three
  plus the three release-gate triggers; `recordCustodyMovement` composes
  `assertCustodyPacketStatusStatement` (and its item twin) first in the batch so a read-then-write
  precondition rides the write. The `custody_stocktake` parent row is the exception — see M4.
- **Redaction holds across both packages.** `custodyAuditStatement` call sites carry identifiers,
  booleans, and counts only; the calendar's audit metadata carries matter identifiers, the closed
  source vocabulary, and the before/after due dates, and never a title, description, court reference,
  participant name, authority note, or state reason. Timeline labels are the declared non-privileged
  ones: an email's subject is `NULL` with the decision stated, a time entry projects its duration and
  not its narrative.
- **Cross-firm scoping.** Every handler in both route files resolves its database through
  `requireChokepointFirmContext(c).firmDatabase`; no query in either package takes a firm identifier
  or crosses a database. The will-deposit catalog is compiled reference data with no database access
  at all.
- **Idempotency.** Every mutating route in both files declares `idempotency: "required"` with
  `idempotencyStore: "firm"`, and the chokepoint owns the whole gate for those
  (`apps/api-worker/src/chokepoint/chokepoint.ts:219-283`), so a retry replays the stored response rather
  than re-executing. The movement and sighting paths additionally thread `runIdempotentEffect` so the
  record commits inside the business batch. Read routes are `optional`, correctly.
- **Bounded fan-out, not N+1.** The timeline's read count scales with the registry (thirteen sources,
  fourteen statements) and the two join-reached sources pre-read once per page under explicit
  `LIMIT`s. The stocktake reconciliation reads the register once and chunks its by-identifier lookup
  at 200 parameters. The location occupancy report is two queries and an in-memory walk with a cycle
  guard. `reports.ts` holdings-by-owner is the one exception — L6.

## Not covered

- `packages/matter-assets/` — not merged; design note only.
- The Svelte surfaces over any of this (UI is parked per the current snapshot).
- Load-profile measurement: no harness was run, so every performance finding here is a plan-reading
  argument, not a measurement. M3 and L6 in particular should be confirmed against the fixtures
  before the fix shape is settled.
- Test coverage quality. The fitness tests were read to confirm what they actually enforce (cited
  above where they do real work); the behavioural tests were not audited for gaps.
