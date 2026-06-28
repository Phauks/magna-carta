# worktree-ai-text-detection

**Stream:** AI-Text Detection — vendor-agnostic core (Tools area).
**Started:** 2026-06-28 · **Owner:** Trevor Goldsmith

## Scope

Build the agnostic core of an AI-text detection capability: a pure `@magna-carta/ai-detection`
package on the integration ports-and-adapters framework, plus its Tools-catalog row. No concrete
vendor wired (deferred adapter returns `not-connected`). Spec/plan:
`docs/specs/2026-06-28-ai-text-detection-{design,implementation-plan}.md`.

## Files expected to touch

- Create: `packages/ai-detection/**` (new package — port, report, normalizer, consent, manifest,
  deferred adapter, tests).
- Modify: `packages/access-control/src/registry.ts` (add `tools:aiTextDetection` permission).
- Modify: `packages/tools/src/catalog.ts` (add the `ai-text-detection` row).
- Add: `docs/active-work/worktree-ai-text-detection.md` (this file), spec + plan under `docs/specs/`.

## Deferred (not this stream)

Concrete vendor HTTP adapter + credential scope · document text-extraction · Tools UI widget · firm
consent setting + gate · worker route + role-seeding · matter-action · metering.
