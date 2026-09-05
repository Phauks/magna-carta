# The intake desk — design and build record

**Status:** Built (second intake slice), 2026-09-05. This document is the design of the slice as
built. It stands beside the intake procedure
([`2026-09-03-intake-procedure-design.md`](2026-09-03-intake-procedure-design.md)) and the wider
intake design ([`2026-08-15-client-intake-design.md`](2026-08-15-client-intake-design.md)), and
restates neither.

**White paper:** _Client intake / CRM_, read with _Matters and File Manager_, _Directory_, _Conflicts
Check_ and _Case calendar_. **Binding decisions:** ADR-0080 (a consultation is a prospective
matter), ADR-0079 (the number is drawn at open), ADR-0085 (the Directory is the one corpus a
prospect lives in), ADR-0013 (the conflicts posture), and the intake procedure decision of
2026-09-03 (the checklist is derived, a kind may exist ahead of its subsystem).

**Owner direction, 2026-09-05.** A customer calls the firm wanting to open a case. The receptionist
opens Intake from the sidebar; from there they select a person or an organization from the
directory or create a new one, collect what the intake requires, and fulfil the criteria to complete
it — a required conflicts check, emailing the client an agreement and receiving it back, sending the
client online forms, sending or receiving payment, and whatever else the firm requires. Multiple
intakes happen at once and can be resumed. Once an intake is complete it leads to scheduling a
consultation. And on this field and every other place a person is chosen, there has to be a way to
create the entity from that location: a top-level New.

---

## 1. What the desk is, and what it is not

**An intake in flight is a prospective matter.** Nothing else was added to carry it. The wider
design settled that a lead and a consultation are one record and the procedure slice settled that a
consultation's checklist is derived over it; the desk is therefore a **reading** of the firm's
prospective matters, never a register of its own. An intake cannot be on the desk and missing from
the docket, it needs no reconciliation, and it leaves the desk by the two exits a prospective matter
already has: opening and closing.

**The desk is firm-wide.** The 2026-08-15 design left this open as flag J4, because ADR-0080 had
made the Consultations view deliberately per-attorney. The owner's workflow answers it: a
receptionist takes the call, a paralegal sends the forms, an attorney answers the conflicts step,
and each of them has to find the same intake. The per-attorney Consultations view is unchanged and
reads the same rows through its own filter; the desk reads them through `intake:read`, the
permission that already lets a member read one consultation's checklist at a time.

**"Complete" is the procedure's word, not the platform's.** An intake is complete when no required
step of the procedure binding its kind is outstanding. That is the same number the opening gate
refuses on, and the desk prints it as a count — "3 of 5 answered, 1 required outstanding" — never as
a word about the client. The conflicts step's standing stays a sentence on the matter's Intake
section in the conflicts record's own vocabulary; the desk does not summarise it.

## 2. What was built

**The read.** `readIntakeDesk` in `packages/intake/src/desk.ts`, behind
`GET /api/v1/intake/consultations`: the firm's prospective matters (the matters listing's own
statement, so the search is the docket's search over title, number and client), joined in one
batched read each to the client party, the responsible member's name and the matter type's name,
plus the earliest scheduled event on or after today per matter, and one checklist read per row for
the counts. The page is capped at fifty because that last read is derived across several subsystems
and stored nowhere; the desk is a surface a person looks at, not a feed.

**The screen.** `/intake`, shipped in the sidebar at alpha. One table over the read, on the list
archetype every register uses: the search and the create control in the masthead, the columns'
own filters, the consultation number anchoring the row, the standing as a sentence, the next
consultation or its honest absence, and a Stale badge on a consultation past the firm's
stale-consultation age. Activating a row resumes the intake on the matter's Intake section, where
the steps are answered.

**Starting one.** New Intake opens the New Matter window in its intake purpose: the status is fixed
at Prospective and not offered, the commit says Start Intake, and the consultation-fee and
trust-deposit affordances are not drawn, because on an intake those are steps of the firm's
procedure and the checklist asks for them. The client field is the directory picker, which can now
record the caller in place (section 3).

