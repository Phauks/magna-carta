---
number: 271
slug: directory-pronouns
status: Accepted
date: 2026-08-11
area: Directory
summary: "Pronouns become an optional, owner-entered field on a Directory person, and document assembly gains the pronoun() and pronounVerb() helpers that render them — reversing the shipped no-pronoun-helper default on the owner's direction. Five decisions carry the weight. PRONOUNS ARE NOT GENDER and no gender field ships: a pronoun set is what a person states and what prose needs, while the gendered legal terms a decree occasionally requires (widow against widower, husband against wife) are already served by the platform's stored-designation pattern — matter_estate's styles, matter_court_case's designations, and matter_party.capacity are all recorded text printed as recorded, never composed — so a gender attribute would add a second, guessable source for facts the firm already records verbatim; the question is FLAGGED for the owner rather than settled unilaterally. THE WHOLE DECLENSION IS STORED — subject, object, possessive determiner, possessive pronoun, reflexive, plus a verb-agreement number — rather than a label resolved through a lookup table, because a label determines only two of the five forms and any label-to-forms table is a closed enum in disguise whose gaps fall on exactly the people most often rendered wrong; six columns render any set, including a neopronoun set invented after this ships, with no code change. A PARTIAL SET IS UNREPRESENTABLE: a table CHECK admits all six columns or none, the write path exposes no per-form update, and the read projection treats anything short of a whole set as no set, because a document mixing one set's subject with another's object is invisible on the page and is the single failure the field exists to prevent. THE UNRECORDED CASE ANSWERS THEY/THEM: pronoun() is the only helper in the expression language that never goes unresolved, because the unstated case is the common case and a marker mid-clause would turn every ordinary letter into a document needing repair — the same neutral answer covers an organisation party and a role the matter does not resolve to one person, since all three mean the same thing and they/them is wrong about nobody. Verb agreement is NOT inflected: pronounVerb(person, singularForm, pluralForm) picks between two forms the author wrote, using the agreement number the set declares, which is total for every English verb including the irregular ones and keeps the choice visible in the template. Nothing anywhere derives a pronoun from a name, a courtesy title, or any other column."
---

**Pronouns are recorded, never inferred; stored as the whole declension, never as a label; and the
unstated case renders they/them rather than a marker, a blank, or a guess.**

**Context:** The shipped posture was that no pronoun helper would exist — the template expression
design recommended it and the realization decision applied it, on the reasoning that `choose` lets an
author express the substitution visibly and that a helper "requires recording a gender attribute on a
party", which is the part the platform did not want. The owner overrode that: the Directory gains
optional owner-entered pronouns feeding a template helper.

The override is worth reading precisely, because it dissolves the objection rather than accepting its
cost. The old reasoning conflated two different facts. A GENDER ATTRIBUTE is an inference source — a
field the platform would hold in order to work something else out. A PRONOUN SET is a statement a
person made about how they are referred to. Recording the second requires none of the first, and once
the second is recorded there is nothing left to guess.

**Decision:**

(1) **Pronouns are not gender, and no gender field ships.** The six columns on `directory_person` hold
five grammatical forms and one verb-agreement flag. There is no gender column, no derivation from one,
and no derivation toward one. The case for a separate gender field is real but narrow: some
instruments use gendered nouns a pronoun set does not supply — "widow" against "widower", "husband"
against "wife", "son" against "daughter". The platform already answers those honestly and by an
established pattern: a legal designation a court has fixed is STORED and printed as recorded
(`matter_estate.estate_style`, `matter_court_case.client_designation`), and the capacity a person acts
in on a matter is recorded free text on the party link, never composed. A gendered noun in a decree is
exactly that shape of fact. Adding a gender attribute would create a second source for it, one the
platform would be tempted to derive from — and a derived "widower" on a filed decree is the same class
of defect as a derived pronoun. **Flagged for the owner** rather than closed: if a firm meets an
instrument these patterns cannot serve, the answer is a separately optional recorded field with its
own reason to exist, never a proxy that pronouns are computed from or that is computed from pronouns.

(2) **The whole declension is stored, not a label plus a resolved set.** The alternative was a stored
label ("she/her") resolved into forms through a table. Rejected: a two-form label settles nothing
about the possessive, the possessive pronoun, or the reflexive for any set the table lacks, and the
table is therefore a closed enum wearing a different hat. Its gaps are not evenly distributed — they
fall on neopronoun users and on anyone whose set the platform's authors did not think of, which is to
say on the people most used to being rendered wrong. Six columns let a template render every
grammatical position for any set at all, with no code change and no release. The verb-agreement number
is stored for the same reason it cannot be a label: nothing about the letters of a pronoun says
whether it agrees like "she is" or like "they are" — "they" agrees plurally and "xe" singularly. The
conventional "she/her" label a screen shows is DERIVED from the subject and object forms, so the
printed label and the printed pronouns cannot disagree.

