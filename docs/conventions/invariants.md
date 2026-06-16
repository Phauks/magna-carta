# Invariants

**Status:** Active. The **domain invariants** — hard correctness constraints tied to a specific subsystem. Violating one is a bug regardless of what was asked.

These are **scoped, not universal:** each binds only when you work in its area. Broad, cross-cutting rules — UI/design system, data access, error & bug logging, documentation, feature parity, reuse-before-building — are **golden rules** in the root [`CLAUDE.md`](../../CLAUDE.md), not here. Each code area's local `CLAUDE.md` restates the invariants that apply there, so they surface in context. Each cites its white-paper area and the ADR that set it.

## Money & accounting

- **Append-only ledger & audit.** Never mutate or delete a ledger or audit row; corrections are new, balancing entries. (_Financial Core_; ADR-0008)
- **Balanced entries on leaf accounts.** Every ledger entry has ≥ 2 same-currency lines whose debits equal credits, posted to active leaf accounts only (parents are roll-ups); line amounts are always positive — direction is data, never a sign. (_Financial Core_; ADR-0072)
- **Materialized balances are derived state.** `account_balance` rows update only inside the posting batch and must always equal the recomputed sum of lines (fitness query); bounds violations abort the whole batch. (_Financial Core_; ADR-0072, prepares ADR-0009)

## Trust

- **No-negative trust balance.** A client trust ledger can never go negative — enforce on write. (_Trust accounting_; ADR-0009)
- **Fees never touch trust.** Trust/IOLTA deposits land gross; processor fees debit the operating account only, never netted from a trust deposit. (_Payments_; ADR-0032)

## Matters & numbering

- **A matter number is frozen at assignment, unique per firm.** It is drawn when a matter opens (a prospective consultation has none) and never changes except by a deliberate renumber; a partial UNIQUE index on `matter_number` is the concurrency backstop, so two simultaneous draws yield distinct numbers. (_Matters and File Manager_; ADR-0079)
- **Closed is archived-but-additive.** A closed matter still accepts documents; closing runs the named close-precondition registry first (the Financial Core registers the zero-balance rule later). (_Matters and File Manager_; ADR-0080)

## File Manager

- **The quarantine gate is a status gate enforced by reads.** Every `file_version` read filters `status = 'clean'` (and `deleted_at IS NULL` for default lists) — a pending or quarantined version is never servable; quarantine is a status, never a key scheme. A source-scan fitness function rejects any `file_version` SELECT without a status predicate. (_Matters and File Manager_; ADR-0081)
- **Versions are immutable; soft-delete only.** A committed version's bytes and metadata never change — a new version is a new row and a new R2 key; files soft-delete, versions are untouched. (_Matters and File Manager_; ADR-0077)
- **R2 keys are opaque and server-minted.** Object keys are `files/{fileId}/{versionId}`, never derived from a client-supplied path; the bytes flow direct-to-R2 and never transit the Worker. (_Matters and File Manager_; ADR-0081)

## Secrets & encryption

- **`protected()` for sensitive fields.** Encrypt/role-gate/audit sensitive identifiers via the DAL `protected()` field type — never hand-rolled crypto, never plaintext secrets in core tables. (_Encryption & key management_; ADR-0026)
- **Secrets never leave core; plugins isolated.** Each integration is its own Worker behind a typed port; it receives plaintext at call time and never sees key material. (_Plugin system_; _Encryption & key management_; ADR-0015, ADR-0026)

---

> Data access (firm-scoping through the DAL) and redact-by-default error logging used to live here; they are **core**, so they are now golden rules in [`CLAUDE.md`](../../CLAUDE.md). The `protected()` chokepoint above _is_ part of the data-access layer, but the rule "encrypt sensitive fields" is specific enough to stay a domain invariant.
