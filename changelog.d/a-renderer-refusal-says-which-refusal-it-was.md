---
category: Fixed
audience: public
---

**A renderer refusal says which refusal it was.** The safe website viewer signalled every structured
refusal from Cloudflare Browser Rendering by throwing one sentence containing the words "capacity"
and "limit", and both routes then decided the response by matching that sentence with `includes`.
Every distinguishable fault therefore collapsed into the same answer: an account without the
entitlement, a credential lacking the permission and a rejected parameter all reached the member as
a 502 saying the service was at capacity and to try again shortly. The service states its reason in
an `errors` array, and the renderer discarded it — reading only `success`, `result` and `meta` —
before anything could act on it.

The refusal now travels as `RendererFailure` (`packages/safe-browse/src/renderer-failure.ts`),
carrying the service's HTTP status and error code and, deliberately, nothing else: the upstream
message can quote the suspect URL back, so a failure that cannot hold the target cannot leak it
whatever a caller later logs. A status the service documents as momentary (408, 429, 5xx) stays the
transient 502; every other refusal describes how this worker is calling the service, which waiting
cannot fix, so it reaches the standard pipeline as a 500 with an Error ID to quote. Both paths now
log — the transient one answered and wrote nothing before, which is why the first live failure left
no trace at all. A non-2xx and an unparseable body are refusals too, rather than a `SyntaxError`
surfacing as an unexplained server fault.

## Public

**A failed page capture now says what actually went wrong.** When the Safe Website Viewer could not
capture a page, it always gave the same answer — that the service was busy and to try again in a
moment — even when trying again could never work. It now tells the two apart: a genuine momentary
outage still asks you to retry, while a problem that needs someone to fix something gives you an
Error ID to quote to support instead of sending you back to a button that cannot succeed.
