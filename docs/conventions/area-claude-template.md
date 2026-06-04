# Per-area `CLAUDE.md` template

Copy this into a code area (e.g. `src/<area>/CLAUDE.md`) when you create it. Keep it **local and specific** — cross-cutting standards belong in [`docs/conventions/`](.), and architecture belongs in the white paper. A per-area file documents only what is true _here_.

Delete this intro and fill in the sections below.

---

```markdown
# <Area name> — CLAUDE.md

**Purpose.** One or two sentences: what this area does and its boundary.

**White paper:** <section title> — <link to the white paper>. (Design and rationale live there; do not restate. Reference by title, not section number.)
**Spec:** docs/specs/<file> — <link>, if one exists.

## Key files / entry points

- `<path>` — <role>
- `<path>` — <role>

## Local conventions

- <Naming, structure, or pattern specific to this area and not covered by docs/conventions/.>

## Invariants that apply here

- <Which domain invariants from `docs/conventions/invariants.md` (and which golden rules from the root `CLAUDE.md`) are load-bearing here, and how they show up in the code — e.g. "all reads go through `firmDb()`, never the raw D1 binding.">

## Dependencies & contracts

- <What this area calls and what calls it; the typed ports/bindings it relies on.>

## Gotchas

- <Non-obvious traps, sequencing requirements, things that have bitten us.>
```
