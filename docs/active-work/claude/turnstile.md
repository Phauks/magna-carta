# claude/turnstile — human verification on the anonymous endpoints

**Scope.** Build the server side of Cloudflare Turnstile verification for the platform's anonymous
write endpoints, dormant until the owner provisions the secret. Turnstile has been treated as
adopted across four merged designs while existing only as an unticked box in the operations runbook;
this stream turns it into a running control with a typed absence, so the gap is observable instead of
assumed closed.

**Out of scope, deliberately.** The client widget. Nothing here renders a Turnstile challenge or
mints a token — UI surfaces stay with the owner. The server therefore ships enforcing nothing until
both the secret and the widget exist.

**Files expected to be touched.**

- `apps/worker/src/human-verification/` (new): the port, the siteverify adapter, the wiring, the
  route-level gate.
- `apps/worker/src/app.ts` — two optional bindings, one `CreateAppOptions` seam.
- `apps/worker/CLAUDE.md` — one section for the new subsystem (**overlap:**
  `claude/stub-masked-wiring`, `claude/teardown-fix`).
- `apps/worker/src/routes/registrations.ts`, `apps/worker/src/routes/invitations.ts` — the gate at
  the two anonymous writes, plus their new declared responses.
- `apps/worker/src/contracts/problem-types.ts` — one new problem type.
- `apps/worker/openapi/openapi.json` + `packages/api-client` — re-emitted contract (**overlap:**
  `claude/shipment-refusal`, `claude/stub-masked-wiring` both declare these).
- `packages/telemetry/src/metrics.ts` — one metric declaration.
- `apps/worker/test/human-verification*.test.ts` (new).
- `docs/deploy-queue.md` (**overlap:** `claude/passive-dev-orchestrator-m7f9jw`,
  `claude/search-r2-adapter`, `claude/shipment-refusal`), `docs/conventions/operations.md`,
  `roadmap.d/auth.md`, `status.d/`, `changelog.d/`, `docs/decisions/pending/`.
- `apps/web/src/lib/auth/unbuilt-capabilities.ts` — the `human-verification` entry, restated. The
  server half exists now; the widget does not, so the entry narrows rather than disappearing.

**Open for the owner.** The fail-open posture when Turnstile is unconfigured is flagged for
ratification in the pending ADR; the widget is a UI change this stream will not make.
