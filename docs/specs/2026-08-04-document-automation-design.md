# Document automation — design (slice 2·6)

**Date:** 2026-08-04
**Status:** Design proposed; owner decisions in section 13 are open. No product code in this cycle.
**Scope:** The template catalogue and its storage/version model, the merge-field data dictionary and
its resolution pipeline, the assembly engine and where it runs, the job orchestration, the HTTP
contract, and the path by which an assembled document becomes a filed matter document. Excludes:
the user interface (named as seams only, section 9), court-form curation, a clause library,
questionnaire-driven assembly, and any assembly-time use of the inference port.
**White-paper home:** _Document Automation_, with _Documents_ (versioning, editing, conversion),
_Matters and File Manager_ (the ingest chokepoint), _Locations_ (office identity), _Directory_
(parties and custom fields), and _Core domain_ (matter types) as the surrounding context.
**Governing decisions:** ADR-0011 (document automation as a first-class capability), ADR-0003
(tenancy), ADR-0077 (app-managed versions + `storage_encoding`), ADR-0078 (content hash on write,
storage metering), ADR-0081 (inbound upload + quarantine chokepoint), ADR-0082 (async job artifacts),
ADR-0083 (load-profile accretion), ADR-0084 (`protected()` fields), ADR-0067 (route metadata and the
chokepoint), ADR-0107/ADR-0108 (the custom-fields engine and its lifecycle), ADR-0030 (the conversion
format registry), ADR-0039 (compute placement).
**Decision inputs:** the shipped substrate this design is obliged to reuse — `@magna-carta/metadata`
(the OOXML walker and scrub), `@magna-carta/custom-fields` (handle identity and the
`resolveCustomField` contract the slice 1·4 design fixed for this consumer by name),
`@magna-carta/file-manager` (the version model and the ingest chokepoint), `@magna-carta/conversion`
plus the LibreOffice engine design (`docs/specs/2026-08-04-libreoffice-conversion-engine-design.md`),
`@magna-carta/locations` (letterhead and remit-to), `@magna-carta/signing` (the platform seal), and
`crates/pdf-core`'s AcroForm fill engine. A competitive survey of what document automation means in
practice (Clio Draft, Smokeball, HotDocs, Gavel) informs the capability categories in section 1 and
nothing else.

## Why now

Every input this subsystem consumes is already on `main`, and it is the last unbuilt promise in
Phase 2. The matter shell, Locations with letterhead and remit-to text, the Directory with party
role links, the custom-fields engine, the File Manager version model, the quarantine ingest
pipeline, in-browser editing, and the conversion registry with a `docx→pdf` edge all exist. The
feature ledger records the consequence plainly: `document-automation` is `partial` only because the
AcroForm fill engine shipped under the PDF program, and every other node under it is `not-started`
with the evidence line "no assembly engine, template model, or schema anywhere".

Two specific obligations from earlier slices come due here rather than being invented here. The
slice 1·4 custom-fields design fixed the `resolveCustomField(handle)` contract — a tagged
`active | archived | absent` result — expressly so this engine could **detect at generation time**
that a bound field went away instead of silently emitting a blank, and it deferred the
custom-field hard-delete guard's "template bindings" arm until this consumer existed. The
`@magna-carta/locations` notes carry the matching line: the letterhead logo asset "lands with
document generation". This slice is where both land.

## 1. What ships first, and what does not

The competitive category is wide — template libraries, merge fields bound to matter and contact
data, conditional clauses, repeating sections, court forms, clause libraries, client-facing
questionnaires — and the products that cover the wide end (HotDocs, and Knackly behind it) do so by
making template authoring a programming job. That is the failure mode to avoid: a template
language rich enough to need a developer produces a firm-wide dependency on whoever wrote the
templates. The narrower products (Clio Draft, Smokeball) cover merge fields plus conditional
clauses plus pronoun and verb agreement, authored in Word, and that is the shape a firm actually
uses daily.

So the vertical slice is drawn at **a document a firm can file, assembled from a template a
paralegal authored in Word**, and everything richer is a later slice with the seam placed now.

