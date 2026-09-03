---
category: Added
audience: public
---

**A time entry names the task it was worked on — one nullable `task_id` on `time_entry`, with the
minutes read back grouped over a whole page of tasks.**

The scope study's flag **T2** answered its own way: ONE task per entry, never a set. An entry split
across two tasks needs an allocation of its minutes between them, and an allocation is a second
ledger with its own rounding and its own disputes; the honest encoding of "this block served two
tasks" is two entries, which the capture surface already supports. A join table is an additive
migration over this column's data if many-to-many is ever wanted; the reverse is not.

`assertTaskOnMatter` is the whole enforcement of the one rule the schema cannot hold — SQLite cannot
express the cross-table condition without a trigger. It refuses three shapes under one code, on the
`file-not-on-matter` model, because the caller's remedy is the same for all three: a task that does
not exist, a task on another matter (which would let one matter's time point at work another matter
is paying for), and a task on NO matter, which is the firm's own work and has nothing to bill it to.
A null `matter_id` on the task is a refusal, never a wildcard.

`readTaskTimeSummaries` is minutes and never money: what a task COST is a billing question with a
different audience and a different permission, and a summary carrying both would be gated by the
stricter everywhere it is read. Void is excluded and every other status counts. It is **batched by
construction** — a set of task identifiers in, a map out — because its caller is a paged list, and
it rides `pageFrom` beside the attachments read rather than a route of its own, so nothing was left
uncalled. The scope travels WITH the totals rather than once per page: the same two numbers mean
"what the task cost the firm" under `firm` and "what I put into it" under `own`, and a consumer must
not be able to render one without the other.

Setting the link is a field in the time record window offering that matter's open tasks. The load
profile gained a task volume — the deep list, the firm's own matterless work, and the linked time —
and the harness earned its keep on the first run: `tasks.my-work-page-1` scans, which is structural
(the firm-wide read names no matter and no assignee, and its visibility fragment is an OR spanning
the presence of `matter_id` itself), and it is recorded by name with the number to revisit it
against rather than waved through. Two pre-existing firm-window scans, `matterNote` and `matterTask`,
were sitting unallowlisted and are now named with the same reason as the other eight.

## Public

Time entries can now say which task they were for.

Open a time entry and pick the task in the **Task** field. It offers that matter's open tasks and
nothing else — time on one matter cannot be work on another matter's task. Most entries will name
none, and that is fine: time is recorded against a **matter**, and naming a task is an extra you
choose when you want to know how long a particular piece of work actually took.

The task then shows it. **Time logged** appears in the task's row with the total — minutes, not
money, because what a task was billed for is a billing question asked on a billing screen. If you
are allowed to see other people's time the total is the whole task's; if you are not, you see your
own and the row says **by you**, so the number is never mistaken for the whole.

One task per entry. If a block of time served two tasks, record two entries — splitting one entry
between tasks would mean deciding how many of its minutes went to each, and that is a second set of
books. Starting a timer from a task is not built yet, and a task never carries an estimate the
product quietly compares against the real time.
