# The merge-field catalog system — design

**Date:** 2026-08-05
**Status:** Design proposed; owner decisions in section 13 are open. No product code in this cycle.
**Scope:** How the merge-field dictionary grows from the 29 keys shipped in slice 2·6 to the several
hundred a firm's documents actually name — the catalogue's generative shape (subjects and facets),
the formatting system and its interaction with registration-time checking, which facts already exist
and which have to be recorded, the identity model for estates and courts, how a picker stays usable
at that size, and the lifecycle rules that keep stored templates working while the catalogue grows.
Excludes: the OOXML mechanics of substitution and block removal (the document-automation design owns
those), the expression language's grammar and evaluator (the template-expression-language design owns
those), the authoring interface's visual design, and rules-based docketing.
**White-paper home:** _Document Automation_, with _Directory_ (parties, names, identifiers, custom
fields), _Locations_ (office identity), _Core domain_ (matter types, matter shell), and
_Foundational data & runtime conventions_ (civil dates, zone context) as the surrounding context.
**Governing decisions:** ADR-0011 (document automation as a first-class capability), ADR-0003
(tenancy), ADR-0084 (`protected()` fields), ADR-0107 / ADR-0108 (the custom-fields engine and its
lifecycle), ADR-0210 / ADR-0211 (the engine and template model shipped in slice 2·6·1),
ADR-`template-expression-realization` (the expression ceiling), ADR-`document-automation-directory-role-sources`
(platform-declared role sources, ambiguity-as-declared-absence, the `.all` convention), ADR-0039
(compute placement), ADR-0083 (load-profile accretion).
**Decision inputs:** the shipped substrate this design is obliged to compose with —
`packages/document-assembly/src/dictionary.ts` (the declarative catalogue and its expression-scope
projection), `directory-role-bindings.ts` (role sources, normalized matching, ambiguity as an answer,
`<role>.all`), `custom-field-bindings.ts` (per-firm entries bound by handle), `format.ts` (the legal
formats per value type), `resolve.ts` (the one-read-per-source rule), `packages/merge-field-catalog-contract`
(the read contract the field-input interface is built against, and its fixture catalogue), the
design system's `merge-field-picker` / `merge-field-chip` / `merge-field-review-list`, and the
per-firm schema's Directory, Locations, Matters, custom-fields, and trust tables.

## Why now

The owner's ask, verbatim: _"for document automation, there are hundreds of potential items that can
be put into the documents, along with various ways to format them. dates, multiple attorneys and
types of attorneys on both sides, names of the estate, and so much more."_

That is a scaling problem, not a re-architecture. The engine shipped in slice 2·6 already has the
right bones: a declarative catalogue rather than a resolver per field, one batched read per source
rather than one per key, absence as a declared decision rather than an accident, registration-time
checking rather than assembly-time surprise, and per-firm derivation for the firm's own fields. Every
one of those properties gets **more** valuable at three hundred keys, not less.

What does not survive the scale-up is the way the catalogue is written down. Three things break:

1. **Hand-written rows.** Twenty-nine rows written out one at a time is a table. Three hundred is a
   copy-and-paste field where one row in ten quietly gets a different absence behaviour than its
   siblings — the exact failure `DIRECTORY_ROLE_DICTIONARY_ENTRIES` was generated to avoid, at ten
   times the surface. Writing a party's address facet out once per party slot means writing it
   fourteen times.
2. **Presentation lives in a fixture, not in the dictionary.** The dictionary entry carries `key`,
   `source`, `valueType`, `defaultFormat`, `sensitivity`, `absence`, and a one-line `description`.
   The catalog contract the picker consumes needs `label`, `group`, `exampleRendering`,
   `availability`, and `availabilityNote` — none of which the dictionary has, all of which
   `packages/merge-field-catalog-contract/src/fixture-catalog.ts` invents independently. At
   twenty-nine keys that is a stand-in. At three hundred it is a second catalogue with its own way of
   being wrong, and it already carries keys the engine does not have (`matter.practiceArea`,
   `matter.courtCaseNumber`, `matter.responsibleAttorney`).
3. **One flat grouping axis.** `MergeFieldGroup` is six values — matter, parties, firm, location,
   system, custom. A "Parties" heading with a hundred and thirty rows under it is a list nobody
   scrolls.

The fixture catalogue is worth reading as evidence rather than as a defect: the interface stream,
working from what a probate firm's documents look like, invented a practice area, a court case
number, a responsible attorney, a client mailing address, a client tax identifier, and a decedent
date of death. Every one of those is in the owner's ask, and not one of them exists as a fact the
platform records. **The gap between the two catalogues is the specification for this design.**

## 1. What is preserved, stated as constraints

These are properties of the shipped engine that the scale-up may not weaken. They are listed first so
that every later section can be read as "does this hold".

- **A merge field never issues a query.** Cost tracks the number of _sources_ a manifest touches,
  never the number of fields. Section 5 states the source budget explicitly and gives its number.
- **A key is one lexical atom, resolved by exact match through a `Map`.** No traversal, no computed
  key, no property lookup. The expression language's whole security posture rests on this, so a
  generated catalogue must generate _flat keys_, not a tree to walk.
- **Absence is a declared decision, biased toward a visible marker**, with a reason where resolution
  knows one.
- **Ambiguity is an answer, not a coin toss.** Section 3.3 generalizes the rule to every level of a
  key's path rather than restating it per level.
- **Binding is by stable identity, never by a firm's typed text.** Handles for custom fields;
  platform-declared tokens for roles.
- **Everything is checked at registration**, where an author is still looking at the template.
- **Resolved values never leave memory**, and the provenance row records keys, never values.

## 2. The catalogue's shape

### 2.1 The key stays flat; the declaration becomes a product

**A merge key remains exactly what it is today — a flat, dotted, exactly-matched token.**
`{{opposingCounsel.displayName}}` is what a paralegal types, and nothing about scale changes that.
What changes is how the list of keys is _written down_: instead of one hand-authored row per key, the
catalogue is **materialized from two small registries crossed with each other**, exactly as the four
Directory role sources already materialize twelve entries from four rows and one facet list.

```
SUBJECTS  ×  FACETS(subject.kind)  ->  the flat DICTIONARY
```

