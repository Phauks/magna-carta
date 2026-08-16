# `claude/ai-search-1` — AI Search integration, slice 1

**Scope.** Slice 1 of the Cloudflare AI Search integration
([design](../specs/2026-08-06-ai-search-integration-design.md),
[plan](../specs/2026-08-06-ai-search-integration-implementation-plan.md)), tasks **1, 2, 3, 4, 6, 7,
8, 9**. The feature is built with every gate closed: no instance exists for any firm and no firm
produces a feed object.

**Deliberately not in scope: task 5, the retrieval port's adapter and the retrieval route.** It is
gated on the filter-wall experiment's E1 and E2, whose live half has not run
([record](../research/2026-08-07-ai-search-filter-wall-experiment.md)). The one carve-out taken from
task 8 is the typed `instance-not-provisioned` outcome and the default port resolution on an absent
binding — a not-configured seam rather than a query surface.

## Files this stream expects to touch

**New — `packages/search/`**

- `src/natural-language-settings.ts`, `src/natural-language-disclosure.ts`,
  `src/natural-language-instance.ts`, `src/natural-language-feed.ts`,
  `src/natural-language-port.ts`, `src/natural-language-statements.ts`,
  `src/natural-language-audit.ts`, `src/natural-language-topics.ts`
- `CLAUDE.md`, `package.json` (export paths), tests under `test/`

**Changed — `packages/database/`**

- `src/per-firm-schema.ts` (feed catalog, usage meter, firm disclosure acknowledgement, the matter
  exclusion column), `src/control-plane-schema.ts` (the instance record)
- one new migration in each lineage plus its `meta/` snapshot

**Changed — `apps/worker/`**

- `src/per-firm-migrations.ts`, `src/control-plane-migrations.ts` (hand registration)
- `src/search/` — the feed writer inside the existing index job, the provisioning/teardown and
  deletion handlers, the keep-alive sweep, the instance-binding resolver
- `src/search/index-consumer.ts` (a second consumer of the extraction already computed there)
- `src/costs/recoverable-charge-consumer.ts` (three rows in the per-firm topic dispatch table)
- `src/index.ts` (the weekly keep-alive on the existing sweep), `wrangler.jsonc` (the two bindings)

**Changed — `packages/telemetry/`**

- `src/events.ts` (the error-pipeline event builders)

**Cross-cutting, appended not rewritten:** `roadmap.d/ai.md` (one new node), `status.d/`,
`changelog.d/`, `docs/decisions/pending/`, `docs/user/`, `docs/operating-costs.md`,
`docs/conventions/operations.md` (the gateway-posture runbook step).

## Overlap to watch

`packages/database`'s two schemas and the two migration journals are the collision-prone files —
another stream adding a migration takes the next timestamp, not the next index. `roadmap.d/ai.md`,
`docs/conventions/operations.md` and `packages/telemetry/src/events.ts` are appended to, never
restructured.
