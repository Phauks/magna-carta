---
category: Added
---

**The merge-field catalogue is designed for the size a real document set needs.** Two specs land: how
the catalogue grows from the twenty-nine fields shipped with document automation to the several
hundred a firm's letters, pleadings, and probate filings actually name, and the phased plan that
builds it. The design is a scaling-up of the shipped engine rather than a rework — one batched read
per source, absence as a declared decision, ambiguity answered rather than guessed, and everything
checked when a template is registered all stay exactly as they are.

The catalogue stops being a written-out list and becomes a **cross product**: a small registry of
subjects a document talks about (the matter, the client, the opposing party, opposing counsel,
co-counsel, a guardian ad litem, a trustee, the responsible attorney, the court, the estate, this
office) crossed with a small registry of facts about each (its name, its address, its email address,
its capacity, its title). About forty declared rows produce about two hundred and sixty fields, and
adding a role — or adding a fact that every role should carry — is one row either way.

**Ways of formatting stay formats, not more fields.** A different fact gets its own field; the same
fact written differently gets a suffix, so a name is one field that can be written "Rowan Ashcroft",
"Ashcroft, Rowan", "Dr. Rowan T. Ashcroft Jr.", "R.T.A.", or in capitals for a caption — and an
address is one field that can be a letterhead block or a single line. Dates keep the styles they
have and gain a few; money gains the words-and-figures form a settlement statement and a promissory
note use. A rendering the record cannot support — a surname-first form for a company, a courtesy
title nobody recorded — produces the usual visible marker and a sentence saying why, never a
plausible-looking wrong name.

**Attorneys on both sides get an answer.** Our side becomes matter staffing — the responsible,
originating, supervising, and billing attorney and the assigned paralegal, each with a name, title,
signature block, and direct dial; the other side is the party mechanism that already exists, widened.
Two attorneys in one role still resolves to nothing with the count named, and "list them all" is
still the repeating block. **The estate becomes a first-class identity on a matter** — the decedent,
the style a court fixed, the short style a letter's second reference uses — and a capacity phrase
like "as Administrator of the Estate of Rowan Ashcroft, Deceased" is composed once, as one field with
one marker when something is missing, rather than three placeholders that leave stray punctuation
behind.

Everything a template already binds keeps working: a shipped field is permanent, its default
rendering is frozen, a withdrawn field is deprecated rather than deleted, and the number of database
reads an assembly costs goes from six to twelve while the number of fields it can name goes up
roughly ninefold.
