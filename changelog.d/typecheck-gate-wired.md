---
category: Changed
---

**The type-check gate now runs incrementally and is enforced.** `pnpm check` type-checks via
`tsc -b` over the project-references graph (fast + incremental) instead of `vp check`'s whole-repo
type pass, which was too slow to complete and had been letting real type errors slip onto `main`.
`vp check` keeps fmt and lint (including type-aware lint rules); scope the type-aware pass to changed
files in the local loop. See [`docs/conventions/build-performance.md`](docs/conventions/build-performance.md).
