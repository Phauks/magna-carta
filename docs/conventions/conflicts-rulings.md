# Conflicts — the owner's standing rulings

Every ruling the owner has issued on the conflicts surface, cumulative, newest round last. **A
ruling here is settled.** It is not re-derived, re-proposed, or re-litigated by a later round, and a
round that silently reverts one is a regression, not a redesign.

The surface is the firm's log at `apps/web/src/routes/(app)/conflicts/`, one check read back at
`conflicts/checks/[checkId]`, the matter's own section at `matters/[id]/conflicts`, the policy page
at `settings/conflicts`, and the parts they are built from in `apps/web/src/lib/conflicts/` over
`packages/conflicts/`.

Status values: `settled` (built and confirmed) · `regressed` (was settled, a later round undid it) ·
`open` (asked for, not yet built) · `superseded` (a later ruling replaced it, with the pointer).

Rulings that generalize from the other ledgers bind here too — notably the tabbed-pane and
no-reflow rulings staged for the Upload dialog in
[`file-manager-rulings.md`](file-manager-rulings.md), the consolidation round in
[`settings-rulings.md`](settings-rulings.md) (which owns the firm's conflicts policy page), and the
standing corrections in [`design-corrections.md`](design-corrections.md).

**Concurrent work.** `claude/conflicts-check-ui-0i4kir` is in flight over this same area — it lit
the destination, gave a matter its own Conflicts section, and added the firm policy page on a new
`conflicts:configure` permission. Its note asks that `matters/sections.ts`,
`navigation/destinations.ts`, `access-control/src/registry.ts` and
`apps/api-worker/src/routes/conflicts.ts` not be stepped on. Check where it has landed before this
round starts.

## R1 — round one: the check panel loses its paragraphs and its limits

The owner's notes of 2026-09-11, staged. **Nothing here has been started** — the round was recorded
ahead of the work and waits on the owner's go-ahead, so every row below is `open` as a statement of
fact rather than an oversight. The research beneath each group is what the code says today; it is
not a plan.

### The New Check panel

| #  | Ruling                                                                                                                                                                                                                                                                                                                                                                | Status |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P1 | **The panel says less.** A line of explanation under every control is clutter, and there is enough of it here to bury the controls themselves. Cut the per-control prose back. This **amends the direction of 2026-09-08** that each setting carry its own sentence in place — the intent was that a setting be understandable, not that the panel become a document. | open   |
| P2 | **"Where To Look" reads "Search Locations".**                                                                                                                                                                                                                                                                                                                         | open   |
| P3 | **The locations are LOCATIONS, listed as places** — Directory, Files, Messaging, Magnus, and the rest of the product's listings — not techniques. The specifics of each sit beneath it behind a caret, so the reader chooses where to search first and tunes how second.                                                                                              | open   |
| P4 | **The location list is modular.** Adding a place the product can search is an entry in the list; it is not a redesign of the pane.                                                                                                                                                                                                                                    | open   |
| P5 | **Name matching is a dropdown, and it shows examples of what it would hit.** A band that says what it catches by showing a name it catches needs no paragraph.                                                                                                                                                                                                        | open   |
| P6 | **The right pane is tabbed: one tab for Locations, one for Advanced Settings.** The settings named in these rows are what Advanced Settings holds; Locations is the tab a member actually uses.                                                                                                                                                                       | open   |
| P7 | **Input and output are separated.** What was asked for and what came back are never laid out as one run of sections.                                                                                                                                                                                                                                                  | open   |
| P8 | **Once the person is chosen, the matter field offers the matters that person is on.** A dropdown of the eligible matters they are assigned to, rather than a free search of the whole docket.                                                                                                                                                                         | open   |

**What the code says today.**

- **The clutter is a ruling from the round before, working as written.** `check-scope.svelte` opens
  by recording the 2026-09-08 direction and then the rule it produced: "SO EVERY CONTROL SAYS WHAT
  IT SEARCHES, IN PLACE. A hover title is not a label." Every checkbox, radio and number field
  therefore carries a `text-xs text-text-muted` line, each group carries a paragraph above it, and
  the pane carries the firm's floor sentence on top of that. P1 is the correction to that rule, not
  a discovery of an oversight — the accessibility reasoning behind it (a hover title is not a
  label, and a touch device has no hover) still stands and has to be met some other way. The
  dropdown-with-examples of P5 is the shape the owner has named for one of them.
- **Today's list is techniques, not places, and P3 is a change of axis rather than a relabel.**
  `SOURCE_VOCABULARY` in `conflicts-vocabulary.ts` offers "Name or identifier", "Relationship", "The
  firm's own people", "Documents and messages", "Prior-firm history" and "Nickname equivalents";
  `packages/conflicts/src/sources.ts` is the one home for what each can search and why it cannot.
  Mapping those onto Directory / Files / Messaging / Magnus does not line up one-to-one: the content
  class bundles document text and message bodies into a single source that would have to split
  across two locations, Magnus is not a source at all today, and prior-firm history and nickname
  equivalence are dimensions rather than places. Every past check's recorded scope is keyed by the
  technique, and the log is append-only, so a location-shaped pane needs a mapping that keeps old
  records readable — which is the same constraint `sources.ts` already exists to hold.
- **The availability seams are load-bearing and must survive the reshape.** Only `party`, `graph`
  and `imputation` have a corpus; `content`, prior-firm history and nickname equivalence are
  registered precisely so a check records them as not searched rather than omitting them. A reader
  has to be able to tell "searched and found nothing" from "never searched", so a location the
  product cannot yet search still appears, saying so.
- **P8 needs no new endpoint.** `check-subject.svelte` runs its own debounced `listMatters` over the
  whole caseload, unfiltered by the parties chosen, because the matters listing takes only `status`
  and free-text `search`. The read that answers P8 already exists on the other side:
  `GET /api/v1/directory/entities/{entityId}/matter-parties` returns the matters an entity is a
  party to, with the matter's title, number and status.
- P6's tabs are the same move being staged for the Upload dialog, and the same reason: a pane that
  grows by stacking is a pane that has to be redesigned to grow again.

### What a check may limit

| #  | Ruling                                                                                                                                                                                                                              | Status |
| -- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| E1 | **A check follows relationships all the way through.** "How far to follow relationships" is removed — there is no depth for anyone to set. A limit here is a conflict the firm does not find, and that is the failure that matters. | open   |
| E2 | **Where the search stops goes with it.** A check is not capped: the same reasoning, and for the same reason it is not a setting.                                                                                                    | open   |

**What the code says today, and what E1/E2 reach.** The bounds are not only two fields in the panel.
`CheckDraft` carries per-edge-class hop budgets and two limits; the firm policy carries
`defaultDepth`, `edgeClassBudgets`, `closureCap` and `candidateCap`, and the conflicts settings page
sets a floor over them; the check row stores `depth` (a `depth >= 0` constraint sits in the per-firm
baseline); the log has a **Depth** column; and a check that reaches the candidate cap records itself
as truncated, which the product surfaces on purpose. Removing the settings therefore reaches the
draft, the request, the policy, the schema's stored scope, the log's columns and the report's own
sentences.

One thing already agrees with E1 and is worth keeping as the precedent: the corporate class carries
no budget at all, and the pane says so in plain words — "Followed all the way, however long the
chain runs" — because a rename, merger or successor chain is the same legal person continuing. E1
extends that stance to every class.

The tension to hold in the open, not to resolve here: the caps are also what bounds a run's cost,
and the load profile measures conflicts runs
(`packages/fixtures/src/load-profile/conflicts-measurements.ts`). An unbounded walk is precisely
the kind of search that cannot complete inside one request — which is the same fact R4 is asking the
screen to report on. The two rows may well be one piece of work.

### The check screen

| #  | Ruling                                                                                                                                                                                                      | Status |
| -- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R1 | **A conflicts check has an ID number.** It is how a check is referred to, on its own screen, in the log, and in anything printed.                                                                           | open   |
| R2 | **The report's top right is exactly two controls: Print Report and Download Report.**                                                                                                                       | open   |
| R3 | **A check can be assigned to a matter from the report screen.** A check run before there was a matter is the ordinary case, and the moment a matter exists is the moment somebody is looking at the report. | open   |
| R4 | **While a check runs, the screen says where it is and what has been checked so far.** A search nobody can watch is exactly the one that has to report on itself.                                            | open   |
| R5 | **The report screen is formatted.** As it stands the settings and the output read as one undifferentiated page; the two have to be told apart at a glance.                                                  | open   |
| R6 | **A check can be re-run from its own screen.**                                                                                                                                                              | open   |
| R7 | **A check carries a history.** The re-runs of one check belong together, on the check, rather than scattering as unrelated rows in the firm's log.                                                          | open   |

**What the code says today.**

- **A check has no number, anywhere.** The identifier is the opaque `conflictsCheck` handle in the
  URL; the log's columns are Run, Trigger, Asked By, Against, name matching, Floor, Depth and
  Candidates, with the run instant doing the work of a reference. So R1 shows up in three places at
  once: the report's own header, the log, and the printed sheet. The firm already owns machinery for
  drawn numbers — `numbering-scheme.ts` has two purposes, matter and consultation — and the settings
  round is reconsidering that screen anyway, so whether a check number is a third purpose or a
  simpler firm-wide sequence is a decision the two rounds should take together rather than twice.
- **The report's two controls are not the two the owner asked for.** The screen header's actions are
  "Where the matter stands", shown only when the check already names a matter, and "The report",
  which opens a `PrintSheet`. R2 replaces them with Print Report and Download Report; R3 is the
  control that has to exist for a check with no matter, which is the case the whole preliminary
  trigger exists for and is exactly when "Where the matter stands" is absent.
- **There is no re-run and no run history.** `RotateCcw` is imported on the check page and never
  used, which is the shape of a control that was removed or never wired. The page reads one check
  and renders it; re-running means going back to the log and opening the New Check panel again,
  which produces an unrelated row. R6 and R7 are what turn those into one record with a trail.
- **There is no running state to show, because the run is one request.** `runConflictsCheck` POSTs
  to `/api/v1/conflicts/checks` and returns the finished check; the page's only interim state is a
  `LoadingRegion` over an invented three-line fixture, deliberately inert and hidden from assistive
  technology so none of it can be quoted as what a search did. R4 asks for a real reading of a real
  run, which is a different shape of request as well as a different screen.
- **R5's cause is visible in the markup.** The body is three sections of equal weight separated by
  plain rules — What The Search Did, Scope In Force, then the hit list — with no framing to say that
  the first two are what was asked for and the third is what came back. That is P7's separation seen
  from the other end, and the page's own header comment already names the risk it is guarding
  against: a candidate count read without the account of the search that produced it gets misread as
  a verdict.
