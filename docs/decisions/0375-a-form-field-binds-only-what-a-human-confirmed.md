---
number: 375
slug: a-form-field-binds-only-what-a-human-confirmed
status: Proposed
date: 2026-08-16
area: Document automation
summary: "A firm-supplied fillable PDF becomes a second TEMPLATE KIND rather than a second subsystem: `document_template_version.kind` is `wordProcessing | pdfForm`, defaulting to the existing value, and the two share the catalogue, the immutable version ladder, the ingest gate, the field-manifest shape, the binding index, the dictionary, the formatters, the absence model, and the provenance row while sharing no engine. The binding rule is the load-bearing decision: an AcroForm field binds to a merge key ONLY through a mapping a human confirmed, stored in the firm's existing `document_template_field_mapping` library — and the exact-name match is refused as well as the near one, offered as a `proposedMergeKey` that nothing applies. Every terminal field the form declares comes out either bound or on a fourth manifest list with one of three reasons (`no-confirmed-mapping`, `not-fillable`, `unclassified`); a field the engine cannot classify is never defaulted to text, and a form that binds nothing warns that every document from it is the blank form. The absence model is unchanged, with one honest divergence: a tick box and a set-answer box have nowhere to print a marker, so an unanswerable one is left unanswered with a reason rather than ticked. Whether a filed form is flattened or interactive is NOT decided here — it is a required, typed `FormFillFinish` parameter at the fill seam, answered in one worker constant that is `interactive` today because flattening is irreversible."
---

**A form carries the firm's own field names, not merge keys, and no amount of resemblance turns one into
the other. Everything else about a form template is the machinery a Word template already uses.**

**Context:** The document-automation tail left fillable-PDF form filling planned and unbuilt, with the
reasoning recorded: it looks adjacent to the PDF output arm and is not. The PDF arm was one call on an
existing conversion edge inside an existing job. A form template changes the shape of a template — the
catalogue grows a discriminator, the manifest is discovered rather than authored, the engine is a second
one, and what a filled form IS when it is filed is a product question.

Three of those four are engineering. The fourth — how an AcroForm field name becomes a merge key — is the
one that could quietly go wrong, and it is the same problem the Word `MERGEFIELD` conversion already
faced. A court's drafting tool minted `Petitioner_Name_1`; a firm's own scanner minted `TextField12`. A
system that reads those and decides what they mean is making a binding decision about privileged content
on the firm's behalf, once per box, silently, and the result is a filed document that looks right.

**Decision.**

**A kind, not a subsystem.** `document_template_version.kind` is `wordProcessing | pdfForm`, defaulting
to the existing value so every row that predates the column is correctly described. The kind is STORED
rather than sniffed at read time, because the question every consumer asks is "which engine fills this
in", and a version registered without an answer is one that fails at assembly time instead of at
registration. The two kinds share the catalogue row, the immutable version ladder and its supersede
behaviour, the ingest gate and the status ladder, the field-manifest shape, the binding index, the
per-firm dictionary, the formatters, the absence model, the provenance row, and the telemetry. They
share no engine, and the assembly job branches in exactly one place.

**A field binds only what a human confirmed — including the exact match.** A mapping comes from this
registration's request or from the firm's existing `document_template_field_mapping` library, which is
the same store the Word conversion writes to, so a firm that has already said what `ClientName` means
does not say it again. Where a field's name IS a merge key, character for character, that is reported as
a proposal and nothing applies it.

Refusing the exact match is the part worth defending, because it looks like pedantry. It is not: a
proposal built on exactness today becomes a proposal built on normalization tomorrow and on resemblance
the week after, and each step is individually reasonable. The line has to sit where it can be stated in
one sentence — *nothing binds until a person says so* — because a line that needs a paragraph is a line
that moves. The cost is one confirmation per form per firm, on a library that remembers it.

**Every box is accounted for, and none is defaulted to a type.** Each terminal field the form declares
is either a site on a manifest field or an entry on `unboundFormFields` with its reason:
`no-confirmed-mapping` (confirm one), `not-fillable` (a push button or a signature field — no repair
wanted or possible), or `unclassified` (the form declares a box without stating its type). A fourth
manifest list rather than a widening of the third, on the same reasoning that separates the third from
the second: the repairs differ. **Unclassified is never filled as text** — a text fill writes an
appearance stream, and an appearance stream prints, so a guess about an unidentifiable box produces a
box that reads as answered. **A form that binds nothing warns that every document from it is the blank
form**, which is the exact failure `FORMTEXT` and the placeholder-showing content control each produced
before their manifest lists existed.

**The absence model is unchanged, with one honest divergence.** `fail` fails the assembly naming the
key, `blank` empties the box, and a text box otherwise prints the same visible marker a Word template
would, inside the box. A tick box and a set-answer box have nowhere to print one, so they are left
unanswered and the absence is carried in words instead — reported to the caller, counted, and stored on
the provenance row like every other. Ticking a box to signal "we do not know" would answer the form's
question wrongly, which is worse than leaving it for a person. For the same reason a non-boolean value
bound to a tick box, and a value outside a drop-down's option set, are reported absences rather than
guesses: the engine would otherwise set a state with no appearance behind it — a box that looks
unanswered and carries an answer.

**Flatten-or-not is deliberately NOT decided here.** `FormFillFinish` is `interactive | flattened` and
is a REQUIRED parameter at the fill seam, so nothing can acquire a default by omission. The platform's
one answer is a named constant in the assembly job's engine wiring, and it is `interactive` while the
question is open — a flattened form cannot be corrected, and the non-destructive option is what should
sit behind an unanswered question. Answering it is a change to that constant, or a change from a
constant to a per-template column read.

**Consequences.** A firm's court and agency forms enter the same catalogue as its letters and are
governed by the same rules, at the cost of one confirmation pass per form. The registration surface
gains a field set to confirm against and the field-list surface gains the boxes each merge field fills;
the assembly surface gains nothing at all, which was the point of making this a kind. A curated
jurisdiction court-form library remains out of scope and unanswered — these are the forms a firm
supplies. And a gap is recorded rather than papered over: the PDF engine's sanitizer does not remove
document-level JavaScript or additional actions, so a fillable PDF is not made inert the way the OOXML
macro strip makes a `.docx` inert, and what stands between a hostile form and a firm today is the scan
every uploaded byte already crosses.
