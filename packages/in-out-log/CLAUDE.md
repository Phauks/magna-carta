# @magna-carta/in-out-log — CLAUDE.md

**Purpose.** The In/Out Log: what crosses the front desk that is not held in custody. Copies, papers,
a physical file handed back. One row per thing dropped off, numbered, To one or more people, and then
picked up or moved into Custodian. Validates in memory and composes statements into
`@magna-carta/data-access`'s effect batch; holds no binding, reads no clock, and calls no service.

**White paper:** _Custodian_, with _Directory_ and _Tenancy and data isolation_ as the surrounding
context — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-11-19-in-out-log-design.md`](../../docs/specs/2026-11-19-in-out-log-design.md).

## Key files / entry points

- `src/types.ts` — the party kinds, the statuses, the ceilings
- `src/validation.ts` — every refusal as a code the route maps to a problem type, and the
  normalization of the description, the optional text fields and each person
- `src/numbering.ts` — the counter and allocation table names for the `in_out_entry` run on the
  numbering register, and the two conflicts a losing draw raises
- `src/entry-statements.ts` — the SQL: the shared SELECT with the matter and packet joins, the page
  read with its search, and the guarded transitions
- `src/entry-service.ts` — Drop Off, Pick Up, the link to a custody packet, and Delete, each one
  batch with its audit row

## Local conventions

- **The log is the lighter record, on purpose.** Custodian requires a Directory owner, draws a
  custody number and moves only by append-only ledger rows, because it holds a client's originals.
  The owner ruled on 2026-11-19 that copies and returned files must not cost that. So an entry's few
  transitions overwrite its own columns, and the audit row beside each one is the history.
- **A person is one of three kinds** — a member, a Directory person or organization, or a typed name
  — on the custody borrower's model. The name is stored for every kind, because a log records who it
  was at the time and the screen reads it without a join per row.
- **Words on screen are Drop Off, Pick Up, To, Waiting for Pickup and Log** (owner, 2026-11-19).
  "Check out" and "return" already mean lending a packet in Custodian; this log never uses them.

## Invariants that apply here

- **Every read composes the visible-matter predicate**, as a required argument. An entry with no
  matter is visible to everybody who may read the log; an entry on a matter is visible exactly when
  the matter is, so the custody holding matter is unreachable here.
- **An entry only moves forward**: waiting to picked up, or waiting to moved to Custodian. Both
  transitions are `guarded` on `status = 'waiting'`, so two people pressing Pick Up on one envelope
  cannot both be told they handed it over.
- **Delete is for a mistake, and only while waiting.** Once something has been handed over or put
  into custody, the row is the record of that. The number is not given back.
- **The audit row carries identifiers and the entry number, never the description or a name.** What
  a client's papers are is the client's business.
- **Identity checked is a yes or no, never a document number.** A number written here could not be
  taken back and nothing about the log needs it.
- **The number is drawn in the same batch as the entry**, under the shared register's draw planner
  and the caller's `drawWithBoundedRetry`; nothing here renders a number.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/database`, `@magna-carta/identifiers`,
  `@magna-carta/sequence-numbering`, `@magna-carta/civil-time`, and `@magna-carta/calendar` for the
  visible-matter predicate alone.
- Routes: `apps/api-worker/src/http/routes/in-out-log/`, behind `inOutLog:read` and
  `inOutLog:manage`. The screen: `apps/web/src/lib/in-out-log/` and `/in-out-log`.
- Move to Custodian is two writes by design: Custodian's own New Packet route logs the packet under
  `custody:manage`, then this package links the entry to it. Nothing here writes a custody row.

## Gotchas

- The waiting read is oldest first and the whole log newest first, and the keyset cursor flips with
  the direction. Keep the ORDER BY and the cursor comparison in step.
