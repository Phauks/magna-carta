---
slice: Magnus — conversational assistant
group: cross-cutting
order: 33
research: n/a
spec: done by="Opus 5"
plan: done by="Opus 5"
built: in-progress by="Opus 5"
ui: done by="Opus 5"
load-profile: todo
tested: todo
branch: claude/magnus-ui-setup-a5lp1p
active-work:
next: The firm-administrator enablement screen (the two consent settings have no screen, so a firm opens them through the settings write path), then explicit per-conversation context grants, then token streaming and the events socket the surface polls in place of today
link-spec: docs/specs/2026-08-06-magnus-design.md
link-plan: docs/specs/2026-08-06-magnus-implementation-plan.md
adrs: ADR-0109, ADR-0110, ADR-0111, ADR-0112, ADR-0113
blocked-by:
---

Build slice 1 landed: `@magna-carta/magnus` (record, gates, window, caps), one additive `InferencePort` operation plus a general deterministic stub, three per-firm tables, two permissions, the queue-dispatched path, and the push transport. A transcript is firm **work product** — protected, deletable, archivable, discoverable like email but never swept into a search without an explicit include-or-exclude (that control lands with discovery). **Off by default** — both consent settings closed, stub adapter, no interface; production enablement waits on ADR-0109.

**The member-facing interface landed.** One `Conversation` component in the design system — a
record, not a chat window — read through two routes that differ in what they ARE rather than in what
they can do: the sidebar destination is the member's own workspace across everything, the matter
section is one matter's file of transcripts. Both hold the whole state set the record can reach: the
four availability answers, the member disclosure, a pending turn, all five failure labels in words a
member can act on, and the truncated-context note. The list read gained a matter filter, which is the
one backend change the interface needed. The surface polls the turn rather than holding the events
socket; the socket lands with token streaming, where a frame can carry a partial answer.
