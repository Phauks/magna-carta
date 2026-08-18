---
category: Changed
audience: internal
---

**The step whose whole purpose is removing what a PDF hides leaves its executable content
untouched, and the question of what to do about that now reaches the decision desk.**

`crates/pdf-core/src/scrub.rs` removes thirteen document-level surfaces — `Info`, `Metadata`,
`StructTreeRoot`, `MarkInfo`, `Outlines`, named destinations, optional-content properties, field
values and appearances, `XFA`, embedded files, `Collection`, file associations and file-attachment
annotations — and then checks its own work: `verify_scrub_absence` walks the document model before it
is serialized, gating all seven option groups across thirteen checks, and refuses to emit anything at
all if a surface is still reachable. (A model check, not an output-byte one — the weaker of the two
forms the crate uses; `redact.rs` re-reads what it actually wrote.)

What it never looks for is executable content. No document-level JavaScript name tree, no open
action, no catalog actions on save, print or close, no page or field additional-actions, no
annotation action. A document scrubbed before production to an opposing party can still carry code.

The finding sharpens against the tree rather than against the design: the page-split path in
`crates/pdf-core/src/generate.rs` removes some of the same entries, and does so for safety — but a
different safety, that no byte of an excluded page survives into the output. It drops the catalog
`OpenAction`, `AA` and `Names` because they reference pages across the whole document, and strips an
action from an annotation on a kept page only when that action points at an excluded one, with a
fail-closed gate behind both. An action pointing inside the kept range survives. A split is not a
scrub, and neither path settles what the other should do.

**Surfaced, not built.** What stands in the way today is the malware scan every uploaded byte
crosses, which is a different guarantee — it catches what is known to be hostile, not what is merely
executable. Stripping is not free either, and the cost falls on fillable forms a *firm* uploaded: a
court form uses field actions for validation and formatting, so a scrub that removes them hands back
a form that looks right and computes nothing. The node's `awaiting-owner` line states the three
answers — strip always, strip with an exception a firm marks at upload, or report without removing —
and says why a fourth that sounds obvious is empty: an exception keyed on templates the platform
authored would exempt nothing, because every fillable template in the tree is a firm upload and
whether the platform ever authors its own is itself an open question on
`document-automation.filing-grade-generation`. `documents.pdf.scrub` is `shipped`, so
the question sits under the questions that change something already running rather than under the
ones holding a build.

Also moves this stream's active-work note to `docs/active-work/claude/passive-dev-orchestrator-m7f9jw.md`.
It was written at a flattened path, so the registry reported the branch as resolving to no ref while
two design specs linked the correct path and found nothing there. The path mirrors the branch name,
slashes included, which is what makes the registry collision-free.
