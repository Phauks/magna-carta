---
number: 211
slug: document-automation-template-model
status: Accepted
date: 2026-08-04
area: Document Automation
summary: "Template placeholders are `{{key}}` double-brace text delimiters, and that is the one canonical form once a template is registered. Word MERGEFIELD constructs are always DETECTED and REPORTED back to the person registering the template, but conversion to the brace form is OPT-IN — it runs only on an explicit request, never silently as a side effect of registration — and each confirmed MERGEFIELD-name-to-key mapping accumulates in a per-firm field-mapping library so later imports reuse earlier confirmations instead of re-asking. Content controls (`w:sdt`) stay a named, deferred seam. Normalization runs once at registration, not once per assembly, and stores the normalized package as the version's bytes. A macro-bearing upload is ACCEPTED AND STRIPPED — registration removes `vbaProject.bin` with its content-type entries and relationships and then re-verifies that the stripped package sniffs as a clean macro-free `.docx`, refusing only if it does not — deviating from the recommendation to refuse macro-bearing packages outright. Templates live in their own catalogue versioned exactly like files: `document_template` plus an immutable `document_template_version` mirroring `file` / `file_version`."
---

**Placeholders are `{{key}}` and nothing else once a template is registered; MERGEFIELD constructs are always detected and reported but converted only on request; normalization runs once at registration, strips any macro project and re-verifies the result, and stores the normalized package as the version's bytes; templates are versioned exactly like files.**

## Context

A template is a `.docx` file carrying placeholders. Two questions had to be settled before any code:
what a placeholder looks like to the person authoring it, and where templates live. Word splits a
typed run at arbitrary points — a spellcheck mark, a language change, a revision identifier — so a
typed `{{matter.number}}` is routinely stored as several sibling text elements with the braces in
different runs than the key. Every DOCX templating system pays for that somewhere.

## Decision

**Placeholders are `{{key}}` text delimiters, and that is the one canonical form once a template is
registered.** _Owner decision, 2026-08-04._ Word `MERGEFIELD` constructs are not a second supported
authoring syntax — but they are also never rewritten behind the firm's back:

- **Detection and reporting are always on.** Registration finds every `MERGEFIELD` construct in the
  uploaded package and reports them back to the person registering the template — what was found,
  where, and which merge key each would map to. A firm always learns what is in its own document,
  whether or not it asks for anything to be done about it.
- **Conversion is opt-in.** Rewriting `MERGEFIELD` constructs into the brace form runs only on an
  **explicit request** at registration, never as a silent side effect of uploading. A template that
  is registered without that request keeps its constructs exactly as authored and is simply reported
  as carrying unconverted fields.
- **Confirmations accumulate in a per-firm field-mapping library.** Each confirmed
  `MERGEFIELD`-name-to-merge-key mapping is recorded for the firm, so a later import that meets the
  same field name proposes the mapping the firm already confirmed instead of asking again. The
  library is the seam that makes bulk migration of a firm's template set converge on one pass of
  human confirmation rather than one per template.

Content controls (`w:sdt`) remain a named seam, deferred until a browser authoring surface can emit
them, because Collabora's structured-document-tag support is uneven and authoring one in Word is a
developer-tab exercise.

**Normalization runs once, at template registration, not once per assembly.** Registering a version
finds every placeholder however it was split, rewrites each into a single contiguous run, records a
field manifest, applies the requested `MERGEFIELD` conversion (if any), strips any macro project
(below), runs the existing OOXML scrub over the result, and stores the normalized package as the
version's bytes. Every assembly thereafter substitutes over known runs.

**A macro-bearing upload is accepted and stripped, not refused.** _Owner decision, 2026-08-04 —
this deviates from the recommendation, which was to refuse a macro-bearing package outright._
Registration removes `vbaProject.bin` together with its `[Content_Types].xml` entries and the
relationships that reference it, and then **re-verifies the stripped package**: it is accepted only
if the result sniffs as a clean, macro-free `.docx`, and refused otherwise. A firm's existing
letterhead templates routinely carry a macro project nobody needs, and refusing them outright
pushes the firm into stripping macros in Word — the least supervised place it could happen — so the
platform does it under audit instead. The stripping path is **security-boundary code**: it decides
that an untrusted package no longer carries executable content, so it carries adversarial tests
(a macro part reached by an unusual relationship chain, a duplicate or mis-cased part name, a part
re-added under a different extension, a content-type override left behind) and fails closed on
anything it cannot account for.

