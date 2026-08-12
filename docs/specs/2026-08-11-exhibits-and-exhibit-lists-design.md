# Exhibits and exhibit lists — design (slice 2·7)

**Date:** 2026-08-11
**Status:** Design proposed; owner decisions in section 12 are open. No product code in this cycle.
**Scope:** The exhibit model (a matter-level exhibit, an ordered set, a label that is a function of
position), the in-text reference mechanism and how a person inserts one, the filed-versus-draft
freeze line and what withdrawal does after it, where exhibits come from, numbering schemes, exhibit
separator pages and the compiled package, how the exhibit list itself is produced, and the boundary
with Bates numbering. Excludes: the user interface (named as seams only, section 10), court e-filing
and docket integrations, trial-presentation software, admission tracking at trial, and any
jurisdiction rules catalog.
**White-paper home:** _Document Automation_, with _Documents_ (versioning, conversion, the ingest
chokepoint), _Matters and File Manager_, _Discovery_ (productions and Bates), _Custodian_ (physical
originals), and _Calendar and rules-based docketing_ (the correction-versus-continuance line this
design reasons from) as the surrounding context.
**Governing decisions:** ADR-0011 (document automation as a first-class capability), ADR-0003
(tenancy), ADR-0077 (app-managed versions), ADR-0081 (inbound upload + quarantine chokepoint),
ADR-0082 (async job artifacts), ADR-0083 (load-profile accretion), ADR-0142 (Bates numbering as an
additive overlay), ADR-0210 / ADR-0211 (the assembly engine and template model), ADR-0218 (the
template expression ceiling), ADR-0039 (compute placement), ADR-0067 (route metadata and the
chokepoint).
**Decision inputs:** the shipped substrate this design is obliged to reuse —
`@magna-carta/document-assembly` (the dictionary and its `assetClass` collection-only precedent, the
repeat machinery, `MergeListItem`, the registration-time check, the field-binding index),
`@magna-carta/file-manager` (the version model and the ingest chokepoint), `@magna-carta/matter-assets`
(`matter_asset_document` — a link over ordinary matter files, no bytes), `@magna-carta/calendar` (the
correction/continuance line and its two partial unique indexes), `@magna-carta/conversion` plus the
LibreOffice engine (the DOCX-to-PDF edge), `crates/pdf-core`'s `stamp_set` Bates engine, and the
design system's `merge-field-picker` / `merge-field-chip`. Prior art surveyed in section 4.4 and
section 11: Word's `SEQ` / bookmark / `REF` cross-reference machinery, LaTeX's `\label` / `\ref`, and
the litigation-support products that automate exhibit renumbering. Nevada practice was read from
primary text (EDCR 2.27 and the Eighth Judicial District Court department guidelines), and section
6.3 explains why none of it is encoded as a rule.

## Why now

Every input exists. The matter shell, the File Manager version model, the ingest chokepoint, the
assembly engine with conditional and repeating blocks, the DOCX-to-PDF edge, and the Bates engine
with its continuous `stamp_set` are all on `main`. What does not exist is the thing every litigation
matter needs on the day it opens a motion: an exhibit that keeps its identity while its title, its
position, and every sentence citing it move around it.

Two prior designs named this slice by name and left it open. The document-automation design's own
worked example of a repeating block is, verbatim, `{{#each exhibits}} Exhibit {{exhibits.letter}} —
{{exhibits.title}} {{/each}}` — an `exhibits` collection the dictionary has never had. The
expression-language design's first open question is where a list-valued dictionary source comes from
and names `exhibits` first. This slice is where that source becomes real, and where the reason it was
never trivial gets designed rather than assumed.

## 1. The recommendation, up front

**An exhibit is an identity, a position, and a label — three facts that are never the same fact.**
The identity is a row on the matter. The position is a row in a set. The label is a **pure function
of position and the set's scheme, computed on read and never stored** — until the set is issued, at
which point the label is **materialized onto the member row and frozen by a trigger**. In-text
references cite the **identity** and render the **label**, so a reorder moves every citation in the
document and cannot move one in a document already filed.

Concretely:

1. **`matter_exhibit`** is the thing — the employment agreement — with a stable, matter-scoped
   `reference_name` a human wrote, a title that may change daily, and a link (never bytes) to an
   ordinary matter `file`.
2. **`exhibit_set`** is an ordered membership for one document — the exhibits to Plaintiff's Motion
   to Dismiss — carrying its own numbering scheme and exactly two states, `draft` and `issued`.
3. **`exhibit_set_member`** is a position in that set. While the set is `draft` the label is
   computed; at issue it is written down and becomes immutable.
4. **An in-text reference is a fourth placeholder form**, `{{@referenceName}}`, distinct from a merge
   key, from a computed field, and from a block marker — because an exhibit is an instance created
   during drafting and a merge key is a platform-declared fact of the matter, and conflating the two
   would either make the dictionary firm-derived or make every exhibit reference a registration
   error. A reference names **exhibits**, never a span: `{{@leaseAgreement,@rentLedger,@noticeToQuit}}`
   renders "Exhibits B through D" today and "Exhibits B, D, and F" after somebody inserts two
   exhibits in the middle, because the renderer computes the phrasing from the members.
