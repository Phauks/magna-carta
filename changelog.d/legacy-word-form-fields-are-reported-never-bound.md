---
category: Fixed
audience: public
---

**A template built from legacy Word form fields now says so at registration, instead of registering
clean and filing the form's own prompts.** A `.docx` whose blanks are `w:fldChar` complex fields with
a `FORMTEXT` / `FORMCHECKBOX` / `FORMDROPDOWN` instruction and a `w:ffData` block — the shape the
appellate court forms and a great deal of legacy firm precedent take — contributed no merge key,
because `mergeFieldNameOf` matched `MERGEFIELD` and nothing else, and `unconvertedMergeFields` only
ever carried what the `MERGEFIELD` pass had looked at and rejected. So the template registered with
no failures, no fields, and one warning: `no-placeholders`, whose text is "the template carries no
merge fields, so every assembly of it produces the same document". That is the exact opposite of
true for such a template, and the assembled document filed carrying `Click here to enter caption`
with nothing anywhere having mentioned it.

The normalization pass now detects the construct and records it on the field manifest as
`legacyFormFields` — the `w:ffData` bookmark name, the field's kind, the part, the occurrence count,
the author's own status-bar prompt, and the text the document prints there today. Registration warns
naming each field and what it prints, the version's field list carries it, the `no-placeholders`
warning is suppressed for a template that has these (it was the most misleading possible thing to
say about one), and every assembly reports them alongside the unconverted merge fields and lands on
`succeeded_with_absences`. A refused registration reports them too, so a template rejected for an
unrelated authoring mistake still names the fields nothing will bind.

**Nothing converts one, and that is the decision rather than a gap.** A `MERGEFIELD` carries a name
the firm chose, which the firm can confirm the meaning of through the field-mapping library. A form
field carries a Word-minted bookmark (`Text1`) and a sentence of help text, so deriving
`client.displayName` from either would be a guess at what a firm's document means, on privileged
content — the same silent binding decision the engine's name-guessing rule already refuses with
better evidence available. The two lists are kept separate on the manifest for the same reason:
blending them would offer "register again asking for conversion" as the remedy for a construct
conversion does not answer.

Two related facts, named and not fixed: `w:documentProtection` survives the metadata scrub, so a
template protected as a Word form registers with its edit restriction intact and every document
assembled from it opens restricted; and whether the product should ever offer a form-field
conversion is an owner decision, not a default this pass may take.

## Public

**A template with Word's old fill-in-the-blank fields now tells you those blanks will not be filled
in.** Registering one lists each field, the prompt its author wrote, and the words the document will
print where it sits — and every document you build from that template reports the same fields and is
marked as needing review before it is filed.

Before this, such a template registered without comment and said it carried nothing to fill in. The
document then came out with the form's own instructions in it, like "Click here to enter caption",
and nothing had warned you.

These fields cannot be filled in automatically, and the system will not guess what one was meant to
mean — the only name Word keeps for such a field is something like "Text1". To bind one, replace it
in Word with a `{{field}}` naming the merge field it should have been.
