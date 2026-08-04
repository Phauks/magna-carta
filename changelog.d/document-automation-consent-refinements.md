---
category: Changed
---

**Document automation — registering a template asks before it rewrites, and remembers what you tell
it.** Three changes to how a `.docx` becomes a template.

**A document built from Word mail merge now registers.** It used to be refused until you asked for its
merge fields to be converted. Now it registers as authored, and every Word merge field in it is
recorded against the template — its name, where in the document it sits, and **the text it will
actually print**, which is whatever Word last cached in the field. The field list shows them, and
every document you assemble from that template reports them again and completes as needing review, so
a field printing text left over from the template is visible in the same place a missing value is
rather than looking finished. Converting is still opt-in, and still the way to make those fields fill
in.

**Macros are now removed only when you ask.** Before, a macro project was stripped out of any upload
that had one. Removing it changes the document you sent us, so it is now a choice you make:
`stripMacros` on the registration request removes the macro project and re-checks the result from
scratch, and an upload carrying macros without it is refused with what was found and both ways
through — ask for the removal, or upload a macro-free copy. A template is never stored carrying live
macros, and never quietly rewritten.

**Your firm's merge-field names are remembered between imports.** Confirming what a Word field name
means — by converting a template that uses it — records the mapping, and every later registration
consults it, so importing a second document from the same source arrives already mapped instead of
asking again. Nothing is ever mapped by guessing: a name your firm has not confirmed is reported as
unmapped. The library is visible and editable at `GET /api/v1/merge-field-mappings` and
`DELETE /api/v1/merge-field-mappings/{mappingId}`, both under **manage templates**.

An assembly's status now carries `frozenMergeFieldNames` beside `absentFieldKeys`, and the
registration response carries `unconvertedMergeFields`, `confirmedFieldMappings`, and `macrosStripped`.
