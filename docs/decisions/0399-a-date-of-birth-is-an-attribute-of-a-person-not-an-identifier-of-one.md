---
number: 399
slug: a-date-of-birth-is-an-attribute-of-a-person-not-an-identifier-of-one
status: Accepted
date: 2026-08-30
area: Directory
summary: "Date of birth is stored today as an encrypted directory_identifier row, and the codebase already flags the mismatch: IdentifierNotIndexableError exists because a date of birth is too low-entropy to blind-index, so conflicts resolves it by decrypt-and-compare. It is the one entry in that catalog nobody issued, that identifies nobody uniquely, and that the firm needs to compare with less-than and greater-than rather than equals — is this client a minor, has a limitation period tolled, is this person over sixty-five. A range query over ciphertext is not a query. Date of birth, date of death, a separate deceased flag for the real state of known-dead-date-unknown, and place of birth become first-class nullable columns on directory_person, following NIEM, which puts birth, death and citizenship on the person and SSN and passport in identification. The owner settled the contested part directly: a date of birth needs a year and needs to be a date, so the full date is stored in the clear as an ordinary attribute, not a plaintext birth year beside a retained sealed date. The dob scheme is never dropped, only closed to new writes."
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
`PersonDeathDate` and `PersonBirthLocation` are properties of the person, while
`PersonSSNIdentification` and `PersonPassportIdentification` are identification. NIEM also puts
citizenship on the person; **the owner dropped citizenship from this model outright**, and it is not
built, not seamed for, and not deferred pending anything. A firm that needs it has
`packages/custom-fields`.

**Decision:** `directory_person` gains `date_of_birth`, `date_of_death` and `deceased`, all nullable.
`birth_place` is **deferred** rather than built: no engine consumes it, the owner's direction named the
two dates, and a column nothing reads is a column that gets filled in inconsistently before anything
depends on it. `deceased` is separate from the date because "known dead, date unknown"
is a state probate work meets constantly and a nullable date alone cannot express it. The implication
that a recorded date of death means deceased is held in the **write path** rather than in a CHECK: a
cross-column CHECK cannot be added to a table that already holds rows without rebuilding it, and this
schema is expand-contract only. Clearing the flag while a date of death stands is refused rather than
silently corrected — the caller has asked for two things that cannot both be true, and guessing which
one they meant is worse than saying so. Every new column is registered in the erasure registry in the
same change. The `dob` identifier scheme is **never dropped** — it stays readable forever so a firm's
existing records do not become unreadable — and is closed to new writes.

**The plaintext question is settled: the full date, in the clear.** The owner's ruling was direct —
"obviously date of birth needs a year, but wtf is wrong with our code that we cannot handle a date of
birth" — and it is the right reading of the defect. The date is stored as a plain ISO calendar date on
`directory_person`, and the earlier recommendation of a plaintext birth year beside a retained sealed
date is **withdrawn**: a birth year answers "is this client a minor" and cannot fill in the date of
birth field on a court form, so it would have left the original complaint standing while adding a
second place for the same fact to live.

The reasoning the decision stands on is the one the pronoun columns beside it already stand on. A date
of birth is printed in pleadings, discovery responses and court forms all day. A permission gate and
an audit row on every document render buys no confidentiality against a member who already has the
file open, and it costs enough that the practical result is a firm that stops recording the date at
all — which is where this started. What the classification does buy is registration in
`packages/data-access/src/pii-registry.ts`, so subject erasure reaches it, and coverage by the
standing redaction default, so no log line ever carries it.

**Stated so it is decided rather than discovered:** several state breach statutes name a date of birth
as a notifiable element, and this column is a plaintext column in a per-firm database. The trade was
made knowingly.

**A calendar date and nothing else.** No time and no zone: a date of birth has no instant, and storing
one would make two records of the same birthday compare unequal across a zone boundary. The write path
refuses a date that names no day — `2026-02-30` matches the shape and is not a date — and refuses a
date of death that precedes the date of birth.

**Considered and rejected:** leaving it as an identifier (every range question stays unanswerable and
every document render stays an audited decrypt); an order-preserving or otherwise searchable
encryption over the sealed value (it leaks the ordering, which for a date of birth over a firm's
client base is most of the value, and it would be a new cryptographic primitive in the one place the
platform has deliberately kept simple); a generic entity-attribute table (a join on every person read
for four singular facts).

**Consequences:** a firm can record a client's date of birth and then ask something of it — who is a
minor, whose birthday falls this month, which files a limitation period has run on. An estate matter
can record its decedent's date of death against the `decedent_entity_id` that has been pointing at
nowhere. Merge fields render an age without an audit row, and conflicts can stop decrypt-and-comparing
dates and take a date agreement as a cheap corroborating signal that is additive and never on its own
a hit. The cost is that a full date of birth sits unencrypted in a per-firm database.
