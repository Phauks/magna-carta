# claude/tools-reality-check — Tools catalog reality check

**Scope.** An audit, not a build. Trace every tool in the `@magna-carta/tools` catalog end to end
(manifest → route → package → whatever it reaches outward for), exercise each as far as a local
Miniflare worker and real outbound HTTPS allow, and classify each honestly: works here, works only
after a named deploy step, broken by a defect, or undeterminable. Only cheap unambiguous repairs are
made; everything larger is a finding with evidence.

**Deliverable.** `docs/research/2026-08-15-tools-reality-check.md`.

## Files expected to change

- `docs/research/2026-08-15-tools-reality-check.md` (new — the audit)
- `docs/deploy-queue.md` (additive: the OCR worker's missing entry) — **also declared by
  `claude/passive-dev-orchestrator-m7f9jw` and `claude/search-r2-adapter`; edit is one new section,
  appended, no reflow of existing ones**
- `roadmap.d/integrations.md` (note corrections on tool nodes) + `docs/now.md` +
  `docs/register-history.json` (re-rendered by `vp run register-build`) — **`docs/now.md` is also
  declared by four other streams**
- `packages/whois/src/legacy.ts`, `packages/whois/src/index.ts`, `packages/whois/test/legacy.test.ts`
- `apps/worker/src/routes/whois.ts`, `apps/worker/test/whois-route.test.ts`,
  `apps/worker/openapi/openapi.json`, `packages/api-client/src/types.gen.ts`
- `apps/web/src/lib/tools/whois/whois-lookup.ts`, `apps/web/test/whois-lookup.test.ts`
- `changelog.d/tools-reality-check.md`

## The one repair

A WHOIS query for a registry that publishes neither an RDAP service nor a port-43 host this package
knows returned `500 Internal Server Error` with an Error ID — 234 of the 1,438 TLDs on the IANA list,
including `.ch`, `.at`, `.jp` and `.ru`. It is now a typed `UnsupportedRegistry` answered as `501`
with plain guidance, and the page classifies 501 as information rather than as our fault.
