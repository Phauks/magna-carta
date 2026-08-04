# Document-automation template model — normalize at registration, version like a file

**Status:** Proposed
**Date:** 2026-08-04
**Area:** Document Automation

## Context

A template is a `.docx` file carrying placeholders. Two questions had to be settled before any code:
what a placeholder looks like to the person authoring it, and where templates live. Word splits a
typed run at arbitrary points — a spellcheck mark, a language change, a revision identifier — so a
typed `{{matter.number}}` is routinely stored as several sibling text elements with the braces in
different runs than the key. Every DOCX templating system pays for that somewhere.

## Decision

**Placeholders are `{{key}}` text delimiters.** Word `MERGEFIELD` constructs are recognized as an
equivalent authoring form and normalized to the same internal representation; content controls
(`w:sdt`) are a named seam, deferred until a browser authoring surface can emit them, because
Collabora's structured-document-tag support is uneven and authoring one in Word is a developer-tab
exercise.

**Normalization runs once, at template registration, not once per assembly.** Registering a version
finds every placeholder however it was split, rewrites each into a single contiguous run, records a
field manifest, refuses macro-bearing packages, runs the existing OOXML scrub over the result, and
stores the normalized package as the version's bytes. Every assembly thereafter substitutes over
known runs.

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

**Templates as `file` rows in a firm-level folder** — rejected. `file.matter_id` is `NOT NULL`, and
relaxing it would touch the quarantine gate and every matter-scoped read and index in the File
Manager for one consumer's convenience. A narrow parallel pair is the smaller change.

## Consequences

**Positive.** Authoring errors surface at registration, while a human is looking at the result and
the field inspector can point at a location, rather than at 4:55pm on a filing deadline. The
per-assembly path is cheap enough to stay in a Worker. Immutable versions make an isolate-level
template cache safe and make "why does the March document differ from the September one" answerable.
Templates are scanned, macro-refused, and scrubbed once rather than per output.

**Negative.** A normalizer change does not retroactively apply to already-registered versions
(correct, since versions are immutable) so two templates registered under different normalizer
versions can behave differently; the normalizer version is recorded on the row so the difference is
explicable. The catalogue is a second, deliberately narrow storage surface beside the File Manager.

**Open.** The placeholder syntax is user-visible and is an owner decision; changing it after firms
have authored templates is a migration.
