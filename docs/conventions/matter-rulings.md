# The matter record — the owner's standing rulings

Every ruling the owner has issued on the matter record itself — its header, its status seal and the
status window behind it — cumulative, newest round last. **A ruling here is settled.** It is not
re-derived, re-proposed, or re-litigated by a later round, and a round that silently reverts one is
a regression, not a redesign.

The matter's four financial tabs have their own ledger
([`time-tab-rulings.md`](time-tab-rulings.md)) and its Conflicts section has its own
([`conflicts-rulings.md`](conflicts-rulings.md)); this file is the record around them.

Status values: `settled` (built and confirmed) · `regressed` (was settled, a later round undid it) ·
`open` (asked for, not yet built) · `superseded` (a later ruling replaced it, with the pointer).

## R1 — round one: the status seal becomes the control it was already called

The owner's notes of 2026-09-11, staged and then built the same day — except the status window's
Location (W1), which waited on the Offices component and was built on 2026-09-14. All three were
built; L2 was then reversed by round two, three days later, and its notes below are the record of
what it built rather than of what stands. The research beneath each group is what the code said when
the round was staged.

### The lifecycle and the seal

| #   | Ruling                                                                                                                                                                                                                                                             | Status     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| L1  | **A consultation can be closed or put on hold, not only opened.** A firm that decides against a consultation, or parks one, has to be able to say so from the consultation itself.                                                                                 | settled    |
| L2  | **The status seal is a dropdown that changes the status.** Today it offers the one step the lifecycle runs toward; it becomes the control the status is actually changed from. This **amends the "steps, never a picker" rule** recorded in `matter-lifecycle.ts`. | superseded |

L2 is superseded by **S1** in round two below, issued 2026-09-14, three days after it shipped: the
seal is a pillbox again and no menu hangs off it. **L1 still stands** — a consultation can be
opened, put on hold, or closed as declined, and what replaced the dropdown still offers all three.

**Notes recorded this round (2026-09-11).**

- **L1 reaches the contract, not only the table.** `MATTER_LIFECYCLE_STEPS.consultation` is now
  Open Matter, Put On Hold, Close Consultation, in that order: the step the lifecycle runs toward,
  then the pause, then the exit. The hold route accepts a consultation (the service's
  `holdMatter` and the statement's in-batch guard both take `open` or `consultation`; an intake is
  still refused, because it has nothing yet to pause). The close route already accepted one at the
  service — the same preconditions run, and a consultation with nothing on its ledgers passes them.
  What was new on the close side is the release: `releaseMatter` returns the matter to where the
  hold found it, reading `opened_at` as the one honest signal (stamped, it goes back to Active;
  empty, it was a consultation and goes back to being one), and `reopenMatter` already restored a
  consultation by the same signal. A closed consultation keeps its tentative number and draws no
  matter number. The refusal code for a hold on the wrong status keeps its name (`matter-not-open`)
  because callers branch on it; its message names both statuses the hold takes.
- **L2 is a dropdown of STEPS, and the "steps, never a picker" comment now says why that is not
  a picker.** The seal is `DropdownMenu` over the Badge, with a chevron it has earned (the menu
  always holds at least one step and the way into the window). It lists the steps available from
  where the matter stands and never the five statuses. Each step declares how it is taken from
  the seal (`takenFrom` on the model): the hold, the close, the open and the intake's completion
  open the status window at the step — the hold with its reason field already asked, the others
  with their requirements in view — and the release and the reopen ask their one question in the
  product's confirm panel and run. The window stays, as the last item on the menu ("Matter
  Status"), because it is where the number, the engagement and the paper file live; its own
  seated step controls are unchanged. A refused step is offered refused, its reason under the list
  rather than in a hover a disabled item cannot show.
- **The seal reads the session through the shared store** (`session-permissions.svelte.ts`) as the
  pointer reaches it or focus lands on it, so the menu's items are usually already answered when it
  opens instead of flickering from refused to offered; opening the menu or the window is the
  backstop for a touch. The window used to make its own read on open.
