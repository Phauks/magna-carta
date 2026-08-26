# The personal timesheet + header-bar time capture — design study

**Status:** Proposed (design study) · **Date:** 2026-08-25 · **Owner:** Trevor Goldsmith
**White-paper home:** _Financial Core — Time tracking_
**Builds on:** [`2026-06-22-slice-3-1-time-tracking-design.md`](2026-06-22-slice-3-1-time-tracking-design.md) (the shipped backend) ·
[`../research/2026-06-22-competitive-time-tracking-deep-dive.md`](../research/2026-06-22-competitive-time-tracking-deep-dive.md) ·
[`../conventions/time-rulings.md`](../conventions/time-rulings.md) (the owner's standing time rulings — every one binds here) ·
[`2026-07-02-slice-0-7b-stage-1-app-shell-design.md`](2026-07-02-slice-0-7b-stage-1-app-shell-design.md) + [`2026-06-12-page-archetypes.md`](2026-06-12-page-archetypes.md) (the shell this surface lives in)
**Answers:** time-rulings open questions **TP5** (the firm-level Timesheet week grid) and frames **TP3** (delegated entry) for decision.

---

## 1. The surface's job

Every attorney expects a place to open **their own time, across every matter, for a period** — see the week, catch up the day that got away, fix the narrative that reads wrong, and know where they stand against target — without visiting matters one at a time. The matter Time tab answers "what time is on this matter?"; nothing yet answers "what time is *mine*?" That second question is the daily-driver question, and it is asked at least once a day by every timekeeper.

The competitive research confirms both the expectation and the opening: every competitor ships some per-person period surface (Clio's Timekeeper day view, LEAP's Timesheet window, Tabs3's recap-of-hours reads), but **none ships the weekly matters × days grid** — the classic legacy-timekeeping strength attorneys remember — which the slice 3·1 design already names as a capture method and the deep dive names differentiator #3. The `grid-batch` endpoint was built for exactly this surface and currently has no caller.

### The three-place model

The design's spine — each place has one job, and the seams between them are explicit:

| Place                              | Job                                                                                                | Scope                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------- |
| **Header bar** (Time Keeper chip)  | **Capture anywhere** — the running timer, and a quick Log Time reachable from any screen           | one entry / one timer     |
| **Personal timesheet** (`/time`)   | **Review and edit a period** — my time, all matters, this week; add, correct, catch up, submit     | one person × one period   |
| **Matter Time tab**                | **The matter's record** — every entry on the matter, every timekeeper, every status                | one matter × all time     |

Hand-offs: the chip's panel links to the timesheet ("Open my timesheet"); a stopped timer reopens the Log Time dialog prefilled **wherever you are** (ruling TD6 — the entry lands in the WIP store and therefore appears in both the timesheet and the matter tab; no navigation is forced); a row on the personal timesheet links to its matter; the matter tab never grows a matter picker (rejected in round one) because cross-matter is *this* surface's job.

---

## 2. Where it lives, and who sees whose

**Route: `/time` — the sidebar already promised it.** The destination registry (`apps/web/src/lib/navigation/destinations.ts`) carries an announced Soon row: `Time` in the **Money** group, `href: /time`, "Time capture and entries, ready for billing." Building the personal timesheet there flips `shipped` and retires the Soon treatment — no new navigation decision needed, and no `My Work` umbrella to invent. The page is a Layout-A canvas page (List/Index archetype with a Dashboard-grade summary line, per the page archetypes).

**Self by default.** The page opens on the session user's own time. Every listing and capture endpoint already enforces exactly this (`timekeeperUserId` must equal the session user on capture; foreign listings require `time:viewFirm`).

**Others' time is a gated switcher, not a different page.** A member holding `time:viewFirm` gets a timekeeper select in the page header (initials avatar + always-visible name, ruling TL6); the URL carries the selection (`/time?timekeeper=…`) so a supervisor's view is linkable. Without the permission the control does not render. Viewing is read-only in phase 1: **delegated entry — an assistant capturing for an attorney — is TP3 and stays an owner decision** (§8); the capture route today hard-refuses a foreign `timekeeperUserId` ("reserved for a supervisor role that does not exist yet"), so the switcher must not pretend the cells are editable for someone else's week.

**Period controls.** Default **this week**; a Day / Week segmented control (custom range arrives with the list view's filter, phase 2); previous/next arrows plus a "Today" jump (the Clio Timekeeper day-navigation pattern, which is the field's reference for period review). The week's start day and which days count as working days are firm settings this surface forces into existence (§8) — unlogged-day detection is already built and must not flag Saturdays at a firm that does not work them.

---

## 3. Layout: grid for capture, list for review — both, one route

### The argument

- **The day-column week grid (days × matters, cells are durations)** is the fastest catch-up surface ever shipped for legal time — type `1.2` under Thursday on *Smith*, tab to the next cell. It is confirmed absent across all nine researched competitors, the slice 3·1 design names it the bulk path, and `grid-batch` (up to 200 entries, one idempotency key, `source: "grid"`) exists for it. But a grid cell is a **total**, and an entry is not a number: it carries Info (the billed text), a category, an activity code, a status, a rate. A grid that pretends a cell *is* the entry either hides the record's richness or collapses when two entries share a matter-day.
- **A period list with strong day grouping** renders the full ruled vocabulary — the status register (TS1), one chip per row (TS2), Info not Narrative (TL2), resolved rate (TD3), disposition (TD2) — and is where review, correction, and submission actually happen. But it is a slow way to key in a missed week.
- **Recommendation: both, as two views of one route** — `/time` opens on **Week** (the grid, capture mode) with a **List** toggle (review mode) beside the period controls, both reading the same WIP store so totals never disagree. This is not scope doubling: the list view is the matter Time tab's table (its component vocabulary, status register, filters, and dialog) minus the Timekeeper column, plus a Matter column — the mockup's design language ports, it is not redesigned. The grid is the genuinely new construction, and it is the differentiator.

Phasing (§9) still puts the list first: it reuses the most, it unblocks review/edit immediately, and the grid arrives one release later with its micro-editor done right rather than rushed.

### The grid's anatomy

- **Rows are matters** the timekeeper has touched in the period (seeded from the period's entries), plus a type-ahead "Add matter row" (the global matter picker, §5). Rows persist for the visible period only — the grid is a view, not a stored artifact.
- **Columns are the period's days**; a **Totals column** on the end and a **totals row** on the foot: per-day totals against the daily target (the My Day shortfall read, extended to a range — §7), per-matter totals, and the period's billable/non-billable headline as a quiet summary line — not stat tiles (ruling TL5).
- **A cell shows the day-matter total in hours** (tabular numerals). One entry: the cell *is* that entry. Multiple entries: the cell shows the sum with a small count mark, and opening it lists the stack.
- **Cell status at a glance:** a cell whose entries are all drafts renders plain; submitted/approved/billed tint the cell with the same semantic tokens the status chips use (TS1) so a locked week reads locked before anyone clicks. A mixed cell tints by its *most restrictive* member.

---

## 4. Quick add/edit ergonomics

**Cell entry — type a duration, get a draft, but never a naked one.** Typing into an empty cell and pressing Enter opens a **micro-editor popover** anchored to the cell: the duration (already typed), an **Info** field (focused), and the category/activity selects collapsed behind a "More" disclosure. This is deliberate, not timid: `CreateTimeEntryRequest.narrative` is `min(1)` — the API refuses an empty Info, and it is right to (an entry with no billed text is unbillable work the firm forgets to describe). The micro-editor makes the honest minimum two keystrokes-plus-a-phrase, with per-task-code templates and recent-Info reuse (both already served by the backend) one keypress away. Committing writes through `grid-batch` (single-cell batches are fine; a "fill the week then save" flow batches naturally). An owner decision (§8) covers whether grid drafts may ever be Info-less.

**Cell edit.** A draft cell opens the micro-editor prefilled; duration edits `PATCH` the entry (draft-only, owner-only — as the API enforces). A multi-entry cell opens the stack; each row edits individually. **Full detail is always one step away:** "Open" in the micro-editor raises the Log Time dialog — the same dialog as everywhere else (TD1/TD5/TD6/TD7 all inherited), never a grid-only editing dialect.

**Keyboard-first.** Arrow keys move cells; typing begins entry; Enter commits and stays; Tab commits and moves right; Escape abandons. The grid is the one surface where a timekeeper should be able to reconstruct a week without touching the mouse.

**The quick-add line rides along.** The one-line natural-language parser (`quick-add-preview` — "0.5 Smith — drafted demand letter") gets a persistent input above the grid: parse, confirm the matter candidate, land the draft in its cell. The timesheet is the natural home for the field's only native NL quick-add.

**Bulk-day operations.** "Copy yesterday's matters" / "Copy last week's structure" copies **rows, not hours** — it seeds the matter rows so the timekeeper fills durations, never fabricating billable time by duplication. (LEAP's `=` duplicates whole entries; copying amounts is how double-billing accidents happen, and the stop/commit ethics posture from the research argues for structure-only copy.) Scope confirmed as an owner decision (§8).

**Where the editing chain surfaces in the grid.** The chain is the matter tab's, unchanged: drafts editable; submitted locked to the timekeeper when the review gate is on (editable by a reviewer); approved locked pending billing; billed and void frozen. A locked cell renders read-only with its status tint, and interacting with it states the reason in the vocabulary the API already returns ("This entry is billed. Corrections are new adjusting entries.") — the 409 `frozen-entry` reason surfaced before the request is ever made, not after. Submission itself (gate on) is a list-view row action plus a "Submit week" bulk action over the period's drafts.

---

## 5. The header bar: the Time Keeper chip and the global Log Time

The topbar already reserves this exactly (`app-shell.svelte`): the **Time Keeper widget** — a hairline chip with status dot, tabular elapsed readout, and the active matter — ships today as resting anatomy (`0:00`, aria-disabled) with its light-up contract documented in place. This design fills that contract:

1. **The chip is the running timer.** Idle: quiet `0:00`. Running: live elapsed (computed client-side from the DO's `startedAt`, per the timer design) plus the bound matter's short title; paused and abandoned states render distinctly (the abandoned state must surface the keep / trim / discard resolution the DO already flags).
2. **Click opens the timer panel** — a popover with the active matter, the narrative, pause/resume, **Stop & log** (stop-commit for a bound timer; for a scratch timer, bind-then-commit via the matter picker), Discard, and two footer links: **Log time without a timer** and **Open my timesheet** (`/time`).
3. **"Log time" opens the Log Time dialog — the global variant.** Same dialog as the matter tab (TD1–TD7 inherited wholesale) with one addition: a **matter field at the top**, because outside a matter the dialog cannot know one. This is where the matter picker becomes necessary — one person, many matters — a reusable search-as-you-type `MatterPicker` component (backed by the matters listing; the quick-add parser's candidate search is precedent) that the dialog, the grid's add-row, and timer bind all share. On a matter page the field prefills from context; on any other screen it starts focused and empty.
4. **Stop hands off locally.** A stopped timer reopens the Log Time dialog prefilled with the elapsed time and bound matter (TD6), wherever the user is standing — capture never forces navigation. The chip's menu, not the stop action, is the road to the timesheet.

Header = capture anywhere. The chip never grows review affordances (no entry lists in the popover — that is the timesheet's job, one click away). Clio's header clock opening a day-review panel is the pattern deliberately *not* copied: it splits review between a cramped popover and a real page; with `/time` one link away, the panel stays a timer panel.

---

## 6. Data honesty

**Server totals or no totals.** The matter tab's scope-honesty caption ("the total below covers only what is on screen") is the right honesty for a paged list — and the wrong ceiling for a timesheet whose headline *is* the total. The period totals, per-day totals, and target shortfalls must come from a server aggregate over the whole period (§7), never summed from loaded rows; the caption pattern then applies only to the list view's paged tail, in the same words the matter tab uses.

**What the listing serves today vs what the columns need.** The listing summary (`TimeEntrySummary`) carries id, matter id, timekeeper, date, durations (raw and rounded — rounding stays visible), Info, billable, amount, currency, status. The rulings' API-gap register already names the rest (resolved rate, activity code, categories, disposition, memo, historical timekeeper name); this surface adds **matter title on the per-person listing** to that register — a cross-matter table cannot render `matter_…` handles, and N+1 title fetches are barred by golden rule 10.

**Targets exist — firm-level only.** `time.target_daily_hours` / `_monthly` / `_annual` are live firm settings (nullable; My Day already reads the daily one). A five-attorney firm does not share one target; per-timekeeper targets are the scoped-setting resolver's exact shape (`user` tier) but are a policy question, not a technical one — owner decision (§8). Until set, the totals row shows totals without a target line, exactly as My Day does today.

---

## 7. API deltas

What exists is closer than expected — the write side is essentially done; the read side is the gap.

**The headline gap: there is no cross-matter per-person period read.** `GET /api/v1/time-entries` answers exactly two questions: one timekeeper on **one day**, or one matter. A week view would need seven serial calls and would still lack matter titles and any totals. Needed:

1. **Range listing** — extend the per-timekeeper shape to `workDateFrom`/`workDateTo` (bounded range, e.g. ≤ 31 days), cursor-paged, ordered by work date then matter, each row carrying `matterTitle` (denormalized into the query's join, not fetched per-row). Same self-or-`time:viewFirm` guard the day shape already enforces.
2. **Period totals read** — extend My Day to a range (`GET /api/v1/my-day?from&to` or a sibling `my-period`): per-day billable/non-billable minutes, per-day shortfall against the daily target, unlogged-day flags, and the period roll-up. One indexed read over `(timekeeper_user_id, work_date)` — the index already exists.
3. **The listing enrichments** already registered in the time-rulings API-gap list (rate, activity code, categories, disposition, memo, historical timekeeper name) — shared with the matter tab, not duplicated here.

**What `grid-batch` already covers — and its edges.** It accepts up to 200 entries under one idempotency key, enforces self-capture per entry, resolves rate and rounding per entry, forces `source: "grid"`, and returns the minted ids: bulk *creation* is fully served, and 200 comfortably exceeds any real week. Its edges, both acceptable: it is create-only (cell edits ride the existing per-entry `PATCH`; a mixed save issues one batch plus the individual patches), and it is all-or-nothing per batch (one invalid entry fails the batch — fine for a single-cell commit; a whole-week "save all" should commit per cell rather than one mega-batch, so one bad cell does not hold the week hostage).

**Not needed:** any new write path, any timer change, any new permission for phase 1. Delegated capture (TP3) is the one change that would touch write authorization, and it is gated on the owner.

---

## 8. Owner decisions

| #  | Decision                                                                                                                                                                | Recommendation                                                                                       |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| D1 | Label and route: keep the sidebar's announced `Time` at `/time`, or rename (e.g. "Timesheet")?                                                                            | Keep `Time` / `/time` — the registry's promise stands; "Timesheet" names the week-grid view inside it |
| D2 | Landing view: Week grid or List first?                                                                                                                                    | Week grid once it ships (it is the differentiator); List is the landing view during phase 1           |
| D3 | Week start day + working-day set (drives the grid's columns and unlogged-day flags)                                                                                       | Firm settings, seeded Mon-start / Mon–Fri; per-timekeeper override deferred                          |
| D4 | May a grid draft be captured with empty Info (API relaxation), or does the micro-editor always require it?                                                                | Require it — an Info-less entry is unbillable work waiting to be forgotten; templates make it cheap  |
| D5 | Delegated entry (TP3): permission shape (`time:trackFor`?), actor-vs-timekeeper dual attribution on the row, and whether the supervisor's timesheet view becomes editable | Decide before phase 3; the audit trail already records the actor, but the listing needs both names   |
| D6 | Per-timekeeper billable targets (the scoped-setting `user` tier) vs firm-level only                                                                                       | Per-timekeeper, set by admins — the firm-level value stays the default tier                          |
| D7 | Copy-structure scope: yesterday's matters, last week's structure, both?                                                                                                   | Both, rows-only (never hours)                                                                        |
| D8 | Does the `time:viewFirm` switcher ship in phase 1 (read-only), or wait for the delegated-entry decision so viewing and acting arrive together?                             | Ship read-only in phase 1 — a billing partner's week-end review is real today                        |

---

## 9. Phased plan

- **Phase 1 — the list, honestly.** API deltas 1–2 (range listing + matter titles, period totals). `/time` route: period controls, the day-grouped list view (the matter tab's table vocabulary minus Timekeeper plus Matter), the Log Time dialog with the `MatterPicker` (global variant), per-day subtotals and the period headline from the server read, chain locks with stated reasons, the `time:viewFirm` read-only switcher (per D8). Flip the destination's `shipped`.
- **Phase 2 — light the header.** The Time Keeper chip's light-up contract: live elapsed, the timer panel (pause/stop-commit/discard, bind via `MatterPicker`, abandoned-timer resolution), stop→Log-Time-prefilled hand-off, the two footer links. This phase is deliberately after the timesheet exists so "Open my timesheet" has somewhere to go.
- **Phase 3 — the grid.** The week grid view: cell micro-editor over `grid-batch` + `PATCH`, keyboard traversal, status-tinted locked cells, the quick-add line, copy-structure ops, "Submit week" under the review gate. Ships with the load-profile weekly-grid read measured (the harness already fans this query).
- **Phase 4 — the gated extras.** Delegated entry per D5 (permission, dual attribution, editable supervisor view), per-timekeeper targets per D6, and the listing enrichments landing alongside the matter tab's (shared register, one delivery).

---

## 10. Web-research notes (verified 2026-08-26)

- **Clio Timekeeper:** the header clock (beside the play/pause timer control) opens a day-scoped review surface — all of today's entries, arrow/calendar navigation to other days, restart-timer / edit / create in place. Principles taken: period navigation belongs in the surface's header; the header control and the review surface are *linked, distinct* places. Principle rejected: cramming period review into header chrome. Sources: [Clio Help — Time Entries](https://help.clio.com/hc/en-us/articles/9289741706779-Time-Entries), [Clio Help — Capturing Your Time](https://support.clio.com/hc/en-us/articles/115001161493-New-Clio-Experience-Capturing-Your-Time).
- **Tabs3 (the classic):** dual "hours worked" vs "hours to bill" on the entry form (the raw/rounded split this platform already stores), the Recap of Hours report summarizing daily/weekly/monthly worked hours per timekeeper, and review of unbilled time by attorney or matter. Principle taken: the per-person period roll-up against worked-vs-billed is the review artifact attorneys and billing partners both read — it belongs on the surface, not in a separate report. Source: [Tabs3 Billing features](https://www.tabs3.com/products/tabs3/tabs3_features.html).
- The in-repo deep dive stands as the primary competitive source: the weekly matters × days grid remains confirmed-absent across the field, and the bulk path, the grid, and the timer must share one WIP store — which they do.
