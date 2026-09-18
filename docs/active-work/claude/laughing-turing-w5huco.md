---
worktree: /home/user/magna-carta (remote session)
area: Safe website viewer — the renderer's failure diagnosis, ahead of any interactive-browsing work
status: review
touches: packages/safe-browse/src/, apps/api-worker/src/routes/safe-browse.ts, apps/api-worker/test/safe-browse-route.test.ts
---

Makes a refusal from Cloudflare Browser Rendering readable. The renderer signalled every structured
refusal by throwing one sentence containing the words "capacity" and "limit", which both routes then
matched with `includes` — so an entitlement that is not enabled, a credential without the
permission and a rejected parameter all reached the member as "at capacity, try again shortly", and
the service's own `errors` array was discarded before anyone could read it. The refusal now travels
as `RendererFailure` carrying the service's HTTP status and error code, transient and permanent
faults answer differently, and both paths log — the transient one previously answered and wrote
nothing, which is why the first live failure could not be diagnosed.

Narrow by design: it touches the two routes' error mapping and the package's exports, nothing else.
It is the prerequisite for the interactive-browsing seam recorded in ADR-0119, which cannot be built
on a renderer whose failures are unreadable.
