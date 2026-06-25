---
category: Security
---

**Upgraded `hono` 4.12.23 → 4.12.27 (catalog).** Closes five upstream advisories in the API framework, including a high-severity one where the CORS middleware reflects any `Origin` with credentials when `origin` defaults to the wildcard, plus a `serve-static` path-traversal on Windows via encoded backslash. The Worker does not use the CORS or `serve-static` middleware, so this is a proactive bump with no behavior change. (`pnpm-workspace.yaml`, `apps/worker`, `packages/data-access`)
