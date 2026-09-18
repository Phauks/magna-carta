---
slug: every-number-the-firm-issues-is-drawn-from-one-register
status: Accepted
area: Platform
date: 2026-09-18
summary: "Every number the firm issues is drawn from one register in @magna-carta/sequence-numbering: one row per purpose naming what the sequence is, when it is drawn, whether the firm shapes it and with which parts, and what renders until it does. The segment-template scheme engine that lived in matters moves into that package beside the counter mechanism it already held; conflicts checks and custody packets join the register as scheme-shaped purposes and draw through the shared planner instead of a hard-coded prefix over MAX + 1 and a fixed-shape record nothing ever configured; invoice, time-entry and call numbers are registered with their fixed shapes so the one settings screen (Settings › Practice › Numbering, the former Matter Numbering) is the whole inventory. The conflicts default becomes CC2026-00001, restarting each year with five digits, because a four-digit firm-wide run was the wrong default for the busiest sequence a firm has; numbers already drawn keep the numbers they were, and the firm-wide counter is seeded past them."
---

**One register, one engine, one screen: a firm decides the shape of every number it issues in one
place, and a new sequence is one row rather than a new engine.**

**Context:** The platform numbered eight kinds of record and answered "what shape is this number,
and can the firm change it?" in four different ways. Matters had a real engine — an ordered segment
template with exactly one counter, per-purpose schemes on `numbering_scheme`, a settings editor with
a live preview — and it was matters' own, in `packages/matters/src/numbering/`. Custodian carried a
second scheme model (`CustodyNumberScheme`: prefix, width, scope-by-root) whose design said the firm
would configure it through scoped settings; nothing ever read a setting, so every firm drew
`CUS-00001` and the model was dead configuration. Conflicts rendered `CC-` and four digits from
`MAX(check_sequence) + 1` under a unique index, with a private retry loop, no counter table and no
way to change it — and a firm-wide four-digit run is the wrong default for the busiest sequence a
firm has, since every intake, every new party and every automatic re-check opens a check. Invoice,
time-entry and call numbers each rendered a fixed shape in their own package over the shared
counter. The counter mechanism itself had already been extracted once, into
`@magna-carta/sequence-numbering`, precisely because copies of it drifted; the layer above it had
not been, and was drifting the same way. The owner's request of 2026-09-18: consolidate the manner
and method by which numbers are assigned into a single modular component the firm decides the
formulation of, and stop conflicts checks running out.

**Decision:** `@magna-carta/sequence-numbering` becomes the one home of the whole draw, in four
layers, and every consumer composes rather than copies.

1. **The register** (`purposes.ts`): one row per purpose — `matter`, `consultation`, `intake`,
   `conflicts_check`, `custody_packet`, `invoice`, `time_entry`, `communication` — naming its
   title, its label, when its number is drawn, its formulation (`scheme` or `fixed`), and for a
   scheme-shaped purpose the parts a scheme may use, the prefix that keeps its counters separate in
   a shared table, and the built-in default or `null` to refuse. The three defaults that lived as
   three files in matters, and the reasoning beside each, move here. Two facts stay in the owning
   package because they cannot leave it: the counter and allocation tables (the owner column is a
   foreign key to the owning row) and the rendered-string collision only that package's own unique
   index can see.
2. **The scheme engine** (`segments.ts`, `render.ts`, `scheme-statements.ts`, `scheme-service.ts`)
   moves out of matters unchanged in shape, with one addition: a scheme is validated against its
   purpose's vocabulary at the save (`schemeSchemaFor`), so a conflicts check scheme naming a
   client code is refused where the person who wrote it is looking rather than on the first draw.
3. **The draw planner** (`scheme-draw.ts`): `planSchemeDraw` loads the scheme in force, derives the
   scope under the purpose's prefix, reads the counter and renders; `schemeDrawOpeningStatements`
   are the consumer's first two statements; `previewNextNumber` is the "identified before it is
   saved" read every opening screen makes. Matters' inline draw, conflicts' loop and custodian's
   loop all become the planner plus their own batch under the shared bounded retry.
4. **The one screen**: `Settings › Practice › Numbering` lists every purpose from
   `GET /api/v1/numbering-schemes`, one plate each — the editor for a scheme-shaped purpose, with
   only the parts and starters that purpose may use; the fixed shape and the reason for a fixed
   one. The sample every example and preview renders against travels with the listing, so the
   screen keeps no second copy of the register or the sample. `/settings/matter-numbering` redirects.

**Conflicts checks** gain `conflicts_check_number_counter` and `conflicts_check_number_allocation`,
the unique index on `check_sequence` is dropped (a sequence restarting per year draws a 1 twice; the
rendered number's index stays and is the draw's retryable collision), and the default renders
`CC2026-00001`: the CC that says what the record is, the year, and a five-digit count that restarts
each January, so the run keeps the width a person expects. Padding is a floor, never a ceiling — a
run past its width grows a digit rather than wrapping or refusing — so the concern was never that a
sequence stops, but that a firm-wide count stops looking like the reference on its intake sheets.
Numbers already drawn keep the numbers they were, and the migration seeds the firm-wide counter past
`MAX(check_sequence)` so a firm that chooses to keep a firm-wide `CC-` run under its own scheme
continues from where the old run stopped instead of colliding with it.

**Custody packets** draw from the `custody_packet` purpose with the default `CUS-00001`, the shape
custodian always rendered, so nothing already labelled changes; the dead `CustodyNumberScheme`
model and its `scopeByRoot` are deleted. A firm that wants its custody numbers to restart each year
writes that on the numbering screen.

**Considered and rejected:** **Registering purposes at runtime from each package** — a static table
is what lets a reader see every number the platform draws without starting it, and the ADR
precedent for the per-purpose facts (the intake sequence) was a table for the same reason.
**Making invoice, time-entry and call numbers scheme-shaped in the same change** — an invoice
number's per-letterhead scope is a finalize-time choice on its own contract, a time entry's number
is the matter's number by ruling, and a call's number carries the day by ruling; each is listed on
the register with its fixed shape and the reason, so the screen is complete and any of them can
become scheme-shaped later as one row flipping from `fixed` to `scheme`. **A single continuing
firm-wide default for conflicts checks with more digits** — a wider firm-wide count still grows past
its width in a busy firm; restarting the count each year is what keeps the number's shape stable,
and it is what the consultation and intake defaults already do. **Keeping matters' export paths as
re-exports** — a re-export is a second home for the same fact, and the imports were eleven lines.
