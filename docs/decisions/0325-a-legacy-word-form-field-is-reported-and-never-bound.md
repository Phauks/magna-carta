---
number: 325
slug: a-legacy-word-form-field-is-reported-and-never-bound
status: Proposed
date: 2026-08-14
area: Document automation
summary: "A legacy Word form field — a w:fldChar complex field whose instruction is FORMTEXT, FORMCHECKBOX, or FORMDROPDOWN and which carries a w:ffData block — is detected at template registration, recorded on the field manifest as its own legacyFormFields list, and never bound or converted. Before this it contributed no merge key at all and nothing reported its absence, so a template built entirely from them (the appellate court forms, and a great deal of legacy firm precedent) registered clean, declared no keys, warned only no-placeholders — 'every assembly of it produces the same document' — and filed carrying the form's own 'Click here to enter caption'. The reporting half follows the unconverted-MERGEFIELD precedent exactly: recorded rather than refused, because an unregisterable template is one nobody can inspect, and surfaced at registration, in the field list, and by every assembly, which lands on succeeded_with_absences. The conversion half is refused on the engine's existing name-guessing rule with worse evidence than that rule already turns down: a MERGEFIELD carries a name the firm chose and can confirm through the field-mapping library, while a form field carries a Word-minted bookmark (Text1) beside a sentence of help text, so a derived merge key would be a silent binding decision on privileged content inferred from an identifier nobody chose. The list is kept separate from unconvertedMergeFields rather than widened into it, because blending them would offer 'register again asking for conversion' as the remedy for a construct conversion does not answer. Whether the product should ever offer such a conversion is left open as an owner decision, and w:documentProtection surviving the metadata scrub is recorded as a related, unfixed surprise."
---

**A construct the engine cannot bind is a fact the template's registration has to state. Reporting it
is not optional; converting it would be a guess, and the two halves are decided separately.**

**Context:** the normalization pass reads Word's field constructs to find authoring forms it can turn
into the canonical `{{key}}` placeholder. `mergeFieldNameOf` matched `MERGEFIELD` and returned nothing
for every other instruction — correct for `PAGE`, `DATE`, `TOC` and the rest, which are Word's own
fields, render correctly on their own, and need no merge value.

A legacy form field is not one of those. It is a blank: Word's own fill-in-the-blank machinery, a
`begin` fldChar carrying a `w:ffData` block, a `FORMTEXT` / `FORMCHECKBOX` / `FORMDROPDOWN`
instruction, and a cached result that is the field's placeholder prompt rather than a value. Nevada's
appellate court forms are built entirely from them; so is a great deal of firm precedent that predates
mail merge. Where an unconverted `MERGEFIELD` at least renders a stale value that once meant
something, one of these renders `Click here to enter caption` or `enter name of party/parties
appealing` — the author's instruction to a human, filed as if it were content.

The absence model had no view of it. `unconvertedMergeFields` carries what the `MERGEFIELD` pass
looked at and rejected, so a construct that pass never looked at produced no entry. The result was
worse than silence: with no fields, no blocks, and no unconverted merge fields, the pass reached its
`no-placeholders` warning and told the firm "the template carries no merge fields, so every assembly
of it produces the same document" — a template full of holes described as a static document.

**Decision, first half — report, on the terms already established.** The pass detects the construct
and records one manifest entry per field per part: the `w:ffData` bookmark name, the kind, the
occurrence count, the author's status-bar prompt, and the text the document prints there today.
Registration warns naming the fields and what they print; the version's field list carries them; every
assembly reports them and completes `succeeded_with_absences`, exactly as an unconverted merge field
does. `no-placeholders` is suppressed when a template has them, because it is the single most
misleading sentence available about such a template. They ride the refusal path too, so a registration
rejected for an unrelated authoring mistake still names the fields nothing will bind.

Recorded rather than refused, for the reason already settled for `MERGEFIELD`: refusing keeps the
failure out of the product at the price of keeping the template out too, and an unregisterable
template is one nobody can inspect. The failure a refusal would guard against is one the manifest can
see.

**Decision, second half — do not convert, and do not treat that as a gap.** The engine never guesses
what a Word field name means. That rule was written for a case with better evidence than this one: a
`MERGEFIELD` carries a name a firm's own author typed, and the field-mapping library exists precisely
so a human confirms once what `ClientName` means and the firm reuses the answer. A legacy form field
carries a bookmark Word minted (`Text1`, `Check1`, `Dropdown1`) that authors almost never rename, and
beside it a sentence of prose help text. Deriving `client.displayName` from either is a silent binding
decision on privileged content taken from an identifier nobody chose. So there is no third opt-in
beside `convertMergeFields` and `stripMacros`, and the remedy the warning names is the honest one:
replace the field in Word with a `{{field}}`, choosing the merge field it should have been.

**A separate manifest list, not a widened one.** `UnconvertedMergeField` and `LegacyFormField` describe
different decisions for the reader. One says "this can be bound; register again asking for conversion,
or edit the document". The other says "this cannot be bound by anything; edit the document". Widening
the first shape to hold the second — a `form` variant, an empty `mappedKey`, `mapsToKnownField:
false` — would put a form field in front of the conversion offer and in front of the field-mapping
library, both of which would then be answering about a construct they do not handle.

**Consequences.** The manifest, the registration response, the version field-list response, and the
assembly provenance row each gain the list; a manifest stored before this reads it as empty, which is
correct only in the sense that those versions are immutable — a template registered before today has
to be registered again to be reported on. The assembly's `frozen_field_names` column now holds both
classes, labelled, because "how many holes does this document have" has to mean all of them.

**Left open, deliberately.** Whether the product should ever offer a form-field conversion — deriving a
candidate key from the bookmark or the help text and asking a human to confirm it, the way the
field-mapping library already works for names — is an owner decision. It is buildable on this
reporting: the entry already carries every fact such a prompt would show. It is not built, and it is
not a flag: a switch whose off state is the only tested one is not a decision taken, it is a decision
hidden.

**Named and not fixed.** `w:documentProtection` survives the metadata scrub — the scrub rewrites
`word/settings.xml` only to drop the mail-merge configuration, the attached-template reference, the
document variables, and the revision identifiers. Word writes a `w:documentProtection` element
declaring `w:edit="forms"` with enforcement on when a form is protected, so it arrives with exactly these templates and every
document assembled from one opens edit-restricted. Clearing a firm's own protection setting is a
rewrite of their document and wants the same opt-in reasoning the macro strip got, so it is recorded
in `packages/document-assembly/CLAUDE.md` rather than changed here.
