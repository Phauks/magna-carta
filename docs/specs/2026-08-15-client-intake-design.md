# Client intake / CRM — design

**Status:** Design only. No code, no schema, no migration, no route. Seven of the thirteen owner
flags in this document decide **what gets built**; the implementation plan beside it
([`2026-08-15-client-intake-implementation-plan.md`](2026-08-15-client-intake-implementation-plan.md))
does not start until those seven are answered.

**Owner-flag series: `J`.** Numbered in its own letter series so an answer to an intake question can
never be mistaken for an answer to a payments (`K`), trust (`T`), discovery (`P`), notifications
(`N`) or other design's flags.

**White paper:** _Client intake / CRM_, read with _Matters and File Manager_, _Directory_,
_Conflicts Check_ and _Communications layer_. **Binding decisions:** ADR-0080 (the matter lifecycle
and what a consultation is), ADR-0079 (the number is drawn at open), ADR-0013 (conflicts posture),
ADR-0085 / ADR-0086 / ADR-0087 (the Directory graph, its conflicts seams, and the custom-fields
engine), ADR-0052 (absence-not-existence and the host split), ADR-0040 (the settings registry),
ADR-0003 (firm-scoped data access). **Invariants:**
[`packages/conflicts/CLAUDE.md`](../../packages/conflicts/CLAUDE.md),
[`packages/directory/CLAUDE.md`](../../packages/directory/CLAUDE.md),
[`packages/matters/CLAUDE.md`](../../packages/matters/CLAUDE.md).

**The shape of this document.** Intake is the last major gap between subsystems that already exist.
Almost nothing here is invention; the work is deciding **which existing record a thing is** and
**which existing seam it commits through**. Where this design proposes a new table it says why no
existing one will carry the fact, and there are only two.

---

## 1. What is already built, and what the ledger got wrong

Seven capabilities sit in the feature ledger under `intake`, all `not-started`. Five of the seven
evidence lines are accurate. Two describe a repository that stopped existing.

**`intake.conflict-check` said "Directory captures entities today, but no conflicts check exists to
trigger." That is false in both halves of the sentence that matters.** `packages/conflicts` is on
`main`: the check orchestrator (`src/run-check.ts`), the reporting posture (`src/posture.ts`,
`src/report-text.ts`), the four blocking channels through the Directory corpus, the append-only
three-table log plus the disposition stream, the event-driven re-check ledger, its two queue
consumers, and the scheduled backstop. There is a conflicts check to trigger, it has a public
surface at `apps/worker/src/routes/directory/conflicts.ts`, and it has been callable since conflicts slice 1.

**Better than that: the trigger vocabulary intake needs already shipped, and it is already live.**
`CONFLICTS_TRIGGERS` in `packages/conflicts/src/types.ts` opens with `"preliminary"` and
`"comprehensive"`, and `TRIGGER_BY_TOPIC` in `packages/conflicts/src/recheck-cause.ts` already
produces both: a `matter.created` event records a check as `preliminary`, and `matter.opened` and
`matter.reopened` record theirs as `comprehensive`.

What intake adds is the one call that vocabulary cannot reach today, because it happens **before a
matter exists to raise an event about**. The topic-driven path can only fire once a matter row is
there; a check at the moment a member accepts a submission has entity ids and no matter at all. So
intake is not supplying a missing producer — it is supplying the earliest one, and the correct
reading of the ledger's stale line is not "conflicts is missing" but "the check exists and intake is
the caller that reaches it first."

`roadmap.d/conflicts.md` carries the same staleness from the other side — its parent node still says
"the conflicts-check feature itself has no code or spec" over a shipped package with two specs, and
`conflicts.triggers` still says "No conflicts-check invocation exists anywhere in the codebase" after
slice 2 shipped four event producers, two consumers and a cron backstop. Both are corrected in this
branch; the remaining conflicts nodes are stale in the same direction and are reported rather than
rewritten, because that area belongs to a conflicts stream.

The other correction is smaller. `intake.crm` calls `packages/custom-fields` "a substrate only" for
CRM-style fields **and** activity tracking. For the fields half it is not a substrate, it is the
answer — the engine targets `matter` and `entity`, which is exactly what a promoted lead is made of.
For the activity half the ledger understates the gap: the platform has no note, no activity and no
timeline primitive anywhere, on any record, and that absence is not intake's to fill (section 9).

### What intake composes rather than builds

