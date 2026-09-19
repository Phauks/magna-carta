# @magna-carta/safe-browse — local notes

Worker-consumed safe website viewer package. Given a suspect URL, it renders the page in
Cloudflare's isolated remote browser and returns a static snapshot (`SafeView`). The suspect page
is never rendered in the user's browser — isolation is architectural, not a runtime flag.

Outputs are inert: a base64 screenshot image and escaped text/markdown. HTML is never returned or
re-rendered as live markup anywhere in the pipeline.

All outbound effects (redirect following, remote browser rendering, DNS resolution) arrive through
the injected `SafeBrowseDeps` interface — the worker supplies real implementations; tests pass
fakes. There is no global `fetch` or browser call anywhere in this package.

**SSRF invariant (local, enforced here).** The target is user-supplied. Every entry point that
accepts a user-supplied URL MUST call `assertPublicTarget` (from
`@magna-carta/integrations/safe-target`) before making any outbound connection or passing the URL
to the renderer. Never pass an unvalidated target to `SafeBrowseDeps.probe`,
`SafeBrowseDeps.renderer`, or `SafeBrowseDeps.resolve`.

**A refusal from the renderer is a `RendererFailure`, never a message to pattern-match.** The
service states its reason in an `errors` array; `renderer-failure.ts` carries the HTTP status and
the error code out of it and nothing else, because the message beside them can quote the suspect URL
and a failure object that cannot hold the target cannot leak it. That is what makes it safe to log,
and both the transient and permanent paths do. Never signal a renderer fault by throwing a string
for a caller to `includes` — that is exactly what collapsed an entitlement failure, a permission
failure and a rejected parameter into one "at capacity" answer.

Screenshots are transient — they are returned to the caller and are not persisted anywhere in this
package. Persistence policy is the caller's responsibility.

The orchestrator `captureSafeView` (added in a later task) wires the redirect probe and browser
renderer together behind the worker route. `src/capture.ts` (added in a later task) is the public
entry point for the orchestration logic.
