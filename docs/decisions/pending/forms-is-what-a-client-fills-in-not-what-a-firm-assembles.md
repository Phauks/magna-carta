---
slug: forms-is-what-a-client-fills-in-not-what-a-firm-assembles
status: Accepted
area: Platform
date: 2026-09-07
summary: "The product's word 'Forms' means a surface a client or a prospect fills in — the public intake form, and the forms a firm sends a client and gets back — and never the firm's document automation. The word carried both meanings simultaneously: the sidebar destination described itself as 'Document automation and court forms' while the intake procedure's step vocabulary called a client's questionnaire the client's online forms, so a member who learned one meaning was wrong on the other screen. The automation reading was the one to give up, on three findings already in the code rather than on taste. A fillable court PDF and a .docx template are two kinds of ONE record — document_template_version.kind is wordProcessing | pdfForm, and the kinds share the catalogue, the version ladder, the ingest gate, the manifest shape, the binding index, the dictionary, the formatters, the absence model and the provenance row while sharing no engine — so 'forms versus templates' is not a boundary the data has, and drawing it in the interface would mean two screens over one table. The permission registry had already drawn the boundary that IS real, and it is a different one: templates:manage is firm-rooted and administrative, documents:assemble is matter-rooted, and nothing anywhere is called forms:*. And the act the Forms destination existed to host already had a home — assembling a document is live on the matter's Add a Document dialog, because that is where the document lands. Templates therefore belong to the documents cluster, court forms are templates of a kind rather than a separate shelf, and the client-facing subsystem takes the word."
---

**One word cannot name both the document a firm generates and the questionnaire its client fills in.**

**Context:** "Forms" named two subsystems at once, in the shipped product. `destinations.ts` declared a
top-level destination described as "Document automation and court forms", pointing at a route whose
only page was a field-input surface for assembling a document. Meanwhile `intake_procedure_step`
carries a `client-forms` kind, added when the owner described a receptionist's workflow as "the
conflicts check, the agreement out and back, **the client's online forms**, the payment" — a
questionnaire that goes to a client and comes back.

Both meanings were live on screens a member uses. Neither was wrong about its own screen, and the
navigation ledger already names what that costs elsewhere: two routes to one destination must not
disagree about what it belongs to, because a member who learned one arrangement finds the other at a
narrower window. A word meaning two subsystems is the same failure with a larger blast radius, and it
does not resolve itself — something has to give up the word.

**Decision:** Forms means what a client or a prospect fills in. The firm's templates — both kinds —
belong to the documents cluster, and assembling one stays on the matter.

Three findings decided which meaning went, and none of them is a matter of taste:

**A court form is already a template, in the schema.** `document_template_version.kind` is
`wordProcessing | pdfForm`. The two kinds share the catalogue, the immutable version ladder, the
ingest gate, the field-manifest shape, the binding index, the dictionary, the formatters, the absence
model and the provenance row, and share no engine — one branch in the assembly job, one in the fill
planner. The firm-facing guide already says it in the firm's own words: a template can also be a
fillable PDF your firm already has, a court form, an agency form, your own intake sheet. So "forms
versus templates" is not a boundary the data has, and a Forms destination holding court forms while a
Documents one held templates would be two screens over one table, two vocabularies for one version
ladder, and a reader who must know which kind a file is before knowing which screen holds it.

**The permission registry had already drawn the boundary that is real, and it is a different one.**
`templates:manage` binds `resource: "firm"` and is described as administrative — register, version
and archive. `documents:assemble` binds `resource: "matter"`, and listing the catalogue is
deliberately bound to it rather than to a third read key, because a member who can assemble must be
able to see what they can assemble. The platform distinguishes **holding** a catalogue from **using**
one. It has never distinguished a form from a template, and nothing in the registry is called
`forms:*`. Whatever the interface decides, it inherits a two-way split, not a three-way one.

**The act the destination existed to host already had a home.** Assembling a document from a template
is live on the matter's Add a Document dialog, which reads the real catalogue and files the output
onto the matter. A verb does not earn a destination, and this one lands its result on a matter, which
is where it belongs.

**Not renaming the client-facing thing instead.** The alternative was to keep Forms on automation and
call the client-facing surface Intake Forms or Questionnaires. It was rejected because it spends the
plainest word in the product on the narrower meaning: a client who fills something in has filled in a
form, in every firm in the country, and the intake procedure had already reached for that word
unprompted.

**Consequences:** The destination keeps its id, its label and its route and changes what it is for;
nothing is built behind it yet, and it stays announced-not-shipped until the public intake form or
the portal's client forms land. The template library — the administrative half of the split above,
which today has no screen at all and is reached only through `/api/v1/templates` — is a documents
surface when it is built, and the curated court-form library lands there as templates of a kind
rather than as a separate shelf.

The one screen that moved is the field-input scaffold formerly at `/forms/assemble`. It went to the
developer console rather than to a new product route or to deletion, because a third finding surfaced
while executing this decision: **the capability it draws does not exist.** The live assembly path
merges from matter data alone, and no supplied value is accepted by the request body, the engine, or
the schema — a field the matter cannot answer becomes an absence in the finished document. The
scaffold was never a duplicate of a live act; it is the design of an unbuilt one, and the developer
console is where a reviewable state real data cannot reach belongs. Assembling with values a person
supplies is now recorded as an open gap in the feature ledger rather than implied by a screen.