5. **Issuing a set is a recorded human assertion, not an observed event**, because the platform has
   no court e-filing integration and will not pretend to. A member states that this set went out —
   filed, served, exchanged, or lodged — on a date, and that assertion is the freeze.
6. **The exhibit list is produced both ways.** A live rendered table on the matter is the working
   view and is never a document. An assembled document, produced through the shipped engine from a
   starter template over the new `exhibits` dictionary source, is what gets filed.
7. **Separator pages are assembled documents that are never stored as matter documents.** They exist
   only inside a compiled package, regenerated from the label every time, because a stored separator
   page is a stale label waiting to be filed.
8. **An exhibit label and a Bates number are different identifiers with different owners, and
   neither derives from the other.** Reordering exhibits never touches a Bates number; a production's
   Bates range rides the exhibit as recorded provenance and prints as a column on the list.

The defect this feature exists to prevent, stated once so every rule below can be measured against
it: **a document that says "as shown in Exhibit C" while Exhibit C is now the medical records.** It
is worse than having no feature, because the document looks finished. Every design choice here is
biased toward making that state unrepresentable rather than detectable.

## 2. The model

### 2.1 Three facts, three rows

The naive model is one table with a `label` column and an `order` column, and it fails on the second
day: the label drifts from the order, and nobody can see that it has. The model here separates what
changes independently.

**`matter_exhibit` — the identity, at matter scope.** `id`, `matter_id`, `reference_name`, `title`,
`description`, `source_kind`, `file_id`, `pinned_file_version_id` (nullable), `page_count`
(nullable), `bates_begin` / `bates_end` (nullable), `created_by`, timestamps, and soft-archive. The
row is matter-scoped rather than set-scoped for a reason that shows up on the third filing: the
employment agreement is **one thing** that is Exhibit C to the motion and Exhibit 7 at trial, and a
per-set row would make those two unrelated records that nothing can reconcile.

**`exhibit_set` — the ordered membership for one document.** `id`, `matter_id`, `name`, the scheme
columns (section 6), `state` (`draft` | `issued`), `continues_from_set_id`, `supersedes_set_id`,
`disposition`, `issued_on`, `issued_by`, `filed_copy_file_id`, timestamps.

**`exhibit_set_member` — a position, and after issue a label.** `id`, `exhibit_set_id`,
`matter_exhibit_id`, `position`, `label` (NULL while draft), `title_as_issued` (NULL while draft),
`file_version_id_as_issued` (NULL while draft), `status` (`active` | `withdrawn`), `withdrawn_at`,
`withdrawal_basis`, timestamps.

**`exhibit_reference` — which document version cites which exhibit.** `id`, `matter_id`, `file_id`,
`file_version_id`, `matter_exhibit_id`, `occurrence_count`, written by the assembly that produced the
version. **The index is acceptable here for exactly the reason the template field-binding index is
acceptable: a `file_version` is immutable**, so neither side ever changes after the batch that wrote
them, and there is no update path, no reconciliation, and no staleness mode. It is the read behind
"which of our documents cite this exhibit", which is the question a reorder has to be able to answer
before it is allowed to be casual.

### 2.2 The label is a subtraction, not a column

While a set is `draft`, `label` is NULL and the label is computed from `(position, scheme)` on every
read. This is the calendar's rule about overdue deadlines, transplanted with its reasoning intact: a
fact that is a function of two other facts must not also be a column, because a column can disagree
with the function and nothing in the system is positioned to notice. A stored draft label would
require a renumber sweep on every insertion, every deletion, and every reorder — three write paths
that must all be correct forever, where the alternative is one function with one test.

The function is total and small: `labelFor(position, scheme)` in a pure module, with the sequence
generators (upper letters with their overflow form, lower letters, arabic, roman) as a closed
registry. It reads no clock, no database, and no firm setting — the scheme is an argument.

**At issue the label is materialized**, and from that moment the column is the authority and the
function is only a check. Section 5 is why.

### 2.3 The attachment, and which version an exhibit is

An exhibit points at a `file`, and a file has versions. Three states, and the middle one is the
default that matters:

- **Draft, floating.** `pinned_file_version_id` is NULL and the exhibit is whatever the file's
  current clean version is. This is right while drafting: somebody fixes a scan and the exhibit
  improves.
- **Draft, pinned.** A member pinned a specific version deliberately — the executed copy, not the
  redline.
- **Issued.** `file_version_id_as_issued` on the member row records the exact version that went out,
  written at issue, immutable thereafter. A later edit to the underlying file does not and cannot
  change what was filed.

The third is the one that is expensive to retrofit and free today: without it, a firm asked in
deposition "is this the document you attached?" has the platform's word and nothing else.

### 2.4 What an exhibit set does not do

_It does not span matters._ An exhibit is a matter fact and a set is a matter's document. A shared
exhibit across two matters is two exhibits over the same file, which is honest — the two matters have
different access boundaries and different filings.

_It does not track admission at trial._ Real trial exhibit lists carry Offered / Objection / Admitted
columns, and the starter list template prints them **blank**, because that is what a court hands the
clerk. Recording what actually happened in the courtroom is a different feature with a different
audience and its own evidentiary weight, and it is not smuggled in as three more columns here.