| The thing intake needs                        | Where it already is                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A conflict-checkable person or organisation   | `directory_person` / `directory_organization` — the only corpus the matching channels read                |
| A matter that is not yet an engagement        | `matter.status = 'prospective'`, unnumbered, in the per-attorney Consultations view (ADR-0080)            |
| The check, its log, and its reporting posture | `packages/conflicts` — `runConflictsCheck`, `readMatterConflictsPosture`, `describeCheck`                 |
| The moment the firm agrees to act             | `openMatter` — draws the number in a guarded batch, `prospective` -> `open` (ADR-0079)                    |
| Firm-defined fields on either record          | `packages/custom-fields` — twelve kinds, targets `matter` and `entity`, temporal values                   |
| The engagement letter                         | `packages/document-assembly` — `assemble` against a registered template and a resolved merge context      |
| The fee agreement                             | `packages/billing/src/arrangements.ts` — one in-force arrangement per matter, versioned append-only       |
| Duplicate suggestion when a name is typed     | `findDuplicateCandidates` in `packages/directory/src/search.ts` — phonetic, trigram and blind-index       |
| An anonymous, rate-limited, bot-gated surface | The registration route's `surface: "public"` metadata, the `auth` rate-limit bucket, ADR-0280's precedent |

A design that reinvents any row of that table has gone wrong. The two things this design adds are
the **submission** (section 4) and the **pipeline stage** (section 6), and both are additions because
no existing record can carry the fact without damage.

---

## 2. What a prospect is

**A prospect is not a record. It is a reading of two records the platform already has: a Directory
entity, and a matter that has not drawn a number.**

That is forced rather than chosen. The conflicts engine takes `subjectEntityIds` and reads
`directory_person` / `directory_organization`; the four blocking channels are phonetic codes, an FTS5
trigram index, blind-index identifiers and typed edges, and all four are Directory tables. There is
no narrower place a prospect could live and still be checkable, and ADR-0013 with ADR-0080 both
require checkability from first contact. Any "prospect store" outside the Directory is a second
identity to reconcile and a corpus the engine cannot see — which is the failure ADR-0085 already
refused once, for firm personnel.

**The structural distinction is the matter number, not the status column.** ADR-0079 draws the number
at open and never at prospective, deliberately, so a dead consultation burns none. That decision has
a consequence nobody wrote down and this design depends on: **`matter_number` is the join every money
subsystem reaches a matter through, so a prospective matter is not reachable by any of them.** A
prospective matter has no invoice, because billing draws from `invoice_matter_balance` rows that a
draft creates against matters a bill names. It holds no trust money, because a trust leaf is opened
per matter by a member who is doing so on an engagement. It carries no client portal grant, because
the portal is not built and its grant model is per-matter. The prospect's inability to touch the rest
of the platform is a property of the graph, not of a permission check somebody remembered to write.

So the answer to "what can a prospect do to the rest of the system" is: **join the conflicts corpus,
permanently, and nothing else.** That is exactly the one thing it must do.

### What a member may see

ADR-0080 put consultations in a **per-attorney virtual folder** — `status = 'prospective' AND
responsible_member_id = X`, a filter and not a container — and that narrowness was an owner-shaped
decision about how the owner's own practice batches consultations. A pipeline board is by nature a
shared, firm-visible surface: a receptionist triaging submissions, an intake coordinator watching
stages, a partner seeing what is in the funnel. **Shipping a pipeline board therefore widens what one
member sees of another's consultations, and that is a decision, not a detail** (flag **J4**).

Two things are settled regardless of the answer. The board never becomes a second source of truth —
it reads the same prospective matters the Consultations folder reads, so a matter cannot be on the
board and absent from the folder. And the ethical-walls seam stays where ADR-0068 left it: walls are
unbuilt, so any per-matter concealment intake appears to offer would be a convention rather than a
mechanism, and this design offers none.

### The declined prospect, and the duty that survives declining

A firm that declines still holds what the prospective client told it, and the platform has to say
what it does about that rather than leaving it implicit. Four facts constrain the answer, three of
them already decided.

1. **ADR-0080 already decided the retention half:** "closed prospectives are retained forever as
   conflict history." A declined consultation is closed, never deleted, and its parties stay in the
   corpus. That is the ethically correct default and it is not reopened here — a firm that forgets a
   declined prospective client cannot detect the conflict that declining created, which is the whole
   reason the information is worth keeping.
2. **The conflicts log is append-only by database trigger.** Six `RAISE(ABORT)` triggers across
   `conflicts_check`, `conflicts_hit` and `conflicts_disposition` mean the record of what was searched
   for a declined engagement cannot be removed by application code even if a future statement builder
   tried. The record survives the outcome by construction.
3. **`representation_declined` is already a disposition kind** — but it disposes of **one hit**, under
   one reviewer's name with a rationale. It is not, and must not be read as, a record that the firm
   declined the engagement: a firm may decline for reasons that have nothing to do with conflicts, and
   may decline before any check surfaced anything at all.