A **subject** is a thing a document can talk about: the matter, the client, the opposing counsel, the
responsible attorney, the court, the estate, this office, the firm. A **facet** is one fact about a
subject of that kind: its name, its address, its email address, its capacity, its number, its date.
The dictionary is the cross product, minus the combinations a subject kind does not admit, plus the
subjects that are one-of-a-kind enough to be written out (the matter's own columns, the system
values).

The load-bearing consequences:

- **Adding a party role is one row**, and its full facet set follows — which is already true of
  `DIRECTORY_ROLE_SOURCES` for three facets and becomes true for nine.
- **Adding a facet is one row**, and every subject of that kind gains it with identical absence
  behaviour, identical formats, identical description wording, and identical grouping. A facet whose
  absence behaviour differs between two slots is then a deliberate override in one table rather than
  a divergence nobody notices.
- **The mistake mode inverts.** A hand-written catalogue produces local errors that are invisible; a
  generated one produces systematic errors that every test sees at once. Section 11 puts a committed
  golden key list behind that.

Nothing downstream changes: `dictionaryIndex`, `lookupDictionaryEntry`, `expressionScopeFor`,
`dictionaryForFirm`, and the resolver's `sourcesFor` all consume `readonly DictionaryEntry[]` and are
indifferent to how the array was built.

### 2.2 The subject registry

Subjects are grouped by **kind**, because kind is what decides which facets apply and which read
answers them.

| Subject kind  | Subjects (platform-declared)                                                                                                                                                                                | Resolved from                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `matter`      | `matter`                                                                                                                                                                                                    | the matter row                             |
| `party`       | `client`, `opposingParty`, `opposingCounsel`, `coCounsel`, `localCounsel`, `guardian`, `guardianAdLitem`, `conservator`, `trustee`, `personalRepresentative`, `beneficiary`, `witness`, `expert`, `insurer` | the matter's party links                   |
| `member`      | `responsibleAttorney`, `originatingAttorney`, `supervisingAttorney`, `billingAttorney`, `assignedParalegal`                                                                                                 | the matter's staffing assignments          |
| `office`      | `location`                                                                                                                                                                                                  | the matter's home location                 |
| `firm`        | `firm`                                                                                                                                                                                                      | the firm record and firm settings          |
| `court`       | `court`, `case`                                                                                                                                                                                             | the matter's court-case record             |
| `estate`      | `estate`                                                                                                                                                                                                    | the matter's estate record                 |
| `financial`   | `trust`, `billing`                                                                                                                                                                                          | the trust sub-ledger; the billing surfaces |
| `system`      | `system`                                                                                                                                                                                                    | the assembly itself                        |
| `firmDefined` | `custom`                                                                                                                                                                                                    | the firm's own custom-field catalogue      |

Two rules keep this list from becoming a free-for-all:

**Subjects are platform-declared, never firm-derived**, for the reason the role-sources decision
already recorded: a firm's own vocabulary is free text that neither lexes as one atom nor gets typed
from memory. A firm's own facts enter through `custom.<handle>` and through the alias map in section
3.4, never by minting a subject.

**The top-level namespace is a reserved registry with a fitness test.** `client`, `matter`, `court`,
`estate` and every other subject key are reserved; nothing may collide with them, no two subjects may
normalize alike (the existing rule for role tokens, widened), and the `custom.` prefix stays the one
namespace a firm's own identity lives under. Keeping slots at the top level rather than nesting them
under `party.` is deliberate: `{{opposingCounsel.displayName}}` is already shipped, is shorter, and
is what someone types; grouping is the picker's job (section 7), not the key's.

### 2.3 The facet vocabulary

| Facet             | Applies to                   | Value type | Notes                                                                                                |
| ----------------- | ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `displayName`     | party, member                | `text`     | Shipped. Gains the name format set (section 4.2) rather than a sibling key.                          |
| `kind`            | party                        | `text`     | Shipped. Person or organisation — what lets a sentence read differently for a company.               |
| `salutation`      | party, member                | `text`     | "Mr. Ashcroft". Composed from the recorded prefix and family name; never guessed (section 4.6).      |
| `address`         | party, member, office, court | `address`  | Structured. Formats: block, inline, street, cityRegionPostal.                                        |
| `emailAddress`    | party, member                | `text`     | The primary one, by the rule in section 3.3.                                                         |
| `phone`           | party, member                | `text`     | Likewise.                                                                                            |
| `capacity`        | party                        | `text`     | The capacity recorded on the link — "Administrator", "Trustee", "Attorney-in-fact".                  |
| `capacityLine`    | party                        | `text`     | The composed phrase (section 6). Resolver-composed, never template-concatenated.                     |
| `title`           | member                       | `text`     | "Partner", "Associate", "Senior Paralegal".                                                          |
| `barNumber`       | member, party                | `text`     | `protected` — a typed Directory identifier, read through the decrypt path (section 5.4).             |
| `signatureBlock`  | member                       | `text`     | The multi-line block a pleading signs off with.                                                      |
| `directDial`      | member                       | `text`     |                                                                                                      |
| `custom.<handle>` | party, member                | per kind   | The firm's own **entity-axis** fields, on that subject (section 5.3).                                |
| `all`             | party, member                | `list`     | Shipped convention. The collection a repeating block walks; its items carry the scalar facets above. |

Subjects of kind `matter`, `court`, `estate`, `firm`, `financial`, and `system` carry named facets
rather than a generated set, because each is a one-of-a-kind subject whose facts are its own columns.
Those are written out, and writing them out is correct: there is exactly one of each.

### 2.4 What a dictionary entry carries after the widening

The shipped entry keeps every property it has and gains the ones the catalog contract needs, so that
**the dictionary is the one home and the contract is its projection** rather than its twin.

