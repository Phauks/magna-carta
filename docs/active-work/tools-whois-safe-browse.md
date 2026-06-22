# tools-whois-safe-browse

**Owner:** Trevor Goldsmith · **Started:** 2026-06-22

Two new Tools-area security-hygiene tools: **WHOIS Lookup** and **Safe Website Viewer**.

**Scope:** new `web-domains` subject group + `website` context tag + two catalog rows in
`@magna-carta/tools`; new packages `@magna-carta/whois` (RDAP-first + port-43 fallback) and
`@magna-carta/safe-browse` (Cloudflare Browser Rendering snapshot); a shared SSRF guard in
`@magna-carta/integrations`; two Worker routes (`GET /api/v1/whois`, `POST /api/v1/safe-browse`)
through the chokepoint; new `tools:whois` / `tools:safeBrowse` permissions + seed migration; UI
widgets in the shell; docs.

**Expected files touched:**

- `packages/tools/src/{types,catalog}.ts` + tests (cross-cutting catalog — additive rows/group/tag)
- `packages/access-control/*` (register two `tools:*` permissions)
- `packages/integrations/*` (shared SSRF guard, with the http transport seam)
- `packages/whois/**` (new), `packages/safe-browse/**` (new)
- `apps/worker/src/routes/{whois,safe-browse}.ts` (new) + contract/route-meta + wrangler `BROWSER` binding
- worker permission seed migration
- `docs/specs/2026-06-22-whois-and-safe-website-viewer-design.md`, `docs/user/*`, white paper,
  ROADMAP, `changelog.d/`, `docs/decisions/pending/`

**Status:** design spec written + committed; implementation plan next.
