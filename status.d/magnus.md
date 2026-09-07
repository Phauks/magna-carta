---
slice: Magnus — conversational assistant
group: cross-cutting
order: 33
research: n/a
spec: done by="Opus 5"
plan: done by="Opus 5"
built: in-progress by="Opus 5"
ui: in-progress by="Opus 5"
load-profile: todo
tested: todo
branch: claude/magnus-ui-setup-a5lp1p
active-work: docs/active-work/claude/magnus-ui-setup-a5lp1p.md
next: Explicit per-conversation context grants (the ratified shape), then token streaming and the events socket the surface polls in place of today
link-spec: docs/specs/2026-08-06-magnus-design.md
link-plan: docs/specs/2026-08-06-magnus-implementation-plan.md
adrs: ADR-0109, ADR-0110, ADR-0111, ADR-0112, ADR-0113
blocked-by:
---

Build slice 1 landed: `@magna-carta/magnus` (record, gates, window, caps), one additive `InferencePort` operation plus a general deterministic stub, three per-firm tables, two permissions, the queue-dispatched path, and the push transport. A transcript is firm **work product** — protected, deletable, archivable, discoverable like email but never swept into a search without an explicit include-or-exclude (that control lands with discovery). **Off by default** — both consent settings closed, stub adapter, no interface; production enablement waits on ADR-0109.
