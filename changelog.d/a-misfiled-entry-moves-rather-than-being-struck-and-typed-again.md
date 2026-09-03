---
category: Added
audience: internal
---

A time entry filed on the wrong matter can be moved to the right one.

Time gets recorded against the wrong matter — a person is on two of them in one afternoon, the picker was left where it was, the timer was bound before anybody had decided. Until now the only remedy was to strike the entry and type it again, which loses its number, its internal memo, its codes, its attached files and its whole history, and leaves a struck row standing on a matter the work was never really on.

**`POST /api/v1/time-entries/{id}/refile` moves it instead.** Its own route rather than a `matterId` on the update, and deliberately: this is a cross-matter write. Two ledgers change, two matters' totals move, and the rate the entry froze was resolved against the matter it is leaving. A patch field would let anything that can edit a narrative also move money between matters without meaning to.

**What carries, and what is re-asked.** The entry number carries — a reference that changes is a reference that lies, and anything that cited it has to keep resolving. The consequence is stated rather than hidden: the number's own shape names the matter the entry was FIRST written on, so after a move that prefix is provenance and not a claim about where the entry lives now. The description, the memo, the codes, the attachments and the history all carry untouched.

The **rate and the rounding increment are re-resolved** against the destination, on the entry's own work date. Both are matter-scoped — the rate chain reads matter, then client, then timekeeper; the increment resolves matter, then client, then user — so carrying one client's answers to another is how a firm bills at the wrong rate. This is not the rate-snapshot invariant bending: that rule says a rate card edited later never re-rates a standing entry, and it still holds. What changed here is the question, not somebody's later edit to the answer. The acknowledgement reports what the entry now carries, so a screen that assumed only the matter moved is not left showing the wrong money.

**What it refuses, and why.** Anything past draft, anything on a bill, anything a draft invoice has claimed, a matter this firm does not have, and the matter the entry is already on. Past draft the entry is evidence somebody is relying on — an approved entry is a reviewer's decision about a matter, a billed one a line on a finalized invoice — and the answer to both is a void and a fresh record, never a move nobody can see. Refusing the no-op move rather than reporting success keeps the act's meaning.

**Every move is on the record**, as one audit event naming both matters, so a reader of the entry's history can see where it came from and when it moved.

On screen, the Matter field is now settable on every draft — in the Time Sheet's Matter cell and in the record window. On a row not yet written it is still the choice that lets the row be written at all; on one the firm holds, picking another matter moves the entry. The one thing a move cannot do is take a written entry off a matter altogether: the record has to be somewhere.
