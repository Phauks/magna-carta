# seo-noindex-hardening

**Owner:** Trevor Goldsmith · **Started:** 2026-06-22

Keep every private, authenticated surface this Worker serves out of search indexes ahead of the
(later, Fable-gated) public marketing site. The product SPA, the API, Better Auth, and every branded
per-firm subdomain serve only a firm's own privileged data and must never be indexed.

**Scope:** a single Worker response-header middleware that stamps `X-Robots-Tag: noindex, nofollow`
on every app-origin response, registered AFTER the cookieless preview route so the sealed `files.*`
edge is deliberately excluded. The existing Cloudflare-managed `robots.txt` stays as-is (it governs
crawling; the header governs indexing — complementary, not redundant). The public marketing site is a
separate future app on its own host and will not inherit this header.

**Expected files touched:**

- `apps/worker/src/crawler-directives.ts` (new — middleware + directive constant)
- `apps/worker/src/app.ts` (register the middleware after `registerPreviewServeRoute`)
- `apps/worker/test/crawler-directives.test.ts` (new — standing fitness guard)
- `changelog.d/`, `docs/decisions/pending/`, `ROADMAP.md`

**Status:** built + fitness test green; worker `vp check` + `lint:process-refs` green; sealed-edge,
telemetry, and contract/conformance suites re-verified. Ready to commit. (Full worker suite OOMs on
this machine — a known environment limit, verified in batches.)
