/**
 * Whether a WebSocket upgrade was asked for by a page this deployment serves.
 *
 * A WEBSOCKET UPGRADE IS NOT SUBJECT TO THE SAME-ORIGIN POLICY. A browser will not let another
 * site's script read a `fetch` of this API, but it will happily let that script open a socket to it
 * and carry the member's cookie — so the session that protects every other route protects a socket
 * route only up to the point where somebody's page decides to open one. Every route that upgrades
 * asks this before anything else. What a foreign page would gain differs by route — a meeting's
 * roster and signaling, a live browser's screen and the ability to type into it — and none of it is
 * anything a foreign page should have.
 *
 * `Origin` ABSENT IS ALLOWED, and that is not a hole: a non-browser client (a test, a tool) sends
 * none and is not the thing being defended against, while every browser attaches one to a
 * cross-origin upgrade without exception. Present, it must match — the request's own origin, which
 * is the per-request derivation the auth layer takes for the same question, or the deployment's
 * declared origin where one is configured and the two differ because a proxy re-addressed the
 * request.
 */
export function isSameOriginUpgrade(
  request: Request,
  declaredBaseUrl: string | undefined,
): boolean {
  const origin = request.headers.get("origin");
  if (origin === null || origin === "") return true;
  const allowed = new Set([new URL(request.url).origin]);
  if (declaredBaseUrl !== undefined && declaredBaseUrl !== "") {
    try {
      allowed.add(new URL(declaredBaseUrl).origin);
    } catch {
      // A misconfigured base URL narrows the check to the request's own origin rather than throwing
      // a member off a socket over a deployment value they cannot see.
    }
  }
  return allowed.has(origin);
}
