---
number: 43
slug: code-management-github-source-control-github
status: Accepted
date:
area: Code management
---

**GitHub for source control + GitHub Actions for CI/CD.** Repositories, branch protection, **pull requests** (the maintenance and diagnostics agents open _draft_ PRs), code review, and issues live on GitHub. **GitHub Actions** runs the quality gate (`vp check`), tests (`vp test`, Playwright, visual-regression), and the OpenAPI spec toolchain (Spectral/Prism/oasdiff/SDK-gen), then **deploys to Cloudflare via Wrangler** (auth via OIDC / encrypted secrets). **Cloudflare Workers Builds** considered but GitHub Actions chosen for flexibility and because the propose-only agent PR workflow already centers on GitHub.
