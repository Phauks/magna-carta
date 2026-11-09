# Conflicts read surface — design

**Date:** 2026-09-02
**Status:** Both questions answered by the owner on 2026-09-02 — Q1 `conflicts:read`, Q2 option (c).
**All six reads are built.** `conflicts-gaps.ts` is down to the one entry this design excluded: the assembled report document (section 9).
**Scope:** The **reads** the conflicts screens are already built against and the contract does not
serve. Six of them, each named today in
[`apps/web/src/lib/conflicts/conflicts-gaps.ts`](../../apps/web/src/lib/conflicts/conflicts-gaps.ts)
and rendered as a disabled affordance saying what it waits on.
**Excludes:** the matching engine, the graph expansion, imputation, the disposition writes and the
append-only log — all shipped, all tested, none of them changed by this. Also excludes the
pre-engagement screen (a check with no matter to raise an event about) and the assembled report
document, which are their own work and are named in section 9.

**Binding inputs, in order of authority:**

- The append-only rule on the three log tables
  ([`per-firm-schema.ts`](../../packages/database/src/per-firm-schema.ts)) — no UPDATE and no DELETE
  ever touches `conflicts_check`, `conflicts_hit` or `conflicts_disposition`, enforced by
  `RAISE(ABORT)` triggers and probed at runtime by `assertConflictsFitness`. Every read here is a
  read; nothing in this design writes to the log.
- The existing gap register — the seven entries in `conflicts-gaps.ts`. Six are reads and are this
  design; the seventh (`reportDocument`) is section 9.
- The standing rulings in [`design-corrections.md`](../conventions/design-corrections.md), and the
  professional-responsibility posture the surface already takes: a value that cannot be read says
  what it waits on, and never renders as absence.
- ADR-0013 (the conflicts subsystem) and
  [`2026-07-09-slice-4-1-conflicts-design.md`](2026-07-09-slice-4-1-conflicts-design.md).

---

## 1. What this is, in one paragraph

The conflicts engine is built. A firm can run a check, the engine walks the Directory graph and the
firm's own members, and every candidate it surfaces is written to an append-only log along with the
scope that actually ran. A reviewer can answer a hit, and that answer is appended too. What a
reviewer **cannot** do today is read most of it back: the hit list cannot name the party that
matched, the firm cannot see the checks it has run, a hit shows only its latest word rather than the
trail, and the firm's own policy floor is unreadable from the screen that is judged against it. This
design is the six reads that close that, and one finding that makes the first of them much smaller
than the gap register assumes.

## 2. The finding: the batch machinery already exists

`conflicts-gaps.ts` says the Party column waits on "a read that names many Directory entities in one
request, so a hit list can say who matched without one request per row".

**That read exists.** `readSubjectFactsBatch`
([`subject-facts.ts`](../../packages/conflicts/src/subject-facts.ts)) takes a set of entity ids and
returns each one's kind and current name parts, in one query per node table per hundred ids —
chunked at `MAX_SUBJECT_BOUND_PARAMETERS`, mirroring D1's bound-parameter cap. It skips an id whose
row is absent rather than failing the whole read. It is used on the WRITE path, by the matcher, to
seed a check.

So the Party column is not blocked on new machinery. It is blocked on the check read not
**projecting** what the check already knows how to fetch: `GET /conflicts/checks/{checkId}` selects
`entity_id` from `conflicts_hit` and puts it on the wire unresolved
([`conflicts.ts:128`](../../apps/api-worker/src/http/routes/directory/conflicts.ts)).

**Consequence for the build order:** gap 1 is an enrichment of an existing response, not a new
endpoint. That matters beyond effort — a second endpoint returning names for a set of entity ids
would be a general Directory batch read reachable with `conflicts:read`, which is a wider grant than
this surface needs and a worse thing to own.

## 3. The six reads

Each names the gap entry it removes. Nothing else in the surface changes when one lands.

### 3.1 The matched party's name — `matchedPartyName`

**Shape:** not a new route. `GET /conflicts/checks/{checkId}` resolves every hit's `entity_id`
through `readSubjectFactsBatch` and adds a `party` object to each hit: the display name and the kind
(person or organization).

**Bounded by construction.** The hit set is one check's hits, already read in full to build the
response, so the entity set is bounded by that same set and the batch read chunks it.

**An unresolved entity is stated, never blank.** An entity whose row the batch read did not return is
a real outcome — the Directory hard-deletes nothing, but a merge resolves a subordinate away, and the
log is append-only so an old hit can name an entity the Directory has since reshaped. The hit carries
`party: null` and the column says the entity could not be resolved, naming the id. It must never read
as "no party matched", which is the opposite of what a conflicts hit means.

### 3.2 The adjudication trail — `adjudicationTrail`

