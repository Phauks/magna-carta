# Documents, Forms and Templates — a taxonomy scope study

**Status:** Study (not a spec, not a plan) · **Date:** 2026-09-07 · **Owner:** Trevor Goldsmith
**Outcome:** The owner ruled **taxonomy B** on 2026-09-07 — Forms means what a client fills in. Recorded in
[`docs/conventions/design-corrections.md`](../conventions/design-corrections.md) and in the ADR fragment
`forms-is-what-a-client-fills-in-not-what-a-firm-assembles`. **V1** and **V4** are answered; **V2** is answered
differently from the way this study framed it, for the reason in section 7. **V3**, **V5** and **V6** stay open.
**White paper:** _Document Automation_, _Client Intake & CRM_, _Client Portal_
**Reads against:** [`2026-08-04-document-automation-design.md`](2026-08-04-document-automation-design.md),
[`2026-08-15-client-intake-design.md`](2026-08-15-client-intake-design.md),
[`2026-08-14-nevada-court-form-library-design.md`](2026-08-14-nevada-court-form-library-design.md),
[`2026-09-05-intake-desk-design.md`](2026-09-05-intake-desk-design.md)

**What this file is for.** The owner asked what "forms" are, and whether they are a separate thing from templates
or whether templates simply belong to Documents. The word carries four jobs in this repository and two of them
point in opposite directions: the sidebar says Forms means document automation, and the intake procedure says
forms are what the client fills in. Both are in the product now. This study says what each sense is, what the
built code has already decided without anyone ruling on it, what the three candidate taxonomies cost, and which
decisions the owner still owes. **It decides nothing and moves no ledger status.**

---

## 1. The word carries four jobs

| Sense                            | What it is                                                                                                         | Where it lives now                                                                                     | State                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **Forms, the destination**       | Document automation — merge fields, conditional assembly, the assemble surface                                     | `apps/web/src/lib/navigation/destinations.ts` (`id: "forms"`, "Document automation and court forms.")  | `shipped: false, announced: true`; one route, `/forms/assemble`, running on fixtures |
| **A fillable-PDF form template** | A court or agency PDF the firm supplies, registered as a template and filled through AcroForm                      | `document_template_version.kind = pdfForm`, `packages/document-assembly/src/pdf-form.ts`               | Backend built end to end; no browser screen                                          |
| **A court form**                 | A form the platform would ship, curated per jurisdiction                                                           | [Nevada court form library design](2026-08-14-nevada-court-form-library-design.md)                     | Designed; blocked on owner flags **N1**–**N5**                                       |
| **An online form**               | A surface a prospect or client fills in — the public intake form, and the client's forms going out and coming back | `roadmap.d/intake.md` (`intake.public-forms`), client intake design section 5, the `client-forms` step | Not started. No form builder, no public route, no portal                             |

The fourth is what the owner meant by the word. The first is what the product currently says it means.

---

## 2. What the built code has already decided

Four decisions are already in the repository. None of them was taken as a taxonomy ruling; all four constrain one.

### 2.1 A court form is a template, in the schema

`document_template_version.kind` is `wordProcessing | pdfForm`. The two kinds **share the catalogue, the
immutable version ladder, the ingest gate, the field-manifest shape, the binding index, the dictionary, the
formatters, the absence model, and the provenance row**, and share no engine — one branch on the kind in the
assembly job and one in the fill planner. The firm-facing guide already says the same thing in the firm's own
words: "A template can also be a fillable PDF your firm already has — a court form, an agency form, your own
intake sheet" ([`docs/user/features/document-templates-and-assembly.md`](../user/features/document-templates-and-assembly.md)).

**Consequence.** "Forms versus templates" is not a boundary the data has. Drawing it in the interface means two
screens over one table, two vocabularies for one version ladder, and a reader who has to know which kind a file
is before knowing which screen holds it.

### 2.2 The permission registry has already drawn a boundary — and it is not the one the sidebar draws

`packages/access-control/src/registry.ts` carries two keys for this subsystem and its own reasoning for them:

- **`templates:manage`** — `resource: "firm"`, described as **administrative**: register, version and archive
  assembly templates. The catalogue is firm-level and carries no matter data.
- **`documents:assemble`** — `resource: "matter"`: list the catalogue and assemble a document onto a matter.
  Listing is deliberately bound here rather than to a third read key, because "a member who can assemble must be
  able to see what they can assemble, and a member who cannot has no use for the list."

**Consequence.** The platform already distinguishes **holding a catalogue** (administrative, firm-rooted) from
**using one** (operational, matter-rooted). It does not distinguish a form from a template anywhere, and nothing
in the registry is called `forms:*`. Whatever the interface decides, it inherits a two-way split, not a three-way
one.

### 2.3 Assembly already has a screen, and that screen works

`apps/web/src/lib/documents/new-document-dialog.svelte` draws a **From a template** tab on the matter's New
Document dialog. It reads the real catalogue, posts to the real assembly route, and files the output onto the
matter as a document. That is live and on `main`.

`apps/web/src/routes/(app)/forms/assemble/+page.svelte` is a second implementation of the same act. Its own header
comment says so: every field, template and proposal comes from an in-repo fixture catalog through a mock provider,
and choosing Assemble reports the collected values rather than starting a job. Its stated gap is "a matter to
submit against" — which is precisely what the matter's own dialog supplies by standing on a matter.

**Consequence.** The Forms destination's only route duplicates a working screen, and building it out is the
build-every-screen-twice pattern the owner retired on 2026-08-29. The verb "assemble" already has a home, and that
home is the matter, because that is where the document lands.

### 2.4 What has no screen at all is the catalogue, not the act

`GET/POST /api/v1/templates` and `/api/v1/templates/upload` exist. Nothing in `apps/web` reads them outside the
matter dialog's picker. A firm registers a template, versions it, reads its field manifest, and confirms the
field mappings for a fillable PDF **through the API**. The registration and field-list surfaces for `pdfForm`
templates are recorded as backend-only in `roadmap.d/document-automation.md`, with the browser screens named as
slice 2·6·4.

**Consequence.** The real hole under the word "Forms" is a **template library screen** — the administrative half
of 2.2 — and it is the half no destination currently claims.

### 2.5 The client-facing sense has no code and two declared placeholders

`intake.public-forms` is `not-started`: no form builder, no public route. What exists is the bot control such a
form would sit behind (`apps/api-worker/src/human-verification/`, Turnstile, built and dormant). On the other
side, `intake_procedure_step` carries a `client-forms` kind, added on 2026-09-05 on the procedure's own principle
that a kind exists ahead of the subsystem that answers it — a member's record today, a reader's answer the day the
portal exists.

**Consequence.** The client-facing sense is not speculative. It is declared in two places and waiting on the
subsystem underneath it, exactly as `payment` is.

---

## 3. Where the disagreement actually is

A member reading the sidebar learns that Forms means the firm's document automation. A member working an intake
reads a step called "the client's online forms" and learns that forms are what the client fills in. Neither is
wrong about their own screen, and the two cannot both be the product's word.

The correction ledger has already ruled on the general shape of this failure, for navigation: two routes to one
destination must not disagree about what it belongs to, because "a member who learned 'Trust is under Money' finds
it loose in a menu at a narrower window" (`docs/conventions/design-corrections.md`, matter section strip,
2026-09-01). The same cost applies to one word meaning two subsystems.

So the question is not cosmetic and does not resolve itself. Something has to give up the word.

---

## 4. The three taxonomies

### A. Three identities, kept apart (status quo, made honest)

Documents holds files. Forms holds templates, assembly and the court-form library, as `destinations.ts` declares
today. The client-facing sense takes a different name — Intake Forms, or Questionnaires — and lives under Intake
and Portal.

**What it costs.** Nothing moves; the collision is resolved by renaming the thing that has no code yet. `/forms`
gains a real index and a template library, and `/forms/assemble` either becomes that library or is deleted in
favour of the matter dialog.