- **A seam left.** A held matter's steps are keyed by status alone, so "Close Matter" and
  "Release Hold" read the same on a held consultation as on a held active matter; only the
  consultation's own rung says "Close Consultation". The done sentences are neutral where the
  rung cannot know ("back where the hold found it").

**What the code said when the round was staged.**

- **The lifecycle graph has no edge for either step.** `MATTER_LIFECYCLE_STEPS` in
  `apps/web/src/lib/matters/matter-lifecycle.ts` gives `consultation` exactly one step, Open Matter.
  It is not only the screen: the API refuses both. The hold route "refuses a matter that is not
  open" and the close route the same, so L1 adds edges to the contract as well as to the table —
  `consultation` gains a close and a hold, and reopen, which already "restores the status it left",
  generalizes to restore a consultation.
- **A closed consultation is coherent with the numbering rule, which is worth stating because it is
  the thing that usually breaks.** A matter draws its permanent number the moment it opens and never
  before, so a consultation the firm closes consumes no matter number and keeps its own tentative
  one. Nothing has to be unwound.
- **L2 amends a rule that is written down and argued for.** `matter-lifecycle.ts` opens with "STEPS,
  NEVER A PICKER... A control that let somebody pick 'Closed' from a list would be offering a state
  the lifecycle may not put a matter in from where it stands", and the contract is shaped to match:
  one POST per step, none of which takes a status, and the hold alone takes a body — its reason. The
  reconciliation the round has to find is a dropdown that offers the steps available FROM where the
  matter stands, rather than a list of the five statuses; and the hold still has to ask for its
  reason somewhere, which is what the status window does today. With L1 adding two edges, a
  consultation's seal would offer three, which is the case that makes a dropdown read better than a
  row of buttons.
- The seal is `matter-status-dialog.svelte`, rendered inline in the matter header's meta line
  (`matter-header.svelte`), and the header's own comment already calls it "the control": "Pressing
  the status seal opens the status window, which is where a matter is opened, closed or reopened."
  L2 is that sentence becoming true without a window in the way.

### The status window's Location

| #   | Ruling                                                                                                                                                                        | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| W1  | **The status window's Location links to the office record**, and it is a modular component — the same piece used wherever an office is named, not a field written again here. | settled |

W1 stayed open on 2026-09-11 because it waits on the Offices component (`O1` in
[`settings-rulings.md`](settings-rulings.md)), which is the piece it has to be modular over. Offices
landed, and W1 was built on 2026-09-14.

**Notes recorded this round (2026-09-14).**

- **The Location W1 means is the PAPER FILE's, and it is a second office on the matter.** The
  ambiguity below is settled the way the research reads it: the row literally in the pillbox is the
  Physical File's Location, so that is the one that became real. It is a new nullable column
  (`matter.physical_file_location_id`, pointing at `location`) beside the owning office, never
  derived from it. A firm boxes a closed matter's folder with other matters' folders, commonly at a
  remote store it keeps as an office of its own, so a matter run out of Carson City can have its
  file at Sparks; deriving one from the other would state, with a record's confidence, a building
  the folder has left. The write is the existing matter patch behind `matters:edit`, and null is a
  real answer — a firm that has lost track of a file has to be able to say so.
- **The modular piece is now proven modular**, which was the other half of the ruling. `OfficeLink`
  names the office on the status window; `OfficePicker` sets it there and also replaced
  `vocabulary-picker.svelte` on the New Matter dialog's Location, so the office a matter is run out
  of and the office its file is kept at are chosen by one control reading one list. Nothing imports
  `VocabularyPicker` any more; it is left standing with a note saying so rather than deleted.
