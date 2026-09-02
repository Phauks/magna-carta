---
worktree: /home/user/magna-carta (remote session)
area: Dependency audit — clear the HIGH advisories that turned the governance job red on every pull request
status: review
touches: pnpm-workspace.yaml, pnpm-lock.yaml, osv-scanner.toml, apps/api-worker/package.json, docs/conventions/api.md, docs/conventions/operations.md, docs/Magna-Carta-White-Paper.md, roadmap.d/platform.md, docs/now.md, changelog.d/
---

The governance job started failing on 2026-09-02 for every branch, on a lockfile identical to `main`: five HIGH advisories published against packages already in the tree (four on fast-uri 3.1.5, one on @faker-js/faker 5.5.3). This stream moves the fast-uri override to the fixed line and removes the Prism mock server from the dependency set, which is the only way the faker finding leaves: its carrier cannot load the fixed line. The docs that described Prism as a CI step are corrected to say it runs on demand. Anything touching `pnpm-workspace.yaml` overrides or `osv-scanner.toml` should merge `main` after this lands.