**What it makes hard.** Documents and Forms both hold documents, and a reader has to know that a `.docx` the firm
files is in one and a `.docx` the firm merges is in the other. A template's output is a document, so the two
destinations are joined by every act that crosses them. And it spends the plainest word in the product on the
narrower meaning: a client who fills something in has filled in a form, in every firm in the country.

### B. Two identities, Forms means client-facing collection

Documents absorbs the template library — both kinds, court forms included — because a template is a document.
Forms means what a client or prospect fills in: the public intake form, and the client's forms through the portal.
Assembly stays on the matter, where it already is.

**What it costs.** `destinations.ts` changes one description and one target. `/forms/assemble` is deleted rather
than finished (the act it scaffolds is live on the matter). The template library is built as a Documents surface
rather than a Forms one. The Nevada library, when its flags clear, lands as templates of a kind, filterable, not
as a separate shelf.

**What it makes hard.** A lawyer who says "pull up the JC-14 form" finds it under Documents · Templates, reached
by search rather than by the word in the sidebar. That is a real loss and search is the mitigation, not an answer.

### C. Two identities, and Forms is not a destination at all

As B, but Forms does not get a sidebar row either. The public form is authored and read under **Intake**, which is
built and is where the submissions land. The client's forms are read under **Portal**, which is planned. Both
already own the surrounding workflow.

**What it costs.** `destinations.ts` loses a row. Everything in B, minus a destination to design.

**What it makes hard.** A firm-wide "all our forms" view has no home; if one is wanted later it has to be
invented, or it becomes a section of Intake that reaches across into Portal. Against that: neither Intake nor
Portal is a place a reader would fail to look for the thing they are already doing there.

---

## 5. What B or C would mean concretely

| Thing                                              | Today                                              | Under B/C                                                       |
| -------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| Assembling a document from a template              | Matter · New Document · From a template (**live**) | Unchanged                                                       |
| `/forms/assemble`                                  | Fixture-backed duplicate of the above              | Deleted                                                         |
| Registering, versioning, archiving a template      | API only                                           | A Documents surface (or Settings — see **V3**)                  |
| A fillable PDF's field list and confirmed mappings | API only                                           | The same surface, one kind filter                               |
| The Nevada court-form library                      | Designed, gated on **N1**–**N5**                   | Templates of kind `pdfForm`, adopted through the same catalogue |
| The public intake form                             | Not started                                        | Intake (C) or Forms (B)                                         |
| The client's forms going out and back              | An intake step a member ticks                      | Portal, answering the `client-forms` step                       |
| `destinations.ts` `id: "forms"`                    | "Document automation and court forms."             | Client-facing collection (B), or removed (C)                    |

---

## 6. What no taxonomy here decides: where the template library renders

Both halves of 2.2 have precedent in this repository and they disagree.

**The Settings reading.** `templates:manage` is firm-scoped and the registry calls it administrative. The house
pattern for a firm-authored reusable definition is Settings: matter plans, intake procedures, event types, matter
numbering, report policy all live there.

**The daily-work reading.** A paralegal registers a new engagement-letter template the way they save a document,
not the way they configure a firm. The correction ledger says a destination checked daily stays on the row, and a
template library is closer to a file cabinet than to a preference.

The split in 2.2 is the honest resolution and it is available: the **catalogue's administration** can sit in
Settings while the **catalogue's use** stays on the matter, exactly as the two permission keys already divide it.
Whether a firm also wants a browsable library screen — open a template, read its fields, see what it produces —
is a separate question this study does not answer. Flagged as **V3**.

---

## 7. Owner decisions this study needs

