# claude/nevada-trust-corpus

**Scope.** Encode the Nevada trust-accounting jurisdiction corpus over the existing jurisdiction seam
in `@magna-carta/trust`, review-gated. Nevada only; every other jurisdiction stays explicitly
not-encoded and the existing refusal behaviour is unchanged.

Three parts: primary-source research into Nevada's own published rule text (RPC 1.15, the Nevada
Supreme Court Rules, State Bar guidance); a new `@magna-carta/trust-jurisdictions` package holding the
typed Nevada profile with its citations and the resolver; and the attorney-review gate, under which an
encoded-but-unreviewed jurisdiction surfaces as not-verified and does not resolve. Nevada ships
NOT-VERIFIED.

**Files expected to be touched.**

- `docs/research/2026-08-07-nevada-trust-accounting-rules.md` (new)
- `packages/trust-jurisdictions/**` (new package)
- `packages/trust/src/trust-validation.ts` (one added refusal code)
- `packages/trust/src/jurisdiction.ts` (documents the third refusal)
- `changelog.d/`, `docs/decisions/pending/`, `status.d/3-2-trust-accounting-jurisdiction-compliance.md`

**Migration disposition: none.** Jurisdiction rules are shared reference data compiled into a package,
not per-firm rows — a rule correction is a package release rather than a migration against every
tenant. The per-firm side the profile binds to (`trust_account.jurisdiction`) already exists. No
`.sql` is added, so nothing is registered in `apps/worker/src/per-firm-migrations.ts` and no contingent
journal index is consumed.

**Not in scope.** The firm-funds bank-charge carve-out is NOT enabled — see the research document and
the pull request for why Nevada's rule text does not settle what the built `firm_funds` leaf would
need. The composition guard keeps refusing `firm-funds-node-not-enabled`.