4. **`matter` has `closed_at` and no reason column.** There is nowhere on the matter today to record
   _why_ it closed, so a declined engagement's outcome has no home on the existing record.

From those, the design's position: **declining is a recorded, attributable act on the intake record,
and a close on the matter.** The outcome, its reason, the member who recorded it and the instant live
on the lead; the matter closes through the shipped `closeMatter` path; the conflicts log needs no
change, because it already holds what was searched and by whom and cannot be edited afterwards. The
report itself is **reproducible rather than stored** — `describeCheck` is pure, takes no database, no
clock and no locale, and derives its sentences from a check row that cannot be mutated. A stored
report would rot; a derived one over immutable rows is the stronger evidence.

What is **not** settled here, because it is professional conduct and legal exposure rather than
engineering:

- Whether a decline may be recorded at all before a conflicts check has completed (flag **J5**).
- What a declined prospect's information means for a later adverse matter — the Model Rule 1.18
  problem, where the people who must not see it are precisely the ones acting against that person, and
  the only mechanism that would enforce that is the unbuilt ethical wall (flag **J12**).
- What the platform does with an erasure request from a declined prospect, given
  `packages/data-access/src/pii-registry.ts` marks `matter_party` `retain-under-matter` and every
  conflicts table `pseudonymize-keep`, and honouring the request at the entity would blind the corpus
  to exactly the person the retention exists for (flag **J13**).

---

## 3. Where the two new records sit, and why nothing existing will do

Two records are added. Everything else in this design is a query, a view, or a call into a shipped
package.

**`intake_submission`** — one inbound approach that no member has yet accepted. It is not a Directory
entity and not a matter. Section 4 is the whole argument for it.

**`intake_stage`** — a per-firm, ordered pipeline label. Section 6 is the argument, and the argument
is short: nothing existing is both per-firm, ordered, and free of authority.

There is deliberately no `lead` table. **A lead and a prospective matter are the same record.**
ADR-0080's "everything is a matter (one data model)" is the reason, and it holds: a lead has a
responsible attorney, a title, a type, parties, documents, calendar events and now a stage — every
one of which the matter shell already carries or the custom-fields engine already extends. A separate
lead entity would duplicate all of it and then need a migration at conversion that moves documents,
which is the specific harm ADR-0080 avoided by making each consultation its own matter so its files
never move on retention.

---

## 4. The submission — untrusted input at the front door

**The Directory is effectively permanent.** Soft-delete only; a merged subordinate keeps
`status = 'merged_into'` and stays in the corpus **on purpose**, so a merged-away alias still surfaces
a hit. That is correct for a conflicts corpus and it is the reason the front door cannot open onto it:
anything an anonymous stranger can write into the Directory is in the conflicts corpus forever, and a
corpus full of bot submissions is a corpus a reviewer stops reading.

So the boundary is drawn at **triage, by a human**, and it is drawn one step earlier than "conversion":

```
                  a human accepts it              a human converts it
 intake_submission ────────────────▶ consultation ────────────────▶ open matter
  (no entity,                        (Directory entity              (number drawn,
   no matter,                         + prospective matter,          engagement begins)
   not in the corpus)                 IN the corpus, on a stage)
```

An `intake_submission` holds the verbatim payload plus a small set of typed columns for the fields a
form is allowed to ask for, a `source` from an open catalog (`public_form`, `staff_entered`,
`telephony` reserved — section 10), the form and form version it arrived through, the receipt instant,
and a triage outcome that is one of unreviewed, accepted, or rejected with a reason. It names no
Directory entity until a member accepts it, at which point it names the entity and the matter that
acceptance created and never changes again.

Four rules bind it, and each exists because the alternative has a specific failure:

- **A submission is never in the conflicts corpus.** It has no phonetic code, no trigram row, no blind
  index. `findDuplicateCandidates` cannot see it and neither can `matchParty`. A submission that
  surfaced as a conflicts hit would be the platform asserting a relationship between a firm and
  somebody who filled in a web form.
- **Nothing automated promotes a submission.** No queue consumer, no cron, no rule engine turns one
  into an entity. The act is a member's, it is audited, and the audit row names them — because the
  first thing that ever writes a person into the permanent corpus should be a person.
- **A submission may not carry a protected identifier.** No social security number, no employer
  identification number, no driver's licence, no date of birth, no account number. The
  `protected()` machinery exists so a named member with `directory:viewSensitiveIdentifiers` takes
  responsibility for a decrypt; a public form collecting one puts sealed personal data into the firm's
  custody with nobody having accepted it. The enforcement is structural rather than validating: the
  form field vocabulary simply has no kind that maps to a `protectedField` declaration, so there is no
  shape a form can be given that would collect one.
