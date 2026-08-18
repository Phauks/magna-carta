---
category: Changed
audience: internal
---

**The step whose whole purpose is removing what a PDF hides leaves its executable content
untouched, and the question of what to do about that now reaches the decision desk.**

`crates/pdf-core/src/scrub.rs` removes twelve document-level surfaces — `Info`, `Metadata`,
`StructTreeRoot`, `MarkInfo`, `Outlines`, named destinations, optional-content properties, field
values and appearances, `XFA`, embedded files, `Collection` and file associations — and verifies
that two of them survived nothing. It removes no document-level JavaScript, no open action, and no
field or page additional-actions. A document scrubbed before production to an opposing party can
still carry code.

The finding sharpens against the tree rather than against the design: the page-split path in
`crates/pdf-core/src/generate.rs` already drops `OpenAction`, `AA` and `Names`, but for a structural
reason — a page subset cannot preserve cross-page references — not a safety one, so it settles
nothing about what the scrub should do.

**Surfaced, not built.** Stripping is not free, and the cost landed recently: the fillable court
forms this platform now assembles use field actions for validation and formatting, so a scrub that
removes them hands back a form that looks right and computes nothing. The node's `awaiting-owner`
line states the three answers — strip always, strip with a named exception for platform-generated
forms, or report without removing — and what each one costs. `documents.pdf.scrub` is `shipped`, so
the question sits under the questions that change something already running rather than under the
ones holding a build.

Also retires the active-work note for the register stream, which landed.