| Flag   | Question                                                                                                                                                                                                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1** | ~~Which taxonomy — A, B or C?~~ **Answered 2026-09-07: B.** Forms means what a client or a prospect fills in; templates belong to the documents cluster and assembling one stays on the matter.                                                                                                                       |
| **V2** | ~~Does `/forms/assemble` get deleted?~~ **Answered 2026-09-07: moved, not deleted** — to `/developer-console/document-assembly`. This study called it a duplicate of the live matter dialog and it is not; see section 7's note. Deleting it would have thrown away the only record of an unbuilt capability's shape. |
| **V3** | **Where does the template library render — a Documents surface, a Settings page, or both halves split as the permissions already split them?** Section 6 sets out the two readings and the resolution available.                                                                                                      |
| **V4** | ~~Is it a destination (B) or Intake plus Portal (C)?~~ **Answered 2026-09-07: a destination.** The deciding question is whether a firm ever wants to see all its forms in one place, or only ever the one it is working in.                                                                                           |
| **V5** | **What does the product call a fillable PDF the firm registered?** If templates and forms merge, one word has to cover a `.docx` with braces in it and a court PDF with boxes. "Template" is the schema's word and the guide's; "form" is the courthouse's. This is the vocabulary entry, not a schema change.        |
| **V6** | **Does the client-facing work start before the portal exists?** The public intake form needs no portal (an anonymous stranger, a public route), but the client's forms do. If the two ship apart, the first is an Intake slice and the second waits.                                                                  |

**One correction this study owes, found while executing V1.** Section 2.3 called `/forms/assemble` "a second
implementation of the same act". That is wrong, and the way it is wrong matters. The live path on the matter sends
a template version and an output format and nothing else — `SubmitAssemblyRequest` in
`apps/api-worker/src/routes/assemblies.ts` has no field for a supplied value, `packages/document-assembly`
resolves every field from the matter through the dictionary, and no column holds one. A field the matter cannot
answer becomes an absence in the finished document, and no person can fill it in.

So the scaffold was never a duplicate. It is the design of a capability the platform has not built: **assembly
from values a person supplies**, now carried as `document-automation.supplied-values` in the feature ledger so it
outlives the screen. The screen went to `/developer-console/document-assembly`, which is where a reviewable state
real data cannot reach belongs. Deleting it, as this study recommended, would have left the gap with no record of
its intended shape and no entry in any ledger — the study's recommendation was right about the path and wrong
about the reason, and the reason is what decided the disposal.

---

## 8. Already answered — do not re-derive

- **A questionnaire front end is a non-goal of document automation, not an omission.** The design names it:
  Gavel's model — a client fills a web form and a document falls out — "belongs to the client portal and intake
  phases, and it **consumes this engine rather than replacing it**"
  ([document automation design](2026-08-04-document-automation-design.md), section 1). Whatever V1 decides, the
  client-facing surface produces data and hands it to the assembly engine; it does not become a second engine.
- **The public form performs no lookup against firm data.** One row written, one answer returned, identical for
  every submission — because a Directory read leaks through latency and hands a probing script its oracle from the
  clock ([client intake design](2026-08-15-client-intake-design.md), section 5). This is structural and is not
  reopened by a naming decision.
- **A public form's fields come from a bounded platform vocabulary, never from the custom-fields set** — a
  custom field of kind `contact-reference` would let a stranger point a value at a Directory entity (flag **J10**).
- **The court-form library is gated on N1–N5** (authoring versus redistribution, the starter set's contents, the
  review gate, whether fillable-PDF templates get built at all, and written permission from the two bodies that
  assert copyright). None of that moves on this study.
- **Whether a filled form files flattened or interactive is flag B5**, held today at interactive because
  flattening is irreversible.

---

## 9. What this study does not touch

As written, nothing: no schema, no route, no ledger status, no destination. **The owner's ruling of the same
day changed that**, and what followed it is recorded where it belongs rather than here — the destination's meaning
in `apps/web/src/lib/navigation/destinations.ts`, the ruling in
[`design-corrections.md`](../conventions/design-corrections.md), the decision as an ADR fragment, and the
supplied-values gap as a node in `roadmap.d/document-automation.md`. No schema moved and no status flipped:
`document-automation.supplied-values` enters the ledger at `not-started`, which is what it has always been.

What the ruling did **not** settle stays open and is listed in section 7: where the template library renders
(**V3**), what the product calls a registered fillable PDF (**V5**), and whether the client-facing build starts
before the portal exists (**V6**). The public intake form additionally waits on its own flags **J1**, **J3**,
**J10** and **J11**, none of which this ruling touches.
