# @magna-carta/exhibits — CLAUDE.md

**Purpose.** A matter's exhibits and the ordered sets they are filed in. An exhibit is one
document's identity on a matter (a stable reference name over an ordinary matter file); a set is the
ordered membership for one filing, with a numbering scheme; a member's label is computed from its
position while the set is a draft and frozen when a member records that the set went out. This
package validates in memory and composes statements into `@magna-carta/data-access`'s effect batch;
it holds no binding, reads no clock, and never touches a byte of a document.

**White paper:** _Document Automation_ and _Core domain — Matters and File Manager_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md`](../../docs/specs/2026-08-11-exhibits-and-exhibit-lists-design.md).

## Key files

- `src/scheme.ts` / `src/label.ts` — the scheme shape and `labelFor(position, scheme)`. Pure, no
  imports beyond each other; everything else rests on them
- `src/label-moves.ts` — which labels a proposed reorder moves, computed before anything is saved
- `src/presets.ts` — the default scheme and the starter schemes a member may copy
- `src/reference-name.ts` — the one-shot mint of an exhibit's reference name
- `src/exhibit-*.ts`, `src/set-*.ts`, `src/member-*.ts` — create, edit, archive, add, remove, reorder
- `src/issue-service.ts` — the issue batch: **the only writer of `exhibit_set_member.label`**
- `src/withdrawal-service.ts`, `src/correction-service.ts`, `src/supersession-service.ts` — what
  stays possible after issue
- `src/queries.ts` — the set read, the set list, the matter register and the continuation chain,
  one statement each

## Invariants that apply here

- **A draft label is computed, never stored.** No read of a draft consults the `label` column and
  no path but the issue batch writes it; `test/purity.test.ts` scans the source for both. A stored
  draft label would need a renumber sweep on every insert, removal and reorder.
- **An issued set never changes.** Triggers in the `exhibits` per-firm migration refuse an insert,
  a delete, or a change to a member's label, position, as-issued title or as-issued version once
  the set is issued, and refuse moving the set out of `issued`. Services refuse the same operations
  by name first (`exhibit-set-issued`) so a caller sees a reason, not an abort.
- **Withdrawal retires a label; it never frees it.** The member keeps its label and position, and a
  continuing set starts past the highest consumed ordinal, withdrawn ones included.
- **A correction writes beside the as-issued values, never over them**, and names no label or
  position, so it cannot renumber.
- **No exhibit route accepts bytes.** Every attach takes a `file` id that already exists on the
  matter with a clean version.
- **No title, label or reference name reaches an audit row or a telemetry dimension.** Identifiers,
  counts and closed vocabulary values only.

## Gotchas

- **Draft positions run 1..n with no gap.** A removal closes the gap and a reorder replaces every
  position at once. Both park rows on negative positions first, because an UPDATE visits rows in no
  promised order and the `(exhibit_set_id, position)` unique index would see two rows on one slot
  halfway through a shift.
- **A reorder and an issue are guarded on the membership they read.** A member added between the
  read and the commit makes the guarded statement match nothing, and the batch is refused rather
  than committing an order that leaves someone out.
- **The vocabularies on `exhibit_set` are complete on day one** (both roman cases, both overflow
  forms, four dispositions) because members point at the table, and widening a parent table's CHECK
  is a rebuild a durable object refuses.
