---
category: Added
---

**Design spec and implementation plan for document automation (slice 2·6).** The last unbuilt
promise in Phase 2 now has an implementation-grade design. A template is a `.docx` stored in per-firm
R2 and catalogued in per-firm D1, versioned exactly like a file — immutable versions, content hash,
the same quarantine status gate, the same supersede-to-Infrequent-Access tiering — so an assembled
document can always name the exact template version that produced it. Placeholders are `{{key}}` text
delimiters (Word `MERGEFIELD` constructs are recognized as an equivalent authoring form), and the
fiddly half of DOCX templating — finding a placeholder Word split across five runs — is paid **once,
at template registration**, not on every assembly: registration normalizes each placeholder into one
contiguous run, records a field manifest, refuses macro-bearing packages, and scrubs the template's
authoring history so no tracked change or comment can propagate into a filed document.

Merge fields resolve through a declarative data dictionary over matter, Locations, firm, Directory
party, and custom-field sources, with one hard rule stated as a test rather than a convention: a
merge field never issues a query, so a 150-field template costs the same reads as a four-field one.
Custom fields bind by handle, never by name — the property the custom-fields engine was built to have
— and the reciprocal obligation slice 1·4 deferred is taken up here: the custom-field hard-delete
guard gains its template-binding arm. Location fields resolve from **the matter's** home office, so a
document assembled by one office on another's matter carries the correct letterhead and remit-to.
Money renders from `amount_minor` by moving a decimal point, never by multiplying; a merge field bound
to a `protected()` value resolves only through the decrypt-permission-plus-audit chokepoint and fails
by name rather than emitting a blank.

The assembly engine is built in-house in TypeScript over `fflate` and `fast-xml-parser` — the same
substrate the metadata inspector and scrubber already use to rewrite OOXML safely — and runs in a
Worker queue consumer behind a `DocumentAssemblyJob` Durable Object. docxtemplater's MIT core was the
real alternative and is recorded as a scoped fallback behind the same port; it was declined because it
would bring a second zip stack beside `fflate`, because image insertion (the letterhead logo, next
slice) sits behind a paid module, and because its richer expressions are evaluated from template
content — where this design deliberately keeps the expression language non-executable, so a
firm-authored `.docx` can never become an execution surface. Driving the consented LibreOffice
container's mail merge was rejected outright: it is the only memory-unsafe route and would push party
names, settlement amounts, and decrypted identifiers through the one C++ dependency, for no fidelity
gain when input and output are both `.docx`. LibreOffice keeps exactly the job the conversion design
gave it, DOCX to PDF.

The assembled document enters the **normal ingest chokepoint, scan included, with no bypass** — the
moment there are two ways for a version to reach `clean`, the invariant that every file read filters
on status stops being enforceable by construction. Absence is a declared decision per field
(`blank` / `placeholder` / `fail`, defaulting to a visible placeholder) because a blank where a party
name should be, filed without anyone noticing, is the failure mode that matters. Resolved merge values
live in memory for the life of the job and are never persisted, logged, or placed on a queue; the
provenance row stores which keys were absent, never what the present ones held.

Nine owner decisions are flagged, including the placeholder syntax (user-visible, and a migration to
change later), court-form and clause-library scope, the expression ceiling that separates a template
a paralegal maintains from one that needs a developer, and whether merge fields may bind to protected
identifiers at all.

Specs: `docs/specs/2026-08-04-document-automation-design.md` and
`docs/specs/2026-08-04-document-automation-implementation-plan.md`. Decisions:
`docs/decisions/pending/document-automation-assembly-engine.md` and
`docs/decisions/pending/document-automation-template-model.md`.
