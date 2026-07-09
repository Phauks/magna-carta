// The default response cache-control policy: every reply that leaves the chokepoint without an
// explicit Cache-Control header is stamped `private, no-store`.
//
// WHY THIS IS A SECURITY GATE, NOT A PERFORMANCE KNOB. An edge cache in front of this Worker keys
// entries by entrypoint + path + query + worker version — NOT by the request host and NOT by the
// Cookie header. This application resolves the firm from the session cookie and never from the URL
// (chokepoint.ts, step 1), so `/api/v1/matters` is a byte-identical cache key for every firm on the
// platform. Cookie-borne authentication also triggers none of the automatic cache bypasses (those
// fire on an `Authorization` request header or a `Set-Cookie` response header). And a response
// carrying no Cache-Control at all is not treated as uncacheable: RFC 9111 heuristic freshness
// applies, which stores a 200 for hours. Compose those and one firm's response is served to the
// next firm that asks for the same path.
//
// `private, no-store` closes that hole at the source: `private` forbids a shared cache from storing
// the response, `no-store` forbids any cache from storing it. Stamping it here makes the safe
// behavior structural — the same way the chokepoint makes tenancy and authorization structural —
// rather than contingent on nobody switching on a cache layer. Reasoning home:
// docs/conventions/security.md (tenant isolation).
//
// The escape hatch is to say so explicitly: a handler that sets its own Cache-Control keeps it,
// because a route that has reasoned about cacheability is exactly the route allowed to opt out. Any
// such route must carry the firm identity in the cache key itself (or return a response that is
// genuinely identical for every firm) — it cannot rely on the cookie to keep firms apart.
const DEFAULT_CACHE_CONTROL = "private, no-store";

const CACHE_CONTROL_HEADER = "Cache-Control";

// Stamps the default on a response that declares no policy of its own. Mutates in place and returns
// nothing: the response object is already the one Hono will finalize, and replacing it would discard
// the streamed body of a range/preview reply.
//
// A Response returned straight from `fetch()` has immutable headers, so this would throw on one. No
// route does that today — every handler constructs its own Response — and a route that starts to
// must copy the upstream reply (`new Response(upstream.body, upstream)`) before returning it. The
// throw surfaces as a 500, which is the fail-closed direction: a route that cannot be stamped must
// not be served uncovered.
export function applyDefaultCacheControl(response: Response): void {
  if (response.headers.has(CACHE_CONTROL_HEADER)) {
    return;
  }
  response.headers.set(CACHE_CONTROL_HEADER, DEFAULT_CACHE_CONTROL);
}
