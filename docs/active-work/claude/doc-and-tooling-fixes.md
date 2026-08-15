# claude/doc-and-tooling-fixes

**Scope.** Four unrelated small corrections, each self-contained: the scoped gate learns to name the
stale-workspace-link false positive; two stale trust documents are corrected to what shipped on
2026-08-12; the white paper's _Payments_ card-capture wording is corrected to the accepted decision;
and `idempotencyMiddleware` gains the warning that keeps it away from a signature-verifying route.
No behaviour changes anywhere in the product — one tooling diagnostic and three documentation
corrections.

**Files expected to touch**

- `tooling/check-scoped/index.mjs` — capture the type-check step's output and, on a TS2307 against a
  `@magna-carta/` specifier with the generated build references in sync, print the `pnpm install`
  remedy
- `packages/trust-jurisdictions/CLAUDE.md` — the carve-out gotcha said "NOT wired"
- `packages/trust-jurisdictions/src/data/nevada.ts` — the comment on `cited.firmFundsForBankCharges`,
  same stale claim
- `docs/Magna-Carta-White-Paper.md` — one bullet in _Payments_ (in-DOM tokenization to hosted modal)
- `docs/specs/2026-08-15-payments-design.md` — the drift note that pointed at that bullet
- `packages/data-access/src/hono-idempotency-middleware.ts` — a comment on `idempotencyMiddleware`
- `docs/active-work/`, `changelog.d/` — this note and one fragment

**Not touched.** No trust source, no composition guard, no payments code, no schema, no migration,
no test fixtures. The white paper edit is one bullet in one topic and nothing else in that area.
Nothing in `roadmap.d/`, `status.d/`, or `docs/decisions/pending/` — nothing here is a new decision
or a status change.
