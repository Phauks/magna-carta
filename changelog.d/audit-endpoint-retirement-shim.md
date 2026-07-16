---
category: Fixed
---

CI dependency-audit gate no longer fails repo-wide on npm's audit-endpoint brownout. npm is retiring its legacy audit endpoints (intermittent HTTP 410; retirement began 2026-07-15) and the pinned pnpm still queries them, so `pnpm audit --audit-level high` began failing at random on every pull request. The gate's governance step now passes pnpm's first-party `--ignore-registry-errors` flag, which exits 0 when the registry errors while still failing on any real high-severity advisory the registry actually reports. Harmless once pnpm moves to the bulk advisory endpoint (tracked: pnpm/pnpm#11265).
