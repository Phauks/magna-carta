---
category: Changed
audience: internal
---

**The hard and soft cost distinction is gone from the cost surface.** The owner struck it in plain
words — it is not a real thing — and the ruling was recorded as settled: not renamed, not moved to
settings, not kept as a hidden field. It does not exist in the model, the capture form, the columns,
the filters, the review pane, or any copy.

It shipped anyway, because the surface was ported from a superseded draft rather than from the round
that struck it. Gone now: the class column and its filter, the class labels and their meanings, the
class field in the capture form, the class row in the details panel and the review window and the
print sheet, the class clause in the draft refusal, and the hard and soft figures in the panel
summary. Payee drops to three states, because the fourth existed only to carry the distinction, and
the largest-payee ranking now considers every cost that names somebody rather than only the hard
ones.

**The review gate reads off, matching the Time tab.** The two tabs of one matter disagreed about a
firm setting nothing serves: costs assumed review was on and showed Submit, Approve and Kick Back,
while time assumed off and showed none of it. A reader moving between them saw two different firms.
Off is the settled default, and off means the review vocabulary is absent rather than disabled. The
review window and its dialogs stay wired behind one flag, so serving the setting later is a single
change.

Column order, labels and figures come to the settled round: Description leads and is called
Description rather than Info, Recoverable is Billable, Receipt (one) is Attachments (many), and the
footer carries three figures — unbilled, billed, absorbed — rather than four.

Two stale affordances go with it. "Open in Billing" waited on a section that has shipped, and now
waits on the invoice reference it actually lacks. Unsubmit is rendered against a submitted cost,
marked, as the Time tab already does.

**One write still carries the struck field**, because the create contract makes it required: it is
supplied internally as a constant and no caller sees it. The field remains in the schema and, more
consequentially, in the finalize path, where it selects the ledger account — so removing it there is a
decision about accounting rather than a deletion.
