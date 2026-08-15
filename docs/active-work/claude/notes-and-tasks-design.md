---
branch: claude/notes-and-tasks-design
worktree: C:/dev/magna-carta-worktrees/claude/notes-and-tasks-design
area: The note and activity primitive, then tasks and matter plans on top of it — design only
status: designing
touches: docs/specs/, docs/decisions/pending/, changelog.d/, roadmap.d/tasks.md, docs/now.md, docs/register-history.json
---

Two specs and one implementation plan, in a deliberate order. The **note and activity primitive**
comes first because tasks that invented their own activity record would be the second timeline in the
codebase; **tasks and matter plans** stand on it. Design only — no schema, no migration, no route, no
feature code. Every decision that touches privilege, work product, or what a client can see is
analysis plus a numbered owner flag in a fresh **W** series, never a decision taken here.

Correcting `roadmap.d/tasks.md` (four nodes whose evidence asserts no spec exists) and re-rendering
`docs/now.md` + `docs/register-history.json` with `vp run register-build` — coordinate before editing
those two, they are generated and shared.
