---
category: Fixed
---

CI dependency-audit gate no longer fails repo-wide on npm's retired audit endpoints. npm retired the legacy `pnpm audit` endpoints (HTTP 410; full retirement 2026-07-15) and pnpm does not yet query the replacement bulk advisory endpoint, so `pnpm audit --audit-level high` began failing on every pull request. The gate's governance step now tolerates only that specific endpoint-retirement error — during which no advisory signal is available anyway — while still hard-failing on any real high-severity advisory. It self-heals once pnpm ships bulk-endpoint support (tracked: pnpm/pnpm#11265).
