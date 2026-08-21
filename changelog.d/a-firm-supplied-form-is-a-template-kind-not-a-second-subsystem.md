---
category: Added
audience: public
---

**A firm-supplied fillable PDF is now a template KIND rather than a second subsystem.**
`document_template_version.kind` is `wordProcessing | pdfForm`, defaulting to the existing value, and
the two kinds share the catalogue, the immutable version ladder, the ingest gate, the field-manifest
shape, the binding index, the per-firm dictionary, the formatters, the absence model, the provenance
row, and the telemetry — while sharing no engine. `prepareFormTemplateVersion`
(`packages/document-assembly/src/pdf-form.ts`) reads the AcroForm field set through an injected reader
over `crates/pdf-core`, scrubs the upload, and builds the manifest from the bytes that will be STORED;
`fillFormTemplate` (`src/fill-form.ts`) plans the fill and hands it to the same engine. The assembly job
branches on the kind in exactly one place, with the version read, the byte cache, the batched
merge-context resolution, and the protected-field chokepoint on one side of it and the absence
accounting, the ingest chokepoint, the provenance row, and the telemetry on the other.

**A box binds only what a human confirmed, and the exact name match is refused as well as the near one.**
Mappings come from the registration request or from the firm's existing
`document_template_field_mapping` library — the same store the Word `MERGEFIELD` conversion writes to. A
field whose name IS a merge key character for character is reported as `proposedMergeKey` and nothing
applies it: a proposal built on exactness becomes one built on normalization and then on resemblance,
and the line has to sit where it fits in one sentence. Every terminal field the form declares comes out
either bound or on a fourth manifest list (`unboundFormFields`) with its reason —
`no-confirmed-mapping`, `not-fillable`, or `unclassified`. An unclassifiable field is never filled as
text (a text fill writes an appearance stream, and an appearance stream prints), and a form binding
nothing warns that every document from it is the blank form — the failure `FORMTEXT` and the
placeholder-showing content control each produced before their lists existed.

The absence model is unchanged, with one divergence stated rather than smuggled: a tick box and a
set-answer box have nowhere to print a marker, so an unanswerable one is left unanswered with a reason
recorded, and a non-boolean value bound to a tick box or a value outside a drop-down's option set is a
reported absence rather than a guess.

**Flatten-or-not is left open as a typed seam.** `FormFillFinish` is a required parameter on the fill;
the platform's one answer is a named constant in `apps/api-worker/src/assemblies/pdf-form-engine.ts`, set to
`interactive` while the owner decision stands open, because flattening is irreversible.

Also: `crates/pdf-core`'s `FormField` gains `required` (`/Ff` bit 2, inherited down the field tree), which
the manifest records; and the per-firm lineage gains
`20260816T170000_document-template-kind`.

## Public

**A fillable PDF your firm already has — a court form, an agency form, your own intake sheet — can now
be registered as a template, and the same merge fields that fill a Word letter fill its boxes.**

Upload it as a fillable PDF instead of a Word document. Everything else about a template is the same:
the same catalogue, the same version history, the same record of which version produced which document,
and a filed PDF that lands in the matter's documents like any other file.

**Nothing is guessed about what a box means.** A Word template tells us what its blanks are because you
typed them; a form carries only the name whoever built it gave each box — `Petitioner_Name_1`,
`TextField12`, sometimes nothing recognisable. So registering a form lists every box on it — what kind
it is, which page, whether the form marks it required — and you say which merge field fills each one.
What you say is remembered for your firm, so the next form using the same box names arrives already
filled in. Where a box's name happens to be exactly a merge field's, that is offered, and still only
offered: a box called `ClientName` is not turned into the client's name because it looked close. That is
a decision about a client's details in a document you are about to file, and it belongs to you.

**Every box is accounted for, and the ones nothing fills in are named** — boxes with no merge field
chosen, buttons and signature boxes, and boxes the form declares without saying what type they are. Each
is listed with the reason at registration, in the field list, and again on every document you assemble,
which is marked as needing review. A form that binds nothing at all says so plainly rather than quietly
producing the blank form every time.

**Anything already typed into the form is removed when it is stored.** Firms upload the copy they last
filed, and a template still carrying the previous client's answers is the last thing anyone wants.

Missing values behave exactly as in a Word template: the same visible `[CLIENT ADDRESS]` marker inside
the box, the same report, and the same stop when a field is set to require an answer. A tick box and a
drop-down have nowhere to print a marker, so they are left unanswered and the report says which box and
why — ticking a box to mean "we do not know" answers the form's question wrongly, which is worse than
leaving it for a person.

A document built from a form keeps its boxes, so whoever receives it can still correct a typo or
complete what you left for them.
