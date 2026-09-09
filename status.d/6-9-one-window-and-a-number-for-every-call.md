---
slice: 6·9 — One window for a call, a typed length beside the span, and a number every call carries
group: phase-6
order: 9
research: n/a
spec: n/a
plan: n/a
built: done
ui: done
load-profile: n/a
tested: done
branch: claude/zen-ramanujan-rh7zbg
active-work:
next: the History tab becomes the audit feed once a route serves one, which would let it say which fields a correction touched rather than only that one happened; the right pane grows the transcript and the recording when the carrier is connected; the firm's own time zone, which is what would let a reference number carry the day the firm saw rather than the day in UTC
link-spec: docs/specs/2026-09-07-call-and-text-log-design.md
link-plan:
adrs:
blocked-by:
---

The owner's third round on the deployed screen. Two of its six items are real capabilities the log did not have, and the rest is the shape of the one window it now has.

**There was one modal too many, and now there is one.** Recording a call opened an action dialog; opening a row opened the record window. They rendered the same fields through the same component and disagreed about everything around them — one had tabs, one printed, one put its commit under a heading and the other in an action bar. They are one window now, and the only difference between its two states is whether it opened with a record in it. A record being made asks where it belongs, because at that moment the anchor is one of the things being said; a record already on the log moves between anchors through its own concurrency-safe acts in the action bar, as it did.

**A length is typed, and it need not be the span.** The previous round derived the duration from a start and an end, which is right until somebody is put on hold: an hour on the line and twenty minutes of call are two true facts about one call, and a form that computes either from the other is asserting they are the same number. So `communication.ended_at` is stored beside `duration_seconds`, the length is typed — `20`, `1h 5m` and `1:20` all read — and an end fills an EMPTY length and never overwrites one somebody wrote. Where the two differ the form says so in a line under them and the record shows both, so the gap reads as the hold it is rather than as a mistake.

**Every call and text carries a number, and it exists before the record does.** `2026-09-08-0042`: the day it happened and that day's own sequence, drawn through the shared counter idiom with the partial unique index over the rendered number as the backstop — the one sequence in the platform with no allocation table, because its rendered string contains the whole of its scope. The migration numbers every row already on the table. And the window shows the number the next record WOULD draw before anything is saved, because the person entering a call is usually still on the telephone and the save is too late for the sentence they are in the middle of; it is a preview, it says so, and the record's own number replaces it the moment there is a record.

**The description is the row's second line.** It is prose, usually longer than every other fact on the row together, and as a column it was either truncated to a few words or wide enough to push the facts off the screen. It takes the row's whole width underneath the facts now, through the one table's own row-detail — the same mechanism the time sheet's description sits in.

**A number longer than a number is an extension, not a formatting failure.** `AsYouType` gives up silently once the digits exceed what a country holds, so typing a direct dial onto the end of a number turned `(312) 555-0148` into a run of fourteen digits under the cursor. The extra digits roll into an extension field the phone component now owns — the split is the longest prefix libphonenumber calls possible, so a North American number typed with its trunk 1 is not cut a digit short — and the two halves store as one string, `+13125550148x4102`, which the formatter reads back into both. The Directory's contact rows had built their own extension input beside the shared field; they use the shared one now.

**An intake starts from the form as well as from a record.** Save And Start An Intake records the call first and hands the saved row up: an intake with no account of the call that caused it is exactly what the control exists to prevent.

The provenance tab is a **History** rail on the right, in the shape every other record window uses.
