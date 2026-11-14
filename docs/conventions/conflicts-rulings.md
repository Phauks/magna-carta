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

**No conflicts stream is in flight.** Both branches that built this surface have landed and the
work is on `main`: `claude/conflicts-check-redesign-w7pl40` landed in "The conflicts screen is the
log, and a check is asked for in a panel" (#575, 2026-09-08) and
`claude/conflicts-check-ui-0i4kir` in "Conflicts check: the surface lit, a matter section, and the
firm's own floor" (#556, 2026-09-07) — each verified by walking `main` forward from the branch's
merge base to the first commit the branch merges into without changing, which is the only test that
does not expire. `docs/active-work/claude/conflicts-check-ui-0i4kir.md` is still on `main` and is a
dead note: it warns about a stream that finished, and it is owed a
`vp run retire-note claude/conflicts-check-ui-0i4kir`.

## R1 — round one: the check panel loses its paragraphs and its limits

The owner's notes of 2026-09-11, built on 2026-09-12. Every row below is `settled` in the code of
the same commit; the research beneath each group is what the code said BEFORE the round, kept as
the record of what changed, and "Notes recorded this round" at the end of the round says what was
decided along the way and what is still owed outside this surface.

### The New Check panel

| #   | Ruling                                                                                                                                                                                                                                                                                                                                                                | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| P1  | **The panel says less.** A line of explanation under every control is clutter, and there is enough of it here to bury the controls themselves. Cut the per-control prose back. This **amends the direction of 2026-09-08** that each setting carry its own sentence in place — the intent was that a setting be understandable, not that the panel become a document. | settled |
| P2  | **"Where To Look" reads "Search Locations".**                                                                                                                                                                                                                                                                                                                         | settled |
| P3  | **The locations are LOCATIONS, listed as places** — Directory, Files, Messaging, Magnus, and the rest of the product's listings — not techniques. The specifics of each sit beneath it behind a caret, so the reader chooses where to search first and tunes how second.                                                                                              | settled |
| P4  | **The location list is modular.** Adding a place the product can search is an entry in the list; it is not a redesign of the pane.                                                                                                                                                                                                                                    | settled |
| P5  | **Name matching is a dropdown, and it shows examples of what it would hit.** A band that says what it catches by showing a name it catches needs no paragraph.                                                                                                                                                                                                        | settled |
| P6  | **The right pane is tabbed: one tab for Locations, one for Advanced Settings.** The settings named in these rows are what Advanced Settings holds; Locations is the tab a member actually uses.                                                                                                                                                                       | settled |
| P7  | **Input and output are separated.** What was asked for and what came back are never laid out as one run of sections.                                                                                                                                                                                                                                                  | settled |
| P8  | **Once the person is chosen, the matter field offers the matters that person is on.** A dropdown of the eligible matters they are assigned to, rather than a free search of the whole docket.                                                                                                                                                                         | settled |

**What the code said before this round.**

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

| #   | Ruling                                                                                                                                                                                                                              | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| E1  | **A check follows relationships all the way through.** "How far to follow relationships" is removed — there is no depth for anyone to set. A limit here is a conflict the firm does not find, and that is the failure that matters. | settled |
| E2  | **Where the search stops goes with it.** A check is not capped: the same reasoning, and for the same reason it is not a setting.                                                                                                    | settled |

**What the code said before this round, and what E1/E2 reached.** The bounds are not only two fields in the panel.
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

| #   | Ruling                                                                                                                                                                                                      | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| R1  | **A conflicts check has an ID number.** It is how a check is referred to, on its own screen, in the log, and in anything printed.                                                                           | settled |
| R2  | **The report's top right is exactly two controls: Print Report and Download Report.**                                                                                                                       | settled |
| R3  | **A check can be assigned to a matter from the report screen.** A check run before there was a matter is the ordinary case, and the moment a matter exists is the moment somebody is looking at the report. | settled |
| R4  | **While a check runs, the screen says where it is and what has been checked so far.** A search nobody can watch is exactly the one that has to report on itself.                                            | settled |
| R5  | **The report screen is formatted.** As it stands the settings and the output read as one undifferentiated page; the two have to be told apart at a glance.                                                  | settled |
| R6  | **A check can be re-run from its own screen.**                                                                                                                                                              | settled |
| R7  | **A check carries a history.** The re-runs of one check belong together, on the check, rather than scattering as unrelated rows in the firm's log.                                                          | settled |

**What the code said before this round.**

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

### Notes recorded this round