| Property                                                                                             | Status  | Meaning                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `key`, `source`, `valueType`, `defaultFormat`, `sensitivity`, `absence`, `description`, `itemFields` | shipped | unchanged                                                                                                      |
| `label`                                                                                              | new     | What a person calls it — "Opposing counsel's name". The picker row's subject; the key is search vocabulary.    |
| `group`                                                                                              | new     | The picker's top-level heading, from a declared group registry (section 7.1).                                  |
| `subject`                                                                                            | new     | The subject key, so a picker can nest a hundred and thirty party fields under thirteen subheadings.            |
| `prominence`                                                                                         | new     | `primary` or `secondary`. Ordering and default visibility, never a filter on what exists.                      |
| `synonyms`                                                                                           | new     | Search vocabulary a firm would type — "defendant", "PR", "SSN". Declared per facet and per subject.            |
| `exampleRendering`                                                                                   | new     | Invented sample text, per format. Never firm data, so the catalogue stays cacheable before a matter is chosen. |
| `status` / `supersededBy`                                                                            | new     | `current` or `deprecated`, and what replaced it (section 8).                                                   |
| `tags`                                                                                               | new     | Practice-shape hints — `litigation`, `probate`, `transactional`, `billing` — used only for ordering.           |

`availability` and `availabilityNote` — the contract's "is this filled automatically or does someone
type it" axis — are **derived, not declared**: a key is `automatic` when its source resolves from firm
data, `conditional` when its subject is optional on a matter (a court case, an estate), `manual` when
no source can answer it, and `unavailable` when the firm has not recorded the fact behind it at all.
Deriving it keeps one fact in one place; declaring it on three hundred rows would drift the first time
a source moved.

### 2.5 The arithmetic

Worth doing explicitly, because "hundreds" is the ask and a design should say whether it delivers
them.

| Family                                             | Count                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| `matter.*`                                         | ~22 (shipped 7, plus type, number parts, designation, key dates) |
| party subjects × scalar facets                     | 14 × 9 = 126                                                     |
| party subjects × `all` collections                 | 14                                                               |
| member subjects × scalar facets                    | 5 × 8 = 40                                                       |
| `location.*` / `firm.*`                            | ~18                                                              |
| `court.*` / `case.*`                               | ~14                                                              |
| `estate.*`                                         | ~10                                                              |
| `trust.*` / `billing.*`                            | ~12                                                              |
| `system.*`                                         | ~6                                                               |
| **Platform total**                                 | **≈ 262**                                                        |
| the firm's own matter-axis fields                  | per firm, tens                                                   |
| the firm's own entity-axis fields × party subjects | per firm, tens × 14                                              |

Two hundred and sixty-two platform keys from roughly **forty declared rows** — fourteen subjects, five
member subjects, nine facets, and the written-out one-of-a-kind subjects. That ratio is the whole
argument for the generative shape.

## 3. Attorneys, parties, sides, and types

### 3.1 Two families, one mechanism

"Multiple attorneys and types of attorneys on both sides" is two different sourcing problems wearing
one sentence.

**Our side is the `member` axis.** The Directory design already settled that firm personnel are not
Directory entities; staffing stays the member axis. So "the responsible attorney", "the originating
attorney", "the supervising partner", "the paralegal on the file" are **firm members assigned to a
matter** — and today the matter carries exactly one of them, `responsible_member_id`. Everything else
is unrecorded. Section 5.3 proposes the one small table that fixes it.

**Their side is the party axis**, which the shipped role-source mechanism already covers: opposing
counsel, co-counsel, local counsel, a guardian ad litem, an expert. Widening it is rows in
`DIRECTORY_ROLE_SOURCES`.

**The two families share one facet vocabulary and one resolution shape**, which is the reuse that
makes this cheap: a subject of kind `member` and a subject of kind `party` differ in which batched
read fills them and in a few facets each carries, and in nothing else. `{{opposingCounsel.address:block}}`
and `{{responsibleAttorney.address:block}}` are the same code path.

### 3.2 Side is not an axis

The tempting model is `side × role × type` — `plaintiff.counsel.name`, `defence.counsel.name`. It is
rejected for three reasons. It doubles every key for a fact most matters do not have. It forces every
practice area into a two-sided shape, which probate, transactional, and estate-planning work do not
have. And the side vocabulary is jurisdiction- and posture-specific — plaintiff/defendant,
petitioner/respondent, appellant/appellee, movant — so a fixed pair would be wrong more often than
right.

**Side is a caption fact, not a key axis.** A litigation matter records its own designation and the
other side's on the court-case record (section 5.3), so a caption reads
`{{case.clientDesignation}}` and `{{case.opposingDesignation}}` — the words this court uses, recorded
once, rather than baked into three hundred key names.

### 3.3 Ambiguity is an answer at every level

The shipped rule — one match resolves, zero is an absence, many is an absence carrying the count and
pointing at `.all` — was written for role slots. At scale the same question arises three more times,
and answering it differently at each level is how a system becomes unpredictable. **One rule, applied
at every level of a key's path:**

| Level                       | Question                                             | Rule                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — the subject**         | which party link or assignment fills this slot?      | Shipped. One resolves; none and many are both absences, and the reason says which and how many.                                                             |
| **2 — the facet**           | which of this subject's addresses / emails / phones? | The one marked primary. No primary and exactly one recorded: that one. No primary and several: an absence naming the count.                                 |
| **3 — the rendering**       | which format?                                        | Never ambiguous. The placeholder names one or takes the entry's default.                                                                                    |
| **4 — inside a collection** | the same questions, per item                         | Level 2 applies per item. An item that cannot answer a facet is an absence _within_ the item, which is already what the aggregates do with a missing field. |

The property this buys is that a person who has learned "if the firm's data cannot answer the
question as asked, you get a marker and a sentence saying why" has learned the whole system, once.

### 3.4 Firm role aliases — the one firm-typed input

Normalized matching solves spelling (`opposing_party`, `Opposing Party`, `opposing-party`). It does
not solve **vocabulary**: a firm that records its opposing parties as "Defendant" or "Respondent"
matches no platform slot and its templates silently find nothing.

The proposal is a small per-firm mapping — `document_merge_role_alias (firm role text, subject key)`
— administered next to the firm's `directory_party_role` catalogue, read **once per assembly as part
of the party read's planning**, never per role. It changes no key, no template, and no manifest: it
widens the token set a subject matches on. A firm with no aliases behaves exactly as today.

