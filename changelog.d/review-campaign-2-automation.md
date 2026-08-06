---
category: Added
---

Review — the second campaign's automation, email, and extraction work, read adversarially and
recorded at [`docs/reviews/2026-08-06-campaign-2-automation.md`](docs/reviews/2026-08-06-campaign-2-automation.md).
Documentation only: no source changed and no behaviour moved.

Sixteen findings, three of them high. The template expression language's `addDays` is the one date
helper that does not check its result against the calendar range its two siblings check, and an
out-of-range date it produces is neither refused nor rendered — the computed field collapses to an
empty string while the assembly reports a clean substitution, and a comparison against it answers
backwards because date ordering is a string comparison on the ISO form. Both are the failure the
absence model exists to prevent: a blank nobody notices, and a clause silently dropped. The
re-extraction sweep's convergence argument holds only for documents that succeed — a version that
ends `deferred` (the ordinary state wherever the recognition engine is unbound) or `failed` never
gains a split, so it stays a candidate forever, and because candidates are drawn oldest-first under a
per-firm cap, a firm whose oldest documents are scans re-enqueues the same set every day and never
reaches the rest of its back catalogue. And the DKIM verifier accepts a signature whose `h=` omits
`From`, which the RFC requires precisely so that a verdict is a statement about the sender; that
verdict is informational today and becomes the precondition for unattended filing the moment the
auto-file wiring lands.

The report also records what held up. The expression sandbox's structural claims are accurate to the
code — no traversal production, no dynamic dispatch, no prototype-reachable lookup, every walk
bounded, every money intermediate checked before the operation. The protected-value path has no
second read path, catches the chokepoint's refusal by identity rather than re-deriving the
permission, and cannot record a decrypt that did not happen. The auto-file guardrails compose: no
combination reaches an unattended file past ambiguity, a human decision, a withdrawn access, a closed
matter, or the firm ceiling. Two standing facts frame all of it — the ethical-wall filter is still
the identity function, and the auto-file engine is not yet wired to anything — so several findings
describe defects that are invisible now and live on the day those seams are connected, which is the
cheapest moment to have them written down.
