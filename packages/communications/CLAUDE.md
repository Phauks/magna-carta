# @magna-carta/communications — CLAUDE.md

**Purpose.** The call and text log: one row per voice call or SMS/MMS message the firm made or took,
carrying the channel, the direction, the number at the other end, who was on the firm's side, when it
happened, what was said, and — nullably — the matter it belongs to. Validates in memory and composes
statements into `@magna-carta/data-access`'s `composeEffectBatch`; holds no binding, reads no clock,
and never calls an external service.

**White paper:** _Communications layer_, with _Client intake / CRM_ (receptionist call intake) and
_Directory_ as the surrounding context —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-09-07-call-and-text-log-design.md`](../../docs/specs/2026-09-07-call-and-text-log-design.md).

## Key files / entry points

- `src/types.ts` — the three closed vocabularies, the ceilings, the page caps, the list scopes
- `src/validation.ts` — every refusal as a code the route maps to a problem type, the number
  normalization, and the channel/content coherence check
- `src/communication-statements.ts` — the SQL, and **the access gate**: `matterClauseFor` is the one
  place the nullable-matter problem is expressed
- `src/communication-service.ts` — log, file onto a matter, take off a matter, each one batch with
  its audit row
- `src/numbering.ts` — the reference number's counter tables, the UTC day it counts under
  (`communicationNumberDate`), and the conflict its rendered-number index raises. The SHAPE is not
  here: it is the `communication` purpose on the register in `@magna-carta/sequence-numbering`

## The reference number is a scheme like every other

The number a receptionist reads back down the telephone. Since the owner's ruling of 2026-09-19 it
is the firm's to shape: `planSchemeDraw` loads the `communication` purpose's scheme in force and
this package renders nothing itself. The built-in default is year, month, day and a four-digit
count with the three date parts marked scoping, which renders exactly the `2026-09-08-0042` the run
has always rendered and keeps the count restarting each day — a firm-wide run reaches five digits
inside a year and stops being a number anybody can read back.

The day is the **UTC day of the instant**, which is the platform's rule for the day of a recorded
moment used as a key ([`docs/conventions/dates.md`](../../docs/conventions/dates.md)): a number is a
key before it is a sentence, and one derived from the reader's own zone would name two different
days for one call depending on who was looking. What day the call fell on where the reader is stays
the record's When field, rendered in their zone.

This sequence writes **no allocation row** — the one place it departs from its siblings. The
rendered number contains the whole of its scope, so two draws that observed the same counter value
in one day render byte-identical strings and the partial unique index on
`communication.reference_number` aborts the loser exactly as an allocation primary key would. The
tables record therefore names that index's table and is never written to;
`isCommunicationNumberConflict` names the conflict this run actually raises, and it is registered as
the bounded retry's `alsoRetryable`.

The counter's scope keys were re-keyed by migration when the run joined the scheme model
(`20260920T090000_communication-number-scope-parts.sql`), from `2026-09-08` to the `2026:09:08` the
three scoping parts derive. A counter the draw can no longer find restarts the day's count at one
and issues a number the firm has already said out loud, so the rows move with the model.

## Three producers, one record — and only one is built

The log is the durable thing. The carrier is a **producer of rows into it**, and transcription is an
**enrichment of a row**; neither is the feature. A member typing in a call they made from their own
mobile and a Telnyx webhook reporting the call it just carried write **the same row**, and `producer`
is the column that says which.

That is not tidiness, it is what lets this subsystem exist at all right now: A2P 10DLC registration is
weeks of procurement lead time, and a design where the screens waited on the carrier would have
waited months. It is only a real seam if the carrier path writes through the same table and the same
columns, which is why nothing here is shaped around hand-logging in particular — and why
`insertCommunicationStatement` writes the literal `'member'` rather than taking the producer as a
parameter. A shared insert taking it as an argument is how a member row eventually gets written
claiming to be a carrier one.

## The gate, and why the visible-matter predicate is not enough on its own

Every read composes `VisibleMatterPredicate`, required rather than optional-with-a-default, on the
`@magna-carta/notes` precedent.

**What is different here: `matter_id` is nullable.** The predicate is an `EXISTS` over `matter`, which
is FALSE for a null matter id — so an unrouted row fails it. That is correct, and it is **not
sufficient**, because it means the predicate silently decides the unrouted queue is invisible, and the
next person who wants that queue will be tempted to drop the predicate to reach it.

So the null branch is its own clause, in `matterClauseFor`, which the caller asks for by passing
`includeUnrouted` — and the route passes it only when the member holds
`communications:reviewUnrouted`. **Never widen a read by removing the predicate.** If a read needs the
queue, it passes the flag.

The same flag rides on the service options as `mayReviewUnrouted`, because filing a message onto a
matter necessarily reads an unrouted row on its way. Without it, the queue could be worked by id from
outside the permission that reveals it.

## The anchor is a matter with a status, not a matter with a number

The owner's ruling of 2026-09-07. `matter.matter_number` is null until the status reaches `open`, and
an `intake` or a `consultation` is a real anchor a first contact usually lands on — a firm texts a
prospect before the file exists.

So `assertRoutable` checks the matter's **status**, never its number, and `ROUTABLE_STATUSES` admits
`intake`, `consultation`, `open` and `hold`. Anything reading or picking a matter for this subsystem
inherits the rule: **a picker that filters to `status = 'open'` makes the common case unroutable.**

A closed matter is refused for a NEW filing while keeping everything already on it — reopening exists,
and a firm quietly accreting correspondence onto a closed file is how a closed file stops meaning
anything.

## Two refusals that must stay indistinguishable

A matter that does not exist and a matter the reader may not see raise the same
`communication-unknown-matter`. Telling them apart would make the route an existence oracle for walled
matters: ask about an id, learn from the wording whether it is real. `communication-matter-closed` is
separate because it is a different problem with a different fix.

## What the audit log carries, and what it must never carry

Identifiers, enums and instants. **Never the message text, never the call summary, and never the
counterparty's number.** What was said and who it was said to are the content this record exists to
hold; the audit log is a compliance record with its own retention and its own readers. That a call
happened on a matter at a time discloses nothing on its own, which is what makes it the right thing to
log.

The one exception is the unfiling row, which records the matter the message came **off** — that is the
fact "why is this not on the file any more" needs, and once the column is null it survives nowhere
else.

## Not built here, and where each one lands

- **Sending.** Nothing in this package sends anything. Logging a message records that one was sent;
  the messaging port is the rung after this one.
- **Recording and transcription.** Sequenced last for a legal reason rather than a technical one:
  call-recording consent is gated on the jurisdiction-profile machinery (one-party versus all-party
  states), which is itself still in design. Text logging and call metadata carry no such gate; the
  audio does.
- **Email.** Deliberately not this table. Mail lives in the firm's own mailbox and is FILED onto a
  matter from there — `@magna-carta/email-filing` — so its verb is route-what-exists, where the verb
  here is cause-a-record-to-exist. One table for both would carry a threading model serving neither.