This is the only place a firm's own words enter platform key resolution, and it enters as a
**mapping the firm declares**, not as a guess. That distinction is the same one the merge-field name
resolver already draws: the engine never guesses what a firm's word means, and a mapping becomes real
when a person confirms it.

## 4. The formatting system

### 4.1 The rule that decides a key from a format

The owner's phrasing — "various ways to format them" — hides the design's sharpest question: when is
a different rendering a different _key_, and when is it a _format_ on one key?

**The rule: a facet is a different fact; a format is the same fact rendered differently.** The test
that settles it in practice: _could both renderings appear in the same sentence about the same
thing?_ "Ashcroft, Rowan" and "Rowan Ashcroft" cannot — they are one fact, two renderings, so
`lastFirst` is a format. A party's name and a party's capacity can — two facts, two keys.

Applying it: name orderings, initials, and salutation-vs-full are formats. Date styles are formats.
Money in words and money in figures are formats. Address block versus inline is a format. Case is a
format. **Which** address (mailing versus registered) is a facet, and is answered by level 2 of the
ambiguity rule rather than by two keys.

The consequence is worth stating as a number: the alternative — a key per rendering — would multiply
the 262 keys by roughly four, put twelve near-identical rows in front of an author choosing a client
name, and make the picker's job impossible. **Formats are the reason a catalogue of hundreds is not a
catalogue of thousands.**

### 4.2 Structured value types: `name` and `address`

A format can only render what the value carries, so two renderings that need parts require the value
to _have_ parts. Two structured value types are added to `MergeValueType`:

**`name`** — the structured person or organisation name the Directory already stores
(`name_prefix`, `name_given`, `name_middle`, `name_family`, `name_suffix`, `display_name`, and for
organisations `legal_name`). Formats:

