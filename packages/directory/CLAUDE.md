# @magna-carta/directory — CLAUDE.md

**Purpose.** The directory domain module — persons, organizations, their names, identifiers,
contact details (email, phone, address), relationship edges, and the matter-party bridge. It
validates in memory and composes statements into `@magna-carta/data-access`'s `composeEffectBatch`;
it never runs logic mid-transaction and never calls external services.

**White paper:** _Client & contact management / directory_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).

## Key files / entry points

- `src/types.ts` — domain types: branded id re-exports, `EntityKind`, `NameRole`, `PhoneticScheme`,
  `EdgeType`, `IdentifierType`
- `src/index.ts` — public barrel; re-exports `./types.js`

## Invariants that apply here

- **All writes compose the atomic batch.** Every mutation goes through `composeEffectBatch` (never
  raw D1 outside a statement builder). Mirror the pattern in `packages/matters/src/matter-service.ts`.
- **Names are append-and-flip.** When a name changes, insert the new row and flip `is_current` on
  the old row in the same batch — never UPDATE the name text in place. The FTS5 external-content
  index (triggers) and the phonetic-code rows travel with each name row.
- **Phonetic codes on every name write.** Every insert of a `directory_name` row must be accompanied
  by phonetic-code rows for all three schemes (`soundex`, `metaphone`, `double_metaphone`) in the
  same batch statement set.
- **Sensitive identifiers only via `protectedField`.** SSN, EIN, DOB, account numbers, driver's
  licence numbers, and SSN-last-four are stored encrypted. Write them only through
  `composeProtectedWrite` from `@magna-carta/data-access/protected-fields`. Blind-index policy:
  SSN digit-strip 16-bit; account 24-bit; driver's licence state-prefixed 16-bit; EIN digit-strip
  standalone-indexed; DOB + SSN-last-four protected but never standalone-indexed.
- **Soft-delete only.** No DELETE ever targets directory tables; set `deleted_at` instead.
- **Node status for merge.** `directory_person` and `directory_organization` carry `status` and
  `merged_into_id`; these columns exist now so the merge implementation (added later) needs no
  expand-contract migration.

## Dependencies & contracts

- Depends on: `@magna-carta/data-access` (effect batches, protected fields),
  `@magna-carta/database` (schema), `@magna-carta/identifiers`, `double-metaphone`.
- Pure and synchronous (per operation): produces statements for the caller to run via the
  data-access layer; holds no D1 binding and performs no I/O of its own.

## Gotchas

- D1 has no interactive transactions — everything an operation needs must be read before composing
  the batch; never plan logic "between" statements.
- `directory_name` must NOT be WITHOUT ROWID — the implicit SQLite rowid backs the FTS5
  external-content table link.
- `NameRole`, `EdgeType`, and `IdentifierType` are application-level catalogs (open text in the
  schema); the DB only enforces `length > 0`. Add new catalog values to the `as const` union in
  `src/types.ts` before using them in write paths.