| Slice     | Ships                                                                                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2·6·1** | Template catalogue + versioned template storage, the data dictionary over matter / location / firm / client-party sources, straight substitution, the assembly job, output filed into the matter as a document. |
| **2·6·2** | Conditional blocks and repeating blocks; the dictionary widened to Directory role links, custom fields, and the letterhead logo asset.                                                                          |
| **2·6·3** | PDF output through the existing conversion edge, the e-signature hand-off, and dedicated AcroForm filling for firm-supplied fillable forms.                                                                     |
| **2·6·4** | Template authoring in the browser (the editing subsystem's WOPI host, extended to a template subject) and the assembly preview surface.                                                                         |

**Non-goals, named so they are not re-derived.**

_A questionnaire / client-intake front end._ Gavel's model — a client fills a web form and a
document falls out — is a genuinely different product surface with its own consent, portal, and
assurance questions. It belongs to the client portal and intake phases, and it consumes this
engine rather than replacing it.

_Assembly-time inference._ "Document-automation merge intelligence" is on the roadmap as a slice
2·6 consumer of the inference port, and it stays out of the assembly path entirely. A merge that
sometimes guesses is a merge that cannot be relied on for a filing; the deterministic engine ships
first and any suggestion layer sits **above** it, proposing values a human accepts before assembly
runs.

_Spreadsheet and presentation templates._ No format node for them exists in the conversion
registry either, and the layout questions a spreadsheet raises (print ranges, scaling) have no
defensible silent default. Additive later; blocked by nothing here.

_Notification and email templates._ The Notifications registry owns channel-aware templates. Two
template systems in one product would be a drift generator; this one is for documents that become
files.

_Matter-plan document sequences._ "Open a matter of this type, get these six documents" belongs to
tasks and workflows, which will call this engine's job API once it exists.

_A curated court-form library._ Owner decision F2 (section 13). Nothing in slice 1 assumes one
either way.

**The three-way distinction the roadmap backlog flagged, settled here.** A **template** is an
assembly input: it lives in the template catalogue, it is firm-level, and it is never a matter
document. An **example** or **precedent** document is an ordinary file in the File Manager,
classified by its `document_type` — the mechanism already exists and needs nothing new. A
**firm document** is likewise an ordinary file. Only the first gets a catalogue row, and the
catalogue is deliberately not a second file manager.

## 2. The template model

**A template is a `.docx` file with placeholder semantics, stored in per-firm R2 and catalogued in
per-firm D1.** Not a bespoke document format, not a database of clauses assembled at run time, and
not a rich-text blob in a column. The white paper's reasoning stands unchanged: `.docx` gives
perfect formatting control, and a firm's existing letterhead, pleading captions, numbering schemes,
and court-approved layouts already exist as `.docx`. Any format we invented would begin by throwing
those away.

### 2.1 The placeholder syntax, and why this one

Three authoring surfaces are genuinely available in OOXML.

**Text delimiters — `{{matter.number}}` — chosen.** A paralegal types them. They survive copy and
paste, they are visible in the document, they render identically in Word, Collabora, and any viewer,
and a template that is half-authored is still a readable document. The one real problem is that
Word splits a typed run at arbitrary points — a spellcheck mark, a language change, a revision
identifier — so `{{matter.number}}` is routinely stored as five sibling `w:t` elements with the
braces in different runs than the key.

**Word `MERGEFIELD` fields — accepted as an equivalent authoring form, not the primary.** Firms
that already run Word mail merge have these, and a field is a durable single construct rather than
loose text. But authoring one requires the Insert Field dialog, the field code is invisible until
toggled, and Collabora's handling of complex field runs is a fidelity risk we would be taking on
for every template rather than for the ones that need it. Recognized at registration, normalized
into the same internal representation as a text delimiter, and never emitted by us.

**Content controls (`w:sdt`) — a named seam, deferred.** Structurally the best binding: one XML
element carrying a `w:tag` with the key, immune to run splitting by construction, and rendered as a
real placeholder chip. Two things push it out of slice 1 — Collabora's structured-document-tag
support is uneven enough that a template edited in the browser could lose its controls, and
authoring one in Word is a developer-tab exercise no paralegal will do. When the browser authoring
surface lands (slice 2·6·4) it can emit content controls directly, at which point they become the
_produced_ form while text delimiters stay the _typed_ form.

**The load-bearing move: normalize once at registration, not once per assembly.** Registering a
template version runs a normalization pass that finds every placeholder however it was split,
rewrites each into a single contiguous run carrying the key, records the resulting **field
manifest**, and stores the normalized package as the template version's bytes. Every assembly
thereafter operates on an already-normalized template, so the per-assembly path is a deterministic
substitution over known runs rather than a re-derivation of the hard part.

This is worth more than it looks. The fiddly, failure-prone half of DOCX templating — run
reassembly, split delimiters, a `{{` in one paragraph and its `}}` in the next — runs **once per
template version, at the moment a human is looking at the result**, and its output is inspectable
through `GET /api/v1/templates/{templateId}/versions/{versionId}/fields`. An authoring mistake
surfaces when the template is registered, not at 4:55pm on a filing deadline. It also makes
assembly cheap enough to stay in a Worker (section 4) and makes assembly output reproducible: the
same template version plus the same merge context always yields the same bytes.

Placeholders that cannot be normalized — an unclosed delimiter, a key with no dictionary entry, a
nested block — are **registration errors with locations**, not silent passes. A template version
that fails normalization is never activated.

### 2.2 Storage, versioning, and the catalogue

Two tables mirroring the File Manager's shape without reusing its rows, because `file.matter_id` is
`NOT NULL` and a template belongs to a firm, not a matter. Relaxing that column would touch the
quarantine gate and every matter-scoped read and index in the File Manager for one consumer's
convenience; a narrow parallel pair is the smaller change.

**`document_template`** — the catalogue row: name, description, an optional `matter_type_id`
binding, an optional `location_id` binding, status (`active` / `archived`), `current_version_id`,
and the usual timestamps. Soft-archive only, never deleted — a template that produced a filed
document must remain explicable.

**`document_template_version`** — immutable, exactly like a file version: `r2_key`,
`content_sha256`, `size_bytes`, `storage_encoding` (`full` today, per ADR-0077 — nothing outside the
firm-scoped data-access layer may assume the object is raw bytes), `status` through the same
`pending → clean | quarantined` gate, the scan verdict columns, the serialized **field manifest**,
the normalizer version that produced it, and `created_by`. Objects live under a `templates/`
R2 prefix, which is also the `storage_meter` prefix dimension they meter under, so template bytes
are visible in firm usage without a second metering mechanism.

**Versioning is the file model, not a new one.** A template is never edited in place; a new upload
is a new version, the catalogue row's `current_version_id` moves, and superseded versions tier
Standard to Infrequent Access on the same supersede hook. This is not bookkeeping: **an assembly
records the exact template version it used**, so a document assembled in March and one assembled in
September from a template revised in June are explainably different rather than mysteriously so.
That provenance is the whole reason versions are immutable here.

**Sharing scope is firm-wide, with two optional narrowing bindings.** Every template is visible to
every member of the firm who can assemble; `matter_type_id` and `location_id`, when set, narrow
which matters offer it. There is no per-matter template and no per-user template in this design —
owner decision F4. Ethical walls do not apply to the catalogue, because a template carries no matter
data; the **assembly** is matter-rooted and carries the matter's wall like any other document
operation.

### 2.3 What a template may contain

A template is uploaded content and is therefore untrusted (security conventions, _Untrusted file
handling_): it rides the same presigned-upload and quarantine ingest chokepoint every other byte
does, and a template version is not activatable until its verdict is clean.

Two rules on top of the general pipeline, both cheap and both structural:

- **No macros.** `.docm` is refused by content type, and a `vbaProject.bin` part in a `.docx`
  package is a registration failure, not a scrub. A template is executed against privileged data on
  the firm's behalf; there is no legitimate reason for one to carry code.
- **The template is scrubbed at registration.** `@magna-carta/metadata`'s OOXML scrub runs over the
  normalized package, removing tracked changes, comments, hidden text, and document properties. A
  filed document must not carry the drafting history of the template it came from, and doing it
  once at registration is strictly better than doing it on every assembled output.

The assembler itself is purely subtractive and substitutive: it removes conditional blocks and
replaces placeholder runs. It never adds a part, a relationship, a script, or an external
reference. Whatever active content a template could have carried has already been refused or
scrubbed by the time an assembly reads it.

## 3. The merge-data model

### 3.1 The data dictionary is a declarative registry

The white paper's registry-first principle applies exactly: a growing list of similar things is a
declaration, not per-item code. The dictionary is a pure, versioned catalogue in
`@magna-carta/document-assembly`, one entry per merge field:

| Property      | Meaning                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `key`         | The stable, user-visible token — `matter.number`, `client.displayName`, `location.remitTo`, `firm.name`, `system.today`. |
| `source`      | `matter` \| `party` \| `location` \| `firm` \| `customField` \| `system` — which batched read resolves it.               |
| `valueType`   | `text` \| `date` \| `money` \| `number` \| `boolean` \| `reference` — fixes which formatters are legal.                  |
| `format`      | The default rendering (see 3.3); overridable per placeholder.                                                            |
| `sensitivity` | `ordinary` \| `protected` — a `protected` entry resolves through `readProtected` and nothing else (3.5).                 |
| `absence`     | What an unresolvable value renders as (3.4).                                                                             |

Custom fields are the one dynamic arm: a firm's own fields enter the dictionary as
`custom.<customFieldHandle>` entries derived at read time from `custom_field`. **Binding is by
handle, never by name** — which is precisely the property the custom-fields engine was built to
have, so renaming a field never breaks a template. The reverse obligation is this slice's to pay:
the custom-field hard-delete guard gains its template-binding arm, so a field a template binds is
`field-in-use` and routes the admin to Archive.

**Location fields close the office-identity loop.** `location.*` entries resolve from **the matter's
home location**, not the acting member's — office name, address block, footer, remit-to, and
jurisdiction — so a document assembled by a member of one office on a matter belonging to another
carries the correct office identity. That is the behaviour the Locations model was built for and
the reason its letterhead columns have been sitting unused.

### 3.2 The resolution pipeline, and its one hard rule

```
template version
  -> field manifest (the keys this template actually uses)
  -> dictionary lookup (which source, which type, which formatter)
  -> ONE batched read per source, through the firm-scoped data-access layer
  -> a typed, in-memory MergeContext
  -> per-placeholder formatting
  -> substitution
```

**The hard rule: a merge field never issues a query.** Resolution reads at most once per source —
one matter read, one location read, one firm read, one party read covering every role the manifest
mentions, one custom-field read covering every handle it mentions — regardless of how many
placeholders a template has. A template with 140 fields costs the same number of reads as one with
four. This is stated as a rule rather than left to care because the natural implementation of a
merge engine is a per-field resolver, and that is an N+1 generator pointed straight at a document
with a hundred merge fields.

The manifest is what makes the batching possible: because normalization already recorded exactly
which keys a template version uses, the reads are planned before any XML is touched.

### 3.3 Formatting, and the storage encodings that make it non-obvious

Formatting is declarative and lives with the dictionary entry, overridable per placeholder as
`{{matter.openedOn:long}}`.

**Money.** Stored as `amount_minor` plus a currency, never a float, and rendered through
`@magna-carta/money`. The scaling rule that already binds the custom-fields boundary binds here
identically and for the same reason: what a stored integer means is its kind plus its scale, so a
`500` is five hundred on a number field and five dollars on a currency field. Formatting moves a
decimal point; it never multiplies. Named formats: `currency` ($1,234.56), `currencyWords` (one
thousand two hundred thirty-four dollars and 56/100 — the form a settlement statement needs),
`plain` (1234.56).

**Rates.** `rate_e4` is a rate scaled by ten thousand; the same decimal-point discipline applies.

**Dates.** Instants and dates are `Temporal` values in the platform's UTC-normalized model; a
document renders them in the **matter's location's** time zone, not the server's and not the
member's, so a filing date is the date it was in the office that filed it. Named formats: `short`
(3/14/2026), `long` (March 14, 2026), `legal` (the 14th day of March, 2026), `iso`.

**Text.** `plain`, `upper`, `titleCase`. Nothing that attempts grammar.

**Explicitly not in the formatter set.** Pronoun and verb agreement — the "he/she/they, is/are"
substitution Clio Draft advertises — is deliberately absent from slice 1 and 2. It is not a
formatter; it is a conditional over a party attribute, and once conditionals exist (2·6·2) a
template author expresses it directly and visibly rather than trusting a hidden grammar engine to
guess the right pronoun for an organization, an estate, or a party whose gender the firm has no
business recording. Owner decision F6 covers whether we ever ship a shorthand for it.

### 3.4 Absence is a decision, not an accident

The most dangerous failure in document assembly is a blank where a party name should be, filed
without anyone noticing. Every dictionary entry declares its absence behaviour, and the assembly
result reports every absence it encountered:

- `blank` — render nothing (right for an optional middle name).
- `placeholder` — render a visible marker such as `[CLIENT ADDRESS]` (right for anything a human
  must fill in before filing).
- `fail` — the assembly fails with the missing keys named (right for a matter number on a pleading
  caption).

The default is `placeholder`. An assembly that completes with absences completes with a
**warning list** the caller must surface, and the assembly record stores the **keys** that were
absent — never the values that were present.

An archived custom field resolves as absent and is reported as such, which is the `resolveCustomField`
contract slice 1·4 fixed for this consumer by name. A dictionary key the firm's data cannot supply
at all (a party role the matter has no link for) is likewise an absence, not an error.

### 3.5 Protected values

A merge field may bind to a `protected()` column — a Social Security number on a directory entity,
a bank account on a trust instruction. The domain invariant is unchanged and not weakened here:
**decrypt is a permission check plus an audit row, inseparable and fail-closed.** So a dictionary
entry marked `sensitivity: protected` resolves through `readProtected` and nothing else, which
means an assembly that touches one requires the acting member to hold that field's decrypt
permission (`directory:viewSensitiveIdentifiers` for identifiers) and writes a `protected.decrypt`
audit row per read. A member without it does not get a blank — the assembly **fails** naming the
field, because silently omitting an identifier from a document that needs one is the worse outcome.

Whether protected values should be mergeable at all is owner decision F9. The engine supports it
because the alternative is a firm re-typing a Social Security number by hand into a document, which
is worse on every axis; but the decision to expose those keys in the dictionary is the owner's.

### 3.6 Conditionals and repeats — slice 2, with the ceiling fixed now

Block markers are their own paragraphs, and the marker paragraph is removed with the block:

```
{{#if party.spouse}}   … clause text …   {{/if}}
{{#unless matter.isProSe}}   … clause text …   {{/unless}}
{{#each exhibits}}   Exhibit {{exhibits.letter}} — {{exhibits.title}}   {{/each}}
```

In a table, a marker in the first cell of a row makes **the row** the unit, which is how a party
schedule or an exhibit index is actually authored.

**The expression ceiling is fixed now, in slice 1, even though the feature is slice 2**, because it
is a language-design decision that gets expensive to walk back: presence (`{{#if x}}`), negation,
and equality against a literal. **No arithmetic, no function calls, no nested field access beyond
the dictionary's own keys, and no user-supplied code of any kind.** This is the line between a
template a paralegal maintains and a template that needs a developer, and it is also a security
property — the templating libraries that offer richer expressions do so by evaluating code from the
template (`docx-templates` runs JavaScript; docxtemplater's Angular parser evaluates expressions),
which turns a firm-authored `.docx` into an execution surface inside our Worker. A
non-executable expression language cannot have that class of bug. Owner decision F6 is whether the
ceiling ever moves.

Numbering and list continuity is the real implementation risk in block removal — deleting the
second of five numbered paragraphs must renumber, and deleting a row from a table with banded
formatting must not strand the banding. That is engineering work, called out in the risks.

## 4. The assembly engine

Golden rule 14 governs this choice, and the honest position is that **there is no memory-safety
forcing function here at all** — every candidate is memory-safe except the one that involves
LibreOffice, and LibreOffice is not needed for the merge. So the choice turns on reuse, on where the
work runs, and on what surface each option opens.

### 4.1 The candidates

**In-house TypeScript OOXML merge, running in the Worker — recommended.** A pure
`@magna-carta/document-assembly` package over `fflate` (unzip and re-zip) and `fast-xml-parser`
(parse and rebuild) — the exact substrate `@magna-carta/metadata` already uses to walk, rewrite,
and re-emit `word/document.xml`, headers, footers, footnotes, and endnotes safely, including the
part-name and relationship discipline that keeps a rewritten package openable. That package is
proof, in this tree, that in-house OOXML manipulation in TypeScript is viable and reviewable;
`crates/recovery-core`'s Open Packaging Conventions module is the same proof on the Rust side. The
merge is kilobyte-scale XML surgery over a package format we already read and write in two places.

**Rust compiled to WebAssembly — rejected for this slice, not designed out.** The white paper's
original sketch said "light templating in a Worker (Rust/WASM docx)", and the Rust crate landscape
was surveyed against it: `docx-rs` is a read/write library with a real user base but no templating;
`docx-rust` and `rdocx` are parse/generate libraries; `docxide-template` is purpose-built for
placeholder substitution but is a young, single-purpose crate. None of them offers the
conditional/repeat semantics we need, so adopting one buys a document model and leaves the actual
templating to us — in a second language, across a WebAssembly boundary, for a workload that is not
CPU-bound. Rust earns its place in this codebase where the work is byte-level, adversarial, or
shared with the desktop; a merge over our own normalized template is none of those. If assembly
ever needs to run identically on the Tauri client for a parity reason, this is the argument that
gets revisited.

**Adopting docxtemplater's open-source core — the real alternative, declined.** It is MIT, actively
maintained (3.69.3 shipped in July 2026), its only dependency is `@xmldom/xmldom`, and its core
covers exactly the feature set of slices 1 and 2: substitution, loops including table-row loops,
and conditional sections, with the run-splitting problem solved. Golden rule 1 points straight at
it and the reasons for declining have to be better than taste. They are:

1. **Its zip layer is the caller's, and it expects a JSZip-shaped object.** We would carry PizZip
   alongside `fflate`, which is already the tree's zip stack in `@magna-carta/metadata` and
   `packages/file-manager`'s bundle path. Two zip implementations reading untrusted OOXML, with two
   sets of decompression-bomb guards to keep aligned, is a real cost.
2. **The features past the core are paid modules.** Image insertion, HTML insertion, and the
   error-location reporting we want for the registration surface sit behind a per-seat commercial
   licence. Adopting the core means either accepting a ceiling at exactly the point slice 2·6·2
   needs (the letterhead logo is an image insertion) or taking a recurring cost into a subsystem we
   would otherwise own outright.
3. **The expression evaluator is the wrong shape for us.** Its richer expressions go through the
   Angular parser, which evaluates expressions from template content. Our whole position in 3.6 is
   that the expression language must be non-executable by construction.
4. **It solves the OOXML half, and the OOXML half is the smaller half.** The dictionary, the
   batched resolution, the money and date encodings, the absence policy, the protected-field gate,
   and the provenance record are all ours regardless. Adopting a library for the substitution step
   does not remove the subsystem; it removes about a third of it, at the cost of the four points
   above.

**Driving the consented LibreOffice container's mail merge — rejected.** It is the only
memory-unsafe option and the only one that requires a container round-trip per document, and it
would push privileged merge values — party names, addresses, settlement amounts, potentially
decrypted identifiers — through the one C++ dependency we consented to on the explicit basis that
it is sealed behind a process boundary and reached only for format fidelity we cannot get another
way. There is no fidelity argument for the merge itself: the template is already `.docx` and the
output is already `.docx`. LibreOffice keeps exactly the job the 2·4 design gave it — DOCX to PDF —
and never sees a merge value.

### 4.2 The recommendation, and the trade stated plainly

**Build the merge in-house as a pure TypeScript package running in a Worker queue consumer; keep
the consented LibreOffice container strictly for DOCX-to-PDF.**

The trade we are accepting: we own run splitting, conditional-block removal, repeat expansion, and
list/numbering continuity that docxtemplater's MIT core would give for free. Two things make it
acceptable. First, the expensive half of run splitting is paid **once at template registration**
(section 2.1) rather than on every assembly, which is a materially smaller problem than the one a
general-purpose templater has to solve. Second, the alternative's ceiling lands precisely where our
second slice starts. The documented fallback is real and scoped: if our fidelity bar proves more
expensive than budgeted, docxtemplater's core slots in behind the same
`DocumentAssemblyPort.assemble(templateBytes, mergeContext) → bytes` interface, and everything
around it — dictionary, resolution, jobs, filing, provenance — is untouched.

### 4.3 Where it runs

In the **queue consumer**, not the request handler and not a container. The inputs are a template
package of tens to hundreds of kilobytes and a merge context of a few kilobytes; the work is a
decompress, an XML parse, a tree walk, a rebuild, and a recompress. Immutable template versions make
an isolate-level cache keyed by `(templateVersionId, contentSha256)` safe, so a firm's busy template
is parsed rarely. Nothing here needs a container, and putting it in one would add a network hop and
a cold start to the fastest part of the pipeline.

## 5. Orchestration, and how an assembled document becomes a filed document

### 5.1 The job

Assembly is asynchronous from the first line of code, following the `ConversionJob` and
`BundleBuildCoordinator` patterns rather than inventing a third: a **`DocumentAssemblyJob` Durable
Object keyed `firmId:assemblyId`** is the single-flight serialization point, an idempotent `start()`
persists `queued`, arms a stuck-job alarm, and enqueues exactly once; the consumer reports back
through `markRunning` / `markDone` / `markFailed`; the alarm fails a job that never reports.

It is asynchronous even though a single small merge would fit in a request, for three reasons: a
batch assembly (the matter-plan consumer, later) is the same code path; the DOCX-to-PDF hop in
slice 2·6·3 is genuinely long; and a job gives the interface a state to poll rather than a request
to hold open. The cost of retrofitting a synchronous route into a job later is exactly the cost of
building it twice.

Consumer stages: read the template version's bytes from R2 (or the isolate cache) → resolve the
merge context through the firm-scoped data-access layer → assemble → write the output object → file
it.

### 5.2 The ingest chokepoint — stated, because it is the question that gets fudged

**An assembled document enters the normal file pipeline, scan included. There is no bypass.**

The tempting shortcut is to commit a server-generated version directly as `clean`, since we produced
the bytes. It is refused for two reasons. The narrow one: an assembled document is only as
trustworthy as the template it came from, and although a template is scanned and macro-refused at
registration, "we scanned the input" is a weaker guarantee than "we scanned the output", and the
scan is cheap and off the hot path either way. The broad one, which matters more: the moment there
are two ways for a version to reach `clean`, the invariant that every `file_version` read filters on
status stops being enforceable by construction, and the second path is the one that will be wrong.
One chokepoint, no exceptions — the same posture the email-filing design took for attachment
extraction, using the same `initiateUpload` / `completeUploadSession` entry points rather than
reimplementing anything.

The assembled document therefore lands as an ordinary file in the matter's File Manager: versioned,
previewable, editable in the browser, convertible, downloadable, and available to the e-signature
seal. `artifact_role` is `original` — it is the authored artifact, not a derived cache — and it is
never auto-pinned.

**Filing target.** The output goes to a caller-named folder in the matter, defaulting to the matter's
root, as a **new file** named from the template plus the matter number. Assembling onto an existing
file as a new version is deliberately not slice-1 behaviour: overwriting a document someone has
edited with a re-merge of the template is a data-loss shape, and the honest resolution (a merge or a
diff) is not in scope. Owner decision F5 covers whether an assembly may ever file itself without a
human confirming.

### 5.3 The provenance record

**`document_assembly`** — one row per job, and the reason the subsystem is auditable: the template
version used, the matter, the acting member, the outcome, the produced `file_version_id`, the
engine and dictionary versions, the count and **keys** of absences, and timestamps.

It stores **no resolved values**. The merge context exists in memory for the life of the job and is
never persisted, never logged, and never placed on a queue message — the queue message carries
identifiers, and the consumer resolves. That rule is what keeps a Social Security number out of a
queue's dead-letter store.

## 6. The API surface

Code-as-contract per the API conventions: `createRoute` blocks with Zod schemas for every status,
`RouteMeta` on every route, all of it through the one chokepoint.

**Two new permissions**, registered in `@magna-carta/access-control` and seeded by migration:

- **`templates:manage`** — register, version, and archive templates. Administrative; seeded to Owner
  and Admin.
- **`documents:assemble`** — list the catalogue and assemble a document onto a matter. Seeded to the
  practising roles.

Listing is bound to `documents:assemble` rather than a third `templates:read` key: a member who can
assemble must be able to see what they can assemble, and a member who cannot has no use for the
list. The namespace split follows the existing house convention — `templates:*` is firm-scoped and
binds `resource: "firm"`; `documents:assemble` is matter-rooted and binds `resource: "matter"`, the
`files:*` and `emails:*` precedent.

| Route                                                            | Permission           | Resource | Audited | Idempotency | Notes                                                                        |
| ---------------------------------------------------------------- | -------------------- | -------- | ------- | ----------- | ---------------------------------------------------------------------------- |
| `POST /api/v1/templates/upload`                                  | `templates:manage`   | firm     | no      | optional    | Presigned PUT; bytes never transit the Worker (the conversions precedent).   |
| `POST /api/v1/templates`                                         | `templates:manage`   | firm     | yes     | required    | Register a template + first version from an uploaded object.                 |
| `POST /api/v1/templates/{templateId}/versions`                   | `templates:manage`   | firm     | yes     | required    | A new version; normalization + manifest run here.                            |
| `GET /api/v1/templates`                                          | `documents:assemble` | firm     | no      | none        | Cursor-paginated `{ data, nextCursor }`; filterable by matter type.          |
| `GET /api/v1/templates/{templateId}/versions/{versionId}/fields` | `documents:assemble` | firm     | no      | none        | The field manifest + per-key dictionary resolution + normalization warnings. |
| `POST /api/v1/templates/{templateId}/archive`                    | `templates:manage`   | firm     | yes     | optional    | Soft-archive; never a delete.                                                |
| `GET /api/v1/merge-fields`                                       | `documents:assemble` | firm     | no      | none        | The dictionary as the firm sees it, custom-field entries included.           |
| `POST /api/v1/matters/{matterId}/assemblies`                     | `documents:assemble` | matter   | yes     | required    | Submit a job; returns `202` with the assembly handle.                        |
| `GET /api/v1/matters/{matterId}/assemblies/{assemblyId}`         | `documents:assemble` | matter   | no      | none        | Poll: `queued` / `running` / `done` (+ file and version handles) / `failed`. |

Idempotency is **required** on every mutating route because a retried assembly must not file two
documents, and a retried registration must not mint two versions of the same bytes. Problem types
are additive registry entries — `template-normalization-failed`, `merge-field-unresolvable`,
`template-not-activatable` — each carrying enough structure for the authoring interface to point at
a location.

The submit route does three things and nothing else: authorize, persist the assembly row, start the
Durable Object. No template read, no merge resolution, no R2 access.

## 7. Telemetry

Per the telemetry catalogs, every event and every counter is a declaration, and dimension values are
low-cardinality labels rather than content.

**Event** — `document.assembled`, fields `[outcome, reason, absenceCount]`. `outcome` is
`succeeded` / `failed` / `succeeded-with-absences`; `reason` is an error code from a closed set.
No template name, no matter identifier, no field values.

**Counters** —

- `documentAssembly.jobs`, dimensions `[outcome, stage]` — where jobs end and where they fail.
- `documentAssembly.absentField`, dimensions `[source]` — how often each dictionary source fails to
  resolve, which is the signal that a firm's templates and a firm's data have drifted apart.
- `documentTemplate.normalization`, dimensions `[outcome, placeholderForm]` — how often registration
  rejects a template and which authoring form it came from, which is the signal that tells us
  whether text delimiters were the right primary.

**A merge-field key is not a dimension.** Dictionary-declared keys are enum-like and would be
tolerable, but custom-field entries are keyed by firm-defined handles, and a rule that admits one
and not the other is a rule that gets applied wrongly. `source` is the dimension; the key is not.
An absent key is recorded on the assembly row, which is per-firm data behind the firm-scoped
data-access layer, not in the cross-firm analytics dataset.

## 8. Confidentiality and personally identifiable information posture

**Assembled outputs are the highest-sensitivity artifacts this subsystem produces** — a document
that exists specifically because it collects a client's identifying details into one place. The
posture is unchanged from the rest of the platform, which is the point:

- Outputs are per-firm R2 objects under opaque, server-minted keys, reached only through the
  firm-scoped data-access layer, and served only through the existing gated delivery paths.
- Retention follows the File Manager: tiering, never pruning; destruction is policy-driven and
  blocked by holds.
- The three new tables are classified in the personally-identifiable-information registry in the
  same change that creates them. `document_assembly` carries identifiers and absent-field keys;
  `document_template` and `document_template_version` carry firm-authored content, which can itself
  embed sample or boilerplate personal data and is therefore classified rather than assumed inert.
- Resolved merge values are never persisted, never logged, and never placed on a queue.
- Errors follow the standard pipeline: an Error ID to the user, the detail correlated internally,
  never the failing value. A merge failure reports **which key** failed, never what it held.
- Template bytes meter under the `templates/` prefix, so firm usage stays honest.

## 9. User-interface seams

The owner designs the interface; this spec defines only the backend contract it calls. Four seams,
named:

1. **Template library** — the catalogue list and the register/version/archive flow, over the
   `templates:*` routes.
2. **Field inspector** — the authoring feedback surface, over
   `GET /templates/{id}/versions/{v}/fields` plus `GET /merge-fields`. This is where a normalization
   failure becomes a fixable message.
3. **Assemble dialog** — pick a template on a matter, see the resolved values and the absence
   warnings, confirm, poll the job, land on the filed document. Consumes the assemblies routes.
4. **Post-assembly hand-off** — open the produced version in the browser editor, convert it, or send
   it for signature. All three already exist as surfaces; this is a link, not a build.

## 10. Load-profile fit

Per the accretion rule (ADR-0083), this slice extends the load-profile harness in-area with a
`documentAutomation` volume profile rather than adding a bespoke benchmark.

**Expected volumes.** A firm's template set is small and slow-moving — tens to a few hundred
templates, each 20 KB to 400 KB, with 10 to 150 declared fields. Assemblies are the volume path but
not a heavy one: a ten-attorney firm generating thirty documents a day is roughly 7,500 a year, so
even at platform scale this is thousands of jobs a day across all firms, which a queue absorbs
without a strategy. **The corpus that actually grows is the output**, and it grows as ordinary matter
documents already metered and tiered.

**Measured operations**, added to the committed baseline: the catalogue list at the top of the range;
the current-version resolve; the full merge-context batch for a 150-field template on a matter with
a dozen party links and forty custom-field values; and the custom-field manifest read. The
plan-scan check must show index walks, not scans, on all four.

**What must never be on the request hot path**, stated so a later change cannot quietly move it
there: reading template bytes from R2; parsing or rebuilding OOXML; template normalization at
registration; resolving a merge context; the DOCX-to-PDF hop; and committing the output version.
The only synchronous work in the whole subsystem is authorize-persist-start on submit, and paginated
reads of the catalogue.

## 11. Test strategy

The risk is concentrated in the OOXML manipulation and in the resolution batching, and the split
follows it.

**Pure package, in `vitest`, no worker and no network.** Normalization against synthesized templates
whose placeholders are split across runs in every awkward way — braces in separate runs, a
placeholder spanning a spellcheck boundary, a placeholder inside a table cell, inside a header,
inside a footnote — using the fixture-building approach `@magna-carta/metadata`'s tests already
established. Substitution correctness, including that the output package is a valid OOXML package
that opens: content types, relationships, and part integrity, which is exactly the class of failure
the metadata package's notes warn about (a "cleaned" document no reader will open, invisible to a
text assertion). Formatter tables per value type, with money and rate scaling proven integer-exact
in both directions. Conditional and repeat semantics including numbering continuity after removal.
The absence policy per mode. Dictionary well-formedness as a fitness function: every entry has a
source, a type, a legal formatter, and a declared absence behaviour.

**Resolution, against the harness fixtures.** The batching rule is a test, not a convention: a
resolution over a 150-field manifest issues a bounded, asserted number of reads. That test is the
thing that stops the N+1 from being reintroduced.

**Worker integration, under the Miniflare pool.** The chokepoint contract per route (401 / 403 /
404-not-403 for a deactivated member), idempotency on every mutating route, the job lifecycle
including the stuck alarm and a redelivered queue message producing exactly one filed document, and
the end-to-end path from submit to a `clean` version visible in the matter's file list. The
protected-field path gets its own case: a member without the decrypt permission gets a named
failure, and a member with it produces both the document and the `protected.decrypt` audit row.

**Fixtures.** Small, committed, non-privileged `.docx` templates built programmatically and reviewed
once — a letter with letterhead fields, a pleading caption, a fee agreement with money and date
formatting, and a deliberately malformed template for the registration-failure cases.

## 12. Risks

**Fidelity loss in block removal.** Deleting a numbered paragraph or a table row can strand
numbering definitions, list continuity, banded formatting, or a bookmark that spans the removed
range. This is the single most likely source of a document that looks subtly wrong rather than
obviously broken, and there is no general oracle for it. Mitigations: block removal operates on
whole paragraphs and whole rows only, never on partial content; the acceptance fixtures include a
numbered list and a banded table with a removed middle element; and the output is always a new
object, so the template is never damaged.

**A silently wrong document is worse than a failed one.** The whole absence model (3.4) exists for
this, and the default of a visible placeholder rather than a blank is the deliberate bias. It is a
mitigation, not a solution: a firm that configures everything to `blank` can still file a document
with a hole in it.

**Template and data drift.** A firm renames nothing (handles protect against that) but does archive
custom fields, close locations, and change matter types, and a template written two years ago binds
keys that may no longer resolve. The `documentAssembly.absentField` counter is the instrument; the
field-inspector surface is the repair path; and the custom-field hard-delete guard's new
template-binding arm prevents the sharpest version of it.

**Normalization is a versioned transform over stored bytes.** A normalizer change does not
retroactively apply to already-registered template versions, which is correct (versions are
immutable) but means two templates registered under different normalizer versions can behave
differently. The version is recorded on the row so the difference is explicable, and a template can
be re-registered to move it forward.

**Worker limits on a pathological template.** A 40 MB `.docx` with an enormous embedded image is a
legitimate upload and a bad thing to parse in a Worker. A registration-time size and part-count cap
applies, sized against the existing inspectable-size cap discipline rather than invented, and a
template above it is refused at registration — never at assembly time, where a user is waiting.

**The library-versus-in-house call is the one most likely to be revisited.** It is recorded as an
ADR with the fallback scoped (4.2) precisely so revisiting it is a decision rather than an
excavation.

## 13. Owner decisions required

These are opinion-heavy or invariant-heavy and are not settled by this design.

| Flag   | Decision                                                                                                                                                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | **Merge-field syntax, because it is user-visible.** Recommended: `{{matter.number}}` text delimiters primary, `MERGEFIELD` accepted, content controls deferred. This is what a paralegal types for the next decade; changing it later is a migration. |
| **F2** | **Court-form scope.** Do we ship and maintain a curated library of jurisdiction court forms, or only fill firm-supplied fillable PDFs? A maintained library is a recurring content obligation with a per-jurisdiction staleness risk.                 |
| **F3** | **Clause library scope.** A first-class clause entity with its own versioning and approval, or clauses expressed as conditional blocks inside templates? The first is a second content system; the second is free but couples clauses to templates.   |
| **F4** | **Template sharing scope.** Firm-wide with optional matter-type and location narrowing (recommended), or richer scoping — per practice area, per member, per matter?                                                                                  |
| **F5** | **May an assembly file itself, or must a human confirm?** Recommended: always file, always as a new document, never onto an existing one — but whether the interface may skip a confirmation step for a trusted template is a workflow call.          |
| **F6** | **The expression ceiling.** Presence, negation, and literal equality only (recommended), or does it ever grow computed expressions and grammar helpers — the HotDocs slope that turns template authoring into a developer task?                       |
| **F7** | **Own the OOXML merge or adopt docxtemplater's MIT core.** Section 4.2 recommends owning it and scopes the fallback. This is the reuse-before-building call and deserves an explicit answer.                                                          |
| **F8** | **Macro-bearing templates.** Recommended: refused outright, no exception, no opt-in. Confirm — a firm migrating from an older system may have `.docm` templates and will ask.                                                                         |
| **F9** | **May merge fields bind to `protected()` values at all?** The engine supports it under the full decrypt-permission-plus-audit gate; whether those keys appear in the dictionary is a policy decision about privileged identifiers in filed documents. |

## 14. Open questions

1. **Template editing in the browser.** The editing subsystem's WOPI token is a capability over one
   `file` plus one `file_version`, and a template is neither. Adding a subject discriminator to the
   token claims is cheap now and awkward later, but the token format belongs to that area, so it
   needs the editing area's agreement rather than a decision here. If the answer is "not yet",
   slice 2·6·4 stands alone and templates are authored in Word and uploaded.
2. **Whether the assembly record should carry the engine and dictionary versions the same way the
   conversion record was asked to carry the office suite's version.** Both are provenance questions
   with the same shape, and they should be answered the same way; the conversion one is still open
   in that area.
3. ~~**The letterhead logo asset.** Locations reserved it for this slice, but an image merge field
   raises a sizing and placement question a text field does not — does the template declare the box,
   or does the asset declare its dimensions?~~ **Answered when it was built: the ASSET declares the
   box.** The office stores a printed width and the height follows from the image's own proportions,
   so no template restates a measurement and no document can print a stretched mark; `location` gained
   the logo columns, and the image-format policy that came with the answer (PNG and JPEG, decided by
   magic bytes) is recorded in the same decision.
4. **The batch-assembly shape for matter plans.** Tasks and workflows will want "assemble these six
   documents when a matter of this type opens". The job model supports it, but whether that is six
   jobs or one job with six outputs affects the Durable Object's key, and there is no consumer yet
   to settle it against.
5. **Cross-firm template distribution.** The custom-fields conformity-template seam
   (`template_field_key`) anticipates curated starter content living in the control plane. Whether
   document templates get the same treatment is out of scope here and worth deciding before the
   first real client, on the same gate.
