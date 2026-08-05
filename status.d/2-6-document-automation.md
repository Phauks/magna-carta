---
slice: 2·6 — Document automation
group: phase-2
order: 6
research: done by="Opus 4.8"
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: todo
load-profile: done by="Opus 4.8"
tested: done by="Opus 4.8"
next: PDF output and the signature hand-off (2·6·3), a location time-zone column behind timeZoneForLocation, a firm currency setting behind ResolutionInput.currencyCode, and the office-settings UI for the letterhead logo.
link-spec: docs/specs/2026-08-04-template-expression-language-design.md
link-plan: docs/specs/2026-08-04-document-automation-implementation-plan.md
adrs: ADR-0210, ADR-0211, ADR-0217, ADR-0218, ADR-template-expression-realization, ADR-document-automation-directory-role-sources, ADR-document-automation-protected-value-binding
blocked-by:
---

Build slice 2·6·1 shipped: the walking slice, template registration through to a filed document.
`@magna-carta/document-assembly` is a pure package over `fflate` + `fast-xml-parser` (the
`@magna-carta/metadata` substrate) holding the guarded OOXML reader/writer, the macro stripper and its
independent re-verification gate, the normalization pass, the declarative merge-field dictionary and
its formatters, the batched resolution pipeline, and the substitution engine. Four per-firm tables
(`document_template`, immutable `document_template_version`, `document_template_field_mapping`,
`document_assembly`), nine catalogue routes plus submit/poll, a `DocumentAssemblyJob` Durable Object
over a dedicated queue, and the assembled document filed through `initiateUpload` /
`completeUploadSession` — the one ingest chokepoint, no bypass. Owner decisions taken: `{{key}}` is
the single stored placeholder form, and the merge is in-house rather than an adopted library.

Both registration transforms of the firm's own document are **opt-in and always reported**, revised
on 2026-08-04 evening. Converting Word merge fields runs only on request, and a template registered
without it keeps them — each recorded on the field manifest with the part it sits in and the frozen
cached text it will print, reported again by every assembly in the response and on the provenance row,
and landing the assembly on `succeeded_with_absences`, so a blank that does not look like a blank
meets the same absence model an ordinary missing value does. Removing macros likewise runs only on
request; a macro-bearing upload without the opt-in is refused with both remedies named, never stored
carrying live macros and never stripped silently. The per-firm **field-mapping library** behind
`MergeFieldNameResolver` is built: confirmed Word-name-to-key mappings written when a conversion
confirms them, read once per registration, listed and deletable under `templates:manage`.

Build slice 2·6·2 shipped the **template expression language** and the three constructs written in it.
`src/expression/` is an OOXML-free folder — `limits.ts`, `errors.ts`, `lex.ts`, `parse.ts`,
`catalog.ts`, `check.ts`, `evaluate.ts` — holding one lexer, one recursive-descent parser over a closed
grammar, one static checker, and one total evaluator, so the language was proven as a language before it
met a package. A merge key is ONE lexical atom resolved by exact match through a `Map`, there is no
production for property traversal, indexing, assignment, a lambda, a regular expression, or a call to
anything but a frozen helper allowlist, and nothing in the folder throws. Lex, parse, name-resolve,
type-check, format-check, and limit-check all run at REGISTRATION, so a type error is a registration
failure with a part, an excerpt, and a character offset inside the expression — never an assembly
surprise. The manifest stores each block's and computed field's SOURCE rather than a tree, and assembly
re-checks from it, which is what catches dictionary drift.

`{{#if}}` / `{{#unless}}` / `{{#each}}` / `{{= }}` operate on whole paragraphs and whole table rows —
a marker in a row's first cell makes the row the unit — so list numbering and table banding survive a
removed or a repeated unit, and every repeat clone carries its own paragraph and row properties. Money
arithmetic is integer-exact through `@magna-carta/money`, with every intermediate checked before the
operation so the package's own guard is unreachable; division is not an operator, and `divideExact`,
`divideRounded`, `applyRate`, `percentOf`, and `allocate` each state their rounding. Owner-flagged
defaults applied as recommended: an unresolved condition FAILS the assembly naming the field (G1),
banker's rounding only (G2), no business-day math (G3), no pronoun helper (G5). G4 was answered the
following day the other way: `sum`, `minimum`, and `maximum` fold a LITERAL FIELD PATH of a list-valued
key, bounded by exactly what a repeat is bounded by — one batched read, the items-per-repeat cap, a
step per element — with an empty collection left unresolved rather than answered zero, because a
smallest of nothing has no answer and a total of no amounts has no currency. `matter.parties` is the
first list-valued source, one batched read for the whole collection.