_It does not hold bytes._ Every route in this subsystem takes a `file` handle. The File Manager's
`initiateUpload` / `completeUploadSession` chokepoint is how bytes become a file, and this subsystem
never learns a second way, exactly as `matter_asset_document` never did.

## 3. Where exhibits come from

Four sources, none of them a new attachment model, and `source_kind` records which.

| `source_kind`       | What it is                                    | How it attaches                                                                                                               |
| ------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `matterFile`        | An ordinary file in the matter's File Manager | The base case. A `file_id`, and nothing else is needed.                                                                       |
| `assembled`         | A document the platform assembled             | Also just a `file_id` — an assembly output is an ordinary matter file, so this needs no mechanism at all, only the label.     |
| `custodyItem`       | A physical original the firm holds            | The exhibit points at the item's **scan**, which is already a matter file; the custody link is recorded provenance beside it. |
| `discoveryDocument` | A document in a review set or a production    | Points at the review document's file, and carries the Bates range as provenance (section 8).                                  |

The last two are why `source_kind` exists as a column in slice 1 even though the two paths build in
slice 2·7·4. A provenance discriminator added later means a backfill over rows nobody can classify
retroactively; added now it is one `CHECK` constraint.

**Custodian's own boundary is unchanged and this design does not move it.** The custodian design says
a physical exhibit a firm holds is a custody item and belongs there, and that discovery owns the
digital production chain. Both stay true: an exhibit here is a _citation target in a document_, which
is neither custody nor production, and it points at whichever of them holds the thing.

## 4. The reference mechanism

This is where the design work is, so it is worked out from the constraints rather than chosen.

### 4.1 Why an exhibit reference is not a merge field

The temptation is obvious: the platform has a merge-field system, an exhibit reference looks like a
merge field, so make `{{exhibit.C}}` a key. It does not survive contact with three shipped rules.

1. **Subjects are platform-declared, never firm-derived.** The catalogue's subject registry says so
   in its own comment, and the reason is that a firm's own vocabulary is free text that neither lexes
   as one merge-key atom nor gets typed from memory. An exhibit's reference name is firm-authored,
   per matter, and minted while drafting.
2. **A merge key is checked at registration and a template is firm-level.** A template is registered
   once, for every matter, before any exhibit exists. Every exhibit reference in a template would be
   `expression-unknown-key` at registration — and the registration-time check is not a nuisance to be
   worked around here, it is the property that makes the whole subsystem safe.
3. **A merge key names a fact of the matter; an exhibit reference names an instance in this
   document.** `client.displayName` is a question the matter can answer. "Exhibit C" is not a
   question about the matter at all — it is a question about _this document's_ exhibit set, and two
   documents on the same matter give different answers.

So an exhibit reference belongs to the **document instance**, not to the template. It is authored in
the document a person is writing, and resolved when that document is produced.

### 4.2 Why it is not an expression either

The expression language is closed, total, and non-executable by construction, and its central
structural property is that a name is one lexical atom resolved by exact match against a `Map`. An
exhibit reference could be made to fit — but it would have to resolve against a scope the dictionary
does not own, at a time the checker does not run, over names the platform does not declare. Every one
of those is a hole in a property the language's security argument rests on. The correct answer is not
to widen the language; it is to put the reference outside it.

There is one place the languages touch, deliberately and narrowly: the **exhibit list template**
iterates `{{#each exhibits.all}}`, which is an ordinary list-valued dictionary source with ordinary
item fields. That is a merge field, it is platform-declared, it is checked at registration, and it
resolves against the set the assembly was told to use. Nothing about it is special-cased.

### 4.3 The form

**A fourth placeholder form, with its own sigil, following the precedent `{{= }}` set.**

```
{{@employmentAgreement}}                                  -> Exhibit C
{{@employmentAgreement:bare}}                             -> C
{{@employmentAgreement:titled}}                           -> Exhibit C (Employment Agreement)
{{@leaseAgreement,@rentLedger,@noticeToQuit}}             -> Exhibits B through D
{{@leaseAgreement,@noticeToQuit}}                         -> Exhibits B and D
{{@employmentAgreement:asIssued}}                         -> Exhibit C to Plaintiff's Motion to Dismiss, filed March 14, 2026
```

Four properties, each load-bearing.

**The name is symbolic and stable, and this is LaTeX's lesson taken directly.** `reference_name` is
minted from the title at creation (`Employment Agreement` becomes `employmentAgreement`) and is
**thereafter independent of it**. Retitling the exhibit to "Executed Employment Agreement (2019)"
changes the title everywhere it prints and changes no reference anywhere. This is the same move the
custom-fields engine made when it bound by handle rather than by name, for the same reason: a
name-bound reference puts every firm one retitle away from a document that silently stops resolving.

**A reference names members, never a span.** This is the single most important rule in the section
and it is the one a naive implementation gets wrong. If an author writes "Exhibits B through D" as a
range with two endpoints, then inserting an exhibit between B and D leaves a reference that is still
syntactically valid, still resolves, still renders — and is now wrong, because the span silently
acquired a member the author never cited. Enumerating the members and letting the renderer compute
the phrasing makes that state unrepresentable: after the insertion the same token renders "Exhibits
B, C, and E", which is what the author meant all along.

