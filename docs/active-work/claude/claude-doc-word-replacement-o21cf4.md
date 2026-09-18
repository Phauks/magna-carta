---
worktree: (none — this stream runs in a remote session checkout)
area: Research only — assessment of Anthropic's Claude Docs and Claude for Word against the built documents-and-automation subsystem
status: review
touches: docs/research/
---

Adds one research note, `docs/research/2026-09-18-claude-docs-and-word-assessment.md`, and nothing
else. It records what Anthropic shipped as Claude Docs and Slides (2026-09-16) and as the Claude for
Word add-in (2026-04-10), maps each advertised capability onto the node that already owns it here,
and reaches a recommendation: adopt nothing — Claude Docs is unavailable to customers running zero
data retention, which is the posture ADR-0110 pins this platform to, so the product and the firm's
confidentiality obligation are mutually exclusive as shipped.

Nothing is built, no decision is recorded, and no ADR changes. The note names four candidates for
later work, of which one is substantive: the tracked-change AI edit path, proposed as the shape the
already-roadmapped slice 2·6 merge-intelligence consumer should take rather than as new scope. A
stream working in `packages/document-assembly`, `packages/metadata`, the editing subsystem, or
Magnus may want to read section 4 before drawing that slice, but nothing here blocks or touches any
of them.