The security claim carries its fuzz obligation in the slice: a seeded structure-aware generator over
the grammar, a seeded byte-level generator, a committed denied-construct corpus that must fail at parse
or check and never at evaluation, a pretty-print-and-reparse property (which found a real precedence
bug), an independent BigInt arithmetic oracle, and one bound-hitting test per declared limit.

The **custom-field merge bindings and the letterhead logo** shipped next. A firm's own matter-axis
fields enter the dictionary at read time as `custom.<customField_ handle>` entries derived from
`custom_field` — bound by handle and never by name, so a rename breaks nothing — with the catalogue
read once (`readCustomFieldCatalog`) and shared by registration, the field-list surface, and assembly,
which is what makes drift detectable rather than silent: an archived field contributes no entry, so a
template bound to it fails naming the key, and a stored value behind an archived field is skipped and
reported as an absence. Values resolve through one statement covering every handle, joining the
picklist option's label and the referenced record's display name rather than fetching either per value.
`effectiveNumberScale` is REUSED from `@magna-carta/custom-fields` rather than restated, so the same
stored `500` is five hundred on a number field and five dollars on a currency field, and a currency
field with a non-currency scale renders as the exact decimal it is instead of as wrong-looking money.
The hard-delete guard gained its template-binding arm: a field a template manifest names is
`field-in-use` and routes to Archive, with `document_template_version` referenced by string so the
sibling packages stay independent. `custom.customField_…` also lexes as ONE atom in the expression
language — a handle's alphabet includes the hyphen, which is also subtraction, so the atom is matched by
its exact fixed length and no author's spacing can decide which it is.

The **letterhead logo** is the engine's first image work, and answers the design's open question 3:
**the asset declares the box**. `location` gained the logo columns (object key, sniffed content type,
size, hash, intrinsic pixels, printed width in EMU); only a width is stored, so the height follows from
the intrinsic aspect ratio and no document can print a stretched mark. `PUT`/`DELETE
/api/v1/locations/{id}/letterhead-logo` take the image inline (a firm's mark is tens of kilobytes, and
one request is the only shape where reading what the bytes are, measuring them, and writing the row
that points at them happen together). `src/ooxml/image.ts` emits all four halves of a picture — the
part, the `[Content_Types].xml` Default, the relationship on the drawing part (ids allocated per part,
by scanning the ids present), and the inline `w:drawing` with every namespace bound on the element that
uses it — and `packageIntegrityViolations` now proves each one over the emitted bytes, because a
document whose words are right and whose picture wiring is not is a document no reader opens and no
text assertion catches. **Image-format policy: PNG and JPEG only, decided by magic bytes rather than by
a declared content type**, enforced at the write and re-checked at assembly; SVG, EMF/WMF, GIF, BMP and
TIFF are refused with the reasoning recorded. An office with no logo, or one whose object has gone,
assembles with a visible marker.

The **load-profile volume profile** deferred by all three build slices is now in the harness. A
`documentAutomation` volume lays down the firm's template catalogue with its immutable version history,
an archived tail, the confirmed Word-name-to-merge-key mapping library, and the assembly provenance
rows — every write through the real composed effects, never a raw insert — plus, on one probe matter
deliberately chosen NOT to be the custom-field measurements' own probe, the merge-context hot case: the
firm's own matter-axis fields with current values, and a full party list. At the committed baseline
that is 181 templates over 479 versions with 27 archived, 1,605 assemblies, 120 mapping rows, and a
probe matter carrying 40 custom-field values and 13 party links.

The four measured operations the design names are on the clock: the catalogue list taken at a real
keyset boundary rather than at the head of the table, the one-read current-version resolve every job
starts with, the whole batched merge context for the widest template the firm's dictionary can offer,
and the custom-field manifest read the dictionary is derived from. **Every hot-path plan is an index
walk — the scan allowlist for this set is empty.** The read the design flagged as the likely table-wide
exception, the firm's field catalogue, walks `custom_field_scope_index` instead. What the merge-context
measurement is really for is the batching rule: its cost tracks the number of SOURCES, not the number
of fields, so a per-field resolver reintroduced later shows up as a curve rather than as a code review.