**The rendering forms are a closed catalog, checked statically**, reusing the `:format` suffix
machinery the placeholder grammar already has. `full` (default), `bare`, `titled`, `asIssued`. There
is no format that emits a page number or a Bates number, because those are per-page facts and a
citation to a page is a different feature.

**The token is visible text, and that is the property that makes it survive.** The document is
round-tripped through Word and through Collabora by real people. A `{{@name}}` token is ordinary
characters: copy and paste preserves it, a version of Word we have never tested preserves it, and a
half-edited document is still readable. This is exactly the reasoning that made text delimiters the
primary template placeholder form, and it applies here with more force, because a matter document
gets edited far more than a template does.

### 4.4 What Word and LaTeX actually do, and what we take from each

**Word's mechanism is `SEQ` for the number, a hidden bookmark on it, and a `REF` field pointing at
the bookmark.** It is a genuinely good design and it is the right one for a document that contains
its own figures. It does not fit here, for four reasons found in its own documentation rather than
inferred:

1. **`SEQ` fields do not update automatically.** They update on print, on print preview, on `F9`, or
   from a macro. A document whose cross-references are correct only after somebody remembers to press
   a key is precisely the defect this feature exists to prevent, moved one step later.
2. **`REF` needs an in-document target.** Word's model assumes the exhibit's label is _typed in the
   document_ so a bookmark can be wrapped around it. Ours is not: the exhibit is a separate attached
   file and the label comes from the platform's ordering. There is nothing in the document to
   bookmark.
3. **The failure mode is a broken bookmark.** Deleting, moving, or copying a section without its
   target produces `Error! Reference source not found`. That is at least visible, which is better
   than silence — but it is a failure the symbolic-name-plus-central-registry model does not have,
   because the target is a row, not a range of characters somebody might delete.
4. **Complex field runs are a Collabora fidelity risk** the document-automation design already
   declined to take for templates. Taking it for every matter document is the same bet at higher
   stakes.

**What we take from Word is the interaction, not the mechanism.** Its cross-reference dialog is the
right answer to "how does a person insert one without knowing a syntax", and section 4.5 is that
dialog.

**LaTeX's `\label` / `\ref` is the mechanism we take.** A symbolic name the author chooses, a counter
the system owns, resolution at build time, and — critically — the number never appears in the source.
An author cannot write a stale number because there is nowhere to write one. That property is the
whole design, and it is why `reference_name` is independent of the title and why no rendering form
lets an author supply a label.

**The litigation-support products confirm the shape and mark the ceiling.** Exhibit-management tools
automatically renumber and re-stamp exhibits and generate slipsheets carrying the label; the
recurring complaint they exist to solve is that Word cross-references do not follow a renumber. None
of the surveyed products treats the filed-versus-draft boundary as a modelled state — the freeze is a
convention their users maintain by hand. Section 5 is where this design goes past them.

### 4.5 How a person inserts one

Not by typing it. The insertion surface is the shipped picker pattern: the editor offers an
**exhibit picker** listing the set's exhibits by label and title, the same way `merge-field-picker`
lists merge fields, and inserting one writes the token. Beside it, the **exhibit chip** renders the
token's _current resolution_ — the author reads "Exhibit C" in place, and the document stores
`{{@employmentAgreement}}`. Multi-select in the picker produces the comma-separated form, which is
the only way an author ever produces a multi-exhibit citation; there is no range to typo.

Round-tripped into Word the chip is gone and the token is bare text. That is a degradation and it is
the right one: the reference still resolves, still follows a reorder, and is still legible.

**Detecting existing prose references is offered as a proposal and never applied.** A firm's ten
thousand existing documents say "Exhibit C" in plain text. A scan can find those and propose bindings,
and the surface can accept them one at a time — but nothing rewrites a firm's prose unasked. This is
the `DetectedFieldConversion` rule verbatim ("guidance, never a completed action"), and it is the
same rule as "the engine never guesses what a Word field name means", one level up: a paragraph that
silently acquired a binding is a silent binding decision on privileged content.

### 4.6 Resolution, and what an unresolvable reference does

Resolution happens where merge resolution happens — in the assembly consumer, off the request path,
against one batched read of the set and its members. A reference resolves to a label or it does not,
and the three outcomes are the ones the absence model already distinguishes:

| Case                                                      | Outcome                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The name resolves to a member of the document's set       | The label, rendered in the requested form.                                              |
| The name resolves to a matter exhibit not in **this** set | **Fails the assembly**, naming the reference and the set.                               |
| The name resolves to nothing on the matter                | **Fails the assembly**, naming the reference.                                           |
| The member is `withdrawn`                                 | Resolves to its retired label, and the assembly completes **with a warning** naming it. |

The bias is deliberate and matches the unresolved-condition rule: **a citation that cannot be
resolved fails the document, it does not render a placeholder.** A missing clause is invisible and a
wrong citation is worse than invisible — it is confidently wrong. The one case that warns rather than
fails is the withdrawn exhibit, because a brief that cites a withdrawn exhibit is a real thing a
lawyer sometimes means to write.

