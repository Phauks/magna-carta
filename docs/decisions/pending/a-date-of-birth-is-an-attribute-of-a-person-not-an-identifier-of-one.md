---
slug: a-date-of-birth-is-an-attribute-of-a-person-not-an-identifier-of-one
status: Proposed — owner decision required
area: Directory
date: 2026-08-30
summary: "Date of birth is stored today as an encrypted directory_identifier row, and the codebase already flags the mismatch: IdentifierNotIndexableError exists because a date of birth is too low-entropy to blind-index, so conflicts resolves it by decrypt-and-compare. It is the one entry in that catalog nobody issued, that identifies nobody uniquely, and that the firm needs to compare with less-than and greater-than rather than equals — is this client a minor, has a limitation period tolled, is this person over sixty-five. A range query over ciphertext is not a query. Date of birth, date of death, a separate deceased flag for the real state of known-dead-date-unknown, and place of birth become first-class nullable columns on directory_person, following NIEM, which puts birth, death and citizenship on the person and SSN and passport in identification. The one contested part is whether the date is plaintext, and the recommendation where full plaintext is uncomfortable is a plaintext birth year beside the retained sealed full date: it serves every range question at a fraction of the re-identification exposure. The dob scheme is never dropped, only closed to new writes."
---

**A date of birth is a fact about a person, not an identifier of one — and the code already says so.**

**Context:** `IDENTIFIER_TYPES` contains `dob`, and `IdentifierNotIndexableError` exists **because**
of it: the entropy is too low to blind-index without leaking the value distribution, so the conflicts
engine resolves a date-of-birth agreement by decrypting a candidate set and comparing. It is the only
entry in that catalog that no authority issued, that identifies nobody uniquely, and that the firm
wants to compare with `<` and `>`.

The questions a firm actually asks of a date of birth are ranges. Is this client a minor, so a
guardian ad litem is needed. Has a limitation period tolled. Is this person over sixty-five, which
several elder-abuse statutes turn on. Whose birthday falls this month. **A range query over ciphertext
is not a query**, so today none of these can be asked at all — and a date of birth printed on a
pleading, a discovery response or a court form costs a permission-gated audited decrypt on every
render, which is expensive and is not meaningfully a control over a member who is already reading the
file.

There is also a fact with no home whatsoever. The schema carries `decedent_entity_id` pointing at
`directory_person` for an estate, and there is nowhere in the system to record when that person died.

NIEM — the model built for criminal-justice and court information exchange, the closest institutional
neighbour this platform has — draws the line in exactly this place: `PersonBirthDate`,
`PersonDeathDate`, `PersonBirthLocation` and `PersonCitizenshipISO3166Alpha2Code` are properties of
the person, while `PersonSSNIdentification` and `PersonPassportIdentification` are identification.

**Decision:** `directory_person` gains `date_of_birth`, `date_of_death`, `deceased`, and
`birth_place`, all nullable. `deceased` is separate from the date with a CHECK that a non-null date
implies the flag, because "known dead, date unknown" is a state probate work meets constantly and a
nullable date alone cannot express it. Every new column is registered in the erasure registry in the
same change. The `dob` identifier scheme is **never dropped** — it stays readable forever so a firm's
existing records do not become unreadable — and is closed to new writes.

**The plaintext question is put to the owner rather than settled here.** Three options, and the trade
is real in both directions. Full plaintext buys every range query and ends the decrypt-on-render, on
the reasoning the pronoun columns beside it already stand on: ordinary personal data printed in
documents all day, whose confidentiality is the file's confidentiality. Against it: several state
breach statutes name date of birth as a notifiable element, and a plaintext column is a plaintext
column. **The recommendation, where full plaintext is uncomfortable, is the third option — retain the
sealed full date and add a plaintext `birth_year`.** It answers minority, majority and every age band
the statutes turn on, and a year alone is a far weaker re-identification vector than a full date. It
concedes least and serves most.

**Considered and rejected:** leaving it as an identifier (every range question stays unanswerable and
every document render stays an audited decrypt); an order-preserving or otherwise searchable
encryption over the sealed value (it leaks the ordering, which for a date of birth over a firm's
client base is most of the value, and it would be a new cryptographic primitive in the one place the
platform has deliberately kept simple); a generic entity-attribute table (a join on every person read
for four singular facts).

**Consequences:** conflicts stops decrypt-and-comparing dates and gains a cheap corroborating signal
that is additive and never on its own a hit. An estate matter can record its decedent's date of death.
Merge fields render an age without an audit row. The cost, on the recommended option, is that a birth
year sits unencrypted in a per-firm database, which is stated here so the decision is made rather than
discovered.
