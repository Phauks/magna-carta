---
slug: a-fax-is-a-technology-and-work-is-a-context-so-they-are-two-columns
status: Proposed
area: Directory
date: 2026-08-30
summary: "directory_phone is a free-text label and a free-text number, so a program cannot tell a fax line from a mobile and cannot dial either. It gains a contact_system saying what technology answers the number — voice, fax, sms, pager — and a contact_use saying in what context — work, home, mobile, other, old, temp — because the two are orthogonal and vCard's single TYPE axis, where cell and fax and work share one list, is the free-text label problem with better spelling. Fax is a system rather than a label for three concrete reasons: a document-delivery path must not answer from a column where fax and facsimile and office-slash-fax mean the same thing to a person and nothing to a program, service by facsimile is a distinct permitted method whose consent is a recorded fact, and a voice line must never be fax-dialled. A number answering both voice and fax is two rows, not a combined enum value, because they are separately verifiable facts with separately recorded verification dates. The number as entered is never lost; a canonical E.164 column sits beside it and goes null when the input does not parse, and the extension is its own column because E.164 has no extension concept and one embedded in the canonical string breaks dialling."
---

**Fax is a technology and work is a context, so they are two columns — and the extension is a third.**

**Context:** `directory_phone` is `label` (nullable, entirely unconstrained) and `number` (non-empty
text). No country code, no national number, no extension, no canonical form to index or hand to a
telephony or fax integration, and no way for a program to know that a row is a fax line. The table has
no domain module and no route, so nothing has ever written to it — which means the correction costs
nothing in migrated data and should be made before it does.

vCard puts fax in `TEL`'s `TYPE` parameter alongside `cell`, `pager`, `work` and `home`, so
`TYPE=cell,fax` is uninterpretable. FHIR splits the two: `system` is _what communications system is
required to make use of the contact_ (`phone | fax | email | pager | url | sms | other`) and `use` is
the context. FHIR is right, and the reason is visible in the existing column: `label` is vCard's flat
axis with no spelling discipline at all.

**Decision:** `directory_phone` gains `contact_system` (voice, fax, sms, pager), `contact_use` (work,
home, mobile, other, old, temp), `number_e164`, `extension`, and `country_code_iso`. `number` keeps
its meaning as **the number as entered** and is never overwritten: a number the parser rejects is
still stored and still displayed, and only the canonical column goes null, so an unparseable input is
recorded honestly rather than guessed at or refused. `extension` is separate because E.164 has no
extension concept and an extension inside the canonical string breaks every downstream dialler.
`country_code_iso` records the region the number was parsed against, so a re-parse is reproducible.
`label` is retained, read-only from the day the typed columns exist, and dropped only after a
verification window in which a probe reports no label carrying meaning the typed columns cannot.

**Fax is a system, and the three reasons are concrete.** A document-delivery path asking "may I fax
this to opposing counsel" must not answer from a column where `fax`, `Fax`, `facsimile` and
`office/fax` mean the same thing to a person and nothing to a program. Service by facsimile is a
distinct permitted method under several courts' rules, and consent to it is a fact the firm records.
And a voice line must never be fax-dialled, nor a fax line voice-dialled.

**A number that answers both voice and fax is two rows.** They are separately verifiable facts with
separately recorded provenance — a switchboard answering voice today may have had its fax
decommissioned last year — and a combined enumeration value cannot carry two verification dates. The
temporal and primary machinery already handles multiple rows per entity.

**The storage is orthogonal; the screen is one control.** A single picker offering Mobile, Office,
Home, Direct Dial and Fax writes both columns behind it. Nobody entering a telephone number sees two
dropdowns.

**Considered and rejected:** a combined `voice_and_fax` enumeration value (one row cannot carry two
verification dates, and every consumer would have to remember to match it in two places); keeping
`label` and disciplining it by convention (a convention with no constraint is what the column already
is); vCard's single `TYPE` axis; storing only the canonical form and discarding what was entered (a
number the parser rejects would be unrecordable, and the parser is wrong often enough at the edges
that this is a real loss); embedding the extension in the E.164 string.

**Consequences:** a telephony or fax integration has an unambiguous, indexed, dialable value. The
`contact_use` column later lets contact-agreement evidence distinguish a shared switchboard from a
shared personal mobile, which is the difference between noise and a signal. The cost is five columns
where there were two, and a small parse step on every write.