Every assembly writes its `exhibit_reference` rows in the same batch that files the output version.
That is what makes "which documents cite this exhibit" answerable, and section 5.4 is what it is for.

## 5. The filed-document invariant

### 5.1 The line, and the line it is drawn from

The calendar draws a line the whole platform reasons from. A **correction** is an edit: the row
misdescribed reality, so the row is fixed in place and the audit row carries the fix. A
**continuance** is a real-world reschedule: the court vacated one setting and made another, _both of
which happened_, so the old row keeps every historical column byte-untouched, a new row carries the
setting as it now stands, and one link points new to old.

The equivalent line here is between a set that is a **plan** and a set that is a **record of an act**.

**A draft set is a plan.** Reorder it, retitle its exhibits, add and remove members — labels
recompute, references follow, and nothing is preserved because nothing has happened yet. Every edit
is an ordinary edit with an ordinary audit row.

**An issued set is a record of an act.** It was filed, served, exchanged, or lodged. Opposing counsel
has it, and on the docket there is a document that says "Exhibit C" and means one specific thing
forever. From that moment:

- Every `label`, `title_as_issued`, `file_version_id_as_issued`, and `position` is **frozen by a
  trigger**, in the append-only idiom the valuation and custody-movement tables already use. An
  `UPDATE` naming those columns on a member of an issued set fails at runtime, and a source scan
  fails it at review.
- The set admits no new members and loses none.
- Its numbering cannot be recomputed, because the function that would recompute it is no longer the
  authority — the column is.

**A correction is still available and still means the same narrow thing:** the row misdescribed what
was actually filed. We recorded the wrong underlying file for Exhibit C, or mistyped the recorded
title. That is an edit in place, permission-gated, audited, and it **never renumbers** — it changes
what we say Exhibit C _was_, never which position it held.

**A supersession is the continuance.** An amended pleading with a different exhibit set is a **new
set**, the old one preserved untouched, and one `supersedes_set_id` link pointing new to old — held
to a chain by two partial unique indexes so a fork is refused even under racing writes, which is the
calendar's mechanism reused rather than re-derived. Both filings really happened; both sets are real.

### 5.2 Issuing is an assertion, because the platform cannot observe it

There is no court e-filing integration on this platform and none on the roadmap — the competitive
analysis records it as a likely third-party integration rather than a build, and every subsystem spec
that touches it lists it as out of scope. So the platform **cannot know** a document was filed, and
designing as if it could is how a freeze silently fails to happen.

Issuing is therefore a recorded act by a member holding `exhibits:issue`, carrying a `disposition`
(`filed` | `served` | `exchanged` | `lodged`), an `issued_on` civil date, and optionally the
file-stamped copy as a `file_id`. It is **irreversible**: there is no unissue. A set issued in error
is corrected the way an erroneous filing is corrected in practice — by superseding it — and owner
decision **E2** is whether that is too strict.

The alternative designs were considered and are worse. Freezing on _download_ punishes a paralegal
who prints a draft. Freezing on _conversion to PDF_ punishes the same person one step earlier.
Freezing on nothing at all — trusting the firm to stop editing — is the state every surveyed product
is in, and it is exactly the state where a filed exhibit list silently renumbers.

What the interface owes this, named as a seam rather than designed here: the moment a set's compiled
package or exhibit list is rendered for download, the surface asks whether this is going out. That is
a prompt, not a state change.

### 5.3 Withdrawal after issue, and the retired label

An issued exhibit cannot be removed, because it was served. It is **withdrawn**: a recorded status on
the frozen member row, with a date and a basis, requiring the same permission as issuing.

**The label is retired and never reused.** Position 3 stays position 3, Exhibit C stays Exhibit C, and
no later exhibit in that set becomes C. Reusing a served label is the same class of defect as
renumbering and is arguably worse: two different documents both correctly cited as Exhibit C, in a
record where the citation is the only way to tell them apart. The list renders the row as "Exhibit C
— withdrawn", which is what a real amended exhibit list does; the surveyed trial-practice guidance
carries Withdrawn as a first-class status on the list for exactly this reason.

Later sets are unaffected. A superseding set numbers its own members from its own scheme, and if it
continues from the issued set (section 6.2) it starts after the highest label the predecessor
consumed — **including the retired one**, because the retired label was served and a second C on the
same docket is a collision no reader can resolve.

### 5.4 What a reorder must know before it is allowed to be casual

Reordering a **draft** set is free and every reference in every draft document follows. Reordering a
draft set that already has **issued siblings** is also free — but the drafting surface must be able to
say what will change, and `exhibit_reference` is what lets it: before the reorder commits, the surface
reads which document versions cite which members and reports the labels that are about to move. That
read is one indexed statement and it is the difference between a feature that renumbers and a feature
a litigator trusts.

An issued set never enters this path at all, because its members cannot move.

## 6. Numbering schemes

### 6.1 The scheme is a property of the set

Not of the firm, not of the matter, and not of the jurisdiction. One matter genuinely runs two
schemes at once — under EDCR 2.27 the plaintiff's tabs are numbered and the defendant's are lettered
— and one firm appears in many courts. A firm-level setting would be wrong on the second matter.

