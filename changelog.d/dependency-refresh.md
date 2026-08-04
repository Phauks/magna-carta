---
category: Security
---

**Refreshed the npm dependency catalog and recorded verified remediation verdicts for the advisories the
audit gate still accepts.** `hono` moved 4.12.27 → 4.13.0, which crosses 4.12.34 — the release that fixed
four security defects reachable from a Worker: cross-request data disclosure in JSX, a whitespace-tolerant
CORS origin regex (ReDoS), an algorithmic-complexity denial of service in the Language middleware, and
response-header leakage in the proxy helper. Alongside it, `@hono/zod-openapi` 1.4.0 → 1.5.1,
`@tanstack/svelte-query` 6.1.34 → 6.1.38, `@internationalized/date` 3.12.2 → 3.12.3, `@lucide/svelte`
1.17.0 → 1.28.0, `@cloudflare/speedtest` 1.11.0 → 1.13.0, the three self-hosted font packages → 5.3.0, and
the dev tooling `@faker-js/faker` 10.5.0, `@types/node` 26.1.2, `@stoplight/spectral-cli` 6.16.3,
`@stoplight/prism-cli` 5.16.0, and `happy-dom` 20.11.1.

The accepted-advisory list in `osv-scanner.toml` also lost a dead entry and gained real verdicts.
`GHSA-gv7w-rqvm-qjhr` was removed: GitHub withdrew it on 2026-06-17 because the affected package was
misidentified — the flaw was in the esbuild Deno module, not the npm package — so the gate had been
carrying an ignore that matched nothing. The remaining tracked entries now record what was actually
checked rather than a bare "upgrade the carrier": the `quick-xml` advisories (RUSTSEC-2026-0194/0195) are
fixed in quick-xml 0.41.0 but reached only through `office-crypto`, which still requires `^0.38.4` as of
its newest release (0.3.0, published 2026-07-22), so no carrier upgrade can clear them; and the npm `uuid`
advisory (GHSA-w5hq-g745-h8pq) is fixed in uuid 11.1.1 but arrives through `postman-collection`, which
hard-pins uuid 8.3.2 through its newest release (5.3.1) — so an override, not an upgrade, is the only
remediation. Both entries keep their 2026-10-14 `ignoreUntil` forcing function.
