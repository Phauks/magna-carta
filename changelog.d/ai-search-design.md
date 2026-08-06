---
category: Added
---

The design for **natural-language document search** — asking a question in ordinary words and getting back
the passages from the firm's own files that answer it, each with the document, version, and page it came
from. Design and plan only; no product code, and nothing is enabled for any firm.

**It finds; it does not answer.** What comes back is the firm's own words, ranked, with a citation on each
one. Nothing is composed. If nothing matches, the result is empty and says so rather than assembling a
paragraph out of whatever was nearest. The reason is not caution for its own sake: a composed answer moves
the checking onto the reader, who cannot see the passage that was left out, and in a legal product the
failure mode is not an embarrassing sentence but a confident wrong one about a client's matter, sourced to
the client's own file. A search that hands over four passages and says where each one is has actually saved
the work. Adding composed answers later would be a separate decision with its own consent, not a setting
that gets switched on.

**Turning it on is the firm's decision, and off by default.** Nothing is indexed and no index even exists
for a firm until an administrator switches it on and accepts a disclosure. What the disclosure says is
short and checkable: the text pulled out of the firm's documents is copied into storage Cloudflare manages,
outside the firm's own; no outside model company is involved at any point and nothing is sent to one; the
question a member types is turned into numbers by a model to be matched, and that happens on the same
infrastructure everything else already runs on. Two things it deliberately does **not** promise, because
they cannot be verified: where in the world that copy is held, and that switching the feature off erases
every trace from Cloudflare's side. What the platform can prove it deletes, it deletes and can enumerate;
what it cannot prove, it declines to claim. A firm whose obligations require either guarantee is told, in
the disclosure, not to enable this.

**The index is fed deliberately, never pointed at a bucket.** A firm's storage holds far more than its own
working files — material received from the other side in litigation, half-finished edits nobody has saved,
machine-readable index files. Handing all of that to a search index would put an opponent's production into
a search of the firm's own work, which is precisely what the platform reorganized its index scoping to
prevent. So only one thing produces material for this index, and it produces exactly one kind: the text of
a committed document version. Everything else is missing because nothing can put it there, not because a
rule excludes it. **Magnus transcripts cannot reach it at all** — they live in the firm's database, not in
file storage, and there is no path from one to the other.

**A filter is not a wall, so the wall is somewhere else.** The obvious way to keep one matter's documents
out of another matter's search is to attach a condition to the query. That works right up until the day
somebody's code builds the condition wrong, and then there is nothing behind it. So the condition is
treated as a way to get better results rather than as the thing keeping matters apart: every result that
comes back is looked up again in the firm's own records and checked against what the person asking is
actually allowed to see, before a single word of it is shown. Anything that fails is dropped, and the drop
is treated as a serious fault to be investigated rather than a normal occurrence. The firm's own records
are the authority on who may see what, and the search index is never asked.

**And the part that is unknown is being tested before it is trusted, not after.** Cloudflare's own
documentation disagrees with itself about what these conditions can express. Rather than guess, a fenced
experiment on entirely made-up data runs first: two invented matters, a thousand questions deliberately
written to pull the wrong matter's documents to the top, and a hard rule written down in advance — one
wrong result and the feature is not built. It also tests the thing nobody thinks to test, whether a
condition the system does not understand is rejected or quietly ignored, because a condition that is
ignored is worse than no condition at all.

**The index runs behind, and every result says how far.** Material becomes searchable on a schedule
measured in hours, not seconds, which is a real limitation and not a setting anyone can tune away. Because
the platform knows exactly what it has handed over and when, every answer carries a plain sentence — how
current the index is, and how many documents filed since then are not in it yet — stated even when the
answer is none, so that a zero is reassurance rather than silence. A search that quietly omits this
morning's filing is worse than one that admits it is an hour behind.

Also settled: one firm gets one index of its own, because sharing one between firms is refused and the
alternatives run out of room at a hundred firms; searches cover one matter at a time to begin with, with
searching everything a person can see held back until the filtering can be shown to work well enough to be
useful; a matter can be kept out entirely, and keeping it out deletes what was already handed over rather
than merely stopping more; material received in litigation is never fed at any point; a result-caching
feature stays off because it keys on the question text and could hand one matter's passages to a question
asked about another; and no real firm is switched on until Cloudflare stops calling the product a beta and
publishes final prices.