The scheme columns on `exhibit_set`:

| Column          | Meaning                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ |
| `noun`          | The word: `Exhibit`, `Attachment`, `Appendix`, `Tab`.                                      |
| `prefix`        | Free text before the noun: `Plaintiff's `, `Defendant's `. Empty by default.               |
| `sequence`      | `upperLetter` \| `lowerLetter` \| `arabic` \| `roman`.                                     |
| `start_at`      | The first value's ordinal. `1` by default; `500` is a real Clark County practice.          |
| `overflow_form` | What follows Z: `doubled` (AA, BB, CC) or `bijective` (AA, AB, AC). Owner decision **E1**. |

`labelFor` is the cross product and nothing else. There is no rule engine, no jurisdiction lookup,
and no inference from the matter's court.

### 6.2 Continuing across filings

`continues_from_set_id` points at the set this one continues. A set that continues another starts at
one past the highest ordinal its predecessor consumed, retired labels included (section 5.3), and it
inherits the predecessor's scheme unless it overrides it. This is what makes the research finding
work: when an amended complaint adds exhibits, the existing A, B, and C keep their letters even where
that leaves them cited out of order, and the new ones start at D.

Chains are read depth-capped, the way the continuance chain is, so a matter with forty filings does
not walk forty rows to number the forty-first.

### 6.3 Nevada-first, and why nothing is hard-coded

The primary text was read, and it is the argument against encoding it.

EDCR 2.27 requires that exhibits be separated by sheets with `Exhibit ____` **centered in 24-point
font or larger**; that exhibits over ten pages be numbered consecutively **in the lower right-hand
corner**; and that where exhibits collectively exceed one hundred pages they be filed as a separate
appendix **with a table of contents identifying each exhibit and the numbering sequence**. Those are
specific, quantified, and directly implementable — and they are the _format_ rules, which section 7
implements as a starter template a firm can edit.

The _numbering_ rules are where a catalog would be wrong. Within the Eighth Judicial District Court
alone, department guidance disagrees: one department's guidelines direct numbers for the plaintiff and
letters for the defendant with double letters past Z, and another directs that the plaintiff start at
1 and the defendant at 500 unless the plaintiff exceeds 500, in which case counsel agree on blocks.
Both are current, both are that courthouse, and neither is a property of Nevada.

So the platform ships **starter schemes as copyable presets, never as rules** — the same posture
Custodian takes on will-deposit statutes and the calendar takes on deadline computation, and for the
same stated reason: a catalog that is ninety percent right is worse than none, because it gets
trusted precisely because it was computed. A preset is a set of column values a member accepts and
can then change; nothing infers one, and nothing recomputes an existing set when a preset changes.
Owner decision **E4** is which presets ship.

## 7. Separator pages, the list, and the compiled package

### 7.1 The exhibit list is produced twice, on purpose

**A live rendered table**, on the matter's exhibit surface: label, title, description, source, page
count, Bates range, status. Always current, never a document, never filed. This is the working view
and it is what makes the whole feature usable on day one.

**An assembled document**, produced through the shipped assembly engine from a starter template, and
filed as an ordinary matter file through the ordinary chokepoint. This is what goes to the court. It
is an assembly and not a bespoke renderer because a firm needs its own caption, its own columns, and
whatever a particular judge asks for — and the engine that already does conditional blocks, repeating
table rows, and letterhead is precisely the tool.

The list template iterates the new dictionary source:

```
{{#each exhibits.all}}
  {{exhibits.all.label}} | {{exhibits.all.title}} | {{exhibits.all.pageCount}} | {{exhibits.all.batesRange}}
{{/each}}
```

`exhibits` follows the `assetClass` precedent exactly: **collection-only, no scalar facets.** There is
no `exhibits.count` and no `exhibits.first`, because a set with one exhibit is not the normal case and
a scalar would resolve to an absence naming the count on most matters — the ambiguity rule producing a
technically correct answer that is useless every time. `count(exhibits.all)` already answers the one
question worth asking, through the shipped aggregate.

Item fields: `label`, `title`, `description`, `pageCount`, `batesRange`, `status`, `sourceKind`.
Every one is text, a number, or a closed vocabulary; none is money or a date, so nothing here is
foldable and the aggregates stay unexercised on this source, which matches the note the assembly
package already carries about aggregable collections.

**Which set an assembly means is supplied by the caller**, as `ResolutionInput.exhibitSetId`, the same
way the estate schedule's as-of date is supplied. A matter with more than one draft set and no
explicit choice resolves to an **absence naming the count**, never to the newest one — picking
silently is precisely what the ambiguity rule refuses.

### 7.2 Separator pages are assembled, and never stored

EDCR 2.27's separator sheet is a one-page document carrying the label in 24-point type. A firm in
another court needs a different one. So it is a **template**, in the ordinary catalogue, with a
`separatorPage` role, assembled per member with `exhibits.all.label` and optionally the title.

**It is never filed as a matter document.** A separator page exists only inside a compiled package
and is regenerated from the label every time the package is built. The reason is the invariant: a
stored separator page carries a label as bytes, and a label as bytes is a stale label the moment
anything reorders. Making it unstorable makes that failure unrepresentable rather than unlikely.

