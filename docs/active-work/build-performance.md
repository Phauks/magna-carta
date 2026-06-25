---
branch: build-performance
worktree: C:/dev/magna-carta-worktrees/build-performance
area: Fast-builds standard + deploy-model correction (Cloudflare Workers Builds, not GitHub Actions)
status: review
touches: CLAUDE.md, docs/Magna-Carta-White-Paper.md, docs/conventions/README.md, docs/conventions/build-performance.md, docs/conventions/operations.md, containers/scan/Dockerfile, containers/scan/tests/eicar_e2e.sh, .github/workflows/ci.yml (deleted), changelog.d/, docs/decisions/pending/
---

Two coupled changes. (1) Corrects a recurring documentation error: the build/deploy pipeline is **Cloudflare Workers Builds**, not GitHub Actions — verified against Cloudflare (13 builds on push; `vp run build-all` → `wrangler deploy`). Fixes the white paper (_Delivery model_), root `CLAUDE.md` stack, and `operations.md`; deletes the unused/failing `.github/workflows/ci.yml`; records the deploy-model reversal as an ADR superseding ADR-0075. (2) Codifies build-time performance as a standing foundation (`docs/conventions/build-performance.md`, hooked into "Build when in the area") and applies the first wins: Workers Builds Build Caching + Watch Paths (dashboard ops, documented in `operations.md` §12) and BuildKit cache mounts in the scan `Dockerfile`.

The quality gates GitHub Actions used to run are re-homed in a tracked `pre-push` hook (`tooling/git-hooks/pre-push`, via `vp run setup-hooks`). Two settings still need applying in the Cloudflare dashboard (cannot be done from code): enable **Build Caching** and set **Build Watch Paths** per Worker — exact values in `operations.md` §12.

Edits cross-cutting files (`CLAUDE.md`, the white paper, `docs/conventions/`), `tooling/git-hooks/`, and `containers/scan/**` — coordinate before touching these if a scan/Container, tooling, or docs stream is active.
