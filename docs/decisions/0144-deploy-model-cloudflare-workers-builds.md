---
number: 144
slug: deploy-model-cloudflare-workers-builds
status: Accepted
date: 2026-06-25
area: Dev tooling
summary: "The build/deploy pipeline is Cloudflare Workers Builds, not GitHub Actions. Workers Builds is connected to the GitHub repository and, on push, builds each Worker (`pnpm install --frozen-lockfile && vp run build-all`) and deploys it via Wrangler (`wrangler deploy`); deploying the scan Worker builds and pushes its Container image. This records the as-built reality and supersedes the deploy-model choice in ADR-0075 (which named GitHub Actions). GitHub Actions is retired (the `.github/workflows/ci.yml` workflow is removed); the quality gate (`pnpm check`), tests, the OpenAPI contract toolchain, and the scan EICAR acceptance test run pre-push (locally and/or as a Workers Builds build step) rather than in a standalone CI runner. Operator runbook in docs/conventions/operations.md."
---

**Deploy model is Cloudflare Workers Builds (supersedes ADR-0075).**

**Context:** ADR-0075 and the white paper recorded the deploy model as GitHub Actions ("Workers Builds was considered; GitHub Actions chosen"). The as-built reality is the opposite: the GitHub repository is connected to **Cloudflare Workers Builds**, which builds and deploys every Worker (`magna-carta`, `magna-carta-scan`) on push to `main`. The committed `.github/workflows/ci.yml` only ran `wrangler deploy --dry-run` (it never deployed) and had been failing on nearly every push — a neglected workflow, not the pipeline. The documentation drift was real enough that the GitHub-Actions belief recurred repeatedly.

**Decision:** record Workers Builds as the deploy model and retire GitHub Actions. Workers Builds, connected to the repo, runs the build command `pnpm install --frozen-lockfile && pnpm exec vp run build-all` and the deploy command `wrangler deploy` per Worker; deploying `magna-carta-scan` builds and pushes the `containers/scan` image referenced by its Container binding. Fast builds come from Workers Builds' native **Build Caching** (deps + outputs cached across builds) and **Build Watch Paths** (per-Worker monorepo scoping) — see ADR-0145 and docs/conventions/build-performance.md. The `.github/workflows/ci.yml` workflow is deleted. The white paper _Delivery model_, the root `CLAUDE.md` stack summary, and `docs/conventions/operations.md` are corrected to match.

**Scope:** this is the build/deploy pipeline only. Local dev (`wrangler dev` / Miniflare), the `vp` toolchain, and source control on GitHub are unchanged. The rendered `docs/decisions/0075-*.md` register entry should be marked superseded when this fragment lands on `main`.

**Consequences:** the docs match reality, so the recurring "we use GitHub Actions" misconception is removed at its source. Retiring GitHub Actions removed the automatic trigger for the quality gate (`pnpm check`), `vp test`, the OpenAPI contract gates, and the scan EICAR acceptance test — Workers Builds builds and deploys but runs no checks. That gap is closed by a tracked **`pre-push` git hook** (`tooling/git-hooks/pre-push`, activated by `vp run setup-hooks`) that runs those gates and blocks a push that would deploy a broken change; `oasdiff` and the Prism mock smoke remain review-time checks. See `docs/conventions/operations.md` (§12).