### 7.3 The compiled package

One PDF: the exhibit list, then for each member a separator page and the exhibit itself, with PDF
bookmarks to each member. Built as an asynchronous job on the shipped job shape — a Durable Object
keyed `firmId:packageId`, an idempotent start, a queue consumer, a stuck alarm — because it converts
every non-PDF member through the LibreOffice edge and concatenates hundreds of megabytes, neither of
which belongs in a request handler.

The package is an ordinary matter file when it lands, through the ordinary chokepoint, with no
bypass. It is a **derived artifact**: rebuilding it after a draft-side change is expected and cheap.
For an **issued** set the package is built once at issue and is thereafter as immutable as the set.

## 8. Bates numbering

**An exhibit label and a Bates number are different identifiers with different owners, and neither
derives from the other.** A Bates number is per page, sequential across a production, and burned into
the bytes at production render; an exhibit label is per document, positional within one set, and
printed on a separator page and in a list. Reordering exhibits never touches a Bates number, and a
Bates renumber is not a thing that happens.

Where they meet is a column and a join, not a computation. An exhibit sourced from a production
carries `bates_begin` and `bates_end` as **recorded provenance**, copied at attach time from the
discovery record and never recomputed. The exhibit list prints it as a column — which is what a real
exhibit list has, and it is the join that lets opposing counsel find the produced page behind Exhibit
C.

**Package pagination is the one genuine collision.** EDCR 2.27 requires exhibits over ten pages to be
paginated in the lower right-hand corner — which is `BatesPosition::BottomRight`, the shipped engine's
default, and also where a produced page's existing stamp already sits. The package therefore paginates
through the shipped `stamp_set` with its own per-package prefix and an explicit corner, and:

- **No attempt is made to detect an existing stamp.** No reliable detector exists; a false negative
  overprints a served Bates number and a false positive drops required pagination. Guessing here is
  worse than either honest option.
- **The surface warns when any member came from a production**, and the corner is the member's choice.
- Owner decision **E5** is whether package pagination defaults on or off.

## 9. Confidentiality, permissions, and telemetry

**Permissions**, registered in `@magna-carta/access-control`, both matter-rooted (`resource: "matter"`,
the `files:*` precedent):

- **`exhibits:manage`** — create exhibits, build and reorder draft sets, build packages. Seeded to the
  practising roles.
- **`exhibits:issue`** — issue a set, withdraw an issued member, correct an issued member, supersede a
  set. Narrower, because these are the four operations that touch the record of what was served.

**Confidentiality.** An exhibit holds a title and a description a person wrote about a client's
document, so it is privileged content: it is per-firm data behind the firm-scoped data-access layer,
it is classified in the personally-identifiable-information registry in the change that creates the
tables, and no exhibit title, reference name, or label ever becomes a telemetry dimension or an audit
`metadata` value. Audit rows carry identifiers only.

**Telemetry** — three counters, low-cardinality dimensions only:

- `exhibitSet.issued`, dimensions `[disposition, sequence]` — how sets actually go out, and which
  schemes are real.
- `exhibitReference.resolved`, dimensions `[outcome, form]` — `resolved` / `withdrawn` / `failed`
  against the four rendering forms. A rising `failed` is the drift signal.
- `exhibitPackage.built`, dimensions `[outcome, stage]` — where package builds end and fail.

**Load profile.** Per the accretion rule this extends the harness in-area with an `exhibits` volume
profile rather than a bespoke benchmark: a matter carrying a 200-member set with issued predecessors,
plus a document citing forty exhibits. Four measured operations, all of which must show index walks:
the set-and-members read with label computation; the reference-resolution batch for a forty-reference
assembly; the "which documents cite this exhibit" read; and the continuation-chain read. **Nothing on
a request hot path**: package building, PDF conversion, separator assembly, and reference resolution
all run in the queue consumer, and the only synchronous work is authorize-persist-start plus paginated
reads.

## 10. User-interface seams

The owner designs the interface; this spec defines the backend contract it calls.

1. **The exhibit surface on a matter** — the live list, drag-to-reorder with the pre-commit "these
   labels will move" report, add-from-file-manager, retitle, and the scheme editor.
2. **The issue dialog** — disposition, date, the optional file-stamped copy, and the one-way door
   stated in as many words.
3. **The exhibit picker and chip** in the document editor — the insertion surface of section 4.5,
   built on the shipped `merge-field-picker` / `merge-field-chip` patterns.
4. **The reference report** — which documents cite which exhibits, and which references are stale or
   withdrawn. This is the repair surface.
5. **The package builder** — member order, separator template, pagination options, poll, land on the
   filed PDF.

## 11. What was rejected

**A range reference with two endpoints** (`{{@leaseAgreement..@noticeToQuit}}`). Rejected in
section 4.3: it survives an insertion syntactically and dies semantically, which is the exact shape of
failure this feature exists to prevent.

**Making an exhibit reference a merge field.** Rejected in section 4.1 on three shipped rules —
subjects are platform-declared, registration-time checking would fail every reference, and a merge key
names a fact of the matter rather than an instance in a document.

