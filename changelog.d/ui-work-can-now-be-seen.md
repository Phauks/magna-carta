---
category: Added
audience: internal
---

**The UI standard has always required looking at the rendered page, and there was no tool that could
look.** `docs/conventions/ui-design.md` instructs the coordinator of a UI stream to verify
empirically before committing — screenshots, computed styles, interaction round-trips — and the
repository configured no browser. Every gate under it reads source text, so "the classes are right"
was machine-checked and "the screen is right" was somebody's word. The Chrome DevTools MCP server is
now declared in `.mcp.json`, and the standard says where to point it and what evidence a review owes.

The same standard delegates UI work to subagents "with the constraints, not just the task", and
there were no agent definitions to carry them — so each delegation restated the rules from memory.
`ui-builder` and `design-reviewer` now hold the binding constraints and the reading order.

**The third gap is the one that cost the most.** The auth flow went through fifteen mockup revisions
before it was built, and most of what those revisions settled was not about auth at all: headers are
title case, user-facing copy takes no em dashes, a duration in a sentence renders from the value
that governs it, every non-initial step of a flow carries the same back control, a resend counts
down visibly from the first send. Those are rules for every screen, and they lived in one task
description. `docs/conventions/design-corrections.md` is now their home — append-only, and read
before composing anything.
