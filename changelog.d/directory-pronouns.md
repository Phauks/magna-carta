---
category: Added
---

**A person in the Directory can have their pronouns on file, and documents use them.** A person entry
now carries the pronouns that person stated — she/her, he/him, they/them, or any set at all, including
one this software has never heard of. Nothing is ever worked out from a name or a title: a firm
records what it was told, or the field stays empty. It is optional everywhere, and leaving it empty is
an ordinary thing to do rather than a gap the record is nagging anyone to fill.

The set is recorded whole — the five ways a pronoun appears in a sentence ("she signed", "we served
her", "her signature", "the signature is hers", "she represented herself"), plus whether the set goes
with "is" or with "are". That is what lets a template write any of them correctly without the person
writing the template knowing which set is in play, and it is why the field is not a short list of
options to pick from: a list has to leave someone off, and the people it leaves off are the ones most
used to seeing their pronouns come out wrong.

**Two new things a template can write.** `pronoun(client, "subject")` puts that person's pronoun in
the position named — subject, object, possessive determiner, possessive pronoun, or reflexive.
`pronounVerb(client, "signs", "sign")` picks the verb form that agrees with them, because "they" takes
"sign" where "she" takes "signs" — the template supplies both forms and the person's own record
decides. There is no grammar engine guessing at verbs; the words on the page are words the author
wrote.

**A person with nothing on file is written they/them.** Not a blank, not a "[CLIENT PRONOUNS]" marker
in the middle of a sentence, and never a guess from their name. Most people never state a set, so this
is the ordinary case and it has to read correctly — and it does for an organisation, and for a matter
where the role covers more than one person, both of which get the same neutral wording for the same
reason: nobody is being described, so nobody is described wrongly.

Where a document wants to PRINT someone's pronouns rather than use them — a cover sheet, a signature
block — every party and staffing subject now has a `pronouns` field that shows them as "she/her". That
one is blank when the record states none, because a field that reports a fact should not invent one.

Pronouns are personal data: they are erased with the rest of a person's record and never appear in a
log. They are not a gender field, and the software holds no such field — the two are different facts
and neither is worked out from the other.