- **The other two rows did NOT become real, and the reasons differ.** "Held In" waits on a record
  that does not exist: one container holds several matters' folders, so it is a thing a matter
  points at rather than a column, and a column would decide the medium — box, drawer, safe, shelf —
  for every firm, which the owner has already refused. "Destroy After" waits on something harder:
  there is no retention clock anywhere in the platform, and the custody register runs no timer at
  all. A date invented here is a date somebody destroys a client's file on. Both keep the Soon mark
  and neither grew a dependency sentence, per the 2026-09-01 ruling.
- **Which rows are real is one list with one test.** `MATTER_PHYSICAL_FILE_FACTS` carries a `served`
  flag rather than the template branching on row keys, so turning "Held In" on is a word in the
  model when its register arrives.
- **The window reads the office itself when it opens**, the way it re-reads the engagement, so a
  file moved from another surface between two openings is not stated where it used to be. That costs
  one request the matter chrome's own record could have carried; folding the field into
  `matter-record.ts` is the follow-up, and it was not taken because that file belonged to another
  stream this round.
- **A defect found while building it, and fixed.** The window's "read again on every opening" was
  written as an effect guarded by a "have I asked" flag that `onOpen` clears. `ActionDialog` calls
  `onOpen` from an effect of its own, and a child's effects run after the parent's — so the guard
  was read before it was cleared, and the engagement was read on the window's first opening and
  never again. A member who amended a fee arrangement elsewhere and reopened this window saw the
  old deal, which is exactly what the comment above that code said must not happen. Both re-reads
  are now made from the opening transition itself rather than from an effect, and the reasoning is
  written where the next person will meet it. The readiness reads stay effects on purpose: they ask
  about the matter's own status, which only this window changes.
- **A seam left.** The column records where a file IS, not how it got there. A firm that wants the
  movement history — who boxed it, when, where it went — has nothing, and nothing was asked for.

**What the code said when the round was staged, and the ambiguity it settled.** There were **two**
different locations on a matter, and W1 had to say which it meant.

1. The **owning office** — `matter.locationId`, chosen in the New Matter dialog through
   `vocabulary-picker.svelte` (the picker it shared with the matter type before practice areas took
   their own) and shown as `matter.locationName` in the header's citation line. This is a firm
   office, and it is the thing the Offices screen staged as `O1` in
   [`settings-rulings.md`](settings-rulings.md) will manage.
2. The **paper file's whereabouts** — the status window's "Physical File" section, whose three facts
   are Location, Held In and Destroy After (`MATTER_PHYSICAL_FILE_FACTS` in `matter-lifecycle.ts`).
   All three were unserved: every row read "Not recorded" beside a Soon mark. This is the one that
   was literally in the pillbox, and it is the reading the round took.

Reading W1 as the second — the Physical File's Location resolving to an office record rather than
being free text, with Held In carrying the room, shelf or box beneath it — makes the paper file
lean on the office subsystem instead of inventing a second register, and it is why the component
has to be modular: the same office reference appears in the New Matter dialog, on the header's
citation, in the Offices screen and here. The alternative reading, that the owning office simply
gains a link through to its office record, is a smaller piece of the same component. Both want the
office picker and the office link to exist once.

The office record itself did not exist as a screen — the backend did (`packages/locations/`,
`/api/v1/locations`, letterhead logo included), which is the finding recorded under `O1`. So W1 was
sequenced behind the Offices work rather than beside it, and the notes above are what it built once
that landed.

## R2 — round two: the seal is a pillbox, and one control changes the status

The owner, 2026-09-14: "for the matter status pillbox, it should not be a dropdown. It should still
just be a pillbox. Instead of buttons that say Open Matter / Close Matter / On Hold, just make it a
button to change status, which will populate a different modal that will discuss the requirements.
This may mean that you need to move any checks for changing information into this new modal."

**This reverses L2 above**, which shipped three days earlier. L1 is untouched: a consultation can
still be opened, put on hold, or closed as declined, and all three are offered by what replaced the
dropdown.

