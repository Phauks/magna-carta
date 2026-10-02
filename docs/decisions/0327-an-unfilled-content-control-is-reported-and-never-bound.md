---
number: 327
slug: an-unfilled-content-control-is-reported-and-never-bound
status: Proposed
date: 2026-08-15
area: Document automation
summary: "A content control (w:sdt) that the document itself declares unfilled — one whose properties carry w:showingPlcHdr, or one carrying w:dataBinding — is detected at template registration, recorded on the field manifest as its own unboundContentControls list, and never bound or converted. Before this nothing in the package looked at w:sdt at all, so a template whose blanks are content controls registered clean, declared no keys, warned only no-placeholders — 'every assembly of it produces the same document' — and assembled into a document printing 'Click here to enter text.' with zero absences reported. The reporting half follows the legacy-form-field precedent exactly and reaches the same five surfaces: registration warning, no-placeholders suppression, the version field list, the refusal, and every assembly, which lands on succeeded_with_absences with the control named in frozen_field_names. The conversion half reaches the same answer on a DIFFERENT argument, which is the thing this decision settles that the form-field one did not: a content control carries w:alias and w:tag, names an author typed rather than a Word-minted Text1, so the objection is not the quality of the evidence — it is that a name means something only once a human has confirmed it through the field-mapping library, and that every rewrite of a firm's uploaded document here is opt-in. A control that is neither placeholder-showing nor data-bound is deliberately silent, because Word wraps ordinary content in controls constantly and a filled one is content. The list is a third one rather than a widening of the form-field list, because the two constructs stand for different futures: one is dead and replaced, the other is what this engine intends to bind. An opt-in that maps an alias through the mapping library is left open as an owner decision."
---

**The construct Word writes today for a blank had no reader at all, so a template made entirely of
blanks was described as a static document. Reporting it is settled by precedent; refusing to convert
it needed a different argument than the one the precedent used, because the evidence is better here.**

**Context:** three Word constructs bind a blank, and the engine had a reader for two. A `{{key}}`
placeholder is the canonical form. A `MERGEFIELD` is detected always and converted on an explicit
opt-in. A legacy form field is detected and reported and never bound. The fourth — a **content
control**, `w:sdt`, with its properties in `w:sdtPr` — is the one Word actually produces when an
author inserts a blank in a document written this year, and nothing in `packages/document-assembly`
looked at `w:sdt`.

The measured behaviour before this change, from a `.docx` carrying one placeholder-showing plain-text
control and nothing else: registration succeeded, the manifest recorded no fields, no unconverted
merge fields and no form fields, and the single warning was `no-placeholders` — "The template carries
no merge fields, so every assembly of it produces the same document." That is byte-identical to the
warning a genuinely static document gets, and it is a false statement about a template that is
nothing but a blank. The assembly then succeeded with **zero absences** and produced a document whose
visible text was `Click here to enter text.` That is worse than the registration warning, and it is
the outcome that matters: the merge itself cannot see a hole it was never asked to fill, so the
manifest entry is the only thing between a firm and filing a form's own prompt.

**Decision, first half — report, on the terms already established.** The pass records one manifest
entry per control per part: the alias, the tag, the kind, the occurrence count, which of the two
unfilled states it is in, and the text the document prints there today. It reaches every surface the
legacy form fields reach — registration warns naming each control and what it prints, `no-placeholders`
is suppressed for a template that has any, the version's field list carries them, they ride the
refusal, and every assembly reports them in `frozen_field_names` and completes
`succeeded_with_absences`. Recorded rather than refused, for the reason already settled twice: an
unregisterable template is one nobody can inspect.

**What counts as unfilled is what the document says, not what the reader guesses.** Two properties
qualify a control, and one of them is true of every recorded entry:

- **`w:showingPlcHdr`** — Word's own record that what a reader sees is the control's placeholder
  prompt rather than content. Its content text is therefore both the prompt and the printed text, which
  is why the entry has one string where a legacy form field has two: a form field's status-bar prompt
  and its printed result are separate, and a control's are the same words.
- **`w:dataBinding`** — the control's content is refreshed from a custom XML part in the package.
  Nothing in this engine writes such a part, and registration's own metadata scrub removes them
  outright, because they typically hold a document-management system's client and matter record. So the
  control has no source left at all and prints what the document the template was made from last put
  there. That is the unconverted-`MERGEFIELD` failure in a construct that does not look like a field,
  and it is the shape a template exported from another document-automation product takes.