**Shape:** `GET /api/v1/conflicts/hits/{hitId}/dispositions` on `conflicts:read`. Every disposition
recorded against the hit, oldest first, each with its kind, rationale, reviewer and instant, and the
waiver record where the kind is `waiver_obtained`.

**Why it is a route and not another enrichment.** `readCurrentDisposition` and
`readHitDispositionStates` already resolve the latest word, which is what a list needs. The trail is
the whole history and is read one hit at a time, when a reviewer opens it. Putting every disposition
of every hit on the check response would grow the list read by the one thing only the detail view
uses.

**This is the compliance artifact.** The schema comment is explicit that a reviewer who clears a hit
and later reverses must leave both acts visible — a reversal is a second row, never an edit. A trail
read that showed only the latest word would defeat the reason the table is append-only.

### 3.3 The firm's conflicts policy — `firmPolicy`

**Shape:** `GET /api/v1/firm/conflicts-policy`. `readConflictsPolicy`
([`settings.ts`](../../packages/conflicts/src/settings.ts)) already resolves it, including the union
that puts the party class back into the floor on every read so a stored policy cannot drop the
firm-wide corpus. This is that function behind a route.

**Open question on the permission — see section 8, Q1.** The read tells a member what the firm's
floor is, which is not sensitive; a WRITE would be an administrative act on the same key family as
`firm:manageScanPolicy`. This design builds the read only.

### 3.4 The firm's check history — `checkHistory`

**Shape:** `GET /api/v1/conflicts/checks`, a keyset-paginated listing on `conflicts:read`, newest
first, filterable by `matterId`.

**The matter-filtered read is index-served and the unfiltered one is not.** The table carries
`conflicts_check_subject_matter_created_id_index` on `(subject_matter_id, created_at, id)` — leading
with the matter, which is what confines the walk. An unfiltered firm-wide listing has no index
leading with `created_at` and will plan a scan of every check the firm has ever run.

**So this read is measured before it ships**, against the load-profile harness, exactly as the matter
search's sources were — that gate found a full table scan in the parties source that no amount of
reading the SQL had. If the unfiltered listing scans, the answer is an index on `(created_at, id)`
added with this read, not a note to revisit.

### 3.5 A re-surfaced hit's earlier conclusion — `previouslyConcluded`

**Shape:** part of the check response. Each hit carries whether an EARLIER check surfaced what is
recognisably the same hit, and how that one was answered.

**This is the read with a real design question in it — see section 8, Q2.** "The same hit" is not
defined by the schema. Two hits in different checks share an `entity_id`, but a hit is also a
`source_class`, an `evidence_tier`, a matched-field set and a graph path, and two of those can differ
while the conflict is plainly the same one. Getting it wrong is not a display bug in either
direction: too loose and a reviewer is shown a clearance that answered a different conflict, too
tight and they re-adjudicate something the firm already decided and the record grows two answers to
one question.

### 3.6 Re-check this matter, on demand — `rescanNow`

**Shape:** `POST /api/v1/matters/{matterId}/conflicts-rechecks` on `conflicts:run`.

**The machinery is built and has no door.** `recheck-request.ts`, `recheck-run.ts` and
`readOpenRecheckRequestsForMatter` already serve the event-driven and scheduled paths; this is a
person asking for one now. It is a WRITE (it enqueues a run), so it is `conflicts:run`, not
`conflicts:read` — the only one of the six that is not a read, kept here because it is the last
disabled affordance on the same screen.

**Idempotency.** It rides the platform's `Idempotency-Key` chokepoint like every other write, so a
double-press does not produce two checks and two log rows.

## 4. What the whole thing costs

| #   | Read                 | New route                    | Blocked on an answer              |
| --- | -------------------- | ---------------------------- | --------------------------------- |
| 1   | Matched party name   | no — enriches the check read | no                                |
| 2   | Adjudication trail   | yes                          | no                                |
| 3   | Firm policy          | yes                          | Q1 (permission only)              |
| 4   | Check history        | yes                          | no — but must clear the plan gate |
| 5   | Previously concluded | no — enriches the check read | **yes, Q2**                       |
| 6   | Re-check on demand   | yes                          | no                                |

Four are buildable now. One waits on a permission answer that does not block its shape. One waits on
a real ruling.

## 5. Build order

1. ~~**The matched party name.**~~ **BUILT.** It cost no new machinery, as section 2 predicted, and
   it removed two reads rather than adding one: the check handler was resolving dispositions with a
   per-hit `readCurrentDisposition` inside a `Promise.all` — the exact N+1 `readHitDispositionStates`
   was written to replace, and whose own comment names that shape as the mistake — and the checks
   screen was spending a Directory read per hit a reviewer opened. Both are gone; the handler makes
   two set-valued reads. The printed report gained the most: it could previously only name a party a
   reviewer had opened, so every other candidate printed as a raw handle on the document a firm hands
   a court.