**Scheduling the consultation.** Each row carries Schedule, refused with the reason until every
required step is answered (the owner's ordering: a complete intake leads to the consultation) and
refused with a different reason once a consultation is on the calendar. It opens the calendar's own
Record an Event window on the consultation, seeded with a title and the two people the desk already
knows are attending — the client and the responsible attorney — every part editable. Nothing here
is a second event form.

**Two more step kinds.** The owner's list named two steps the eight kinds could only spell as an
acknowledgement: the client's online forms going out and coming back, and a payment sent or
received before the firm acts. `client-forms` and `payment` are added on the procedure's own
principle — a kind exists ahead of the subsystem that will answer it — as a member's record today
and a reader's answer the day the client portal and the payments port exist. Widening the CHECK is
a same-transaction table rebuild of `intake_procedure_step`, bracketed in `PRAGMA foreign_keys`,
with every id preserved.

## 3. A picker that records what it cannot find

The one field a person or an organization is chosen in (`EntityPicker`) ended, on every surface,
at the same wall: a name the directory did not hold sent the reader to the Directory screen, and
the matter, the cost, the check or the event they were in the middle of lost its place. The owner's
direction is that the record is made **from wherever the person is chosen**, through a top-level
New.

Two changes, at two altitudes:

- **The design system's picker** gains a New control beside the field — a button when the field
  offers one kind, a menu of Person and Organization when it offers both — and a row per offered
  kind at the end of the list that adds what was typed. Both hand the caller the typed text and the
  kind wanted; the picker changes no selection itself. The control is present before anything is
  typed, because a way to add a record that only appears after a failed search is a way you find
  by accident. A caller that may not create hands over a refusal, and the control stays, disabled,
  carrying it.
- **The application's wrapper** (`directory-entity-picker.svelte`) opens the Directory's own New
  Person and New Organization windows over whatever surface the picker stands in — the same
  windows, with the same duplicate gate on the right, seeded with what was typed — and hands the
  record back to the field as its selection, its name read back from the directory so it is the
  name every other surface shows. Every surface that picks from the directory now takes the
  wrapper: the matter window's client, the cost's payee, the conflicts check's subjects and the
  disposition's consenting party, the directory's edges and a person's organizations, and the
  calendar's participants. The session is read once and shared for the `directory:edit` permission,
  because a picker stands in places that have no screen to hand it down from.

## 4. Decisions taken against the wider design's open flags

- **J4** (the pipeline board's visibility): the desk is firm-wide, by the owner's workflow. The
  Consultations view keeps its per-attorney narrowing.
- **J6** (the note primitive): shipped since; not touched here.
- **J8** (seeded stages): no stage exists. The desk is the list; a board over firm-defined stages is
  still the wider design's section 6 and unbuilt.

## 5. Fitness functions

- `packages/intake/test/schema-name-sync.test.ts` pins the widened kind vocabulary to the schema.
- `apps/api-worker/test/intake-routes.test.ts` drives the desk read over real bindings: the counts,
  the names, the next setting, the search, the paralegal's read, and a consultation leaving the desk
  when it opens.
- `apps/web/test/entity-picker-gate.test.ts` still holds that the directory's search is called
  from one adapter; the wrapper stands on it.
- `tooling/lint-conflicts-vocabulary/` scans the desk's module and screen with the rest of intake.

## 6. What is deliberately not here, and where the seams point

- **A pipeline board and firm-defined stages** (the wider design's section 6). The desk answers
  "what is in flight and how far is it" from the procedure; a stage is a second word for the same
  thing until a firm needs one the procedure cannot express.
- **The public form, the submission and its triage, call intake.** Unbuilt; every intake on the desk
  is staff-entered.
- **Files landing in named folders on the consultation.** A consultation has the file manager
  already; the desk links to the matter, whose Files section takes them. A per-procedure folder
  layout is a document-automation question and waits on one.
- **The portal and payments readers** behind the two new kinds.
- **A load-profile volume** for the desk read; the page cap bounds it today.