**A control that is neither is deliberately silent, and getting this wrong in the noisy direction
would have been worse than the defect.** Word wraps ordinary content in content controls constantly —
a cover page, a citation, a bibliography, anything built from one of its own templates — and a filled
control prints text an author typed, which is content and not a hole. A warning that every ordinary
template earns is a warning every firm learns to skip past, which would cost the two states above the
attention they exist to get.

**Decision, second half — do not convert, on an argument the form-field decision did not make.** That
decision rested partly on evidence: a `MERGEFIELD` carries a name the firm's own author typed, while a
form field carries a bookmark Word minted (`Text1`) that authors almost never rename, so a derived
merge key would come from an identifier nobody chose. **That leg does not transfer.** `w:alias` is the
title an author types in Word's properties dialog and `w:tag` is the machine-facing name beside it;
nothing mints either, and a control carrying neither reports both empty rather than reporting a
generated one. An alias reading `Client Name` is exactly the kind of evidence the field-mapping
library was built to work on.

The refusal therefore rests on the two reasons that do not depend on evidence quality, and they are
sufficient on their own:

1. **A name means something only once a human has confirmed it.** The mapping library exists precisely
   so an administrator says once what `ClientName` means and the firm reuses the answer. No
   confirmation has happened for an alias read out of an uploaded document, and binding
   `client.displayName` to it because it looked close is the silent binding decision on privileged
   content the engine refuses everywhere else. The evidence being good is an argument for offering the
   confirmation, not for skipping it.
2. **Every rewrite of a firm's uploaded document is opt-in, without exception** —
   `convertMergeFields`, `stripMacros`, and nothing else. A third opt-in is a product decision with a
   remedy to design and a screen to put it on, not a default a detection pass may take on its own.

So the remedy the warning names is the honest one available today: replace the control in Word with a
`{{field}}` naming the merge field it should have been.

**A third manifest list, not a widened second one.** `LegacyFormField` and `UnboundContentControl`
describe different futures as well as different repairs. A legacy form field is a dead construct whose
only answer is replacement. A content control is what Word produces today, and the binding this engine
already names as its intended placeholder form once a browser authoring surface can emit one — so its
entry is also the evidence a future binding would be built on. Their kind vocabularies do not overlap
either: `text | checkbox | dropDown` against fifteen `w:sdtPr` type elements. Folding them together
would put a control in front of a report whose whole framing is "this construct is finished".

**One entry shape covers every control type, with the kind as a field.** The kind is what tells a
person which merge field the control should have been — a date picker wants a date-typed field, a
drop-down wants one of a listed set, and a picture control wants something the merge engine has no
text field for at all — so it is reported rather than flattened. It is read from the type element's
**local name**, because a check box is `w14:checkbox` and a repeating section is
`w15:repeatingSection`, from Word's later extension namespaces, and keying on a prefix would silently
miss both. A control declaring no type element at all is reported as `unspecified` rather than as the
rich-text control it conventionally is: what the document states, never what it probably means. A
repeating section's ITEM wrapper is not recorded — it is the container a repeat puts around each copy
of its body, so recording it would report one hole per iteration of holes already named inside it.

**Consequences.** The manifest, the registration response, the version field-list response, the
registration refusal, and the assembly provenance row each gain the list; a manifest stored before
this reads it as empty, which is correct only in the sense that template versions are immutable — a
template registered before today has to be registered again to be reported on. `frozen_field_names`
now holds three classes, each labelled, because "how many holes does this document have" has to mean
all of them. A `{{key}}` written INSIDE a content control keeps working exactly as one outside it
does, and now has a test saying so: both walks recurse through `w:sdtContent` like any other element,
which is what makes a control transparent to substitution rather than a second placeholder syntax.

**Fixed in passing.** The legacy-form-field decision states that those fields "ride the refusal path
too", and on the package's result they did — but the worker's registration route never put them in the
problem response, so a refused registration told the firm nothing about them. Both lists are now in
the refusal's field-error list, which is what makes that sentence true at the surface a person reads.

**Left open, deliberately.** An opt-in that derives a candidate merge key from a control's alias or
tag and asks a human to confirm it — the field-mapping library's existing flow, pointed at a different
construct — is an owner decision. It is buildable on this reporting and on nothing else new. It is not
built, and it is not a flag: a switch whose off state is the only tested one is a decision hidden
rather than taken.
