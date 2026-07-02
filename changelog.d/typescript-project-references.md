---
category: Added
---

**Incremental TypeScript type-checking (project-references build graph).** A generated
`tsconfig.build.json` per package (`tooling/tsconfig-refs`) plus a `vp run typecheck` task
(`tsc -b`) give the workspace a package-granular, cached type-check that scales with changed code
rather than total code — the foundation for the TypeScript 7 native compiler (`tsgo`) later. Landed
non-gating (not yet wired into `pnpm check`) while pre-existing latent type errors it surfaced are
fixed. Rationale and rollout: [`docs/conventions/build-performance.md`](docs/conventions/build-performance.md).