The declared-field count per template version is bounded by the dictionary rather than by the profile:
a manifest field is keyed by its merge key, so the probe template declares every key the firm has for
that matter — every platform key the dictionary carries (17 at the time it was laid down, 29 once the
Directory role sources landed) plus its 40 custom bindings. The number the batching rule is about is the
40-handle bound-parameter list of the one value statement, and that is the parameter the profile carries;
the platform half widens whenever the dictionary does, without moving the read count.

The **Directory role sources** shipped next, closing the first of the two named seams. Four
platform-declared roles — `opposingParty`, `opposingCounsel`, `guardian`, `witness` — each contribute a
name, a person-or-organisation kind, and a `<role>.all` collection, so a caption names the opposing party
the way it already names the client and a repeat lists them all. The set is PLATFORM-DECLARED rather than
derived from the firm's `directory_party_role` catalogue: a custom field binds by a minted handle
precisely because its name is firm-typed text, and a role has no handle — only the words a firm typed,
which neither lex as one atom nor get typed from memory. Matching is by normalization instead, both sides
lowercased with every non-alphanumeric character removed, so `opposing_party`, `Opposing Party`, and
`opposing-party` are one role and no two shipped sources may normalize alike (a fitness test, not care).
**Ambiguity is an answer:** a matter linking three opposing parties resolves the singular keys to nothing
and says there were three, rather than taking the first by created-at — a document naming the wrong
defendant is the mistake nobody catches by reading it. The reason rides a new `absenceReasons` channel on
the merge context through to `AssemblyAbsence.reason` and into the failure text of a condition that could
not be worked out, and is deliberately NOT persisted: the provenance row records absent KEYS, and a count
of a matter's parties is the matter's data. No new read — every role is derived from the party collection
the merge context already fetched, so a template naming four roles costs what one naming none did, and
the four measured plans are untouched index walks.

**Protected-value binding** closed the second named seam, and closed it by extending the existing decrypt
path rather than by building beside it. The client's sealed Directory identifiers — Social Security
number, Employer Identification Number, date of birth, driver's license number, account number, and
SSN-last-four — are dictionary entries carrying `sensitivity: protected`, which is the ROUTING decision
and not a label: they resolve through an injected reader wired to the directory's `readIdentifier`, which
is `readProtected` — permission gate, decrypt-audit row committed before any plaintext, AAD-bound
decrypt, inseparable. `@magna-carta/document-assembly` names no ciphertext column, derives no key, and
decrypts nothing; the refusal it turns into an absence is the chokepoint's own
`ProtectedReadForbiddenError`, caught by identity so the gate is never restated. **No assembly-specific
audit shape:** the same `protected.decrypt` event, the same subject (the identifier row the AAD binds
to), the same table a direct read writes — recorded as an ADR, since the alternative was a second reason
code and a firm's "who saw this value" answer split across two shapes.

**A member without the permission gets the document.** The field lands on the absence model with a reason
naming the field and the permission, the draft shows the usual visible marker, and the assembly completes
`succeeded_with_absences`; nothing is thrown, and the plaintext exists nowhere on that path. Permissions
are RE-DERIVED when the job runs rather than carried on the queue message, so a revoked grant bites — the
message carries an identity, never a decided answer — and the read is deferred to the first protected key,
so an ordinary template pays nothing. The decrypt count is bounded by the manifest rather than batched
(each ciphertext is bound to its own row and commits its own audit record, so a bulk form would have to
bypass the chokepoint to exist): one decrypt per protected key the manifest names, deduplicated, and a
refusal costs exactly one attempt. The subject rides the party read that already happens; a matter linking
no single client decrypts nothing and says how many it links. Both field-list surfaces now carry an
entry's sensitivity, so an author sees what a template has bound before anything is assembled —
registration itself is unrestricted, because binding names a key, not a value.

A firm declaring one of its OWN fields protected is a separate decision and not this one: it needs a
column on `custom_field` and a ciphertext column on `custom_field_value` that do not exist, and the
derivation in `custom-field-bindings.ts` is the one line that reads the declaration once they do.

Remaining for the subsystem: PDF output and the signature hand-off (2·6·3), authoring surfaces (2·6·4),
the office-settings UI for the logo, and the interface seams.
