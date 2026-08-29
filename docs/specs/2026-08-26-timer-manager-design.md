# The timer manager — header timer control grown up — design study

**Status:** Proposed (design study) · **Date:** 2026-08-26 · **Owner:** Trevor Goldsmith
**White-paper home:** _Financial Core — Time tracking_
**Builds on:** [`2026-06-22-slice-3-1-time-tracking-design.md`](2026-06-22-slice-3-1-time-tracking-design.md) (the shipped timer backend: the per-timekeeper Durable Object) ·
[`2026-08-25-personal-timesheet-design.md`](2026-08-25-personal-timesheet-design.md) (the three-place model — header = capture anywhere; this design grows that header surface up) ·
[`../conventions/time-tab-rulings.md`](../conventions/time-tab-rulings.md) (the owner's standing time rulings — every one binds here, TT1 and TD6 most of all)
**Mockup:** the timer-manager mockup (scratchpad `timer/timer-manager.html`), built to the same token vocabulary as The Timesheet mockup.
**Rounds:** round one proposed a chip-anchored popover; the owner struck it (round two, verbatim): _"opening the time sheet should be a full modal, it is that important. this small fitting is not enough for the magnitude of this task. reorganize and try again. this really needs to be a table, so we can use table functionality. table is much better for mass data review and data entry."_ Round three then reframed the surface fundamentally (verbatim, **the governing ruling**): _"it should be more or less a spreadsheet!"_ and _"this is the time sheet. It should have that functionality."_ — plus the itemized gaps: _"no way to edit the time quantity… no way to change elapsed time" · "no way to type to change matter number" · "no settable date field" · "no way to set fee rate" · "no calculation for total value" · "no one cares when time started" · "time is automatically logged. As soon as it is entered, it goes in. It does not need approval to get saved." · "no way to attribute who did something" · "no undo stack for deleting data" · "what is open my time sheet? this is the time sheet."_

The manager is therefore **not a timer-segment viewer with a logging handoff — it IS a rapid time-entry spreadsheet that timers feed into.** §5 specifies that surface; the single-active auto-pause model (§4) and the chip (§6) survive all rounds. Round two's stop-&-log handoff, bulk-select bar, Started column, and read-only logged tail are **superseded** where §5 says so.

**Round four** (owner review of the round-three build) issued nine corrections plus two addenda, all folded into §5 (see §5.6 for the list and the recorded reasoning): the rate becomes a card **dropdown** with a Custom override; **Recorded by becomes changeable** (the settled delegation model, rate re-resolving); the **Paused and Draft chips are struck**; a **private Internal Memo column** (Soon); rows **open into the full entry dialog stacked above** the sheet; **two dates** (work + recorded); **search**; the **description gets its own row line**; a **full undo/redo history**; the instruction text and the "Earlier" band are removed; "what was done" is corrected to "Description".

---

## 1. The surface's job

The top-right Time Keeper chip today is the handle for **one** running timer. The owner's commission: clicking it should open a **timer manager** — every timer the person has run for a period (today, by default), across different matters: see them, switch between them, resume, stop, and log each one.

The real day is interrupted. An attorney drafting on _Pemberton_ takes a call on _Whitfield_, answers an email on _Marsh_, and returns to the draft. Each interruption is billable time on a different matter, and the tool must make switching cost one click — because the alternative is what actually happens today: the timer keeps running on the wrong matter, or gets discarded, and the interrupting call is reconstructed from memory at week's end, badly. The manager's job is **capture continuity across interruptions**, and its measure of success is that no timed minute is silently lost or silently misattributed.

This grows up the header surface of the personal-timesheet design's three-place model without changing the model's boundaries:

| Place                 | Job                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------- |
| **Header** (this)     | Capture anywhere — now: the running timer AND the day's other timer runs, switch/resume/log |
| **`/time`** timesheet | Review and edit a period — all entries, correction, submission                              |
| **Matter Time tab**   | The matter's record                                                                         |

The timesheet design recorded "the chip never grows review affordances (no entry lists in the popover)." This design **revises that line deliberately**: the manager lists **timer runs** — capture-in-progress objects that exist nowhere else — plus a read-only tail of today's already-logged runs for continuity. The owner's round-two ruling then settled the magnitude: this is a **full modal with a real table**, sized for mass review and mass entry of the day's runs. The boundary that survives is the _object_, not the size: the manager works runs; a logged entry's row links out to `/time`, and entry editing, period review, and submission stay the timesheet's.

---

## 2. Current state (as built)

**The server timer** (`apps/api-worker/src/routes/timer.ts`, `src/timer/live-timer-durable-object.ts`):

- One Durable Object per `firmId:userId`; the DO stores **exactly one run** — a single JSON blob `{ liveRunId, startedAt, pausedIntervals, matterId?, narrative?, utbmsTaskCodeId?, lastActivityAt, status }`.
- Operations: `start` (mints a `live_run_id`), `pause`, `resume`, `bind` (matter required only at commit), `read` (client computes elapsed from `startedAt` — the DO never ticks), `stop-commit` (two-phase, idempotent on the run id; commits a **draft** `time_entry` with `source: "timer"`), `discard`. An abandoned-timer alarm flags a run left ≥ 10 h; resolution is keep / trim / discard.
- **A replacing `start` silently overwrites the stored run.** The route's own description says "stopping any timer already running," but nothing is committed and nothing is kept — `start` writes a fresh state blob over the old one. Starting a timer on a second matter today **destroys the first run's elapsed time**. This is the data-loss hazard the manager exists to close, and it means the manager is not UI over the existing API: the run store must become plural (§6).
- `stop-commit` refuses an unbound timer (422) and a sub-minute run that rounds to zero; the committed entry's narrative may be empty (`state.narrative ?? ""`), unlike manual capture, which requires Info.

**The chip** (`apps/web/src/lib/components/app-shell.svelte`): ships as resting anatomy — hairline chip, status dot geometry, tabular `0:00`, aria-disabled, with its light-up contract documented in place ("live elapsed while a timer runs; click opens the timer panel"). This design fills that contract with the manager as the panel.

**Listings:** `GET /api/v1/time-entries` answers one timekeeper × one day, or one matter. There is no read of timer **runs** (only the single `timer/read` state), no `source` filter, and no matter titles on the listing — all gaps §6 registers.

---

## 3. Competitive principles (verified 2026-08-26)

Four packages read — two legal (Clio, PracticePanther), two dedicated time trackers (Toggl Track, Harvest). Principles, not copies.

**Clio** (the owner's named reference):

1. **One timer runs at a time; starting another pauses the previous, and the previous stays resumable from where it left off.** Clio is explicit that concurrent running timers are impossible — the pause-and-stack model is the honest alternative.
2. **The pause moment is the logging moment.** Pausing surfaces the save modal — the tool asks for the entry while the work is fresh. (Adopted in softened form: **stop** offers the log dialog immediately; pause stays deliberately cheap and quiet, because a pause mid-switch must not interrupt the switch.)
3. **A "Timekeeper" surface beside the timer control lists the day's entries in one place** — restart, edit, create, arrows through previous days. Adopted: the day-scoped list of runs beside the timer control. Rejected (again — the timesheet design rejected it first): day-paging arrows and in-panel editing. Clio crams period review into header chrome because it has no equivalent of `/time`; we have one, one link away.
4. **The timer is startable from anywhere and survives navigation** — already true here by construction (the DO is server-side; the chip is fixed chrome).

**PracticePanther** (legal — the field's closest thing to a shipped timer manager):

5. **Held timers stack in one always-reachable place** (a right-side timer stack on every page); **starting a new timer auto-pauses the running one**, and the new timer stacks on top — newest-first ordering, switch-by-click. This is the held-run model working in a legal package today, and the strongest external validation of §4's recommendation.
6. **Binding can wait until save**: the timer runs first, and Save opens the entry screen where contact/matter are chosen — matching this platform's scratch-then-bind-at-commit design exactly. A timer's note becomes the entry's description, as a run's narrative does here.

**Harvest** (dedicated tracker):

7. **Restarting an existing entry's timer accumulates into that same day-entry** — one entry per project per day, however many sittings. This is §4's "resume accumulates into the same segment" argument, shipped: fragmenting an interrupted day into confetti entries is the failure both models avoid.
8. **Idle time gets an explicit resolution, not a silent policy.** The desktop apps detect keyboard/mouse idle and offer keep / remove the idle minutes / move them to a new entry. The timer-over-lunch is the inverse honesty leak of the unlogged run — time that _didn't_ happen, captured as if it did. The platform's abandoned alarm (≥ 10 h) catches the overnight case only; input-level idle is a client signal the slice 3·1 design already assigns to the UI. Noted as an owner question (M9) — v1 defers the detection but the run model must not preclude a trim-idle resolution (the DO's `lastActivityAt` + trim already fits).

**Toggl Track** (dedicated tracker):

9. **There is no pause at all — "continue" starts a new segment of the same work** (same metadata, new entry), keyboard-first (N starts, C continues the last). The radical version of commit-on-switch: every run _is already_ an entry from the moment it starts, so an unlogged run is structurally impossible. Not adopted (a legal entry needs a matter, an Info, and a rate — birth-as-entry would litter the WIP store with unbillable stubs), but the principle survives translated: **a run must never be silently lost** — held is the platform's equivalent of Toggl's already-saved.
10. **The day's list and its running total stay visible beside the timer** — timing and "where am I today" are one surface, not two. Adopted: the sheet shows the whole day's rows beside the live one (§5.1), with the day's totals always in the footer (§5.5).

Sources: [Clio Help — Time Entries](https://help.clio.com/hc/en-us/articles/9289741706779-Time-Entries) · [Clio — Is it Possible to Have Multiple Timers Running at Once?](https://support.clio.com/hc/en-us/articles/360000159554-Is-it-Possible-to-Have-Multiple-Timers-Running-at-Once-) · [Clio — Using Timers](https://support.clio.com/hc/en-us/articles/115003090754-Using-Timers-in-Clio) · [PracticePanther — How do I keep track of multiple time entries?](https://support.practicepanther.com/en/articles/1362748-how-do-i-keep-track-of-multiple-time-entries) · [Harvest — Tracking time: Day view](https://support.getharvest.com/hc/en-us/articles/360048181892-Tracking-time-Day-view) · [Harvest — How does the idle timer work?](https://support.getharvest.com/hc/en-us/articles/360048685231-How-does-the-idle-timer-work-for-the-Mac-and-Windows-apps) · [Toggl Track — Creating a Time Entry](https://support.toggl.com/en/articles/1957597-creating-a-time-entry) · [Toggl Track — The Timer Page](https://support.toggl.com/en/articles/2015973-the-timer-page).

---

## 4. The model: one live run, many held runs

### Recommendation

**Single-active stays; the manager adds a held-run set.** At most one run is `running` at any moment. Starting or resuming a run **auto-pauses** the current one — never discards it, never commits it. A day is therefore a set of runs across matters, exactly one live, the rest held (`paused` or `stopped`), each keeping its own accumulated elapsed time, matter binding, and narrative. Switching between matters is one click on the target run.

### True concurrent timers — rejected

- **Arithmetic honesty.** One person's concurrent timers sum to more than wall-clock time; the platform would be manufacturing billable hours. Every hour of the day attributed to at most one matter is the property that makes the day's total mean something — and it is the property a fee-audit reads for.
- **The platform's timer is single-active by design** — the DO serializes exactly this invariant, the slice 3·1 design records it as a decision, and offline reconciliation (drafts, never a second live timer) is built on it.
- Clio, the owner's own reference, refuses concurrency for the same reason and ships the pause-stack instead.

### Switch-commits-the-previous (each switch mints a draft entry) — rejected as the default

Committing on every switch fragments an interrupted day into confetti: six returns to the draft become six one-line entries on _Pemberton_ needing manual merge, and each commit demands Info at the worst moment — mid-interruption. Holding the run and **resuming accumulates into the same segment**, producing one entry per matter per sitting, logged when the person is ready — the accumulate-don't-fragment behavior Harvest ships as restart, and the auto-pause-on-new-timer stack PracticePanther ships on every page (§3). Toggl's no-pause model (every run is born an entry) is the one competitor that structurally cannot leak an unlogged run, but only because it demands nothing at birth; a legal entry's matter/Info/rate obligations make held-then-logged the honest equivalent. (Under round three's auto-save this argument strengthens: a complete row is already a draft when the switch happens, and resuming still accumulates into that same row rather than fragmenting it.)

### What a "segment" is

One **run** = one manager row = one prospective time entry. Pause/resume cycles within a run accumulate into it (the DO already stores `pausedIntervals`). Stop ends the run's clock; **log** commits it as one draft `time_entry` (`source: "timer"`) through the existing two-phase idempotent path. A day's history across matters = the held/live runs plus the runs already logged today.

---

## 5. The time-sheet spreadsheet (round three — the governing ruling)

Clicking the chip opens a **near-full-viewport modal** (capped per the settled dialog rules — only the table region scrolls, the modal's chrome is never pushed off; supersedes round two's mid-size modal). It carries no instruction text — the sheet teaches by being a sheet. Header: title, a **quiet period selector** (‹ Today · Wed, Aug 26 › — the reduced remnant of any `/time` link, per the owner: _"this is the time sheet"_), undo, filter-clear, the columns menu, close. Footer: the day's honest totals (§5.5) and one quiet line of truth: "Rows save as drafts the moment they are complete — the review chain lives on the matter's Time tab."

### 5.1 Rows are entries; a timer is one way a duration cell gets filled

The runs-are-rows unification: **a row IS a time entry** (existing draft, or one being typed), and a timer is simply a live feed into one row's Duration cell. The running row ticks in place (accent, tabular); pausing freezes it; starting the timer on another row auto-pauses the current one (§4, unchanged). Rows carry the play/pause control and delete in a trailing Actions cell — the only two row actions left, both **disabled-says-why** on locked rows. There is no separate start-a-timer affordance and no Started column (owner: _"no one cares when time started"_).

### 5.2 Every cell edits in place, spreadsheet-style

All cells are inputs at rest (quiet until hover/focus), Enter commits, Escape abandons:

- **Work date** — settable, defaults today (the day the work is FOR; `work_date`). Beside it, **Date entered** — automatic, never edited, available as a column (off by default, the settled two-dates ruling TL8).
- **Matter** — a **typable combobox**: type a number or any part of the title, pick from the filtered list; an exact or unique match commits on Enter/blur. Setting the matter resolves the rate.
- **Description** — the entry's billed text, and it **gets its own line**: each row renders on two lines — the data columns on the first, the description spanning the full width beneath (it is long and important). Both lines are one row to hover, selection, and the keyboard (one `tbody` per entry); heights stay consistent. Inline editing works on the second line exactly as in any cell.
- **Duration** — typable as decimal hours (`1.2`), `h:mm` (`1:12`), `h:mm:ss`, or minutes (`45m`); the ticking cell renders `h:mm:ss` so its display re-parses to exactly itself. **Editing a ticking cell pauses the timer first** — a cell cannot honestly hold a live feed and a hand edit at once.
- **Hours** — computed: the duration rounded to the firm increment (tooltip states the rule).
- **Rate** — a **dropdown, not a bare number** (owner, round four): a typable combobox over the **named rate cards** with each card's resolved figure ("$340.00 · Standard card — timekeeper rate"), plus a **Custom…** entry that takes a typed hourly rate as the audited per-entry override — the settled TD3 shape, provenance always named.
- **Total** — computed, and the **arithmetic is visible** on the cell: "0:42 → 0.7 h × $340.00 = $238.00".
- **Recorded by** — **changeable** (owner, round four; the delegation model is settled — TD9): a typable person combobox over the firm's timekeepers. Setting another person makes them the timekeeper, records the enterer automatically, keeps **both** people on the entry ("Marcus Reyes · entered by Rosalind Osei" on the description line), and **re-resolves the rate** through the rate chain for the new timekeeper (a custom override survives untouched). Initials avatar + always-visible name (TL6).
- **Internal Memo** — the settled private memo (TD10): never leaves the firm, never on a bill. A column in the columns menu, **Soon-badged and disabled** against its API gap (the listing does not serve the memo yet), stated on the control.
- **Status** — only two things ever render here (owner, round four: _"there is no difference between paused and draft, and we don't want draft"_): the **Running** chip on the one live row, and genuine **chain advances** (Submitted / Approved / Billed) with their locks. **The Paused and Draft chips are struck** — reasoning recorded: under auto-save everything visible is saved or shows its save state, so a Draft chip carries no information the save indicator doesn't; and a paused row's truth is simply that its duration is not ticking — a chip would dress a non-state. A **submitted/approved row locks**: cells read-only saying why, actions disabled with the same truth (TS3's chain, unchanged).

### 5.3 The fresh row, and auto-save

**The last row is always a fresh empty input row** — date defaulted to the day in view, everything else blank. Typing in it materializes the next entry, and another fresh row appears beneath: heads-down entry never reaches for a button.

**Auto-save is the model** (owner ruling: _"time is automatically logged. As soon as it is entered, it goes in. It does not need approval to get saved."_): the moment a row is **complete** — matter + description + a positive duration — it persists as a **draft** entry. Saving is not submission; the review gate, when on, still runs on the matter tab. **Each row shows its database state** in a leading indicator: a quiet check (**saved**, tooltip naming the matter), a spinner (**saving…**), or a warning mark (**not saved yet — needs a matter / a description / a duration**, named exactly). A lock glyph marks saved-and-submitted. Nothing is ever silently unsaved: the chip's badge counts unsaved rows, and the footer names them.

### 5.4 History, deletion, and carried-over rows

- **One full undo/redo history** (owner, round four: _"no undo stack for deleting data"_ — widened to every change): each cell edit, delete, timekeeper change, rate change, dialog save, and new-entry creation enters a single **undo/redo stack**. Ctrl+Z undoes, Ctrl+Y (or Ctrl+Shift+Z) redoes; the toolbar's undo/redo controls **say what they will do** ("Undo edit of duration on 2026-0147"), the footer echoes the top of the stack, and the deletion toast carries an Undo action. This supersedes round two's confirm-first discard and round three's delete-only stack. History is client-session state (§9.7); undo of a saved change writes back through the same auto-save path.
- **Carried-over rows — the "Earlier" band is removed** (owner, round four item 10; choice recorded): with the two-date columns, search, and filters in place, a carried-over unsaved row is simply **a row** — its real work date is visible in the Work date column, the save-state mark names exactly what is missing, and it sorts and filters like everything else. The date column now says what the band was trying to say; a separate warning band restated it louder and interrupted the sheet. The rows still surface on every later day until completed or deleted, and completing one saves it **on its own date**.

### 5.5 Search, full table machinery, and the day's totals

- **Search** (owner, round four): a search field in the modal's header filters rows by description, matter number or title, and person (timekeeper or enterer). It **composes with the column filters** (a row must match both), takes the active-filter accent treatment when in play, clears from its own control, and shares the filtered-empty pattern — the empty table names search and filters together and offers one clear.
- The sheet keeps the one-table system in full: sortable columns, **in-header right-aligned set filters** with per-value counts and the always-present filter-clear, **drag-to-reorder**, **drag-to-resize** with double-click fit, and a **columns menu** (hide/show any non-anchored column — Date entered and Internal Memo live there, off by default).
- The footer states the day in view honestly: **"Worked 4:47 · billed 4.8 h · value $1,496.00 · 3 rows not saved yet"** — server-computed when the API lands; the unsaved count is the nag.

### 5.6 The row's third altitude: the stacked entry dialog

The three-altitude ruling reaches the sheet (owner, round four): **cell → row → full record**. Double-clicking a row's non-interactive area, or its explicit open control, raises the **full entry dialog stacked above the Time Keeper modal** — viewport-capped per the dialog rules, properly stacked (the sheet stays visible and live beneath), carrying every field at full size: matter, work date, timekeeper (with the delegated-entry hint), category, activity code, the description, the Internal Memo (Soon), the arithmetic cluster, and both dates ("Work date Aug 26 · recorded Aug 26 — automatic"). Save & Close writes back through the same auto-save path and returns to the sheet with the row updated; a locked row opens read-only, its footer stating the chain reason. Closing never destroys sheet state.

The mockup structures all of this as an extractable module (`tk`-prefixed ids, `window.tkMoveColumn` surface) for the concurrent unification stream merging the time mockups; the phrase "what was done" is corrected to **"Description"** everywhere (round four, item 11).

---

## 6. Chip states (survives every round — only what opens changed)

| State                 | Chip renders                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| Idle, nothing held    | Quiet `0:00`, hairline border — today's resting anatomy unchanged                                         |
| Running               | Live elapsed + the bound matter's **number** (`0:42 · 2026-0147`); accent border, accent glyph            |
| Paused (none running) | Frozen elapsed of the most recent run + pause glyph; hairline border — visibly not accumulating           |
| Unsaved rows pending  | A small warning-token count beside the glyph (`·2`) — rows missing a matter/description/duration, visible |
| Abandoned run flagged | Warning treatment; opening the manager surfaces the keep / trim / discard resolution on that run's row    |

The chip never shows a sum (a sum reads as one timer); it shows the live row, or the newest paused one, plus the pending count — which under auto-save counts **unsaved rows**, not unlogged runs.

---

## 7. Hygiene under auto-save

Auto-save (round three) dissolves most of the old stopped-unlogged leak: a bound, described run **is already a draft** the moment it exists. What remains, and how the sheet keeps it honest:

- The leak shrinks to **incomplete rows** — measured time missing a matter or a description. They render with the warning save-state mark naming exactly what is missing, surface under "Earlier — not saved yet" on every later day (§5.4), count into the chip's badge (§6), and appear in the footer's "N rows not saved yet." They cannot age out.
- **No fabrication to force a save**: the sheet never invents a description or picks a matter to make a row saveable (the timesheet design's D4 argument, restated for auto-save — see M11 for the owner's call on Info-less drafts).
- **Deletion is honest and reversible** — one click, named in the toast, on the undo stack (§5.4). Honest deletion beats a silent leak; undo beats a scolding confirm.
- The **inverse leak** — a timer left ticking over lunch — remains the idle-detection question (M9, Harvest's keep/trim pattern): deferred, but the duration cell is where its resolution will render, beside the abandoned-run resolution that already exists.

---

## 8. What happened to the handoffs

- **The Log Time dialog is no longer this surface's path** (supersedes rounds one and two): the sheet's cells _are_ the form, and auto-save is the commit. The dialog remains the matter Time tab's capture surface (TD1–TD8 stand there, untouched by this spec).
- **"Open my timesheet" is gone** (owner: _"what is open my time sheet? this is the time sheet."_). The modal absorbs the personal-timesheet identity; the quiet period selector (§5) is the only remnant of period navigation. The fate of the `/time` route itself is M10.
- **Matter links from rows** stay deliberately absent (capture surface, not navigation; owner may overrule — M7).

---

## 9. API deltas (revised for the auto-save model; supersedes the round-two list)

In dependency order:

1. **Auto-save = draft-create-on-entry, then PATCH-per-cell-commit.** A row that becomes complete issues a normal `time-entries` create (`source: "timer"` when a timer fed it, `"quick_add"`/`"manual"` otherwise), idempotent on a client-minted row id so a retry never doubles an entry; each later cell commit is a draft `PATCH` (the route exists — draft-only, owner-only), debounced per row. **Per-row save-state** is client truth derived from the request lifecycle — `unsaved` (incomplete, or not yet acknowledged), `saving` (request in flight), `saved` (acknowledged) — no new server state; the server's only new obligation is that create and PATCH stay cheap enough to fire per cell commit (they are — single-row writes through the chokepoint).
2. **Runs become rows: the DO slims down.** The DO no longer needs a plural run store carrying matter/narrative — those live on the draft entry row. It holds **tick state only**: `{ liveRunId, entryId?, startedAt, pausedIntervals, lastActivityAt }` for the one live feed, attached to a row by entry id. Start-on-row auto-pauses the current feed (single-active, §4 unchanged — this still replaces today's silent-discard `start`); pausing writes the accumulated seconds onto the row (a duration PATCH keyed by `liveRunId`, riding the existing two-phase idempotency), after which the paused row needs nothing from the DO. Round two's plural-run migration therefore **shrinks to a single live feed with an entry-id pointer** — materially less DO work.
3. **The sheet's read** — the timekeeper-day listing (exists) **plus matter number + title denormalized** and the entry's `source`; the personal-timesheet design's range-listing delta covers it. `timer/read` stays the chip's cheap poll and gains the **unsaved-row count** (a cheap incomplete-drafts read, or client-computed).
4. **Rate override per entry** — already in the capture/PATCH contract (`overrideRateE4`); the sheet's Rate cell uses it; who may override remains the standing TP4 question.
5. **Delete + undo** — delete is the draft delete/void the API already allows; **undo is client-side re-create through the same idempotent create** (a restored row is a new row with the same facts). No server undo machinery.
6. **Submitted/approved locks** — already enforced server-side; the sheet renders the 409 `frozen-entry` truth _before_ the request, per the settled chain rules.
7. **Round-four notes.** (a) **Internal Memo** stays a registered API gap (the time-rulings register already carries it): the column ships Soon-badged and disabled until the entry contract serves and accepts the memo — no new delta, the existing one now has a second consumer. (b) The **undo/redo history is client-session state**, never a server feature: undo/redo of saved changes replays through the same idempotent create/PATCH path (an undone delete is a re-create; an undone edit is a PATCH back), so the server sees only ordinary writes and the audit trail records each replay honestly as a change. (c) The **stacked entry dialog** adds no API: it reads and writes the same row through the same contracts, and its stacking is a client-only layering contract (sheet modal below, entry dialog above, both viewport-capped; closing the dialog must never disturb sheet state). (d) **Changing the timekeeper** rides the delegated-entry contract the rulings settled (TD9): capture/PATCH accepts a foreign `timekeeperUserId` under the delegation permission, the actor is recorded as enterer, and the rate re-resolves server-side for the new timekeeper — the sheet's client-side re-resolve is a preview of that authoritative result.

Nothing here touches the WIP store's invariants, rounding arithmetic, rate resolution, or the entry lifecycle — the sheet is a client over exactly the machinery that exists, plus the slimmed DO delta in (2).

---

## 10. Relationship to the personal-timesheet design

The 2026-08-25 personal-timesheet design planned `/time` as a page: a period list first, a capture grid later, with the header chip as a small capture-anywhere surface. Round three collapses that geometry for the personal scope: **this modal IS the capture grid that spec's phase plan wanted** — reachable from anywhere, spreadsheet-fast, auto-saving into the same WIP store — and it absorbs the timesheet identity ("this is the time sheet"). Reconciliation:

- **Its API deltas survive intact** (range listing with matter titles; period totals): this sheet consumes them for the day view and the period selector.
- **Its list-view review role** (multi-week correction, submission under the review gate, the `time:viewFirm` switcher) is _not_ rebuilt in the modal — the sheet is one person × one day in view. Whether that review surface still ships as a `/time` page, or as a period-scoped view of this same modal, is now an owner decision (M10).
- **Its week grid (days × matters cells)** remains the distinct bulk-catch-up idea; the sheet's fresh-row entry covers the daily case, and the grid's fate rides M10.
- The three-place model's surviving boundary: the **matter Time tab** is still the matter's record and the review chain's home, and this sheet never grows approval machinery.

The concurrent unification stream merging the time mockups should treat this modal as the capture surface of record; the mockup is structured for extraction (`tk`-prefixed ids, a `tkMoveColumn` module surface).

---

## 11. Owner decisions

| #   | Decision                                                                                                                                             | Recommendation                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| M1  | The model: single-active with auto-pause on switch vs commit-on-switch vs true concurrency                                                           | Single-active auto-pause (§4); concurrency rejected outright — settled through three rounds                                     |
| M2  | ~~The read-only logged tail~~ — dissolved by round three: saved entries are ordinary editable rows of the sheet (chain locks apply)                  | Superseded; no decision left                                                                                                    |
| M3  | Cap on rows holding measured-but-unsaved time                                                                                                        | None needed under auto-save — the unsaved-row nag (§7) is the pressure                                                          |
| M4  | May multiple matterless rows hold measured time at once?                                                                                             | Yes — they are unsaved rows, named and nagged; refusing would push people back to not timing                                    |
| M5  | Chip treatment for the unsaved-row count                                                                                                             | Warning-token count beside the glyph (§6); never a red badge screaming over a normal workflow state                             |
| M6  | Completing a carried-over row: does it save on its own date (recommended) or today's?                                                                | Its own date — the work happened when it happened; the Date cell is editable if the person disagrees                            |
| M7  | Do sheet rows link to the matter?                                                                                                                    | No (§8) — capture surface, not navigation; revisit if usage asks                                                                |
| M8  | Rollout: the slimmed DO delta (§9.2) ships with the sheet, or the sheet v1 rides the single-run API                                                  | Ship together — today's silent-discard-on-start hazard stays open otherwise                                                     |
| M9  | Idle detection (the timer-over-lunch leak): client input-idle signal feeding `lastActivityAt`, with a Harvest-style keep / trim resolution on the row | Defer detection past v1; the model and the DO's `lastActivityAt` + trim already accommodate it, so deferral costs no rework     |
| M10 | The fate of `/time`: does the page ship at all, or does this modal (with a period-scoped view) absorb the personal timesheet entirely? The week grid rides with it | The modal absorbs the daily surface now; decide the review/list surface (multi-week, `time:viewFirm`, submission) before its phase |
| M11 | May an Info-less row auto-save as a draft (API `narrative` is `min(1)` today), or does it stay unsaved until described (the timesheet design's D4 stance)? | Stays unsaved until described — an undescribed draft is unbillable work waiting to be forgotten; the warning mark makes the gap cheap to see |
| M12 | Round two's multi-select bulk log/discard was dropped in round three in favor of auto-save + per-row delete + undo. Confirm the drop                  | Confirm — auto-save removes bulk-log's reason to exist; the undo stack covers bulk-delete safety with less machinery            |

---

## 12. What this design does NOT do

- No approval machinery in the sheet — saving is not submission; the review chain lives on the matter's Time tab (locked rows render its truth).
- No change to entry-lifecycle invariants, rounding arithmetic, or rate resolution — auto-save writes through the existing capture/PATCH contracts.
- No idle-detection UI beyond surfacing the DO's existing abandoned flag and its keep/trim/discard resolution.
- No multi-week review or firm-wide (`time:viewFirm`) views in the modal — one person, one day in view; the broader review surface is M10.
- No desktop divergence — the sheet is the same surface on Tauri (feature parity; offline capture still reconciles as drafts).
