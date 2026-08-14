# claude/model-pin-rot

**Scope.** Model-pin rot on the two surfaces that carry it: the reasoning-model default (owner flag F1)
and the platform embedding pin. Builds the mechanism that makes a pin changeable and makes a superseded
pin _noticed_; does not choose either model — both remain the owner's call and ship as Proposed.

**Files expected to touch**

- `packages/inference/src/catalog.ts` — reasoning tiers, lifecycle-verification fields, embedding pin state
- `packages/inference/src/model-pin-freshness.ts` (new) — the staleness computation and its report
- `packages/inference/src/reasoning-tier.ts` (new) — tier resolution and the deploy-configuration override
- `packages/inference/src/settings.ts` — the firm default resolves through a tier instead of a literal id
- `packages/inference/test/` — new suites for the above plus the pin-rot fitness gate
- `packages/inference/CLAUDE.md`
- `roadmap.d/ai.md` — the `ai.inference.*` nodes this changes
- `changelog.d/`, `docs/decisions/pending/` — fragments only

**Not touched.** `gateway.ts` (the ZDR guard, gateway options, and the dispatch path are unchanged),
`port.ts`, `stub.ts`, any worker composition root, any UI. No model is switched.

**Overlap watch.** `roadmap.d/ai.md` is the one shared file; everything else is inside
`packages/inference/`. Nothing here edits `CLAUDE.md`, `STATUS.md`, `ROADMAP.md`, the white paper, or
`docs/conventions/`.