Decisions taken while building, so the next round does not re-derive them.

- **A check is a numbered record, and every search under it is a run.** `conflicts_numbered_check`
  and `conflicts_check_run` sit beside the append-only `conflicts_check`, which is now one run's
  RECORD. A numbered check is identified by its first run's handle and every run by the handle of
  the record it writes, so the old addresses still resolve and no new identifier kind was needed.
  The number is drawn from the firm's `conflicts_check` numbering scheme through the shared draw
  in `@magna-carta/sequence-numbering` (a counter row per scope and an allocation row per value,
  as every other numbered record), rendering `CC2026-00001` by default and restarting each year;
  it was `CC-` and four digits from `MAX + 1` until the numbering register consolidated every
  sequence (2026-09-18). Decision records:
  `docs/decisions/pending/a-conflicts-check-is-a-numbered-record-with-runs-under-it.md` and
  `docs/decisions/pending/every-number-the-firm-issues-is-drawn-from-one-register.md`.
- **Opening answers at once; the search runs after the response.** `POST /api/v1/conflicts/checks`
  answers 202 with the id, number, run id and ordinal; the run reports its stage (sources, walking,
  matching, candidates) with counts on its row, and the screen polls it every second until it
  settles. Execution rides the request's background allowance today (`runInBackground`), with a
  two-minute stale rule settling a run the runtime abandoned; the executor
  (`apps/api-worker/src/conflicts/check-run-executor.ts`) is one function a queue consumer can call
  unchanged when the per-firm dispatch table can take it — that table is outside this surface.
- **E1/E2 reach the engine, not only the panel.** `expandGraph` walks to closure under one platform
  ceiling (`WALK_CEILING`), the write bound is the most one batch can carry
  (`CANDIDATE_WRITE_CEILING`), and both are stated on the record when reached. Stored JSON keeps its
  key names so old rows parse; a row that ran under hop budgets reads under them everywhere.
  Decision record: `docs/decisions/pending/a-conflicts-check-follows-relationships-to-closure.md`.
- **The locations map onto stored technique keys and nothing is re-keyed.** Directory stands over
  party, graph and imputation; Files and Messaging both stand over the content class until they grow
  corpora of their own; Magnus is a registered source of its own (`magnus_conversations`), recorded
  unavailable on every check so the log can never read as searched-and-clean for conversations.
  Prior-firm history and nickname equivalence are dimensions, not places, and sit under Advanced
  Settings, both Soon. The mapping is `SEARCH_LOCATIONS` in `conflicts-vocabulary.ts` over
  `packages/conflicts/src/sources.ts`.
- **Advanced Settings holds name matching as well as the two dimensions.** P6 says the settings the
  rows name go there, and P5 is one of the rows; Locations is only places.
- **Run Again lives on the Runs card, not in the header.** R2 fixes the header at exactly two
  controls, so the re-run sits with the history it adds to.
- **Download Report is the printed sheet, projected.** `reportExportDocument` turns the very
  `PrintSheetDocument` Print Report shows into the document renderer's tables, and the download
  follows the export menu's two paths (save now, or keep on the Downloads shelf) so a report
  downloads exactly the way a ledger export does.
- **The matter's re-check lands on the run it opened.** `matters/[id]/conflicts` goes to
  `/conflicts/checks/{id}?run={runId}` so the screen shows the run just asked for.
- **Owed outside this surface, and named in the round's report:** the per-firm migration registry
  entry in `apps/api-worker/src/per-firm-migrations.ts` (without it a firm database cannot boot the
  new lineage); the PII registry entries for the two new tables in
  `packages/data-access/src/pii-registry.ts`; one line in `packages/intake/src/readers/conflicts.ts`
  that still reads a depth shortfall; the load-profile measurements in
  `packages/fixtures/src/load-profile/conflicts-measurements.ts` that still pass budgets; and
  `apps/web/src/lib/matters/new-matter-dialog.svelte`, which still runs a check synchronously
  through the compatibility `runConflictsCheck` and would read better showing the run.

## R2 — round two: the check redesign of 2026-11-09

The owner's rulings of 2026-11-09, given over six rounds of mockups and built the same day. Rows
marked `settled` are built in the commit that adds them; `open` rows wait on the indexes named
beneath them. Rows here supersede R1 where they say so.

### The New Check panel