**Making it an expression.** Rejected in section 4.2: it would resolve against a scope the dictionary
does not own, at a time the checker does not run, over names the platform does not declare.

**Word's `SEQ` + bookmark + `REF` machinery.** Rejected in section 4.4 on its own documented
behaviour: fields do not update automatically, there is no in-document target to bookmark because the
exhibit is an attachment, and complex field runs are a Collabora fidelity risk already declined once.
Its _interaction_ is adopted.

**Storing the label while the set is a draft.** Rejected in section 2.2: a fact that is a function of
two other facts must not also be a column, and three renumber-sweep write paths are three chances to
be wrong where one function is one test.

**Auto-rewriting existing prose references.** Rejected in section 4.5: detection is a reported
proposal a human confirms, never an applied rewrite, exactly as detected merge-field conversions are.

**A jurisdiction rules catalog for numbering.** Rejected in section 6.3 on primary text: two
departments of one Nevada courthouse currently direct incompatible schemes, so the rule is not a
property of the jurisdiction and a catalog would be confidently wrong.

**Deriving an exhibit label from a Bates number, or renumbering Bates on reorder.** Rejected in
section 8: different identifiers, different owners, and one of them is burned into served bytes.

**A parallel attachment model.** Rejected throughout: an exhibit is a link over a `file`, and bytes
reach the platform through one chokepoint.

**Unissuing a set.** Rejected in section 5.2, and flagged as **E2** because it is strict.

**Reusing a withdrawn label.** Rejected in section 5.3: two documents correctly cited as Exhibit C is
a collision no reader can resolve.

**Freezing on download or on PDF conversion.** Rejected in section 5.2: both punish drafting, and
neither is what actually happened.

## 12. Owner decisions required

| Flag   | Decision                                                                                                                                                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1** | **The letter overflow form past Z** — `doubled` (AA, BB, CC) or `bijective` (AA, AB, AC). The trial-practice guidance surveyed says "double letters", which reads as `doubled`, and that is the recommendation — but it is a wire-visible, user-visible choice and changing it later is a migration. |
| **E2** | **Is issuing truly irreversible?** Recommended: yes, with supersession as the only remedy. The alternative is an "issued in error" reversal, which is a second way for a frozen label to become unfrozen and therefore a second way for the invariant to fail.                                       |
| **E3** | **The `asIssued` cross-filing citation wording.** "Exhibit C to Plaintiff's Motion to Dismiss, filed March 14, 2026" is user-visible legal prose that goes into filed documents, and the exact form is a practice preference rather than an engineering choice.                                      |
| **E4** | **Which starter schemes ship**, if any. Candidates from primary text: numbers-for-plaintiff / letters-for-defendant, and plaintiff-from-1 / defendant-from-500. Shipping both means shipping two conflicting readings of one courthouse, which may be honest or may be confusing.                    |
| **E5** | **Does package pagination default on, and in which corner?** EDCR 2.27 requires it past ten pages; a production-sourced exhibit already carries a stamp in that corner; and no reliable stamp detector exists.                                                                                       |
| **E6** | **May a member correct an issued member's recorded title or file at all?** Recommended: yes, narrowly, audited, never renumbering. The alternative — an issued set is wholly immutable — is cleaner but leaves a firm unable to fix a record of its own filing.                                      |
| **E7** | **Is admission tracking (Offered / Objection / Admitted) in scope later?** The starter list template prints the columns blank. Recording what happened in the courtroom is a different feature and this design assumes it stays out.                                                                 |
| **E8** | **Is prose reference detection offered at all?** It is genuinely useful for a firm's existing documents and it is a scan over privileged prose that proposes bindings. Recommended: yes, proposal-only, and only inside a document a member has open.                                                |

## 13. Open questions

1. **Whether an exhibit should be able to point at a specific page range of a file**, rather than the
   whole file. Real practice attaches "pages 4 through 9 of the deposition transcript". The model
   supports it as two columns, and it is cheap now and awkward later — but it interacts with page
   counts, with package assembly, and with the Bates range in ways that want a real consumer to settle
   against.
2. **How an exhibit set interacts with an ethical wall.** Walls are unbuilt platform-wide. An exhibit
   is matter-rooted, so it inherits whatever the matter's wall becomes, and nothing here needs to
   change — but the reference report is a cross-document read within one matter and should be
   re-examined when walls land.
3. **Whether the reference token should also be recognized inside a template**, resolving at assembly
   against the set the assembly names. It would let a firm author a standard motion whose prose cites
   its own exhibits. It is expressible, and it reintroduces exactly the registration-time-checking
   problem section 4.1 rejected, so it needs a real answer rather than a default.
4. **Whether `exhibit_reference` should record occurrence locations** (part, paragraph) rather than a
   count. The field-inspector surface renders locations for template failures already, and the same
   structure would let the reference report point at the sentence. It is more rows and a bigger write
   on every assembly.
5. **What a package does with a member the conversion registry cannot render** — an audio file, a
   native spreadsheet with no defensible print range. EDCR 2.27 anticipates this and requires a
   caption and a transcript, which is a human obligation the platform can prompt for and cannot
   satisfy.
