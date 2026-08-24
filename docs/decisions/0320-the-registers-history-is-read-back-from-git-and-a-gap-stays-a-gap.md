---
number: 320
slug: the-registers-history-is-read-back-from-git-and-a-gap-stays-a-gap
status: Proposed
date: 2026-08-14
area: Dev tooling
summary: "The build register's \"where we have been\" is reconstructed from version control rather than accumulated by hand: for every first-parent commit that touched a `roadmap.d/` node file, the ledger at that commit is parsed by the same parser the live build uses, and the counts are persisted one record per commit — keyed by the full commit hash, dated by committer date — in `docs/register-history.json`. An ordinary `vp run register-build` reads only the commits that file does not already hold (normally one), so the expensive pass runs once; `--rebuild-history` recomputes the series from scratch, which is how a change to the parser or the status vocabulary reaches the past. A commit whose ledger does not parse under the current schema is recorded as unread with the parser's own reason and rendered as a hole: nothing is interpolated across it, the changes either side are stated across the hole rather than apportioned to it, and the document says how many commits are missing and why. No completion date is projected from any of it, because the ledger puts no size on a node."
---

**The history is in git, so it is read back from git — and where it cannot be read, the document says
so instead of drawing a line through the gap.**

**Context:** The build register said, correctly, that the feature ledger records only each
capability's current status and keeps no history, and concluded that no trend line could be drawn
without inventing one. The first half is true of the ledger and the second is false of the
repository: `roadmap.d/` is version controlled, and the ledger at a past commit is the same shape of
document as the ledger today. The past was not missing; it had never been read.

Two ways of getting it wrong were available. Accumulating counts going forward — appending today's
totals on every build — would have started the series at zero and thrown away the month already in
history. Writing a second, laxer parser for old commits would have produced a series that disagreed
with the number at the top of the same page, which is worse than no series: two numbers with one
name and no way to tell which is wrong.

**Decision:** One parser, one direction, one persisted record per commit.

**Reconstructed, not accumulated.** For every commit on the trunk's first-parent history that
touched a node file in `roadmap.d/`, the ledger at that commit is read out of git and parsed by
`parseArea` — the function the register itself renders from. A snapshot holds the commit hash, the
committer date, the count at each of the nine statuses, the total, and per-area totals. The full
hash is the key: it is the only identifier that stays unambiguous as the series grows, and a short
form is derived for display.

**Persisted, and appended cheaply.** The series lives in `docs/register-history.json`, committed. A
normal build reads only the commits the file does not already hold, so the cost of the reconstruction
is paid once rather than on every render; the file is written with each snapshot's statuses and each
area on one line, so a landed commit appends a block a reviewer can actually read. `vp run
register-build --rebuild-history` recomputes everything, which is what a change to the parser or the
status vocabulary calls for, since a commit that was unreadable may have become readable.

**A gap stays a gap.** A commit that does not parse under the current schema is recorded as unread
with the parser's reason and is rendered as a hole — listed by date, commit and reason, with the
count of unread commits carried in the table beside the row that follows them. Nothing is
interpolated, no line is smoothed, and a change measured across a hole is stated as spanning it
rather than attributed to either side. A record that was not read and gives no reason is refused by
the file's own parser, because such a record is indistinguishable from a guess.

**Rates, never dates.** The document states the change in shipped nodes, the rate over the whole
series, and the rate over the most recent stretch with no hole in it. It projects no completion
date: the ledger puts no size or effort on a node, so a date extrapolated from node counts would
treat a jurisdiction research corpus and a second authentication factor as equal work.

**Consequences:** The register now renders from two committed inputs, and its drift gate re-derives
from both — the ledger and the reconstruction — so neither can rot. Two limits are real, named in
the document, and not fixable by better tooling: a snapshot shows when a node's **status** changed
and never when the work happened, and a capability added to the ledger late arrives as a jump in the
total rather than as work done. The reconstruction also depends on the git history being present; in
a shallow clone it leaves the committed file untouched rather than producing a shorter series.
