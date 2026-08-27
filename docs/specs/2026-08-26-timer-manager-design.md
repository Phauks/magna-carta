# The timer manager — header timer control grown up — design study

**Status:** Proposed (design study) · **Date:** 2026-08-26 · **Owner:** Trevor Goldsmith
**White-paper home:** _Financial Core — Time tracking_
**Builds on:** [`2026-06-22-slice-3-1-time-tracking-design.md`](2026-06-22-slice-3-1-time-tracking-design.md) (the shipped timer backend: the per-timekeeper Durable Object) ·
[`2026-08-25-personal-timesheet-design.md`](2026-08-25-personal-timesheet-design.md) (the three-place model — header = capture anywhere; this design grows that header surface up) ·
[`../conventions/time-tab-rulings.md`](../conventions/time-tab-rulings.md) (the owner's standing time rulings — every one binds here, TT1 and TD6 most of all)
**Mockup:** the timer-manager mockup (scratchpad `timer/timer-manager.html`), built to the same token vocabulary as The Timesheet mockup.
**Rounds:** round one proposed a chip-anchored popover; the owner struck it (round two, verbatim): _"opening the time sheet should be a full modal, it is that important. this small fitting is not enough for the magnitude of this task. reorganize and try again. this really needs to be a table, so we can use table functionality. table is much better for mass data review and data entry."_ Everything below reflects that ruling: the chip opens a **full modal**, and the runs render as a **real table on the shared column machinery**. The model (§4), the chip (§6), the handoffs (§8), and the API deltas (§9) survived round two unchanged.

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
10. **The day's list and its running total stay visible beside the timer** — timing and "where am I today" are one surface, not two. Adopted as the logged tail (§5.3) and the honesty line (§5.4).

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

Committing on every switch fragments an interrupted day into confetti: six returns to the draft become six one-line entries on _Pemberton_ needing manual merge, and each commit demands Info at the worst moment — mid-interruption. Holding the run and **resuming accumulates into the same segment**, producing one entry per matter per sitting, logged when the person is ready — the accumulate-don't-fragment behavior Harvest ships as restart, and the auto-pause-on-new-timer stack PracticePanther ships on every page (§3). Toggl's no-pause model (every run is born an entry) is the one competitor that structurally cannot leak an unlogged run, but only because it demands nothing at birth; a legal entry's matter/Info/rate obligations make held-then-logged the honest equivalent. (Stop & log is always one click for whoever prefers commit-per-switch.)

### What a "segment" is

One **run** = one manager row = one prospective time entry. Pause/resume cycles within a run accumulate into it (the DO already stores `pausedIntervals`). Stop ends the run's clock; **log** commits it as one draft `time_entry` (`source: "timer"`) through the existing two-phase idempotent path. A day's history across matters = the held/live runs plus the runs already logged today.

---

## 5. The manager modal (round two — the owner's ruling)

Clicking the chip opens a **full modal** (owner ruling; supersedes round one's chip-anchored popover): wide (~1320 px, viewport-capped per the settled dialog rules — the table region scrolls, the modal's chrome is never pushed off), scrim behind, Escape and explicit close. Header: title, the day ("Today · Wed, Aug 26"), **Start a timer** (the `MatterPicker`; matterless start allowed — scratch). Footer: the honesty line (§5.5), **Log time without a timer**, **Open my timesheet**.

### 5.1 A real table, on the shared column machinery

The runs render as a **table on the one table system** (the Docket's column machinery, which the Timesheet also adopts — the binding one-table ruling applies here): sortable columns with the in-header sort button and arrow; **in-header right-aligned filter controls** (hover-revealed funnel, active-filter accent treatment, set filters with per-value counts); **drag-to-resize grips** with double-click fit-to-widest; **drag-to-reorder** columns (drop lands before/after by which half was entered). A filter-clear control is always present in the toolbar, disabled with "No filters are applied" when idle; a filtered-empty table says why it is empty and hands over the way out. Table functionality is the point of the ruling: mass review and mass entry over the day's runs.

**Columns** (default order): selection checkbox (anchored first) · **State** (the status-chip register: running = accent chip with pulsing dot; paused = quiet chip with its real timestamp "paused 10:12"; stopped-unlogged = warning chip "stopped 12:40 — not logged"; never "just now") · **Matter** (the number — the owner's setting-a-time-shows-the-matter-number ruling; a scratch run renders **"No matter yet"** as the inline bind affordance) · **Matter title** · **Note** (the narrative; becomes the entry's Info) · **Started** (real clock time; carried rows carry their date "Aug 25 · 15:50") · **Elapsed** (right-aligned tabular numerals, **live-ticking on the running row**) · **Actions** (anchored last).

**Row actions** are a uniform icon set — resume / pause / stop-&-log / discard — every button present on every run row, enabled or **disabled-says-why** (the running row's resume: "Already running"; a held row's pause: "Not running — nothing to pause"; resume on a held row: "Resume — pauses 2026-0147"). Stop-&-log opens Log Time prefilled (§8); discard always asks first, naming the elapsed time it deletes.

### 5.2 Mass entry in the table

- **Inline note editing:** click a run's Note cell to edit it in place (Enter/blur saves, Escape cancels) — the note rides into Log Time as the Info, so a paused stack can be annotated without opening anything.
- **Inline matter bind:** a scratch run's "No matter yet" cell opens the `MatterPicker` in place — bind without a dialog.
- **Multi-select + bulk actions:** row checkboxes and a select-all; the toolbar becomes the bulk bar with **honest counts** — "3 selected · **Log 2 as drafts** · **Discard 3…** · 1 needs a matter". Bulk log commits only runs with a matter and a note, each at the firm rounding through its own idempotent stop-commit, and says exactly what it skipped and why — never a silent partial. Bulk discard confirms with the count and the **total elapsed time it would delete**.

### 5.3 Carried over (unlogged runs from previous days)

Runs stopped or paused on a previous day **must not vanish at midnight** — they are exactly the time most likely to be forgotten. A warning-tinted group row ("Carried over — not logged · Yesterday, Aug 25") separates them inside the same table; same columns, same actions, selectable for bulk cleanup — with one difference: **Resume on a previous day's run starts a new run for today on the same matter and note** rather than stretching one run across a date boundary (an entry belongs to one `work_date`). The group renders regardless of any period notion; it empties only by logging or discarding. No day-paging arrows: the modal's scope is "now, plus what still needs an answer," and `/time` owns the past.

### 5.4 Logged today (the read-only tail)

Today's already-committed timer runs render as **rows of the same table** under a quiet group row ("Logged today · read-only — editing lives in my timesheet") — recorded as the designer's call between same-table rows and a separate section: one table keeps one column system, one scroll, and one sort vocabulary, and the group row carries the read-only honesty. Muted treatment, Draft status chip, duration in hours, no checkbox; the one action links into `/time`. This is what makes the modal a truthful history of "where did today go" without becoming an entry-editing surface.

### 5.5 The honesty line

One line in the modal's footer: **"Timed today 3.6 h · logged 1.1 h · not yet logged 2.5 h + 1.1 h carried over"** — server-computed when the API delta lands; the unlogged figure is the nag (§7), and carried-over time is named separately, never folded into today's total as if it happened today.

---

## 6. Chip states (unchanged by round two — only what opens changed)

| State                 | Chip renders                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| Idle, nothing held    | Quiet `0:00`, hairline border — today's resting anatomy unchanged                                         |
| Running               | Live elapsed + the bound matter's **number** (`0:42 · 2026-0147`); accent border, accent glyph            |
| Paused (none running) | Frozen elapsed of the most recent run + pause glyph; hairline border — visibly not accumulating           |
| Unlogged runs pending | A small warning-token count beside the glyph (`·2`), whatever else the chip shows — the leak made visible |
| Abandoned run flagged | Warning treatment; opening the manager surfaces the keep / trim / discard resolution on that run's row    |

The chip never shows a sum of runs (a sum reads as one timer); it shows the live run, or the newest held one, plus the pending count.

---

## 7. Unlogged-segment hygiene

A stopped-but-never-logged run is the dangerous leak: the work happened, the clock measured it, and nothing will ever bill it. The manager nags honestly and never coerces:

- **Stop & log is the primary path** — stopping from the row leads straight into Log Time prefilled (§8); the plain "stop and walk away" state exists only by dismissing that dialog, which parks the run as stopped-unlogged rather than discarding it (dismissing a dialog must never destroy measured time).
- The **chip carries the unlogged count** (§6) so the leak is visible without opening anything.
- **Carried-over runs surface every day until resolved** (§5.2) — they cannot age out, and their warning chips state facts ("Stopped yesterday 16:40 — not logged"), not guilt.
- **Discard is always available and always explicit** — a confirm step naming the elapsed time it destroys. Honest deletion beats a silent leak.
- No auto-commit, ever: committing without Info creates the other leak (an unbillable, undescribed draft — the timesheet design's D4 argues the same), and committing with fabricated Info is worse. The nag ends at the human.
- The **inverse leak** — a timer left running over lunch capturing time that did not happen — is the idle-detection question (M9, the Harvest keep/trim pattern): deferred, but the run row is where its resolution will render, beside the abandoned-run resolution that already exists.

---

## 8. Handoffs

- **Log from a run** → the **Log Time dialog** (the settled TD1–TD8 dialog, global variant), prefilled: matter bound, worked time from the run (rounding arithmetic shown per TD7), Info from the run's narrative, **Info focused** (it is the field most often still empty). Buttons per TD5b: **Save & Close** (primary), **Save & New**. Save commits through the run-addressed stop-commit path, so the entry is idempotent on the run id; the run leaves the live set and reappears in the logged tail. Dismissal parks the run (§7). No forced navigation (TD6).
- **Open my timesheet** → `/time` — review, correction, submission. The logged-tail rows deep-link there.
- **Matter row → matter** is deliberately absent: the manager is not navigation chrome; the matter's own Time tab is two clicks away through `/time` if wanted (owner may overrule, D7).

---

## 9. API deltas

The single-run DO cannot host this surface. In dependency order:

1. **Plural run store (the headline delta).** The DO's state becomes a **run set**: `runs: TimerRun[]`, invariant **at most one `running`**. `start` and per-run `resume` auto-pause the current running run instead of overwriting state. New/changed operations, all per-run-addressed by `liveRunId`: `pause(liveRunId?)`, `resume(liveRunId)`, `bind(liveRunId, …)`, `stop(liveRunId)` (**new** — ends the clock without committing: the stopped-unlogged state), `discard(liveRunId)`, `stopCommit(liveRunId)`. The existing single-run semantics are the degenerate one-run case, so migration is mechanical (a stored single blob reads as a one-run set). The abandoned alarm generalizes: one alarm at the earliest threshold across held runs; resolution addresses a run.
2. **Run listing.** `GET /api/v1/timer/runs` — the full run set (id, status, startedAt, accumulated paused intervals or a server-computed `accumulatedMinutes`, matterId, **matter number + title denormalized** (no N+1 — golden rule 10), narrative, workDate, stoppedAt, abandoned flag). Replaces nothing; `timer/read` stays as the chip's cheap poll and gains the two chip facts: the running run's summary and the **unlogged count**.
3. **Stop-commit addressing.** `stop-commit` takes `{ liveRunId }`; the derived idempotency key and entry handle already come from the run id, so the collapse-to-one-row property is untouched.
4. **The logged tail read.** The timekeeper-day listing filtered by `source=timer` **with matter number + title** — a narrowing of the personal-timesheet design's range-listing delta (its API delta 1); build it as that delta plus a `source` filter, not as a sibling endpoint.
5. **Carried-over resume** is client-composed (start a new run copying matter + narrative) — no new API.
6. **Bulk log needs no batch endpoint**: it is N independent per-run stop-commits, each already idempotent on its own `liveRunId` (a mid-sequence failure leaves the remaining runs held, not half-committed) — honest counts are a client concern.

Nothing here touches the WIP store's write path, rounding, rate resolution, or the entry lifecycle — a run commits through exactly the machinery that exists.

---

## 10. Owner decisions

| #   | Decision                                                                                                                                                                                                                                                                                | Recommendation                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| M1  | The model: held-run stack (switch pauses previous) vs commit-on-switch vs true concurrency                                                                                                                                                                                              | Held-run stack (§4); concurrency rejected outright; commit-per-switch remains available as a habit, never forced                |
| M2  | Does the manager list today's **logged** runs (the read-only tail)? _Revisited in round two: the modal-and-table ruling settles the surface's magnitude; what remains is confirming the tail and its placement as read-only rows of the one table (§5.4, the designer's recorded call)_ | Yes — read-only rows in the one table, deep-linking to `/time`; it is what makes the modal honest about the whole day           |
| M3  | Cap on held runs                                                                                                                                                                                                                                                                        | Soft cap (~8): past it, starting another asks the person to log or discard one first — a nag with a reason, not a hard refusal  |
| M4  | May multiple **scratch** (unbound) runs be held at once?                                                                                                                                                                                                                                | Yes — refusing would push people back to not timing; the bind requirement at log already forces the reckoning                   |
| M5  | Chip treatment for the unlogged count                                                                                                                                                                                                                                                   | Warning-token count beside the glyph (§6); never a red badge screaming over a normal workflow state                             |
| M6  | Does Resume on a carried-over run start a fresh run for today (recommended) or reopen the old run across the date boundary?                                                                                                                                                             | Fresh run, same matter + narrative — one run, one `work_date`                                                                   |
| M7  | Do manager rows link to the matter?                                                                                                                                                                                                                                                     | No (§8) — capture surface, not navigation; revisit if usage asks                                                                |
| M8  | Rollout: does the plural-run DO migration ship with the manager, or does the manager v1 ride the single-run API (one running, nothing held)?                                                                                                                                            | Ship together — a manager over a single-run store is a popover with one row, and the silent-discard-on-start hazard stays open  |
| M9  | Idle detection (the timer-over-lunch leak): client input-idle signal feeding `lastActivityAt`, with a Harvest-style keep / trim resolution on the row                                                                                                                                   | Defer detection past v1; the run model and the DO's `lastActivityAt` + trim already accommodate it, so deferral costs no rework |

---

## 11. What this design does NOT do

- No editing, filtering, or period paging in the panel — `/time` (the personal timesheet) owns review.
- No change to entry lifecycle, rounding, rates, or the WIP store.
- No idle-detection UI beyond surfacing the DO's existing abandoned flag and its keep/trim/discard resolution.
- No desktop divergence — the manager is the same surface on Tauri (feature parity, and the DO is server-side either way; offline capture still reconciles as drafts, never as held runs).
