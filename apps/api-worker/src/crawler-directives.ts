import type { MiddlewareHandler } from "hono";
import type { Bindings } from "./bindings.ts";
import type { AppVariables } from "./chokepoint/ports.ts";

// Magna Carta is a private, authenticated, multi-tenant product: the SPA shell, the API, and every
// branded per-firm subdomain serve only a firm's own privileged data and must NEVER be indexed by a
// search engine (a firm's client portal showing up in Google results would be a confidentiality
// breach, not just bad SEO). This directive is the authoritative, code-owned control: robots.txt
// governs CRAWLING but not INDEXING — a disallowed URL can still be listed if a crawler finds it via
// a link — whereas `X-Robots-Tag: noindex` is what actually keeps a page out of the index.
//
// The public marketing site is deliberately NOT served by this Worker. When it is built it will be a
// separate app on its own host (the apex/www), so it does not inherit this header — the blanket
// directive here cannot accidentally de-index the marketing surface.
//
// `nofollow` is included so a crawler that does reach a private page does not harvest the in-app links
// it contains.
export const X_ROBOTS_TAG_NOINDEX = "noindex, nofollow";

// Stamps the noindex directive on every response in its chain. Registered AFTER the cookieless
// preview route in app.ts so it deliberately does NOT wrap that sealed `files.*` edge — that host
// serves only `Content-Disposition: attachment` bytes and bare 404s (never an indexable page) under
// an exhaustive, payload-derived header set that must stay pristine.
export function noindexResponseMiddleware(): MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AppVariables;
}> {
  return async (c, next) => {
    await next();
    try {
      c.res.headers.set("X-Robots-Tag", X_ROBOTS_TAG_NOINDEX);
    } catch {
      // A Response returned from a binding fetch (the Workers Static Assets SPA shell) carries
      // immutable headers, so .set() throws. Copy it so the directive can be stamped — the body is a
      // re-wrapped stream reference, never buffered.
      const res = new Response(c.res.body, c.res);
      res.headers.set("X-Robots-Tag", X_ROBOTS_TAG_NOINDEX);
      c.res = res;
    }
  };
}