**Templates live in their own catalogue, versioned exactly like files.** `document_template` plus an
immutable `document_template_version`, mirroring `file` / `file_version` — content hash, storage
encoding discriminator, the same `pending → clean` status gate, the same supersede-to-Infrequent-Access
tiering, a `templates/` R2 prefix that is also the storage-meter prefix. Sharing is firm-wide with
optional matter-type and location narrowing. An assembly records the exact template version it used.

## Considered options

**Normalizing on every assembly** — rejected. It puts the fiddly, failure-prone half of the problem
on the path where a user is waiting and an error is least actionable, and it makes assembly output
non-reproducible for a given template version.

**Content controls as the primary authoring form** — structurally the best binding and immune to run
splitting, but it fails the paralegal test today and risks control loss when a template is edited in
the browser. Deferred, not designed out.

**`MERGEFIELD` as a permanently supported second syntax** — rejected. Carrying two authoring forms
forever means every downstream surface (field inspector, authoring help, error messages, the
normalizer's own repair rules) has to describe both, and a template edited in the browser can pick
up either. Offering conversion at registration keeps the migration benefit and drops the standing
cost.

**Converting `MERGEFIELD` automatically at registration** — the shape first written down, and the
owner changed it. Automatic conversion is a silent rewrite of a document the firm supplied: the
stored bytes stop matching what was uploaded, with no moment at which anyone said yes, and a
mis-mapped field name becomes a wrong value in an assembled document rather than a question. Making
detection unconditional and conversion opt-in keeps the whole benefit — the firm still learns
exactly what its template contains — while leaving the rewrite a decision someone made.

**Refusing a macro-bearing package outright** — the recommendation, and the owner deviated from it.
Refusing is the simpler rule and needs no code that must be right about executable content, but it
rejects a firm's real letterhead templates and moves the macro stripping to Word on a paralegal's
desktop, unaudited and unverified. Accepting and stripping keeps the operation inside the platform
where it is verified and logged, at the cost of owning a security boundary; the re-verification step
is what makes that cost bounded — the package is re-sniffed after stripping, so the decision that it
is macro-free is made about the bytes we stored, not about the bytes we received.

**Templates as `file` rows in a firm-level folder** — rejected. `file.matter_id` is `NOT NULL`, and
relaxing it would touch the quarantine gate and every matter-scoped read and index in the File
Manager for one consumer's convenience. A narrow parallel pair is the smaller change.

## Consequences

**Positive.** Authoring errors surface at registration, while a human is looking at the result and
the field inspector can point at a location, rather than at 4:55pm on a filing deadline. The
per-assembly path is cheap enough to stay in a Worker. Immutable versions make an isolate-level
template cache safe and make "why does the March document differ from the September one" answerable.
Templates are scanned, macro-stripped, and scrubbed once rather than per output. A firm can upload
the templates it already has, including macro-bearing ones, without a preparation step outside the
platform. Because detection reports without acting, a firm can register its whole existing template
set, read what the platform found, and decide about conversion afterwards — and the field-mapping
library means that decision is made once per field name rather than once per template.

**Negative.** A normalizer change does not retroactively apply to already-registered versions
(correct, since versions are immutable) so two templates registered under different normalizer
versions can behave differently; the normalizer version is recorded on the row so the difference is
explicable. The catalogue is a second, deliberately narrow storage surface beside the File Manager.
Opt-in conversion means the catalogue holds templates in two states — converted and reported-only —
so the field manifest, the inspector, and the assembly-time absence policy all have to handle a
template that still carries unconverted constructs, rather than being able to assume one shape.
The field-mapping library is a third piece of per-firm state with its own lifecycle: a confirmed
mapping that was wrong stays wrong until someone corrects it, so it needs to be visible and editable
rather than an invisible cache. And accepting macro-bearing uploads puts a security boundary in the registration path that
would not otherwise exist — a stripping bug is a macro surviving into a stored template, which is
why the re-verification and the adversarial tests are part of the decision rather than an
implementation detail.

**Risk.** The placeholder syntax is user-visible, so it is now settled before firms author against
it; changing it later would be a migration over stored template bytes, which is exactly what
deciding it now avoids.
