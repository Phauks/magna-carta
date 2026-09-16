// Who may frame the editor — the one place this deployment states it.
//
// coolwsd sends its own Content-Security-Policy on the editor page, and it composes `frame-ancestors`
// from two things it knows: its own origin, and the WOPI host it was configured with. That is right for
// the ordinary integration, where the WOPI host and the page doing the framing are the same application.
// It is wrong here by construction: this platform's WOPI host is `wopi.magna-carta.internal`, a
// non-routable name the container reaches only through outbound interception, and the page doing the
// framing is the firm's app origin — which coolwsd is never told about and cannot derive. So the header
// it sends names the editor origin and an internal host, the browser finds the app origin missing, and
// every open is refused before a byte of the document is drawn.
//
// The allowed origins are widened here, in the worker in front of the container, rather than in coolwsd's
// own configuration. Three reasons, in order of weight:
//   - coolwsd's configuration cannot express it reliably. `net.frame_ancestors` is obsolete and ignored
//     from CODE 24.12.4.1 onward, and its replacement `net.content_security_policy` is truncated at the
//     first space when passed through the image's `extra_params` — a list of origins is exactly a value
//     with spaces in it.
//   - Who may embed the editor is a fact about THIS DEPLOYMENT's app domain, not about the editor image.
//     A var on the worker is where a deployment-shaped fact belongs; baking it into a Docker build is not.
//   - Nothing in this repository can exercise the container's configuration — coolwsd does not run under
//     the test pool and there is no local Docker — whereas the rewrite below is a pure function with
//     tests beside it.
//
// The existing sources are KEPT and the app origins are added to them. coolwsd's own origin is in that
// list because the editor nests frames of its own, so replacing the list outright would break the editor
// in a way that only shows up in the parts of it we do not exercise. Widening frame-ancestors to origins
// this platform owns is not a relaxation of the boundary that matters: nothing about the framing origin
// authorizes anything, because the WOPI access token names one version of one file in one firm, and it
// is re-verified on every callback (apps/api-worker/src/editing/wopi-guard.ts).

// The app origins allowed to frame the editor when the worker is given no `APP_FRAME_ANCESTORS` var.
// The production app is served from per-firm subdomains under one parent domain, so the source is a
// wildcard over that parent rather than a list that a new firm would have to be added to.
const DEFAULT_APP_FRAME_ANCESTORS = "https://magnacarta.esq https://*.magnacarta.esq";

// The CSP directive separator: `;`, with any surrounding whitespace. A directive list is
// `name value value; name value`, so splitting on this yields whole directives.
const DIRECTIVE_SEPARATOR = /\s*;\s*/;

/** The configured app origins, split into CSP sources. Falls back to the production app domain. */
export function appFrameAncestors(env: { APP_FRAME_ANCESTORS?: string }): readonly string[] {
  const configured = env.APP_FRAME_ANCESTORS ?? DEFAULT_APP_FRAME_ANCESTORS;
  return configured.split(/\s+/).filter((source) => source !== "");
}

/**
 * The same policy with the app origins added to its `frame-ancestors`. Every other directive is left
 * exactly as coolwsd wrote it, sources already present are kept, and a policy that carries no
 * `frame-ancestors` at all gains one — a missing directive falls back to `default-src`, which is how a
 * future coolwsd could refuse the frame just as effectively as the wrong list does today.
 */
export function withAppFrameAncestors(policy: string, appSources: readonly string[]): string {
  if (appSources.length === 0) return policy;

  const directives = policy.split(DIRECTIVE_SEPARATOR).filter((directive) => directive !== "");
  let rewritten = false;

  const merged = directives.map((directive) => {
    const parts = directive.split(/\s+/).filter((part) => part !== "");
    const name = parts[0];
    if (name === undefined || name.toLowerCase() !== "frame-ancestors") return directive;
    rewritten = true;
    const sources = parts.slice(1);
    const added = appSources.filter((source) => !sources.includes(source));
    return ["frame-ancestors", ...sources, ...added].join(" ");
  });

  if (!rewritten) merged.push(["frame-ancestors", ...appSources].join(" "));
  return merged.join("; ");
}

/**
 * The container's response, with the app origins added to whatever `frame-ancestors` it sent. A
 * response that carries no policy is returned untouched — the editor page is the one that carries it,
 * and adding a policy to the assets and the WebSocket upgrade beside it would state a boundary for
 * responses that never had one.
 *
 * The body is passed through by reference, so this stays a header rewrite and never buffers a document.
 */
export function allowAppFraming(response: Response, appSources: readonly string[]): Response {
  const policy = response.headers.get("Content-Security-Policy");
  if (policy === null) return response;

  const merged = withAppFrameAncestors(policy, appSources);
  if (merged === policy) return response;

  // A WebSocket upgrade (status 101) has no mutable headers and no policy to rewrite; the guard above
  // already returned it, so this only ever reconstructs an ordinary HTTP response.
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", merged);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
