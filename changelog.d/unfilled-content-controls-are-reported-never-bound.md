---
category: Fixed
audience: public
---

**A template whose blanks are Word content controls now says so at registration, instead of
registering clean and filing the control's own prompt.** A `w:sdt` region whose properties carry
`w:showingPlcHdr` is a control displaying its unfilled placeholder — the construct Word produces
today wherever an author inserts a blank — and nothing in `packages/document-assembly` looked at
`w:sdt` at all. So a `.docx` carrying one and nothing else registered with no failures, no fields, no
unconverted merge fields, no form fields, and one warning: `no-placeholders`, whose text is "the
template carries no merge fields, so every assembly of it produces the same document". That is
byte-identical to what a genuinely static document gets, and it is the opposite of true. The assembly
then completed with **zero absences** and produced a document whose visible text was `Click here to
enter text.`

The normalization pass now walks the `w:sdt` regions and records each unfilled one on the field
manifest as `unboundContentControls` — the author's `w:alias` and `w:tag`, the control's kind, the
part, the occurrence count, which unfilled state it is in, and the text the document prints there
today. Registration warns naming each control and what it prints, `no-placeholders` is suppressed for
a template that has any, the version's field list carries them, they ride the refusal, and every
assembly reports them in `frozen_field_names` and lands on `succeeded_with_absences`.

**Two states qualify, and a filled control is deliberately silent.** `w:showingPlcHdr` is Word's own
record that a reader is seeing the prompt rather than content; `w:dataBinding` means the control is
refreshed from a custom XML part inside the package that nothing here writes, so it prints whatever
the document the template was made from last put there. A control that is neither holds text an
author typed, which is content and not a hole — and Word wraps ordinary content in controls
constantly, so warning on those would put a finding on every ordinary template and teach a firm to
skip past all of them.

**Nothing converts one, and the argument is a step different from the legacy form field's.** That
decision leaned partly on the evidence being poor: a form field's only name is a Word-minted `Text1`.
A content control's alias and tag are typed by whoever authored the document, so that leg does not
transfer, and it is recorded rather than glossed. What stands on its own is that a name means
something only once a human has confirmed it through the field-mapping library, and that every
rewrite of a firm's uploaded document here is opt-in. An opt-in that maps an alias through that
library is buildable on exactly what is now recorded, and is left open as an owner decision.

Kept as a third manifest list rather than folded into the legacy form fields: that construct is dead
and its only answer is replacement, while a content control is what Word writes today and the binding
this engine intends to grow into, so its entry is also the evidence a future binding would use. A
`{{field}}` written INSIDE a content control keeps working exactly as one outside it does, and now
has a test saying so.

**Also fixed:** a refused registration now names the fields nothing binds, in the response a person
reads. Both the legacy form fields and the unfilled content controls ride the refusal's field-error
list, so a template rejected for an authoring mistake somewhere else no longer stays silent about the
rest of its holes until the attempt that finally passes.

## Public

**A template built with Word's content controls now tells you those blanks will not be filled in.**
Registering one lists each control by the name its author gave it and the words the document will
print where it sits — and every document you build from that template reports the same controls and
is marked as needing review before it is filed.

Before this, such a template registered without comment and said it carried nothing to fill in. The
document then came out with the control's own prompt in it, like "Click here to enter text.", and
nothing had warned you.

A control you have filled in is left alone and says nothing, because what it holds is your own text.
Controls cannot be filled in automatically yet, and the system will not guess what one was meant to
mean from its name. To bind one, replace it in Word with a `{{field}}` naming the merge field it
should have been.
