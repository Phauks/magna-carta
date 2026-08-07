---
category: Fixed
---

The second review campaign's automation, email, and extraction findings, all sixteen of them, from
[`docs/reviews/2026-08-06-campaign-2-automation.md`](docs/reviews/2026-08-06-campaign-2-automation.md).

**The template expression language stops producing dates nothing can read.** `addDays` now shares the
calendar-range guard its two siblings already applied, so a day offset that leaves the four-digit
years is a `magnitude` refusal rather than a value: previously it produced a five-digit or negative
year, which the formatter's calendar-date pattern does not match — the computed field collapsed to an
empty string while the assembly counted a clean substitution — and which compared backwards against
every in-range date, because date ordering is a string comparison on the ISO form. Both failures were
silent, and both are the failure the absence model exists to prevent. Two related holes closed with
it: a value the formatter refuses at rendering time is now recorded as an absence with a reason
instead of collapsing to `""`, and the comparison arm refuses an operand that is not a calendar date
rather than answering from a string comparison that is not an ordering. A `date` custom field whose
stored text is not a calendar date now binds as text at the boundary that constructs it, so comparing
it against a date is a registration-time type error rather than a runtime lie.

**The re-extraction sweep converges over failures, not only successes.** Its candidate set is
"documents the catalog holds no live split for", which a `deferred` document (the ordinary state
wherever the recognition engine is unbound) or a `failed` one belongs to permanently — so a firm whose
oldest documents were scans re-enqueued exactly those documents every day and never reached the rest
of its catalogue. The walk now carries a cursor that advances past every candidate it examines rather
than only the ones it repaired, and the per-firm budget counts messages actually produced rather than
candidates looked at. Beside it, the index coordinator bounds re-attempts per document per engine
generation, so a document nothing can read stops costing anything after a few passes — and a deploy
that binds an engine changes the generation and resets the count, so a backlog drains rather than
being written off. A firm's whole catalogue is now reached; the fixture proves a catalogue whose
entire head is permanently failed still reaches its tail.

**A DKIM `pass` now means something about the sender.** RFC 6376 section 5.4 requires `From` in the
signed header set precisely so a verdict is a statement about who sent the message; the verifier
accepted a signature whose `h=` omitted it, which let anyone holding a message a domain had signed
rewrite `From:` and re-send it with everything still verifying. That is now a `fromNotSigned` failure,
refused before a DNS lookup is spent on it. The verification result also records how much of the body
the signature covered, and a partially-covered `pass` (the `l=` append attack) is no longer enough for
a sender-identity rule to file unattended. The number of signatures examined and the DNS lookups one
message may cause are both capped, since a correct body hash is computable by anyone holding the body
and was otherwise an amplifier pointed at the resolver. Key records carrying `t=y` no longer produce a
pass, RSA keys below 1024 bits are refused, and a non-numeric `x=` is a malformed signature rather
than a silently dropped expiry. The duplicate-`From` question the review left open is answered: the
capture record and the verifier both take the last instance, which is the one the RFC has signers
sign, and that agreement is now pinned by test on both sides.

**Extraction and filing.** One page per page index, so a repeated index from an engine can no longer
become two passages sharing a chunk id or two provenance rows disagreeing about the same page. A size
ceiling at the enqueue seam records an oversized document as `deferred` naming the ceiling, rather
than discovering it as an out-of-memory inside the queue consumer. The email add-in over-fetches
before the ethical-wall filter narrows a result set, so a walled matter can no longer consume a
member's own suggestion slots. Participant addresses resolve to directory entities in one batched
query instead of one round trip per recipient. An auto-file decision now always states a conflict
hold, even when another demotion won the ladder, and a malformed matter id in the deciding evidence is
refused rather than dropped — dropping it shrank the deciding set, which is what permits a firing. The
load-profile harness gained a probe carrying a repeating block, an aggregate, and the protected keys,
so the read plan and the serial decrypt count are measured rather than argued about.
