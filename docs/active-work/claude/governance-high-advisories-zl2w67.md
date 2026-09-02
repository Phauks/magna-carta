---
worktree: /home/user/magna-carta (remote session)
area: Dependency audit — clear the HIGH advisories that turned the governance job red on every pull request
status: review
touches: pnpm-workspace.yaml, pnpm-lock.yaml, osv-scanner.toml, changelog.d/
---

The governance job started failing on 2026-09-02 for every branch, on a lockfile identical to `main`: five HIGH advisories published against packages already in the tree (four on fast-uri 3.1.5, one on @faker-js/faker 5.5.3). This stream moves the fast-uri override to the fixed line and records why the faker finding cannot be overridden away. Anything touching `pnpm-workspace.yaml` overrides or `osv-scanner.toml` should merge `main` after this lands.
