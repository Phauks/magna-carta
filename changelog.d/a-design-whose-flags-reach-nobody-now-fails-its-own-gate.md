---
category: Fixed
audience: internal
---

**The general ledger has been waiting on sixteen owner decisions since its design merged, and the
document written to collect owner decisions showed none of them.**

A design lands carrying a numbered flag register, its capability nodes go into the feature ledger as
`designed`, and if nobody writes the `awaiting-owner:` line by hand the questions exist only inside
the spec. The build register renders, the decision desk renders, and the slice sits blocked with the
one person who can unblock it never shown the block. The ledger node even said so in prose —
"sixteen owner flags gate what is built" — which is true, unactionable, and invisible to every
document that reads the keyed field.

Six questions now reach the desk. Which sub-slice each one decides is recorded on that sub-slice
rather than piled on the parent: whether a starter chart of accounts ships and whether it may seed a
role mapping; the five that decide fiscal-period close, including whether the lock is checked inside
the posting primitive itself, which is the only version a caller cannot decline to honour and is a
behaviour change in shipped subsystems; the three on accounts payable; whether trust accounts appear
on the firm's balance sheet; and the three that decide whether the slice starts at all. Custodian's
retention dating gains one too — its notes have read "owner-gated" since the design merged, and the
question behind that was nowhere a person would look for it.

**The second occurrence is why there is now a detector rather than another sweep.** An earlier pass
moved seventy flags onto nodes by hand; it fixed the ledger of that day and installed nothing, so the
next merged design reopened the hole. `lint-ledger-staleness` gains a rule: a spec carrying a flag
register, cited only by nodes with nothing built behind them, must have an `awaiting-owner:` line on
at least one of them.

The narrowing is the whole rule — **fire only when every node citing the spec is pre-code.** A flag
register is a point-in-time list and flags are answered by being built, so the custodian and
discovery registers are mostly settled and the shipped code beside them is what settled them.
Nothing in a spec distinguishes an answered flag from an open one, so the rule refuses to guess. It
was measured against the whole ledger before it was kept: one hit, no false positives, where the
obvious wider form takes six groups and five of them are wrong.
