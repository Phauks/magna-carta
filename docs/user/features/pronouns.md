# Pronouns on a Directory record

_The field and the document behaviour are built. The Directory screens are authored when they ship; today pronouns are recorded through the API._

## What it does

A person in your Directory — a client, an opposing party, a witness, one of your own attorneys — can
have **their pronouns** on file. Documents your firm assembles then refer to them correctly, without
whoever wrote the template having had to know which pronouns that person uses.

It is **optional**, and it stays empty unless somebody records it. An empty field is an ordinary
state, not a gap the record is waiting on.

**Nothing is ever guessed.** The software will not work a person's pronouns out from their first name,
from "Mr." or "Ms." on an old intake form, or from anything else. Either your firm was told, and
recorded it, or the field is empty. A document that misgenders someone because software made a
confident guess is not a formatting problem — it goes out under your firm's name, to that person and
to a court.

## Recording a person's pronouns

You record the pronouns **whole** — the five ways a pronoun appears in a sentence, plus one question
about verbs:

| What to enter                                   | For she/her   | For they/them | For xe/xem    |
| ----------------------------------------------- | ------------- | ------------- | ------------- |
| Subject (as in "… signed")                      | she           | they          | xe            |
| Object (as in "we served …")                    | her           | them          | xem           |
| Possessive (as in "… signature")                | her           | their         | xyr           |
| Possessive pronoun (as in "the signature is …") | hers          | theirs        | xyrs          |
| Reflexive (as in "represented …")               | herself       | themselves    | xemself       |
| Goes with "is" or "are"                         | is (singular) | are (plural)  | is (singular) |

It is all six or none. You cannot record half a set, and that is deliberate: a record holding only
"she" is what produces a letter saying "she signed their declaration", and nobody catches that by
proofreading. Removing the pronouns on file clears all six at once.

**Any set works.** This is not a list of options to choose from. If someone uses a set the table above
does not show, type it — the software has no opinion about which pronouns exist, and no set is
missing from it.

**The "is or are" question matters.** "She is the petitioner" but "they are the petitioner"; "she
signs" but "they sign". The software cannot work that out from the words — "they" takes "are" and "xe"
takes "is" — so the person's record says which, and documents follow it.

## What documents do with it

Your template author writes about "the client" once, and the document comes out right for whoever the
client is on that matter. The detail is in the
[Document templates guide](document-templates-and-assembly.md) — the short version:

- A person with pronouns on file is written with them.
- **A person with nothing on file is written they/them.** Not a blank, not a marker, not a guess.
- An organisation is written they/them too, since a company states no pronouns.
- Where a matter links more than one person in a role, the same neutral wording is used — no single
  person is being described, so nobody is described wrongly.

A document can also **print** someone's pronouns, as "she/her", for a cover sheet or a signature
block. That one shows nothing at all when the record states none.

## Tips and edge cases

- **Ask, do not assume.** The field exists so that what a person told your firm is what the document
  says. If nobody has asked, leave it empty — the neutral wording is correct and safe.
- **This is not a gender field**, and the software has none. Pronouns are how a person is referred to;
  they are a separate fact from anything else about them, and neither is worked out from the other.
  Where an instrument needs a gendered word a pronoun does not supply — "widow" against "widower" on a
  decree, say — that word is a designation you record on the matter and the document prints as
  recorded.
- **Your own attorneys and staff** get their pronouns from their Directory record, the same place
  their name parts come from. A member's signature block or a pleading that refers back to counsel
  uses them.
- **Changing pronouns** replaces the whole set. There is nothing to reconcile and no partial state to
  land in.
- **Documents already produced do not change.** A finished document is a file; recording pronouns
  today affects the next document assembled, not last month's letter.
- **Merging two Directory records** keeps the surviving record's pronouns. Check the survivor after a
  merge if both records had a set on file.

## Privacy

Pronouns are personal data about that person. They are erased along with the rest of their record when
a person exercises a right to erasure, and they never appear in a diagnostic log. Anyone who can see
the person's Directory entry can see them, and recording or changing them requires the same permission
as any other Directory edit.

## Related

- [Document templates and assembly](document-templates-and-assembly.md) — writing a template that uses
  someone's pronouns, and the verb-agreement rule.
