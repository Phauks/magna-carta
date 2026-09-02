---
worktree: (remote session — no local worktree path)
area: Tasks — the scope study, then the build: @magna-carta/tasks, the schema, the routes, the task screens, the matter plan, and the time link.
status: review
touches: packages/tasks, packages/timekeeping, packages/fixtures, packages/database, packages/notifications, packages/calendar/src/sources, packages/access-control, packages/identifiers, packages/data-access/src/pii-registry.ts, apps/api-worker, apps/web, roadmap.d/tasks.md, status.d, ROADMAP.md
---

# claude/tasks-feature-planning-ihaq2r

Planning only. The owner asked what a Tasks feature could be, framed as "ClickUp inside
Magna Carta" — assignments to self or others, linked to time entries, notified, visible from
inside a matter.

A design already exists and is Proposed pending owner flags
([`../../specs/2026-08-15-tasks-and-matter-plans-design.md`](../../specs/2026-08-15-tasks-and-matter-plans-design.md),
with [`../../specs/2026-08-15-notes-and-tasks-implementation-plan.md`](../../specs/2026-08-15-notes-and-tasks-implementation-plan.md)).
This stream does not rewrite it. It reads the brief against that design, records what the
design already settles, what it deliberately refuses, and what the brief adds that the design
never considered — and it re-verifies the design's claims against `main`, which has moved.

The study landed first
([`../../specs/2026-09-01-tasks-scope-study.md`](../../specs/2026-09-01-tasks-scope-study.md)).
The owner then answered its four gating questions — nullable matter, a platform priority enum, both
cancel and delete, and a first slice carrying both screens — and the build follows those answers.

**What is in flight.** The task record and its two screens, then the matter plan, both tracked as
slice 6·3. Concurrent streams should know this touches five shared things:
`packages/notifications` gains an audience and a payload key on the type (three
recipient-resolution call sites change with it), `packages/calendar/src/sources/all.ts` gains one
source entry, `packages/database`'s per-firm schema gains four tables, two nullable columns and
three widened CHECKs (two table rebuilds), `packages/access-control` gains four permission keys, and
`apps/web`'s matter section map, sidebar destinations and settings sections each gain an entry.

The owner answered **W8** on 2026-09-01 — a plan proposes and a member accepts — which unblocked the
plan half; it is built. **W11** and **W12** stay open and neither blocks: the build took the design's
own answer to each (ship no platform plans, keep the anchor vocabulary at `matter opened`). **T2** is
answered the way the scope study recommended and built: one nullable `task_id` on `time_entry`.

**Also touched, and worth knowing about:** `packages/timekeeping` gains the column on `time_entry`,
a refusal code, and `src/task-time.ts`; `packages/fixtures` gains a task volume, a profile version
bump to 16 and a `GENERATOR_VERSION` bump to 12 (both invalidate cached snapshots by design), a
regenerated baseline, and two additions to the calendar's firm-window scan allowlist that were
already outstanding on `main`.

**Not in flight, and not this stream's:** a plan's event and document steps, starting a timer from a
task (which waits on the live-timer run store becoming plural), and the board view. Each is gated on
an owner answer named in the scope study, or on a seam in another subsystem.