The cost is a firm typing five forms instead of picking one option. That is a user-interface problem
with a user-interface answer — presets that fill the five fields — and deliberately not a storage
shape, because a preset list that becomes the storage shape is the closed enum again.

(3) **A partial set is unrepresentable.** A table CHECK admits all six columns or none of them; the
write path exposes one statement that writes all six together and none that writes one; and the read
projection returns no set at all where any form is missing. Three layers for one invariant, because
the failure it prevents — "she" in one clause and "them" in the next of a document that gets served —
is invisible to a proofreader and lands on a real person.

(4) **The unrecorded case renders they/them.** `pronoun(person, form)` is the only helper in the
expression language that never goes unresolved. Everywhere else in document assembly the bias is a
visible marker, because a silent blank where a name belongs is the worst thing the subsystem can
produce; pronouns invert the calculus, since the sentence is grammatical either way and
"[CLIENT PRONOUNS]" mid-clause would turn every ordinary letter into a document needing repair — and
would teach a firm that markers are noise, which is the marker rule defeated from the other side. The
same neutral set answers three different silences: the person stated nothing, the subject is an
organisation, and the matter resolves no single person in the role. They all mean "we do not know
whose pronouns to use", and they/them names nobody. The `<subject>.pronouns` MERGE FIELD, by contrast,
is blank when unrecorded — it states a fact, so it must not invent one; the asymmetry between the
field and the helper is deliberate.

The reflexive default is "themselves" rather than "themself", for consistency with the plural
agreement the neutral set declares: a document that writes "they are" and then "themself" disagrees
with itself. A person who prefers "themself" records it.

(5) **Verb agreement is a choice between two authored forms, never an inflection.** Singular "they"
takes plural verb forms, and no rule short of a dictionary turns "signs" into "sign", "is" into "are",
and leaves "shall" alone. `pronounVerb(person, singularForm, pluralForm)` takes both forms from the
author — the one that follows "he" or "she" first, the one that follows "they" second — and picks by
the agreement the set declares. Total for every English verb, correct for the irregular ones, and the
choice stays visible in the template rather than hidden in a grammar engine that would eventually be
wrong about a word nobody tested. A person who stated nothing takes the plural form, matching the
neutral set.

**Classification.** The pronoun columns are ordinary personal data on `directory_person`, which the
PII registry already classifies `anonymize`; the entry's note now names them in the scrub set. They
are deliberately NOT `protected()`. Encrypting them would route every pronoun through the decrypt
chokepoint — a permission gate and an audit row per ordinary letter — and a field too expensive to
read is a field a firm works around by guessing, which is the harm the field exists to prevent. The
standing redaction default covers the logging side: a pronoun set is never a log field.

**Considered & rejected:** *A closed enum of she/her, he/him, they/them* — the shape most products
ship, and wrong for the same reason a two-form label is: it renders a set it lacks as blank or as
another set. *Deriving pronouns from a courtesy title* — a prefix is how someone is addressed, which
is a different statement, and "Mrs." on an old intake form is not consent to a pronoun in a filed
decree. *A `gender` column with pronouns derived from it* — the exact conflation the override
dissolves; it makes the platform hold a fact it does not need in order to guess one it could simply be
told. *Five separate helpers (`pronounSubject(person)` and siblings)* — one fewer parameter
specification, rejected because five catalog rows for one idea makes the field inspector list five
near-identical entries and adds four more names a template author must remember. *Exposing the five
forms as merge fields per subject* — eighty-four new permanent keys, a flooded picker, and each one
individually absent-able, which reintroduces the mixed-set rendering from the template side. *A
neutral default of he/she or of the person's title* — a guess with better manners. *Refusing to
assemble when pronouns are unrecorded* — makes an optional courtesy a required field, and would block
the ordinary letter this platform exists to produce.

**Consequences:** `pronoun()` and `pronounVerb()` join the frozen helper catalog; the expression
grammar gains one confined production (a bare subject word, legal only in a declared `personSubject`
position) and no traversal. Ten new permanent merge keys, one per person-carrying subject. Pronouns
ride the party read and the staffing read that already join `directory_person`, so no assembly gains a
query. The `pronoun-first` UI — the presets, the free-form set entry, and the person-detail surface —
is deferred to the owner.
