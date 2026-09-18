---
worktree: (none — this stream runs in a remote session checkout)
area: Research only — assessment of Anthropic's Claude Docs and Claude for Word against the built documents-and-automation subsystem
status: review
touches: docs/research/, apps/edit-worker/wrangler.jsonc, changelog.d/
---

Adds two research notes and nothing else. The first,
`docs/research/2026-09-18-claude-docs-and-word-assessment.md`, records what Anthropic shipped as Claude Docs and Slides (2026-09-16) and as the Claude for
Word add-in (2026-04-10), maps each advertised capability onto the node that already owns it here,
and reaches a recommendation: adopt nothing — Claude Docs is unavailable to customers running zero
data retention, which is the posture ADR-0110 pins this platform to, so the product and the firm's
confidentiality obligation are mutually exclusive as shipped.

Nothing is built, no decision is recorded, and no ADR changes. The first note names four candidates
for later work and its second pass examines each against the code: the tracked-change AI edit path
resolves to a host-side OOXML revision writer applied through the Durable Object, proposed as the
shape the already-roadmapped slice 2·6 merge-intelligence consumer should take rather than as new
scope. The second, `docs/research/2026-09-18-local-first-document-editing.md`, assesses editing a
single-editor `.docx` locally in the browser (SuperDoc, the one memory-safe candidate) behind the
`getEditorBackend` seam, escalating to the Collabora container when a second editor arrives — with
the container's cost and ceiling read from `apps/edit-worker`, the escalation state machine over
`DocumentSession`, and a fidelity-gated spike as the recommendation — **declined for now by the owner on 2026-09-18
("stick to Collabora"), recorded at the top of that note; ADR-0010 stands.** A stream working in
`packages/document-assembly`, `packages/metadata`, the editing subsystem, the presence design, or
Magnus may want to read both before drawing that work, but nothing here blocks or touches any of
them.