| Format      | Renders                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `full`      | Rowan Ashcroft _(the default; identical to today's `displayName` output)_ |
| `formal`    | Dr. Rowan T. Ashcroft Jr.                                                 |
| `lastFirst` | Ashcroft, Rowan                                                           |
| `initials`  | R.T.A.                                                                    |
| `family`    | Ashcroft                                                                  |
| `given`     | Rowan                                                                     |
| `upper`     | ROWAN ASHCROFT _(the caption form)_                                       |

**`address`** — the structured postal address the Directory and Locations already store. Formats:

| Format             | Renders                                         |
| ------------------ | ----------------------------------------------- |
| `block`            | four lines, the letterhead form _(the default)_ |
| `inline`           | 14 Cavendish Row, Reno, NV 89501                |
| `street`           | 14 Cavendish Row                                |
| `cityRegionPostal` | Reno, NV 89501                                  |

**The shipped `displayName` key gains the name formats rather than acquiring a `name` sibling.** Its
default rendering is byte-identical to what it renders today, so no registered template changes
behaviour, and `{{client.displayName:lastFirst}}` becomes expressible without a second key for the
same fact. The alternative considered — a new `<slot>.name` key of type `name`, leaving `displayName`
a plain text key — was rejected because it puts two keys for one fact in front of every author
forever, which is exactly the confusion the facet-versus-format rule exists to prevent. The cost
accepted is a slightly odd-looking suffix on a key whose name says "display": the label a person
actually reads is "Client's name", and the key is search vocabulary.

An organisation resolves the name formats from its legal or display name: `full`, `formal`, and
`upper` render it, and `lastFirst`, `initials`, `family`, and `given` are **absences with a reason**
("this party is an organisation, which has no family name") rather than silently rendering the whole
string. Section 4.6 is why.

### 4.3 The rest of the format tables

Additions to the shipped tables, kept small and each earning its row:

- **date** — shipped `short`, `long`, `legal` ("the 5th day of August, 2026"), `iso`. Added:
  `legalBare` (the same without the leading article, for a sentence that supplies its own),
  `weekday` ("Wednesday, August 5, 2026"), `monthYear` ("August 2026"), `numeric` ("08/05/2026").
- **money** — shipped `currency`, `currencyWords`, `plain`. Added: `wordsAndFigures`
  ("One Thousand Two Hundred Dollars and 00/100 ($1,200.00)") — the form a settlement statement, a
  promissory note, and a closing statement all use, and the one a firm most often re-types by hand.
- **text** — shipped `plain`, `upper`, `titleCase`. Added: `lower`, `sentenceCase`.
- **boolean** — shipped `yesNo`, `plain`. Added: `checkbox` (a box character, for a form line).
- **number** — shipped `plain`. Added: `words` ("two"), `ordinal` ("2nd") — a count of exhibits and
  the "Article Fourth" of a will are both real.

### 4.4 No parameterized formats; chaining is the expression language's job

**A format is a name from a closed set, never an argument.** No `{{date:format("dd/MM/yyyy")}}`. A
format string is a second little language inside the template — a parser, a fuzzing obligation, an
error surface, and an escape from the closed-set discipline that makes registration-time checking
possible — bought for a rendering that a named row gives for free.

**And a placeholder takes one suffix, never a chain.** `{{client.displayName:lastFirst:upper}}` does
not exist. Where the profession genuinely needs a combination, it is a named format (`upper` on the
name table is exactly that). Where an author needs real composition, the expression language already
does it and does it visibly: `{{= upper(client.displayName)}}`. Reusing the language rather than
inventing suffix chaining is golden rule 1 applied to syntax.

### 4.5 Registration-time checking, and the freeze rule

Nothing about formats changes how they are checked: `legalFormatsFor(valueType)` is still the one
table, `isLegalFormat` still runs at registration, and a placeholder naming a format its type does
not have is still a registration failure with a location. Adding a value type means adding one row to
that table, and the empty row is still what makes every suffix on an image illegal.

The rule the scale-up adds is a **freeze on defaults**:

> **A shipped key's default format and its absence behaviour are frozen; its rendering may only
> change by an author naming a new format at the placeholder.**

The manifest records a format only when the author overrode it, so changing a default silently
changes every document every existing template produces. A firm that has filed two years of letters
does not get a different date style because we improved one. New renderings ship as new format names,
opt-in at the placeholder. The one permitted movement is on absence, and only in one direction:
**absence may become more visible (`blank` → `placeholder` → `fail`), never less.** A change that
makes a hole harder to miss is safe; a change that makes it easier to miss is the failure this
subsystem exists to prevent.

### 4.6 A rendering that needs a fact the record lacks is an absence

`{{client.displayName:lastFirst}}` on a Directory record that stores only "Rowan Ashcroft" with no
family-name part **does not fall back to "Rowan Ashcroft"**. It resolves to nothing, with a reason:
_"This Directory record has no family name recorded separately, so it cannot be written surname
first."_

Falling back would produce a document that looks finished and is wrong in a way nobody catches by
reading it — the same failure the ambiguity rule refuses, one level down. The reason travels on the
existing `absenceReasons` channel, so the repair (open the record, split the name) is in the message.
The same holds for `salutation` without a recorded prefix: we do not infer a courtesy title from a
name, which is the honest version of the pronoun question the expression design already answered.

### 4.7 A multi-line rendering is `w:br`, not a newline

`address:block` and `signatureBlock` are the first merge values that render as several lines. A
literal `\n` inside a `w:t` renders as a **space** in Word — the document looks subtly wrong and every
text assertion passes. A multi-line rendering therefore emits alternating `w:t` and `w:br` elements
within the substituted run, which is a small extension to the substitution path and a place where the
package-integrity assertions, not a text assertion, are what proves it correct.

## 5. Sourcing, and the source budget

### 5.1 The budget

The batching rule is stated in reads, so the design states its read count rather than its field
count. **A template naming every key in the platform catalogue costs twelve reads and one object
fetch.** Today's twenty-nine-key catalogue costs six.

| Source             | One statement                                                        | Answers                                                        | Status  |
| ------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------- | ------- |
| `matter`           | the matter row by id                                                 | `matter.*`, `client.displayName`, `client.code`                | shipped |
| `party`            | `matter_party` joined to the Directory name tables                   | every party subject's identity, `matter.parties`, `<slot>.all` | shipped |
| `location`         | the location row by id                                               | `location.*` including the letterhead logo reference           | shipped |
| `firm`             | caller-supplied plus the firm settings read                          | `firm.*`                                                       | shipped |
| `customField`      | current values for every matter-axis handle named                    | `custom.<handle>`                                              | shipped |
| `system`           | no read                                                              | `system.*`                                                     | shipped |
| `partyContact`     | `matter_party` with a correlated scalar sub-select per contact facet | `<slot>.address`, `.emailAddress`, `.phone`                    | new     |
| `partyCustomField` | current entity-axis values for every (subject, handle) pair named    | `<slot>.custom.<handle>`                                       | new     |
| `partyIdentifier`  | `directory_identifier` through the protected read path               | `<slot>.barNumber`, tax identifiers                            | new     |
| `staffing`         | `matter_assignment` joined to `member` and the member profile        | every `member` subject                                         | new     |
| `court`            | `matter_court_case` joined to the court organisation and the judge   | `court.*`, `case.*`                                            | new     |
| `estate`           | `matter_estate` joined to the decedent record                        | `estate.*`                                                     | new     |
| `financial`        | the matter's trust leaf balance and its billing roll-up              | `trust.*`, `billing.*`                                         | new     |

Three properties of this table are the design:

**A subject costs nothing.** Fourteen party subjects ride the one party read, because a subject is a
pass over rows already in memory — the shipped role-source property, generalized. Adding the fifteenth
party subject adds no read.

**A facet costs at most one read, once.** `partyContact` answers addresses, emails, and phones for
_every_ party subject in one statement, using a correlated scalar sub-select per facet so a party with
two primary emails cannot multiply the row count. A join per facet would produce a Cartesian product
of a party's contact rows, which is the same N+1 wearing a different shape.

**The correlated sub-selects encode level 2 of the ambiguity rule in SQL**: each sub-select returns
the primary row where one exists, and the accompanying count tells resolution whether "no primary and
several" applies — so the ambiguity decision is made from one read, not from a second one.

### 5.2 What is derivable today

More than the shipped catalogue exposes, which is the cheapest part of this work:

- **Name parts** — `directory_person` already stores prefix, given, middle, family, suffix. Every
  name format is available the moment the value type exists.
- **Structured addresses, emails, phones** — `directory_address`, `directory_email`,
  `directory_phone`, each with `is_primary` and temporal validity, and `location_address` for the
  office.
- **The matter's type and its number parts** — `matter_type.name` and `matter_type.code` answer the
  fixture catalogue's invented `matter.practiceArea` without inventing anything.
- **Entity-axis custom fields** — `custom_field.target = 'entity'` already exists and is deliberately
  excluded from the merge catalogue today, with the reason stated in
  `custom-field-statements.ts`: an entity-axis field's values hang off a Directory record, and there
  was no subject to hang it on. **The party subjects are that subject.** This is where a firm's own
  "bar number", "insurer claim number", or "court division" already lives, and it is the answer to
  most of the long tail that would otherwise become platform keys.
- **Trust balances** — the matter's trust ledger leaf balance is a direct read, and a closing letter
  or settlement statement that states it is exactly what the trust subsystem was built to make
  answerable.

### 5.3 New facts, and where each belongs

Three genuinely new domain facts. Each is proposed as **the domain's own record, with merge fields as
a consumer** — not as a table shaped by what a template wants. Each names its owning area, because
document automation is not the right owner for any of them and a table designed by its second-loudest
consumer is how a schema goes wrong.

**`matter_assignment` — owner: Matters.** `(matter_id, member_user_id, assignment_role, valid_from,
valid_to)`. The matter's staffing beyond the single `responsible_member_id` column: who originated it,
who supervises, who bills it, which paralegal carries it. It is wanted well beyond documents —
caseload views, billing attribution, conflicts imputation, and workload reporting all ask the same
question — and every one of them is currently answered by the one column or not at all. The document
catalogue is the first consumer to need it, not the reason for it. Ambiguity resolves by the level-1
rule: two supervising attorneys means `supervisingAttorney.displayName` is an absence naming the
count, and `supervisingAttorney.all` lists them.

**`member_professional_profile` — owner: Members / firm settings.** Title, admissions, direct dial,
professional email, and the signature block a pleading signs off with. A firm member's bar number is
a sensitive identifier and belongs on the protected path (section 5.4), not in this row.

**`matter_court_case` — owner: Matters (litigation).** The court (a Directory organisation reference,
so a court's own address and clerk contact come free), the division, the case number, the filing date,
the judge (a Directory person reference), the assigned department, and the two designation words
(`client_designation`, `opposing_designation`) that make a caption read correctly in its own
jurisdiction's vocabulary. This is the record rules-based docketing will hang off later; designing it
now for a caption and later for a deadline is the cheap order, and the white paper already names
court-rule sets as jurisdiction-keyed reference data of the same kind as the trust-rules catalogue.

**`matter_estate` — owner: Matters (probate).** Section 6.

**`matter_party.capacity`** — one column on the existing link table. Section 6.

The alternative for all of these is "let firms define custom fields", and it is genuinely available
today. It is rejected for the platform core for one reason: **a custom-field key is a per-firm handle,
so a template written against it is not portable, not shareable as starter content, and not something
platform documentation can name.** The tail stays custom fields; the facts every firm in the practice
area records get platform keys. That line is the one that decides what earns a table.

### 5.4 Protected facts

Bar numbers and tax identifiers live in `directory_identifier` as ciphertext, so they are the first
`sensitivity: protected` entries the dictionary will carry, and they land only through the seam the
document-automation design already named: resolution through `readProtected`, the acting member's
decrypt permission checked, and a `protected.decrypt` audit row per read. A member without the
permission gets a **named failure**, never a blank.

Two rules the scale-up adds:

- **A protected facet is only decrypted for a subject that resolved.** A slot that resolved
  ambiguously, or not at all, is an absence _before_ any decryption is attempted — so an assembly
  cannot generate a decrypt audit trail for a party the document never names.
- **Protected facets are `secondary` prominence and carry their own group treatment in the picker**,
  so an author choosing "the client's name" never trips over "the client's tax identifier".

Whether protected keys appear in the catalogue at all remains owner decision F9 from the
document-automation design; this design narrows it (section 13, H4) rather than reopening it.

### 5.5 What is deliberately not sourced

- **Anything requiring inference.** No guessed genders, no guessed salutations, no guessed
  party designations, no "responsible attorney" inferred from who has billed the most time.
- **Anything computed that the expression language can compute.** No `matter.daysOpen` key; that is
  `{{= daysBetween(matter.openedOn, system.today)}}`, visibly, in the template.
- **Documents about documents.** No `file.*` keys. A merge field naming a document in the matter is
  an exhibit-index feature with its own selection question, and it belongs to a later slice with a
  real consumer.

## 6. Estate, probate, and capacity

"Names of the estate" is the ask that most rewards being taken literally, because an estate has
**several** names and a probate document uses each in a different place:

- the **decedent's name**, in several renderings ("Rowan Ashcroft", "Ashcroft, Rowan", "ROWAN T.
  ASHCROFT");
- the **estate's style** — "the Estate of Rowan Ashcroft, Deceased" — which is what a caption and a
  bank account name use;
- the **short style** — "the Ashcroft Estate" — which is what a letter's second reference uses;
- and the **capacity phrases** that name a person _through_ the estate: "Devon Marchetti, as
  Administrator of the Estate of Rowan Ashcroft, Deceased".

**The estate is a first-class identity on the matter**, `matter_estate`: a decedent reference (a
Directory person, so every name format comes free), the date of death, the estate style and short
style, the estate's own tax identifier reference, the proceeding type (testate, intestate, small
estate, ancillary), and the letters-issued date. `estate.style` is stored rather than composed,
because "the Estate of Rowan Ashcroft, Deceased" is a legal designation a firm may need to state
exactly as the court has it, and a composed string would be right most of the time — which is the
worst frequency.

**Capacity composes in the resolver, never in the template.** A template that writes
`{{personalRepresentative.displayName}}, as {{personalRepresentative.capacity}} of {{estate.style}}`
is a template that produces "Devon Marchetti, as of " when the capacity is unrecorded, with three
separate markers and stray punctuation. So the composition is a facet:

```
{{personalRepresentative.capacityLine}}
  ->  Devon Marchetti, as Administrator of the Estate of Rowan Ashcroft, Deceased
```

composed from three declared facts — the party's name, the `capacity` recorded on the matter's party
link, and the estate style when the matter has an estate — with **one absence for the whole phrase**
when any part is missing, and a reason naming which part. One marker, one repair.

The same facet serves a trust matter ("as Trustee of the Ashcroft Family Trust"), a conservatorship,
and an attorney-in-fact, because the capacity's object is whatever identity record the matter carries;
the estate is simply the first one built.

## 7. Discoverability at hundreds

### 7.1 Two levels of grouping, plus prominence

`MergeFieldGroup` grows from a closed union of six to a **declared group registry**, and the picker
renders `group > subject > rows`:

| Group                  | Subjects                                                                    |
| ---------------------- | --------------------------------------------------------------------------- |
| Matter                 | matter                                                                      |
| The client             | client                                                                      |
| Other parties          | opposing party, opposing counsel, co-counsel, guardian, witness, expert, …  |
| Our people             | responsible attorney, originating attorney, supervising attorney, paralegal |
| Court and case         | court, case                                                                 |
| Estate                 | estate                                                                      |
| The firm               | firm                                                                        |
| This office            | location                                                                    |
| Dates and the document | system                                                                      |
| Money                  | trust, billing                                                              |
| The firm's own fields  | custom                                                                      |

`prominence` does the rest of the work: a subject shows its `primary` facets (name, address, email)
and keeps its `secondary` ones (kind, capacity, the firm's own entity fields, protected identifiers)
one interaction away. **Prominence orders and collapses; it never removes.** A field that exists is
always findable by search.

### 7.2 Search vocabulary

`catalogSearchKeywords` already matches label, key, description, and group label. It gains
**synonyms** and the **subject label**, which is what makes a firm's own words work: someone typing
"defendant" finds the opposing party, "PR" finds the personal representative, "SSN" finds the tax
identifier, "DOD" finds the date of death. Synonyms are declared per facet and per subject, so the
list stays about forty rows rather than three hundred.

### 7.3 Relevance orders; it never filters

A template bound to a matter type is a strong hint that its author wants probate fields rather than
litigation ones. That hint is spent on **ordering only**:

```
firm usage  ->  tag match with the template's matter type  ->  prominence  ->  alphabetical
```

Never on hiding. Hiding the field someone needs, in a product where the alternative is retyping it by
hand into a filed document, is a worse failure than a longer list — and a person who cannot find a
field they know exists concludes the product does not have it.

### 7.4 The binding index

"Firm usage" above, "which templates break if I deprecate this key", and the custom-field
hard-delete guard are the same question: **which registered template versions bind this key?**

Today the guard answers it with `instr(field_manifest_json, ?)` over every stored manifest, and its
comment argues correctly that a bindings table would be "a second copy of a fact the manifest already
states, with its own way of going stale". That objection is answered precisely, not waved at: **a
template version is immutable.** A row derived from it and written in the same batch as its
registration can never disagree with it, because neither side ever changes again. There is no update
path, no reconciliation, and no staleness mode.

So: `document_template_field_binding (template_version_id, merge_key)`, written once at registration,
indexed both ways. It gives the picker's usage ordering an index seek instead of a table scan on every
open, gives an administrator a real answer to "where is this field used", turns the delete guard's scan
into a lookup, and makes deprecation impact reportable. It is the one new table in this design that
exists purely for the catalogue.

### 7.5 What the catalog contract grows

`packages/merge-field-catalog-contract` is the read contract, and it needs four changes:

1. **`MergeFieldEntry` gains** `subject`, `subjectLabel`, `prominence`, `synonyms`, `status`,
   `supersededBy`, and per-format example renderings.
2. **`MergeFieldGroup` stops being a closed union** and becomes a declared registry with ordering and
   labels, so adding a group is a row.
3. **The value-type union is pinned to the engine's.** The contract today has `longText`, `address`,
   and `reference`; the engine has `image`, `list`, and `rate`. Two unions that describe the same
   thing and disagree is a drift generator, and the fix is one of them deriving from the other with a
   fitness test on the pairing.
4. **The fixture catalogue becomes a projection, not an invention.** A test asserts every fixture key
   exists in the real dictionary. The fixture keeps its job — realistic labels and lengths for
   interface work — and loses its ability to describe fields that do not exist.

The `revision` field the contract already carries becomes load-bearing at this size: a catalogue of
262 platform entries plus a firm's own is tens of kilobytes, and it is the same bytes for every member
of a firm until the firm's custom fields change. **Revision = the platform dictionary version plus a
digest of the firm's custom-field catalogue**, so a browser caches it and revalidates cheaply.

## 8. Lifecycle: permanence, deprecation, and versioning

A stored template is a firm's document, registered against a catalogue that will keep growing for
years. Four rules:

1. **A shipped key is permanent.** Never renamed, never repurposed, never given a different source.
   The name of a fact is part of the contract with every template that binds it.
2. **Defaults are frozen; absence may only get more visible.** Section 4.5.
3. **Withdrawal is deprecation, never removal.** An entry gains `status: deprecated` and, where one
   exists, `supersededBy`. A deprecated key **still resolves** — templates keep working — but it is
   hidden from the picker's default view, flagged in the field inspector with what replaced it, and
   reported by the binding index so an administrator can see the work. Removal is not a lifecycle
   state; if it ever happens, it happens to a key the binding index proves nobody binds, as a
   deliberate act.
4. **Adding is always safe.** A new key cannot break a registered template, because an unknown key is
   a registration failure rather than an assembly one — a template cannot bind what did not exist.
   The one collision risk is a new platform key colliding with a firm's own, and the `custom.`
   namespace reservation plus the reserved-namespace fitness test make that structurally impossible.

`DICTIONARY_VERSION` on the provenance row already records which catalogue an assembly ran against;
its meaning widens from "the shipped list" to "the shipped list plus the generation", and it is what
makes a document assembled in March and one assembled in September explainably different.

## 9. Absence at scale

Three hundred keys is three hundred absence decisions, which is exactly how a set of decisions
becomes inconsistent. **Absence behaviour is declared per facet, with explicit per-subject
overrides**, so the default answer is uniform and every exception is a visible line rather than a
divergence:

- `displayName` on a party: `placeholder`. On `client`: `fail` — the shipped decision, kept.
- `address`, `emailAddress`, `phone`: `placeholder`.
- `capacity`, `capacityLine`: `placeholder`.
- Protected facets: `placeholder` when the fact is missing, and a **named assembly failure** when the
  member lacks the decrypt permission. Those are different outcomes for different reasons.
- Collections (`.all`): `blank`. An empty list is a correct document, as it is today.
- The firm's own fields: `placeholder`, without a per-field override, for the reason
  `custom-field-bindings.ts` already states — the platform cannot know whether a firm's field is
  load-bearing.

The absence marker itself improves for free: `absenceMarkerFor` derives `[OPPOSING COUNSEL DISPLAY
NAME]` from the key today, and with `label` on the entry it becomes `[OPPOSING COUNSEL'S NAME]` —
the words the author picked from, in the document they are proofreading.

## 10. Load-profile fit

Per the accretion rule, this extends the `documentAutomation` volume profile in place rather than
adding a benchmark. The harness is already shaped for it: the probe template declares **every key the
firm's dictionary offers**, so widening the catalogue widens the measured merge context automatically —
the property the slice 2·6 status fragment recorded as "the platform half widens whenever the
dictionary does, without moving the read count".

Measured operations added to the committed baseline:

- **The full merge context at the widened catalogue** — the number that must move with sources, not
  with fields. Its assertion is the source count, not a duration.
- **The catalogue projection** — `GET /api/v1/merge-fields` at 262 platform entries plus a firm's own,
  with its response size recorded, since it is the one payload that grows with this design.
- **The binding-index write at registration** — a template declaring 150 distinct keys writes 150
  rows in the registration batch.
- **The picker's usage ordering read** — the binding-index aggregate, which must be an index walk.

The plan-scan check must show index walks on all four. The generator version bumps, as it did for the
role sources.

## 11. Test strategy

The risk moves from "is this row right" to "is the generator right", and the tests move with it.

**Generation fitness.** The existing `dictionary-wellformed` test generalizes: every generated entry
has a source, a legal default format for its type, a declared absence behaviour, a label, a group, a
subject, and a description. No two subjects normalize alike. No key escapes the reserved-namespace
rule. Every facet declared for a subject kind produces an entry for every subject of that kind — a
hole in the cross product is a defect, not a choice.

**The golden key list.** A committed file of every shipped key with its type, source, default format,
and absence behaviour. The test fails when a key disappears, changes type, changes source, changes
default format, or loosens its absence behaviour. This is what makes the permanence rule in section 8
a property rather than a promise, and it is the single most valuable test in this design.

**Format tables.** Every format for every type, including the absence-with-reason cases: a name
format that needs a part the record lacks, an organisation asked for a family name, an address format
on a record with no street. The multi-line renderings are asserted over the **emitted package parts**
(`w:br` elements present, the run structure intact), never over document text, because a text
assertion cannot see a document Word will not open.

**The source budget.** The batching test generalizes from "a 150-field manifest issues a bounded
number of reads" to "a manifest naming every key in the catalogue issues exactly the number of reads
there are sources, and naming one key from each of two sources issues two". Level 2 ambiguity gets its
own cases: a party with two primary addresses, a party with one non-primary address, a party with
none.

**Contract pinning.** Every fixture catalogue key exists in the real dictionary; the contract's value
types and the engine's agree; the group registry's order is total.

**Worker integration.** The protected facets get the two cases the document-automation design named —
with and without the decrypt permission — plus the new one this design adds: a protected facet on a
slot that resolved ambiguously writes **no** decrypt audit row.

## 12. Risks

**A generated mistake is a systematic mistake.** One wrong facet row is wrong on fourteen subjects at
once. That is a real cost of the shape, and it is bought back by the golden key list and the
generation fitness test, which see all fourteen at once too — where a hand-written catalogue's single
wrong row is seen by nobody.

**New domain facts designed by their second-loudest consumer.** `matter_assignment`,
`matter_court_case`, and `matter_estate` are wanted by caseload views, docketing, billing, and
conflicts, none of which is in the room. The mitigation is procedural and named in section 5.3: each
table's owning area is stated, the merge keys are declared a consumer, and the design is reviewed by
that area before the migration lands.

**Catalogue payload growth.** 262 entries with labels, descriptions, synonyms, and per-format
examples is tens of kilobytes on a read that every authoring surface makes. Mitigated by the revision
digest and browser caching, measured in the load profile, and bounded by the fact that the payload
grows with the platform's key count rather than with any firm's data.

**Firm vocabulary drift.** Aliases (section 3.4) close the gap between a firm's role names and the
platform's subjects, but a firm that never sets them gets absences on keys that "should" work. The
instrument is the existing `documentAssembly.absentField` counter dimensioned by source; the repair
path is the alias surface; and the field inspector is where an author sees it.

**Protected fanout.** A template naming five subjects' bar numbers writes five decrypt audit rows per
assembly. That is correct — each is a real decryption — but it makes an assembly a meaningful event in
the audit log, and a firm generating a hundred documents a day should not be surprised by it. Worth
stating in the user documentation rather than engineering around.

**Scope gravity.** This design touches Matters, Directory, Members, and Trust. Each phase in the
implementation plan is drawn to be shippable alone and to leave `main` working, precisely because the
temptation to build all of it at once is the thing most likely to stall it.

## 13. Owner decisions required

Short list; each has a recommended default the plan builds to unless told otherwise.

| Flag   | Decision                                                                                                                                                                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1** | **New facts as platform tables, or left to custom fields?** Recommended: platform tables for staffing, court/case, and estate — the facts every firm in the practice area records — with the tail staying custom fields. A per-firm handle cannot be named in a shared template. |
| **H2** | **Firm role aliases.** Recommended: ship them. Normalization solves spelling, not vocabulary, and a firm that writes "Defendant" otherwise gets silent absences on every opposing-party key.                                                                                     |
| **H3** | **`displayName` gains name formats, or a new `name` key ships beside it?** Recommended: gains formats. One fact, one key, one row in the picker — at the cost of a slightly odd suffix on a key whose label is "Client's name" anyway.                                           |
| **H4** | **Which protected identifiers are catalogue-visible** (narrowing F9, not reopening it). Recommended: a bar number yes — it is professional public record that the firm holds encrypted — and tax identifiers behind an explicit firm setting, defaulting off.                    |
| **H5** | **Entity-axis custom fields on every party subject, or on the client only?** Recommended: every subject, at `secondary` prominence. It is the same read either way, and "the opposing counsel's firm file number" is a real field a firm has already defined.                    |
| **H6** | **Relevance orders but never filters.** Recommended: yes. A shorter list that hides the field someone needs is worse than a long one, in a product whose alternative is retyping into a filed document.                                                                          |

## 14. Open questions

1. **Where matter staffing is designed.** `matter_assignment` is proposed here because the catalogue
   needs it, but caseload, billing attribution, and conflicts imputation all want the same table and
   none of them has designed it. This design should not be the one that fixes its shape; the Matters
   area should confirm the columns before the migration.
2. **Whether a court is a Directory organisation.** Modelling it that way gives a court's address,
   clerk contact, and divisions for free and matches the white paper's "a court with judges is
   expressed through relationships". It also puts non-client organisations into the Directory, which
   has conflicts-search consequences worth confirming with that area.
3. **Whether the office's free-text `address_block` and the structured `location_address` should
   converge.** Today Locations carries both, the letterhead uses the free text, and this design adds
   structured office address formats. Two sources for one fact is exactly what the one-home rule
   forbids, and the resolution belongs to the Locations area.
4. **Per-firm labels.** A firm that calls the responsible attorney "the file handler" will ask to
   relabel the picker row. The key would stay stable, so it is safe — but it is a per-firm
   presentation store with a migration and an admin surface, and it should wait for a firm to ask.
5. **Starter catalogues.** The custom-fields engine reserved `template_field_key` for curated starter
   content in the control plane. A probate starter pack — the custom fields, the party roles, and the
   templates that use them — is the obvious first use, and it is the strongest argument for platform
   keys over per-firm handles. Out of scope here; worth deciding before the first real client.