| #   | Ruling                                                                                                                                                                                                         | Status                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| N1  | **The panel does not ask for a matter.** A check is a search for parties; the matter is chosen from the report. Supersedes P8.                                                                                 | settled                |
| N2  | **No "What This Check Will Do" read-back.** What the check searches is the right pane's options.                                                                                                               | settled                |
| N3  | **Five locations, each a dropdown of what it searches:** Directory (Names and identifiers, Relationships, Firm Employees), Files, Messaging (Calls, Texts, Email), Tasks, Magnus (All Employee Conversations). | settled                |
| N4  | **Files and Tasks each offer Consultations, Open, Closed and Archived, all on by default.** Filed email and attachments are part of a matter's files, so they need no option of their own.                     | built                  |
| N5  | **An option says what it searches, never its relationship to policy.** No "always searched, the firm's floor", no waits-on sentence.                                                                           | settled                |
| N6  | **"Firm's own people" reads "Firm Employees", and it does not need a matter.** Without one it asks whether anybody the check reached is one of the firm's members, by identity.                                | settled                |
| N7  | **Locations search in parallel.** Each place runs on its own and reports on its own row.                                                                                                                       | open (one place today) |

### The check page

| #   | Ruling                                                                                                                                                           | Status                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| C1  | **Report and Runs are tabs**, after Cloudflare's Workers pages. The run history is no longer a column beside the report. Supersedes the Runs card of R1.         | settled                  |
| C2  | **The report is three collapsible sections: Details, Status, Results.** Details is the parties, one per line, then a Settings area.                              | settled                  |
| C3  | **The per-location status log is part of the report**, live while the run is in flight and kept afterwards.                                                      | settled                  |
| C4  | **A run can be cancelled, and Cancel is merged into the Running badge.** A cancelled run reads Cancelled, names who stopped it, and needs no explanatory banner. | settled                  |
| C5  | **Print Report and Download Report are icon buttons without text.** Amends R2 of round one.                                                                      | settled                  |
| C6  | **"Candidates" reads "Results"; "Nothing surfaced" reads "0 results".**                                                                                          | settled                  |
| C7  | **Each result says why and where**: strength in a word, which search found it, what matched, how it was reached, with the full account one click away.           | settled                  |
| C8  | **Results are filterable**, by text, by which search found them, by strength and by review state.                                                                | settled                  |
| C9  | **The Answer button becomes a review dropdown**: Not reviewed, Cleared, Waived, Walled off, Declined.                                                            | settled                  |
| C10 | **The report names the searcher, never a user handle.**                                                                                                          | settled                  |
| C11 | **Results populate live and can be reviewed mid-run**, and a run waits for documents still awaiting text extraction.                                             | open (waits on indexing) |

**Notes recorded this round.**

- **A cancelled run is stored as `failed` with `cancelled_at` and `cancelled_by_user_id` set**, not a
  fifth status: the status set is a CHECK constraint and widening it in SQLite rebuilds the table.
  `reportedRunStatus` in `packages/conflicts/src/check-run.ts` is where a read turns it into
  `cancelled`. The executor notices at its next progress report, whose guarded write finds no
  running row, and stops without recording.
- **The panel draws Files, Messaging, Tasks and Magnus with their options, disabled and marked Soon**,
  until the indexes behind them exist; the Status section reads them Not searched. N4, N7 and C11
  land with those indexes.
- **The Results "Found In" chips name the Directory's three searches** (Names and identifiers,
  Relationships, Firm Employees) while the Directory is the only place searched; they become places
  when a second place reports. A Party chip waits on hits recording which subject party they came
  from, which the record does not hold today.

- **2026-11-10, Trevor: "there are no such things as private Magnus conversations. general would
  still be allowed to be searched."** A check searches every Magnus conversation that is not deleted,
  General included, and every call, text and email whether or not it is filed on a matter.
