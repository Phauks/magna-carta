---
category: Changed
audience: internal
---

**Three indexes added, three retired, and the eight that were not added written down with the numbers
that declined them.** The second half of the follow-up to the custodian and calendar volume sweep;
the first half rewrote the due-back reads and needed no schema change at all.

**The member filter's participant lookup.** "What is on this member's calendar" resolves as an
`EXISTS` supplying both the event and the member, but only `member_user_id` was indexed, so each
candidate event paid a walk proportional to how many events that member is on.
`matter_event_participant_member_event_index (member_user_id, event_id)` makes it a covering seek,
and the single-column index it strictly subsumes is dropped in the same migration — the table carries
the same number of indexes it did before. Keyed on the member first rather than widening the existing
`(event_id)` index, which measured identically but would have given up seeking by member alone.

**The register list's sort.** `custody_packet` is ordered by `(created_at, id)` on every page, keyset
pages included, and nothing covered that ordering — so every page was a full table scan into a
temporary B-tree, which is the cost keyset pagination exists to remove.
`custody_packet_created_index` costs one B-tree insert when a packet is created and nothing
thereafter: both columns are immutable, so the status and location updates every movement makes do
not touch it.

**The firm calendar's custody movements.** The 31-day firm-wide window reads movements by date with
no packet to key on, so it walked the whole ledger — and that ledger is the one table here that grows
without bound, because a firm holds originals for decades and appends to their history the whole
time. `custody_movement_occurred_index (occurred_at, id)` is insert-only on an append-only table: one
entry per movement a person physically records.

**Two indexes retired for having no reader.** Nothing queries `custody_movement` by `item_id` — every
read goes by `id`, by `packet_id`, or now by `occurred_at` — so `custody_movement_item_index` was
pure write cost on the subsystem's largest table, and it was the cheap-looking entry that made the
due-back reads walk the whole ledger. The partial `custody_movement_due_back_index` was built for the
overdue sweep, and neither that sweep nor the timeline's due-back source seeks by `due_back_on` any
more. `custody_movement` ends with one fewer index than it started.

Measured on the profile corpus against the committed baseline. The first two are harness
measurements; the register pages are direct statement probes, because the harness measures the
register under its filters rather than unfiltered.

| Read                                   | Before   | After    |
| -------------------------------------- | -------- | -------- |
| `timeline.firm-window-member-filtered` | 8.64 ms  | 0.65 ms  |
| `timeline.firm-window-31-day`          | 18.58 ms | 10.80 ms |
| register list, page 1 unfiltered       | 0.32 ms  | 0.09 ms  |
| register list, page 2 keyset           | 0.42 ms  | 0.07 ms  |

The register's two filtered reads plan exactly as they did before — the planner keeps the temporary
B-tree where the filter has already narrowed to a handful of rows, which is the right call and the
reason the new index buys nothing there.

**What was declined.** The firm-wide window scans seven more sources, and none of them gets an index
here. Each costs at most 1.7 ms of that one read at this corpus, and between them `file`,
`time_entry`, `cost_entry`, `email_matter_link`, `document_assembly`, `conflicts_check`, and
`trust_movement` are the platform's hottest write paths — seven indexes on seven constantly-written
tables to save a few milliseconds on federation's weakest read is the wrong trade, and taking it
would spend the evidence that is meant to decide whether a projected read model is ever built. The
scan allowlist still names every one of them by hand, now with the reasoning and the numbers beside
it.
