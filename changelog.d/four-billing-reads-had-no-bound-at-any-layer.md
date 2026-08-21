---
category: Fixed
audience: internal
---

**Four billing list endpoints read with no `LIMIT` at any layer.** A matter's recoveries, a bill's
credit notes, a bill's delivery attempts, and a client's open credits each built a bare
`SELECT ... WHERE ... ORDER BY ...` and returned however many rows the firm's own history held. This
is the same defect as the two matter listings fixed earlier, not the capped-but-silent one the rest of
the campaign has mostly been.

Three now page over the platform's keyset cursor, all ascending: the recoveries and the credit notes
because each is a history read forwards, and the client credits because the oldest open credit is the
one a person reaches for first.

**The recovery read the contingency fee is derived from stays whole, and is now a separate function
that says so.** The derivation is a sum — a page of recoveries would produce a fee computed from part
of what the firm recovered, which is a wrong number rather than a short list. `readMatterRecoveries`
keeps every row for the arithmetic; `readMatterRecoveriesPage` serves the list. A test asserts the fee
is still derived from sixty recoveries, so the two cannot be quietly reunited.

**The delivery history is capped with a signal rather than paged**, and the ordering is why. Two
attempts on one day are ordinary — an email in the morning, a posted copy in the afternoon — so the
sort key is `(delivery_date, recorded_at, id)`, three columns where the platform's opaque cursor
carries two. Dropping `recorded_at` would scramble same-day attempts into identifier order and lose
the fact a reader is looking for. The response already leads with a state summary computed from every
attempt, so the list is detail behind an answer already given; `capped` is what stops the detail being
cut in silence.

**The credit-note list no longer reads its lines one note at a time.** It was an N+1 whose length the
bill chose. With the page bounding the identifier list, `readCreditNoteLinesForNotes` answers the
whole page in one `IN (...)` — two reads instead of one per note, and it refuses a list past the
bound-parameter ceiling rather than silently building an oversized statement.