- **Messaging, Tasks and Magnus are searchable** (`packages/conflicts/src/content-search.ts`). They
  are searched for the check's subject parties, not the walked closure: by identity first (a linked
  record, a phone number's digits, an email address, all tier 1) and then by the party's names
  compared whole and without regard to case (tier 2). An email's body lives in R2 rather than the
  database and is not searched; the report says so. A result records where it was found in
  `conflicts_hit.found_in_json` (kind, id, matter, instant, never the record's text), and the "Found
  In" chips now name the kind of record. Tasks' Archived option means archived tasks; matters have no
  archived status. Since 2026-11-10 the names in calls and texts, tasks and Magnus are read through
  the record index (#751) as exact phrases, so matching is by whole word and folds accents; email
  stays on its own columns because it is not an index source.
- **Files is searchable through the file contents index** (`packages/conflicts/src/file-search.ts`),
  in line with the indexing and discovery design Trevor approved on 2026-11-10. The run asks each
  matter's own index in turn (never a discovery review set's), one question per party per matter with
  each name as an exact phrase, most recently active matters first, under a ceiling of 400 questions;
  unsearched and failed matters are counted and reported. Every file result is tier 2. Archived means
  files deleted from a matter (a file is only soft-deleted); matters themselves have no archived
  status. The application supplies the searcher (`apps/api-worker/src/conflicts/file-contents-searcher.ts`);
  while `SEARCH_SERVICE` is unbound it supplies none and the check records `files` unavailable with
  its reason. Since 2026-11-13, when the binding was declared, it also supplies none for a firm that
  has not turned file indexing on: that firm's files are in no index, and a searcher there would
  have the check record Files as searched and empty. **Not yet on the record:** a firm that does
  index its files can hold files the index does not have yet, and a check that reads `searched`
  does not count them. The Search and Indexing settings page does. A `narrowMatters` seam takes the firm-wide term summary the indexing work will build,
  so the fan-out shrinks without a change here.
- **2026-11-13, Trevor: "rename runs to History. remove 'Every search run under CC-0003. Open one
  to read its report.' there is not way to 'open its report'. assign to matter should be in next to
  the print button."** The check page's second tab reads History (amends C1) and carries no
  introductory line. Filing a check with no matter moved from the Details section to an **Assign to
  Matter** button in the header, beside Print Report, which opens the matter field in a popover.
- **2026-11-13, Trevor: "i think trigram overlap will likely be weak noise, so you should be able to
  disable it?"** A check carries a `trigramMatching` choice (Advanced Settings, "Trigram matching",
  on by default). Off skips the Directory's trigram channel at the balanced band only; the
  over-inclusive band always runs it, so it stays a strict superset of balanced. The run records the
  choice as `inputs_json.matching.trigramMatching` (absent on older rows, read as on), and the report
  says when it was off. Sorting trigram-only results by how much of the name overlaps was proposed
  and not built: it needs the overlap stored on each hit.
- **2026-11-13, Trevor, on the Directory's account of a check: "it should be better delineated into
  sections, not just raw text, remove —", then, of the mockup's options, "Blocks, like B, but don't
  allow multiple in the same row".** `describeCheck` returns keyed sections (heading, plain
  sentences, `attention`) instead of a numbered list, the check read carries them as `report`, and the
  Directory's Status row draws them as stacked blocks, one per row, with Not searched and any
  incomplete part tinted. No reader-facing line carries a dash, and the unavailable reasons in
  `packages/conflicts/src/sources.ts` became plain sentences. The printed report prints one section
  per part.
- **2026-11-14, Trevor: "revise conflicts screen within a matter considering our recent changes to
  conflicts checks screen. should try and reutilize components".** Mockup
  https://claude.ai/artifact/VgPYmdjvgpbfeWszhHHGb3, option A built. A matter's Conflicts section
  is four folding sections, like a check's Report tab: Results (the latest check's results, as the
  check screen's own cards and filters, reviewable in place), Standing (results not reviewed, by
  strength, as tiles; what has been answered; the policy shortfall and anything that could not be
  searched, tinted), Checks (the firm's log narrowed to the matter), and Re-checks (what is owed,
  the scheduled re-screening and Re-check Now). The cards, the result window and the answer dialog
  are one piece, `apps/web/src/lib/conflicts/results-review.svelte`, which the check screen now
  uses too. The old single-column panel (`posture-panel.svelte`) is gone.
- **2026-11-14, Trevor: "parties screen needs to be improved in matters as well", then "we also will
  need to account for counsel, which every case will likely have, or additionally, the firm the
  counsel is with".** The matter's Parties section is a full-width table: Name, Role, Capacity, and
  Conflicts, which says whether the latest check searched the party. A party linked after that check
  reads "Added after the latest check" in the warning tone. The rows are drawn by the matter through
  the parties tab's new `rows` snippet, so the add row and the Remove confirmation stay the tab's.
  A counsel's row (Opposing counsel, Co-counsel) names the firm the Directory says they practice
  with (a current employment, partnership, membership, officer, director or affiliation
  relationship) and offers **Add Their Firm**, which links that firm in the new role Opposing
  counsel's firm or Co-counsel's firm, so the next check searches it as a party. Before this, a
  counsel's firm was reached only through the relationship walk, and only if the relationship was
  recorded.
