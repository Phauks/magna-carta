# claude/owner-answered-batch

**Scope.** Two small, independently-decided backend items cleared in one branch.

1. **Auto-file circuit-breaker thresholds become a per-firm setting.** The owner's answer to the
   auto-file design's F7 flag: the shipped numbers (twenty-five fires per rolling hour, three undos
   within the last ten fires) stay as the platform defaults, and a firm may change them. Built on the
   established firm-setting idiom — one definition and one read helper shared by the settings route
   and the capture consumer, exactly as the scan-policy settings and the existing auto-file
   direct-filing ceiling are.
2. **Custodian's numbering moves onto `@magna-carta/sequence-numbering`.** A behaviour-identical
   refactor: custodian's copy of the counter/allocation statement builders becomes a thin
   custodian-specific shim over the shared package, on the pattern `@magna-carta/matters` already
   uses. The rendered custody-number shape and the draw's retry semantics do not change.

**Files expected to be touched.**

- `packages/email-filing/src/auto-file-rules.ts`, `packages/email-filing/src/index.ts`,
  `packages/email-filing/test/auto-file-rules.test.ts`
- `apps/worker/src/emails/auto-file-policy.ts`, `apps/worker/src/emails/auto-file-evaluation.ts`,
  `apps/worker/src/routes/auto-file-policy.ts`, `apps/worker/openapi/openapi.json`,
  `packages/api-client/`
- `packages/custodian/src/numbering/counter-statements.ts`, `packages/custodian/package.json`,
  `packages/custodian/CLAUDE.md`, `packages/sequence-numbering/CLAUDE.md`
- `changelog.d/`, `docs/decisions/pending/`, `docs/user/` (auto-file admin guide)

**Not touched.** No schema change and no per-firm migration: both items reuse tables that already
exist. No user interface — deferred to the owner.
