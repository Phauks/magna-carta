# `@magna-carta/citations` — CLAUDE.md

**Purpose.** The legal-citation engine: reads a pasted link or rough citation into a kind and
fields, keeps where each field came from so the member's typing overrides what was read, and
formats a citation in a court's format in its full, short and _Id._ forms. Pure: no Svelte, no
network, no `env`, so the browser, the Worker, Magnus and document assembly all run the same code.

**Design:** [`docs/specs/2026-11-09-legal-citations-design.md`](../../docs/specs/2026-11-09-legal-citations-design.md).

## Key files / entry points

- `src/recognize.ts` — `recognize(text)`: links (CourtListener, govinfo link service, Cornell LII,
  eCFR, Nevada Legislature, California Legislative Information, Westlaw, Lexis) and rough citation
  text. Returns a `lookup` request where only a provider can fill the rest; never fetches.
- `src/draft.ts` — a citation being built. `applyReading` (link < lookup), `overrideField` (typed
  wins and survives a re-read), `restoreField` (Undo).
- `src/format.ts` — `formatCitation(kind, fields, format, form)`; italics are `runs`, never markup.
- `src/formats.ts` — base styles, the shipped court formats, `resolveFormat` (document, matter
  court, matter state, firm default, uniform).
- `src/reporters.ts`, `src/california-codes.ts` — the reporter and code tables.
- `src/sources.ts` — the "Available Sources" list the interface shows.

## Local conventions

- **Never the Bluebook's text or name.** Rules are implemented from The Indigo Book (public domain,
  CC0) and cited by its rule and table numbers (`R15`, `T11`). The Bluebook is copyrighted and its
  name a trademark; the style is called "Uniform System (Indigo Book)".
- **Report, never invent.** A required field with no value is listed in `missing` and rendered as a
  placeholder; the formatter does not guess a court, a year or a pin cite.
- **Every rule applied is named** in `rules`, and every court difference names its source rule
  (`NRAP 36(c)(3)`), so a reviewer can check the result.
- **A new court format is data** in `formats.ts`, `reviewed: false` until an attorney checks it;
  `resolveFormat` never selects an unreviewed format by itself.
- Adding a reporter: one row in `REPORTERS`. Free Law Project's reporters-db (BSD) is the intended
  full table.