| #   | Ruling                                                                                                                                                                                          | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| S1  | **The seal is a pillbox.** It reads the status and nothing more: no menu hangs off it, no chevron. Pressing it opens the status window, as it did before L2.                                    | settled |
| S2  | **One control changes the status, labelled for that act** rather than for any particular step. Not three buttons, not a menu of steps.                                                          | settled |
| S3  | **It opens a modal that discusses the requirements** — where the matter stands, which steps the lifecycle allows from here, what each requires and whether that is met, and the act itself.     | settled |
| S4  | **The checks move into it.** What belongs in the change modal and what stays in the window that reads the record is the round's own design work, and the owner said explicitly that it is open. | settled |

**Notes recorded this round (2026-09-14).**

- **The division is what a fact is ABOUT, and that is the answer to S4.** The requirement lists (to
  close, to open, to complete the intake), the hold's reason field and the step controls are all
  about a CHANGE to the status, so they moved into the panel that makes the change, where the
  decision is actually taken. The number, the engagement and the paper file are STANDING facts about
  the record — true whatever the status is, changed from their own controls, read by somebody who
  did not come to change anything — so they stay in the window. The window carrying both made the
  requirements read as a standing property of the matter, which they are not: they are the answer to
  a question nobody has asked yet. A held matter's Since and Reason stay in the window for the same
  test: they state what IS, not what could be done.
- **Why a modal that names the requirements is not a status picker**, which is what
  `matter-lifecycle.ts`'s opening comment now says. The lifecycle still decides which steps exist
  from where the matter stands; the reader is choosing among those steps, never setting a status.
  The contract is unchanged — one POST per step, none of which takes a status, the hold alone
  carrying a body. What the panel adds is the reasoning a menu of verbs could not carry.
- **The steps are `ChoiceRow`s and the commit is the chosen step's own verb.** Each row carries one
  line saying where that step stands: the block sentence where there is one (a sample matter, a
  permission the account does not hold, a session still being read), otherwise "Nothing stands in
  the way", "One requirement is not met", "Checking what this requires", or "This could not be
  checked". A refused step is offered refused ON THE ROW rather than in a hover a disabled control
  cannot show — which is strictly better than the dropdown, where the reasons had to be collected
  under the list. Choosing a step states what it would do to the record and lists everything it
  requires; the footer commit then reads that step's own label, per the 2026-09-05 ruling that a
  lifecycle control reads the step's own verb.
- **Every step gained a `consequence` sentence, and `takenFrom`/`confirmation` went.** The three
  steps no rule gates — the pause, its release and the reopen — have no requirement list to read,
  so the consequence is the whole of what the panel can say about them; it is what the release's
  and the reopen's confirmation panels used to say, moved to where the choice is made. With one
  panel taking every step, there is nothing left for `takenFrom` to decide, and the separate
  confirm panel is gone.
- **One function answers where any step stands** (`matterStepStanding`), because the three gated
  steps answer in two different shapes: the close has a fixed roster of rules to state as MET,
  while the open and the intake's completion have only whatever the firm's own procedure refused.
  A step gated by the procedure gets ONE met row saying so rather than a sentence standing where
  the list would be, which is what keeps the panel rendering a structure in every state
  (`lint:structured-empty`).
- **The readiness reads moved to the panel and are made per opening.** The window used to ask up to
  three readiness questions every time it opened, on most visits for nothing. The panel asks only
  the ones its steps need, from the opening transition rather than an effect (the `onOpen` ordering
  defect recorded under W1), and asks again on every opening because money moves between them.
- **A sample matter's control is disabled with the reason beside it**, not absent, and the sentence
  is now one exported constant so the window and the panel cannot word it differently.
- **A seam left.** The panel preselects the only step where a status offers exactly one (a closed
  matter's reopen, an intake's completion), which saves a press but means a status with three steps
  opens with the commit refused until one is chosen. That is the honest shape of the choice and it
  is deliberate; if it reads as friction, the fix is to lead with the step the lifecycle runs
  toward rather than to preselect nothing.
