---
number: 287
slug: a-firm-wide-financial-total-is-never-screened
status: Proposed
date: 2026-08-13
area: Reports
summary: "Ethical walls are a deferred seam (ADR-0068 point 6) and nothing in this repository implements one, so this slice cannot honor a mechanism that does not exist; what it can do is refuse to design a shape that makes honoring one later impossible, and answer the one part of the question that does not wait. The part that does not wait: the bar-audit pack is NEVER screened. It is evidence produced for a regulator about a firm's handling of client money, and a partial one is not evidence — so the access answer to a screening concern here is a narrower grant (reports:trustCompliance, seeded to Owner and Admin alone) rather than a quieter number. The part that waits is genuinely binary and both arms are bad: a complete-but-undrillable firm-wide total ties to the books while leaking the walled matter's balance by subtraction from what is itemized, and an excluded-and-untying total leaks nothing while showing a member a firm-wide figure that disagrees with the reconciliation, the receivable control account, and another member's copy of the same report. That choice changes what the platform asserts about a firm's books and is flagged for the owner rather than settled. So that the later answer is cheap, every report response carries a completeness declaration from the first sub-slice — complete: true today, shaped to carry an excluded-matter count — so a consumer can never render a screened total as an unscreened one by omission. Location stays a view and reporting filter and never becomes an access gate, per ADR-0031."
---

**The bar-audit pack is never screened; whether an ordinary firm-wide total is screened is the
owner's call, and this slice ships the seam that makes either answer cheap.**

**Context:** A report is the one surface that reads across every matter and client at once, which is
exactly where a content screen binds hardest. Ethical walls are named in the white paper as the
future content-screening layer — a screened user would see a matter's header but not its confidential
contents — and are deliberately deferred with no concrete use case (ADR-0068 point 6). Nothing
implements one today. A design that ignored the question entirely would be fine until walls arrived
and then need every response shape changed; a design that invented a screening rule now would be
asserting something about a firm's books on behalf of an owner who has not been asked.

**Decision, the part that does not wait: the trust-compliance pack is never screened.** It is
produced for a regulator, about a firm's handling of client money, and a pack missing the matters a
member may not see is not evidence of anything. Where the concern is that not everyone should be able
to run one, the answer is the grant, not the number: `reports:trustCompliance` is its own key, seeded
to Owner and Admin alone, and a firm that wants a bookkeeper to run packs reaches for a direct grant,
which leaves a record.

**Decision, the part that waits.** For ordinary firm-wide financial totals the choice is binary and
both arms carry a real cost:

- **Complete but undrillable** — the total includes the walled matter's money, the screened member
  cannot open it, and the report says how many matters are not itemized. The total ties to the books.
  The residual — total minus the sum of what is itemized — is the walled matter's balance, computed
  by subtraction. The screen leaks a number.
- **Excluded and untying** — the total omits walled matters. Nothing leaks, and the member is looking
  at a firm-wide figure that disagrees with the reconciliation, with the receivable control account,
  and with another member's copy of the same report. A financial total that does not tie to the books
  is a different kind of hazard, and it reaches a wider audience than the wall does.

That choice changes what the platform asserts about a firm's books rather than how it presents an
existing fact, so it is **flagged for the owner** and recorded in the design's open questions, not
settled here.

**The seam that ships now.** Every report response carries a completeness declaration from the first
sub-slice: `complete: true` today, with the shape ready to carry an excluded-matter count. A consumer
therefore cannot render a screened total as an unscreened one by omission, and adding either arm
later is a change to one field's value rather than to every response shape. Location remains a view
and reporting filter and never becomes an access gate, per ADR-0031 and the white paper — a per-office
subtotal is a lens, not a boundary.

**Considered and rejected:** **Screen the audit pack too, for consistency** — consistency is not the
value being protected; a regulator receiving a silently partial trust record is a worse outcome than
a member seeing a matter caption. **Pick an arm now and let the owner override later** — the arms
differ in what the platform asserts about a set of books, and choosing by default is exactly the kind
of decision the design process reserves for the owner. **Ship no completeness field and add one when
walls exist** — it would mean revisiting every response shape and every consumer at the moment the
feature is most sensitive.

**Consequences:** The pack's access story is settled and narrow. The ordinary-total story has a
single, cheap decision point waiting for an answer, and a field in every response that makes the
answer expressible without a redesign.