- **A rejected submission is not a soft-deleted prospect.** It never became one. Rejecting it records
  the rejection and leaves the payload; purging it is a retention question (flag **J9**), and it is a
  real one — an untriaged submission from a genuine prospective client is still information the firm
  received, and a purge job that cannot tell the two apart deletes the wrong one.

---

## 5. The public form — what it may and may not reveal

Anyone on the internet can post to this endpoint. It is served from the marketing host
(`magnacarta.esq`, per ADR-0052's host split) and reaches a privileged system, and the route metadata
is already a solved shape: `surface: "public"`, `authenticated: false`, `permission: null`,
`idempotency: "optional"`, `rateLimit: "auth"` — the registration route's exact posture, for the same
reason (the tightest bucket the platform has, on a route an anonymous script can reach).

### The disclosure rule, and why it has to be structural

**The response must not depend on the content of the submission.** One answer — received — for a name
the firm already represents, a name adverse to a current client, an unknown name, a fifth submission
from the same person, and a form that is switched off. This is ADR-0052's absence-not-existence
applied at the front door and it is the same discipline the registration route already holds ("every
outcome within a door answers identically, so the response never reveals whether an address already
has an account").

The naive way to hold that rule is to look the name up and then answer identically anyway. **That
leaks through latency**: a form that consults the Directory answers measurably slower for a name with
candidates than for one without, and a probing script gets its oracle from the clock. So the rule is
enforced by construction instead:

> **The public submission path performs no lookup against firm data. It writes one row and returns.**

No duplicate detection, no entity resolution, no conflicts check, no "we may already act for you",
no matter-type routing that could 422 on an unsupported area of law. Every one of those is a read
whose timing is a signal, and every one of them is available a moment later on the staff side of
triage, where the caller is a member and the reveal is authorised.

Two corollaries follow. The 429 the rate limiter returns is fine — it is a fact about the caller's IP
and budget, not about the content, and ADR-0280's invitation-refusal reasoning already established
that a refusal may report the caller's own budget and nothing else. And the acknowledgement copy must
be as uninformative as the status code: "we have received your enquiry and someone will be in touch"
does not become "someone from the family law team", because the team is a routing decision the form
did not make.

### Spam control

Four layers, none of them new work and none of them content-dependent:

1. **Cloudflare Turnstile** on the form, in managed mode. Named in
   [`docs/conventions/operations.md`](../conventions/operations.md) as a standing item for auth,
   intake, payment and portal forms — and honestly, still an unchecked box there rather than a running
   control (flag **J11**).
2. **The `auth` rate-limit bucket**, per IP, at the chokepoint that already owns rate limiting for
   public-surface routes.
3. **A per-form submission budget** the firm sets, so a firm that is being flooded can throttle or
   close one form without touching the others or its authenticated surface.
4. **Super Bot Fight Mode** at the edge, which the platform already runs.

Turnstile is a signal and not a wall; the layer that actually protects the corpus is the fact that no
submission becomes a Directory entity without a member (section 4), and no volume of spam can change
that.

### What a form is made of

A form definition is per-firm, versioned, and published at a path under the reserved-namespace rules —
a firm's public form path is exactly the sort of user-influenced segment the reserved list exists to
stop shadowing a system route. Its fields are drawn from a **bounded platform vocabulary** (name
parts, organisation name, email, telephone, free-text description of the matter, a firm-defined
picklist, a firm-defined free-text question) and never from the custom-fields definition set
(flag **J10**): the custom-fields engine has `contact-reference` and `matter-reference` kinds, and a
public form that could bind one would let a stranger point a value at a Directory entity. Attachments
are a separate question with a real cost — an anonymous upload is an anonymous write into the
untrusted-ingest and malware-scan pipeline (flag **J3**).

Every submission stores the **form version** it arrived through, on the same reasoning as
`document_template_version` and the billing arrangement version: a firm that changes its questions
must still be able to read what an old submission was actually asked.

---

## 6. The lead pipeline

**The platform ships the shape; the firm defines the list.** That is the house pattern and it is
close to unanimous — matter types are per-firm rows (ADR-0080), party roles are per-firm
(`createPartyRole`), Directory categories are per-firm labels (ADR-0085), custom fields are per-firm
definitions. A shipped, fixed set of stages would be the only closed enum in a subsystem surrounded by
open ones.

So `intake_stage` is a per-firm ordered row set — name, sort order, active flag — soft-deactivated
rather than deleted, on the matter-type precedent. A first-run set is seeded at provisioning so a firm
is not staring at an empty board (flag **J8** settles which stages and how many).

**The rule that makes this safe: a stage carries no authority.** It is a label and a sort order. It
gates nothing, permits nothing, and is never read by a precondition. The moment a stage gates
conversion, a firm renaming "Conflicts cleared" to "Ready" moves an ethics gate by editing a text
column — and a firm that deletes the stage removes the gate entirely. The things that gate are
platform-owned and unrenameable: the conflicts posture, the close preconditions, the permission
registry. This is ADR-0085's "a category is a classification label, not a schema variant" applied to
the funnel.

The stage lives on the prospective matter (one current stage, changed by an audited write; a stage
change is a fact worth keeping, so the history is append-and-flip on the custom-field-value pattern
rather than an in-place update). Nothing about a stage survives conversion: an open matter has no
stage, because the funnel ended.

---

## 7. Conflicts at intake

This is the load-bearing section, and the first thing to say is what is **not** open. The engine's
posture is settled and binding: **the platform never asserts that a matter is free of conflict.** It
reports what it searched, what it could not search, and what surfaced; the conclusion is a lawyer's
and the record says whose. `readMatterConflictsPosture` has no aggregate field, `describeCheck` ends
a zero-hit report with "Nothing surfaced.", and
[`tooling/lint-conflicts-vocabulary/`](../../tooling/lint-conflicts-vocabulary/) fails the gate on any
verdict-shaped field name in the package, the route, the web surfaces or `docs/user/`. Intake does not
relax that by a word, and the vocabulary lint reaches intake's surfaces the day they exist.

### The two checks, and when they fire

**A preliminary check at acceptance.** The moment a member accepts a submission (or types a walk-in,
or takes a call), a Directory entity exists. That is the earliest instant a check is possible and it
is the instant a receptionist most needs one — before an appointment is booked. It runs with
`trigger: "preliminary"`, the subject entity ids just created, and **no `matterId`**, which has an
honest consequence the engine already handles: `imputation` records `unavailable` rather than
`searched`, because there is nothing to join firm members against. That is the correct record, and
`unavailable` must never be read as searched-and-empty.

**A comprehensive check before conversion.** With the prospective matter and every party linked
through `matter_party`, `trigger: "comprehensive"`, `matterId` present, so imputation runs and the
graph expands from the full party set. This is the check the conversion gate reads.

Both are ordinary calls to `runConflictsCheck` through the shipped route. Intake adds no matching, no
scoring, no threshold and no second corpus.

**Re-checks are already automatic and intake gets them free.** `linkMatterParty` emits one outbox row
per party link; the request consumer resolves affected matters and writes a `conflicts_recheck_request`
per matter; the run consumer coalesces every open cause for a matter into one check that names them
all. Adding a party to a consultation during intake therefore produces a durable, visible re-check
obligation without intake writing a line of it. What intake owes is to **show** the obligation:
`pendingRecheck` is read for a never-checked matter too, precisely so a party added to a matter that
predates a check is not silently invisible.

### What a member sees

The check's own words, not a summary of them. `describeCheck` produces the statement list; the hits
come back grouped by evidence tier with `describeEvidence`'s explanation strings, `co_party` flagged
apart from a conflict with a prior or other client, and every source the check could not run listed
with its reason. **No badge, no count-as-verdict, no colour that means safe.** The one number worth
surfacing is the count of hits with no disposition, because that is a fact about the firm's own
procedure rather than about the client.

### The gate

The platform cannot block on "there is a conflict" — it never concludes one, and a gate that did
would be the verdict the whole engine refuses to produce. But there are four conditions it **can**
gate on without concluding anything, because each is a fact about the firm's procedure, and all four
are already computed by `readMatterConflictsPosture`:

| Condition                                                | The posture field | What it says                                              |
| -------------------------------------------------------- | ----------------- | --------------------------------------------------------- |
| No check has ever run on this matter                     | `neverChecked`    | The firm has not looked                                   |
| The latest check's scope falls short of the firm's floor | `scopeShortfall`  | The firm looked, but less thoroughly than it now requires |
| A surfaced hit carries no disposition                    | undisposed counts | Something surfaced and nobody answered it                 |
| A re-check request is open                               | `pendingRecheck`  | The corpus moved and the answer has not been re-derived   |

**The proposed gate: a matter may not be opened while any of the four holds.** Read the fourth line
again — it is the strongest of them and it costs nothing, because `scopeShortfall` is derived against
the **live** policy row on every read, so raising the firm's floor makes every affected matter fail
the gate immediately with no sweep and no write.

This is a gate on procedure, never on outcome. A matter with fourteen tier-1 hits, every one disposed
`waiver_obtained` by a named partner with a rationale, passes it. A matter with zero hits and no check
does not. That asymmetry is the correct one and it is the whole argument for gating this way.

**Whether the gate is a hard refusal or an override is the owner's call** (flag **J2**), and it is a
professional-conduct question rather than an engineering one. What the design settles either way: an
override is itself a **recorded, attributable act** — a named member, a rationale, an audit row, and
the posture as at that instant reproducible from the log. An override that leaves no trace is worse
than no gate, because it produces a record that looks like compliance.

One thing the gate must never do is fire from the automated path. `recheck-cause.ts`,
`recheck-request.ts`, `recheck-run.ts` and the two worker consumers may not import `disposition.ts` —
a run nobody asked for, under nobody's authority, must not record a member as having concluded
anything, and the rule is enforced on the source text. Intake's conversion path calls
`recordDisposition` only from a member's own request, never from a queue.

---

## 8. Conversion, and the hand-offs

**Conversion is `openMatter`.** The shipped path draws the number from the segment-template engine
inside the matter's own atomic write batch, flips `prospective` -> `open` with `AND status =
'prospective'` on the UPDATE, and confirms after the commit that the row carries the number it drew.
Intake adds the preconditions in front of it (section 7) and nothing else. There is no second write
path to an open matter and this design creates none.

**Conversion is a one-way door, and it should stay one.** `reopenMatter` returns a closed matter to
`prospective` only when `opened_at` is null — that is, only for a consultation that was closed without
ever being opened. Once a number is drawn it is frozen, and ADR-0079 rejected numbering at prospective
creation exactly so that dead consultations do not burn numbers and wrong-year them. Un-converting
would either release a number back to a counter (which the `matter_number_allocation` primary key
exists to prevent) or leave a gap that a firm's own numbering audit reads as a missing file. **The
correct undo for a mistaken conversion is closing the open matter, not reversing it**, and the
mistaken-conversion rate is not the thing to optimise against a numbering invariant.

### The engagement letter and the fee agreement

Both are owned elsewhere and intake calls them in an order:

1. **Open the matter** — the number has to exist first, because it is a merge field the letter will
   almost always carry and `resolveMergeContext` reads the matter row.
2. **Assemble the engagement letter** — `packages/document-assembly`, against a template the firm
   registered, filed to the now-open matter through the ordinary assembly path. Intake supplies no
   template, no merge fields and no assembly logic; a firm that wants an engagement letter registers
   one like any other template. An unfilled field lands `succeeded_with_absences` and is reported, as
   it would on any other document.
3. **Record the fee agreement** — `setBillingArrangement`, one in-force arrangement per matter,
   versioned append-only, a fee change minting a new version. Whether this may be recorded on a
   prospective matter before conversion is flag **J7**: the engine would accept it, the sequencing
   question is whether a firm should be able to agree a fee before it has agreed to act.

Signature of the engagement letter is e-signature's, not intake's, and the e-signature capability is
not built. The seam is that an assembled letter is an ordinary filed document, so whatever signs
documents will sign this one.

---

## 9. CRM fields and activities

**The fields half needs no engine.** `packages/custom-fields` defines per-firm fields against a matter
type or an entity category, in twelve kinds, with append-and-flip temporal values, retype without data
loss, and merge-aware repointing. A consultation is a matter of a firm-chosen type and its client is a
Directory entity of a firm-chosen category, so "referral source", "estimated value", "how did you hear
about us" and every other CRM field a firm wants are definitions in the shipped engine. Intake ships
none of them; it ships the surfaces that render whichever ones the firm defined, on the pattern the
matter detail surface already uses.

Two limits to state so nobody discovers them at build time. The engine's `required` flag is advisory
at the data layer — form-level enforcement is the surface's job. And a public form cannot use a
custom-field definition (section 5), so a firm that wants a question on its public form and the same
question on its staff intake screen defines it twice, in two vocabularies, and the mapping between
them is a triage-time concern.

**The activity half is a genuine platform gap, and it is not intake's.** There is no note, no comment,
no activity and no timeline entity anywhere in the tree — not on a matter, not on a Directory entity.
The nearest existing things are the audit log (system attribution, not user content), calendar
`matter_event` rows (scheduled, with `member` / `entity` / `external` participants), and filed email
(a real communication with a real message record). A CRM activity feed over a prospect can be
**derived** from what exists — submissions received, stage changes, conflicts checks and their
dispositions, calendar events, filed emails, assembled documents — and a derived timeline is honest
and needs no new table.

What a derived timeline cannot hold is "I spoke to her on Tuesday, she is thinking about it." That is
a note, every matter needs one, and a note primitive invented inside intake would be a note that only
prospects have. **Flag J6** decides whether the note primitive is built as a platform slice or the
timeline ships derived-only.

---

## 10. Call intake — the seam, and where it stops

`intake.call-intake` depends on the `telephony` port. **The port does not exist**: there is no
telephony module in `packages/integrations`, no adapter, no Telnyx or other carrier code, no media
stream fork and no transcription path. Cloudflare Workers AI transcription is named in the white paper
and is unbuilt. Designing around it would be designing against nothing.

What this design owes, and then stops:

- **`intake_submission.source` is an open catalog with `telephony` reserved.** A catalog that has to be
  widened later is a migration; one that already admits the value is not.
- **A submission body can carry a transcript, and a submission can reference an R2 object.** A call
  recording is bytes in per-firm R2 and a transcript is text; both fit the record as shaped.
- **Call intake is the same triage action as any other submission.** A receptionist accepting a call
  submission creates a Directory entity and a prospective matter with the transcript attached, runs the
  preliminary check, and lands on a stage. Telephony changes where the bytes came from and nothing else
  in the flow.

Everything past that — call-recording consent by jurisdiction (reuse the trust jurisdiction-profile
machinery, do not rebuild it), the media stream fork, E911, the carrier adapter — belongs to the
telephony port's own design cycle. This document names the seam and does not design the port.

---

## 11. What this design deliberately does not cover

- **The telephony port, transcription, and call recording** (section 10).
- **Ethical walls.** Unbuilt seam; intake surfaces the need (section 2) and builds nothing.
- **The client portal.** Not built; a prospect has no portal grant and this design adds no external
  principal.
- **E-signature of the engagement letter.** Owned by the e-signature capability, unbuilt.
- **Marketing attribution and campaign tracking.** A referral-source custom field is a firm definition;
  anything beyond it is a separate subsystem.
- **Automated lead scoring or triage.** Nothing automated promotes a submission (section 4), and a
  score is a verdict-shaped number one step from a gate.
- **The matter note primitive** (section 9, flag **J6**).
- **The erasure orchestrator.** Designed and deferred elsewhere; intake contributes its two tables to
  the PII registry and nothing else.

---

## 12. Owner flags

**These decide what gets built. The implementation plan does not start until all seven are answered.**

**J1 — Does the first slice ship staff-entered intake only, with no public form at all?** The whole
mechanism — submission, triage, entity, prospective matter, preliminary check, stage, comprehensive
check, conversion — works with a receptionist typing into a screen, and it needs no anonymous surface,
no Turnstile, no rate-limit tuning and no disclosure analysis to ship. The public form is an
accelerant on top of a flow that has to exist either way. Recommendation: yes, and it is slice one.

**J2 — The conversion gate: hard refusal, or override with a recorded reason?** Section 7. A
professional-conduct question. The four conditions are facts about the firm's procedure rather than
conclusions about the client, so gating on them concludes nothing — but a hard refusal on an open
re-check request will, at some point, stop a firm opening a matter on a day it needed to. Either
answer is defensible; the design refuses only to leave an override untraced.

**J3 — Does the public form accept attachments?** An anonymous upload is an anonymous write into the
untrusted-ingest and malware-scan pipeline, with its per-firm scan policy, quarantine and storage
cost, driven by a caller who has not been identified. The value is real (a prospective client's
contract, the letter they were served) and so is the surface. Recommendation: not in the first public
form; the accepted submission's matter takes uploads the ordinary way, from a member.

**J4 — Is the pipeline board firm-visible, or per-attorney like the Consultations folder?** Section 2.
ADR-0080 made the Consultations folder deliberately per-attorney; a shared board widens it. A
firm-visible board is what an intake coordinator needs and what every competitor ships; the narrowing
was an owner-shaped decision and reversing it is the owner's.

**J5 — May a decline be recorded before a conflicts check has completed?** Section 2. A firm declining
instantly on subject matter ("we do not do that kind of work") should not be forced through a check; a
firm declining _because of_ a conflict must have the record. The two are indistinguishable to the
platform at the moment of the click.

**J6 — Is the matter note / activity primitive built, and where?** Section 9. If it is not, the
prospect timeline ships derived-only and cannot hold "she is thinking about it". If it is, it belongs
to every matter and not to intake — which makes it a platform slice this one depends on rather than a
part of this one.

**J7 — May a fee agreement be recorded on a prospective matter?** Section 8. The billing engine would
accept it. The question is whether a firm should be able to agree a fee before it has agreed to act.

**These decide how it is built, not whether.**

**J8 — The seeded stage set.** Section 6. Which stages a newly provisioned firm starts with, and how
many. Fewer is better; the firm defines its own.

**J9 — Submission retention.** Section 4. How long an untriaged or rejected submission is kept, and
what purges it. The hazard is that an untriaged submission from a genuine prospective client and a bot
post look identical to a purge job.

**J10 — The public form's field vocabulary.** Section 5. A bounded platform vocabulary is proposed,
deliberately excluding custom-field definitions (whose reference kinds a stranger must not be able to
bind) and every protected identifier. Confirm the field list.

**J11 — Turnstile's real status.** Section 5. `docs/conventions/operations.md` lists it as a standing
item for auth, intake, payment and portal forms and it is still an unchecked box. The public form
should not ship in front of a control that is not running.

**These are professional-conduct questions. The design analyses them and answers neither.**

J2 and J5 above are also conduct questions, but each additionally decides a build, so they sit with
the seven. The two below decide no build and are recorded here because leaving a conduct obligation
implicit is how it goes unmet.

**J12 — Rule 1.18 and the unbuilt ethical wall.** Section 2. A declined prospect's information is
protected from precisely the members most likely to act adversely, and no mechanism enforces that
today. Analysis, not a decision the design may make.

**J13 — Erasure versus the permanent conflicts corpus.** Section 2. `matter_party` is
`retain-under-matter` and the conflicts tables are `pseudonymize-keep`, so the retention posture is
already recorded — but honouring an entity-level erasure for a declined prospect blinds the corpus to
the person the retention exists for. Analysis, not a decision the design may make.

---

## 13. Fitness functions this design owes

Every structural claim above has to be re-provable over stored rows and source text, or it is being
trusted rather than held.

- **No `intake_submission` row is reachable from the conflicts corpus.** A source scan asserting the
  intake package never imports `findDuplicateCandidates`, `phoneticCodes` or `normalizeName`, mirroring
  the scan `packages/conflicts/src/imputation.ts` already carries for the same class of mistake.
- **No automated path promotes a submission.** A source scan asserting no queue consumer, scheduled
  handler or rule engine imports the promotion composer — the same shape as
  `test/automated-path-cannot-dispose.test.ts`.
- **The public submission route reads no firm data.** A scan over the route's module asserting it
  performs exactly one write and no `SELECT` against a Directory, matter or conflicts table. This is
  the latency-oracle rule, and it is only enforceable structurally.
- **No public form field maps to a `protectedField` declaration.** A conformance test over the form
  field vocabulary against the `protectedField` registry, so widening either one fails the gate.
- **Every prospective matter with a stage has a stage that belongs to its own firm and is active or
  soft-deactivated**, never dangling — the ordinary per-firm reference probe.
- **No matter has both `opened_at` and a stage.** The funnel ended at conversion; a stage surviving it
  is a board showing engagements.
- **The conflicts vocabulary lint reaches intake.** `tooling/lint-conflicts-vocabulary/` extends its
  scan set to the intake package, its routes and its web surfaces on the day they exist — a verdict-
  shaped field name is exactly the thing an intake screen tempts a builder into.
- **Both new tables appear in the PII registry** with a stated action, enforced by that registry's
  existing coverage test.

---

## 14. Test plan sketch

- **The refusals, by name**, one test each: a submission carrying a field that maps to a protected
  identifier; a conversion with `neverChecked`; a conversion with an open re-check request; a
  conversion with an undisposed hit; a conversion whose latest check falls below a floor raised a
  moment ago; a stage from another firm.
- **The disclosure rule**, as a behaviour rather than a string: identical status, identical body and
  identical shape for a name with several duplicate candidates in the Directory, a name adverse to a
  live matter, and a name nobody has heard of — asserted against a seeded corpus, not a mock.
- **The latency rule** as a structural assertion, not a timing test: the route module's read count.
  A timing assertion would be flaky and would pass on a fast machine with the bug present.
- **Acceptance is a member's act**: the audit row names them, the entity's first name row carries
  their attribution, and the preliminary check's `actor_user_id` is not null and its
  `trigger_source` is `manual`.
- **The preliminary check records `imputation` as `unavailable`**, not searched — the honest-record
  case, and the one a well-meaning refactor breaks by passing a `matterId` that does not exist yet.
- **A declined consultation stays in the corpus**: after decline and close, the party still surfaces
  as a candidate on a later unrelated check, and the original check row still reproduces its report
  through `describeCheck` unchanged.
- **A stage change is append-and-flip**, and the history survives conversion even though the current
  stage does not.
- **Conversion is `openMatter` and nothing else**: a test asserting the intake conversion path composes
  no `matter` UPDATE of its own, so the number-drawing invariants keep their single home.
