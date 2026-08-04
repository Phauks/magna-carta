---
category: Added
---

**Document automation — template catalogue and merge assembly.** A firm can register a `.docx`
template, and assemble it against a matter into a filed document. Templates live in their own
firm-level catalogue with immutable versions (`document_template`, `document_template_version`), and
every assembly records the exact version it came from (`document_assembly`). The merge engine is
in-house TypeScript over the same OOXML substrate the metadata inspector uses — no new runtime, no
container hop.

Registration does the expensive work once, while a human is looking at the result: placeholders Word
split across runs are reassembled into one run each, the document's drafting history is scrubbed, and
the bytes are scanned before the version can be assembled from. Two things it reports rather than
doing silently — **macro projects are removed and the removal is reported**, and **Word merge fields
are detected and listed but converted only when you ask for it** (`convertMergeFields` on the
registration request). A stripped package is independently re-verified as macro-free before it can
register at all.

An assembled document enters the matter through the same upload-and-scan path every other file
crosses; there is no second route to a clean version. Merge values exist in memory for the life of the
job and are never persisted, logged, or placed on a queue — the provenance row records which fields
were _absent_, never what the present ones held.

New permissions: `templates:manage` (Owner/Admin) and `documents:assemble` (the practising roles).
Conditional and repeating blocks, custom-field bindings, letterhead images, and PDF output are later
slices.
