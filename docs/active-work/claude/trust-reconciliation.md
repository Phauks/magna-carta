# claude/trust-reconciliation — trust 3·2·4, the three-way reconciliation

**Scope.** The three-way reconciliation over the merged trust movement surface: a recorded bank
statement and its lines (member-entered, or CSV-imported through a preview-confirm-report flow), the
human-confirmed matching of statement lines to trust movements, the three-way proof (adjusted bank =
book = the sum of the client ledgers) with outstanding items named and disagreements recorded by leg,
and the reconciliation record whose close freezes that proof as an evidentiary row.

Flags T9, T10, T11 of `docs/research/2026-08-04-trust-accounting-analysis.md` ship as the analysis's
recommended defaults behind seams; the pull request lists them for owner review.

**Migration.** `20260805T200000_trust-reconciliation` — four new per-firm tables
(`trust_bank_statement`, `trust_bank_statement_line`, `trust_reconciliation`,
`trust_reconciliation_match`). Journal head at branch time was idx 31
(`20260805T170000_trust-disbursement-authorization`), so this stream takes the next dense idx, **32**,
and keeps the journal dense on its own branch. A custodian branch expects tag `20260805T180000` and an
extraction branch may take `20260805T190000`; both sort before this one, so the apply order is right
whatever the merge order, and the second to merge retags to the idx that is then free.

**Files expected to be touched**

- `packages/trust/src/{bank-statements,statement-import,matching,three-way-proof,reconciliation}.ts`
  (new), `statements.ts`, `types.ts`, `fitness.ts`, `CLAUDE.md`, and `packages/trust/test/`
- `packages/database/src/per-firm-schema.ts`, `drizzle/per-firm/` (migration + `meta/`),
  `packages/database/test/`
- `packages/identifiers/src/{registry,types}.ts`
- `packages/data-access/src/pii-registry.ts`
- `apps/worker/src/routes/trust-reconciliation.ts` (new), `src/app.ts`,
  `src/per-firm-migrations.ts`, `src/contracts/problem-types.ts`, `openapi/openapi.json`, and the
  conformance operation list
- `packages/api-client/src/*.gen.ts` (regenerated)
- `packages/fixtures/src/load-profile/` (trust volume + measurements + baseline)
- `changelog.d/trust-reconciliation.md`, `status.d/3-2-trust-accounting-jurisdiction-compliance.md`

**Overlaps to watch.** `packages/database/drizzle/per-firm/meta/` and the OpenAPI snapshot plus the
generated api-client are moved by two other streams; the second to merge retags the journal entry and
regenerates the contract.
