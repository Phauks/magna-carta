---
category: Added
audience: public
---

**A consultation is numbered from the moment it is recorded.** A prospective matter carried no number at all, so every surface that prints a matter number printed the word "Consultation" instead — a category, not a name, and nothing a person can quote on an intake sheet, a conflicts check, or a bill for the consultation itself. Consultations now draw a tentative number from their own sequence at creation (`matter.consultation_number`, migration `20260901T020001_consultation-number`).

It is a SEPARATE run from the matter number, not a preview of it. A consultation that never becomes a matter must consume no matter number — a gap in that run reads as a lost file — so the two never share a counter, and opening a matter ADDS its permanent number rather than replacing the tentative one, which stays on the record so anything filed under it still resolves. Both draws ride the same `matter_number_counter` / `matter_number_allocation` mechanism (and the same allocation-key backstop against a losing concurrent draw), separated by a `consultation/` scope-key prefix that no rendered matter scope key can forge — every segment value is folded into the URL-safe set, which contains no `/`.

`numbering_scheme` rows now carry a `purpose` (`matter` or `consultation`), with one active scheme per purpose; `GET`/`PUT /api/v1/numbering-scheme` take it and default to `matter`, so a caller that says nothing means what it always meant. A firm that has configured no consultation scheme renders from the built-in default (`C2026-0001` — a leading C, the year, and a per-year counter), and the GET says so with `usingDefault`, so the settings screen shows what is actually in force rather than an empty box beside numbers people can already see. The matter sequence deliberately keeps no default: there is no defensible shape to invent for a number that is then frozen, so a draw with no scheme still refuses.

`consultationNumber` is served on the matter summary, the matter detail, the consultations list, and the create acknowledgement, and the docket's search matches it alongside the matter number — for a file that is still a consultation it is the only number anyone has.

## Public

**Consultations now get a file number.** A consultation is given a number the moment it is recorded — `C2026-0001` unless your firm sets its own shape — so there is something to write on an intake sheet or a conflicts check straight away, instead of the word "Consultation" where a number belongs. It comes from its own sequence, so a consultation that never becomes a matter does not use up one of the firm's matter numbers.

**Opening the matter adds its matter number; it does not take the consultation number away.** The docket and the matter header show the matter number from then on, and the consultation number stays on the matter's own page — so anything filed or quoted under the tentative number still finds its way back. Searching the docket finds either.

**Recording a consultation works before the firm's numbering is set up.** Consultations number themselves from a built-in sequence until an administrator sets the firm's own, so a file can always be taken down while the numbering is still being decided.
