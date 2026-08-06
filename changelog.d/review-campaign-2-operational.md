---
category: Changed
---

Review campaign 2, operational area — an adversarial read-only pass over the custody register's
operational half (stocktake, gated release, labels, reports, reviews and reminders, the destruction
workflow, the Nevada will-deposit catalog), the case calendar's recorded model and thirteen-source
federation, the matter-close advisory, and the worker routes and data-access statements over all of
it. Findings are recorded in
[`docs/reviews/2026-08-06-campaign-2-operational.md`](docs/reviews/2026-08-06-campaign-2-operational.md):
one high, six medium, seven low. No code was changed.

The one that matters most: **a two-signatory custody release is composable into one person.** Both
signatory identifiers arrive in the request body, and the only checks — at the service and at the
trigger — are that a witness is present when the firm's policy asks for one and that the two
identifiers differ. Neither is tied to the authenticated actor and neither is validated against the
firm's members, so one member can record a witnessed release of an original on an append-only ledger
that then permanently asserts two people signed. The destruction workflow's requester/approver split
is the contrast: it is genuinely two authenticated requests, and it is what the release gate should
look like.

The rest cluster into three themes. **Guards that live in one caller rather than at the database:**
the deadline edit path is the only statement in its file without the `state = 'open'` guard riding
the write, and a closed stocktake is frozen only by the absence of a re-open statement while its
sighting table carries four triggers. **A federated read that quietly disagrees with the register it
claims to be:** three custody-derived timeline sources drop the packet- and item-status predicates
the custodian's own reminder reads carry and document, so the calendar shows due-backs for originals
that came back and review dates for wills the firm has released or destroyed. **Approximations
presented as answers:** the stocktake reconciliation truncates at ten thousand rows in the direction
that drops the corrective sightings, then freezes those counts as the number a firm reports; the
deadline list's `overdue=true` filter is a UTC-date comparison with no per-row zone check behind it.

The review also records what was checked and holds — the stocktake's observe-only boundary, the
intrinsic-value refusal's three independent enforcement points, the advisory's inability to block or
leak, the visibility predicate's structural composition into every timeline source, the mixed
civil-date/instant cursor's correctness in both directions, the audit-log allowlist, and redaction
across both packages — so the next pass does not re-derive it.
