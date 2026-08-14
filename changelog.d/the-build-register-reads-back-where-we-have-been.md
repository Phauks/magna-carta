---
category: Added
audience: internal
---

**The build register now says where we have been, reconstructed from version control rather than
remembered.** `docs/now.md` gains a _Where we have been_ section: the count at each of the nine
ledger statuses at every past commit that touched a `roadmap.d/` node file, what moved between one
commit and the next, and the movement per area since the series began.

**One parser, so the trend cannot disagree with the totals above it.** For each first-parent commit,
the ledger as it stood at that commit is read out of git and parsed by the same `parseArea` the live
render uses. The counts are persisted one record per commit — keyed by full commit hash — in
`docs/register-history.json`, so the expensive pass runs once: an ordinary `vp run register-build`
reads only the commits that file does not already hold, normally one.
`vp run register-build --rebuild-history` (or
`node tooling/doc-fragments/build-register-history.mjs --rebuild`) recomputes the whole series, which
is what to run after changing the ledger parser or the status vocabulary.

**A commit that does not parse is a hole, and stays one.** Nineteen of the forty commits in the
series are written in a ledger vocabulary today's parser rejects — one node carrying a `built` status
between 2026-08-04 and 2026-08-11 — and each is recorded with the parser's own reason and listed in
the document. Nothing is interpolated across them: the +27 shipped that spans that week is printed
beside the count of commits nobody read, rather than apportioned to the two rows on either side of
the gap.

**Rates, and no projected date.** The section states the change in shipped nodes since the ledger
began, the rate across the whole series, and the rate over the most recent stretch with no hole in
it. It projects no completion date, because the ledger puts no size on a node and a date derived
from node counts would treat a jurisdiction research corpus and a second authentication factor as
equal work.

Where the register used to say that no trend line could be drawn from the ledger without inventing
one, it now points at the section and names the two limits that survive: a snapshot shows when a
node's **status** changed and never when the work happened, and a capability added to the ledger
late arrives as a jump in the total rather than as work done. `pnpm run lint:roadmap` re-derives the
document from both committed inputs — the ledger and the reconstruction — so neither can drift.