2. ~~**The adjudication trail.**~~ **BUILT.** `GET /api/v1/conflicts/hits/{hitId}/dispositions`, on
   `conflicts:read`, oldest first. The hit's existence IS checked here — unlike the matter posture
   read, and for the opposite reason: "no such hit" is not a state with a meaning of its own, so an
   empty trail has to mean "nobody has answered this hit" and nothing else. The conformance gate
   caught a real contract bug on the first emit: reusing `DispositionDetail` registered one component
   name under two shapes, because the check response uses it as `.nullable()` and zod-to-openapi
   carries the name onto the nullable schema. A trail entry is now its own component, which is also
   the honest reading — there, null means unanswered; here every entry is an act that happened.
3. ~~**Re-check on demand**, then **firm policy**.~~ **BOTH BUILT.**
   `POST /api/v1/matters/{matterId}/conflicts-rechecks` takes **no scope**, and that is why it exists
   beside the general check route rather than being a call to it: "re-check this matter" has no scope
   for a caller to state, and asking for one invites a screen to compose a narrower search than the
   firm requires. It names no subjects either — `runConflictsCheck` reads the matter's live parties,
   so a party added since the last check is searched without anybody listing them. It is recorded as
   a manual run naming the member who asked, carries no cause, and neither reads nor satisfies the
   automatic re-check ledger: an open cause stays open, because the interval between a cause and the
   check that answered it is evidence about the firm's procedure and a manual run did not answer it.
   `GET /api/v1/firm/conflicts-policy` is `readConflictsPolicy` behind a route, on `conflicts:read`
   per Q1. The check runner now STATES the floor instead of marking it unreadable.
4. ~~**Check history**, behind its load-profile measurement.~~ **BUILT, and the measurement was
   right.** Section 3.4 predicted the unfiltered listing would plan a full table scan, and the plan
   probe measured exactly that on the first run — `conflicts.check-history-firm-wide` came back as a
   scan of `conflicts_check`. The answer was the index this design named in advance:
   `conflicts_check_created_id_index` on `(created_at, id)`, added in the same change rather than
   noted for later. Both shapes of the read are now probed, because they plan differently and only
   the matter-filtered one was ever served.
5. ~~**Previously concluded**, once Q2 is answered.~~ **BUILT, under ruling (c).** `readPriorConclusions`
   matches on the entity alone across every check but the one in hand, and the check response carries
   it as `previouslyAnswered` — a field deliberately separate from `disposition`, so a hit with an
   earlier answer about the same party is still UNANSWERED. It needed a second index:
   `conflicts_hit` carried only `(check_id)`, so matching a party across earlier checks scanned an
   append-only table, and `conflicts_hit_entity_created_index` holds it. Both narrower keys were
   rejected on the same case rather than a different one — source class would hide the September
   hit precisely because it arrived through the graph, and evidence tier would make a firm turning
   on the over-inclusive band look like a new conflict.

Each step is a vertical slice — data access, route, contract, client, tests, docs — and each one
deletes its entry from `conflicts-gaps.ts` and nothing else.

## 6. What does not change

The engine, the expansion, the imputation, the matching bands, the disposition writes, the three log
tables and their triggers. This design adds no column, no table and no trigger. Every read is a read.

## 7. Testing

- **The append-only guarantee stays probed.** `assertConflictsFitness` runs at runtime and
  `conflicts-append-only.test.ts` holds the triggers; neither changes, and both must still pass.
- **Every new route gets a conformance entry.** The api-worker conformance suite asserts each
  operation id and its permission binding; a route added without one fails it.
- **The unresolved-entity path is tested, not assumed** — a hit whose entity the batch read does not
  return must render as unresolved and never as absence.
- **The check history is plan-gated** before it ships, per 3.4.

## 8. Questions for the owner

**Q1 — who may read the firm's conflicts policy? ANSWERED (owner, 2026-09-02): `conflicts:read`.**
Everyone who can read a conflicts check can read the policy that check was judged against. No new
permission key. The read says what the firm's floor is — which source classes are mandatory, the
balanced band's name roles, the edge-class budgets — which is not client data, and every member is
held to it.

**Q2 — when is a re-surfaced hit "the same hit" as one already answered? ANSWERED (owner,
2026-09-02): option (c).** An earlier answer about the same entity is shown as CONTEXT and linked; a
hit is never marked pre-concluded, nothing is pre-filled and nothing is suppressed. The reasoning the
ruling was made on is kept below, because the case is what makes the rule readable.

### The case that decides it

**Check 1 — 14 March 2026.** The firm opens _Herrera v. Coastal Holdings, LLC_ and acts for Herrera.
A hit surfaces **Coastal Holdings, LLC**: `source_class: party`, `evidence_tier: 1` (exact
identifier), `graph_path: []` — the opposing party is in the Directory because the firm acted FOR
Coastal once, on a commercial lease that closed in 2019. A. Whitfield answers it `cleared`:
_"Former client. Representation concluded 2019 on an unrelated commercial lease; no confidential
information material to this dispute."_ That is a Rule 1.9 judgment about a **former** client.

**Check 2 — 2 September 2026.** The same matter re-checks because a party was added: **Marchetti
Capital Partners** joins as a co-defendant. The firm has a live retainer with Marchetti on another
matter. `expandGraph` walks Marchetti Capital → subsidiary → **Coastal Holdings, LLC**, which
Marchetti owns.

Coastal Holdings surfaces again — the same `entity_id`, and nothing else the same:
`source_class: graph`, `evidence_tier: 3`, `graph_path: [Marchetti Capital -subsidiary-> Coastal
Holdings]`.

**The two hits ask different questions about the same company.** March asked whether the firm may act
adverse to a former client. September asks whether the firm may act adverse to the subsidiary of a
**current** client — a Rule 1.7 question, on a materially higher bar and far less freely waived.

Now what each option does with it:

- **(a) same entity + same source class** — no match (`party` then `graph`). The reviewer is shown
  nothing and answers from scratch. Correct outcome here; the cost is that the firm ends with two
  unlinked answers about Coastal Holdings and nothing on the record connecting them.
- **(b) same entity only** — match. The September hit is marked previously concluded and shows
  _"Cleared, A. Whitfield, 14 March 2026 — former client, unrelated matter."_ **This is the failure.**
  A Rule 1.9 clearance is carried onto a Rule 1.7 question, and the screen presents it as the firm's
  own prior answer to the hit in front of the reviewer.
- **(c) same entity, shown as context** — the panel says _"Coastal Holdings, LLC was answered before:
  cleared by A. Whitfield on 14 March 2026"_ and links that check. The hit is NOT marked concluded,
  nothing is pre-filled, nothing is suppressed. The reviewer still has to answer it, and now answers
  it knowing the history.

The mirror case matters too, and it is why (a) is keyed on the source class rather than on the whole
hit. In the same re-check, **Dana Reyes** surfaces at `evidence_tier: 2` in March and
`evidence_tier: 3` in September, because the firm turned the over-inclusive band on in between — same
party, same channel, different evidence. Keying on the tier as well would call that a different hit
and make a settings change look like a new conflict.

### The three candidates

Narrowest first:

- **(a) Same entity, same source class.** The conflict came from the same place about the same party.
  Misses a party that was reached directly last time and through the graph this time — arguably the
  same conflict, differently evidenced.
- **(b) Same entity only.** Broadest. Shows the earlier answer whenever the same party surfaces
  again, whatever the route. Risks presenting a clearance that answered a genuinely different
  conflict — the party was cleared as a co-party once, and now surfaces as a prior client.
- **(c) Same entity, and the earlier hit is shown as CONTEXT rather than as an answer.** The hit is
  never marked pre-concluded; the panel says "this party was answered before" and links the earlier
  check, leaving the reviewer to decide whether it is the same question.

**Why (c), on the case above.** The Coastal Holdings case is not exotic — a corporate group where the firm
has acted for one member and is now adverse to another is among the commonest ways a conflict
re-surfaces wearing a different face. (b) gets that case wrong in the dangerous direction. (a) gets
it right, but only by accident of the source class differing; change the facts so the second hit also
arrives through `party` and (a) presents the same stale clearance (b) does.

(c) is the only one whose behaviour does not depend on the machine having correctly judged that two
conflicts are the same question — it never claims they are. It shows the reviewer what the firm said
before and leaves the judgment where the log already puts it: with a named person, in a disposition
row.

## 9. What this design deliberately does not do

- **The pre-engagement screen** — the check run before a matter exists, at intake, against a
  prospective client. `conflicts_check.subject_matter_id` is already nullable and the schema comment
  already names the case, so the log is ready for it; what is missing is the trigger (every one today
  rides a Directory outbox topic and there is no matter row to raise an event about), the subject
  shape, and an answer to what becomes of a screen against somebody the firm then declines. Its own
  design.
- **The assembled report document** — `report-text.ts` renders the plain-language statement today and
  the gap register wants it filed as a document through the document-assembly arm. Deliberately after
  this: a report that cannot name the matched parties (3.1) or show the full trail (3.2) would be
  filed incomplete, and a filed document is the one artifact that cannot be quietly corrected later.
- **Any widening of what a check searches.** Beider-Morse, document-content scanning and the
  strictness/depth screens are all named on the roadmap and none of them is a read.
