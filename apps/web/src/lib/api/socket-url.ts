/*
 * A contract path as a WebSocket address.
 *
 * It lives in the seam rather than beside the surface that opens the socket, for the reason the
 * seam exists at all: this is the one directory in `apps/web` that knows a URL. The generated client
 * carries every operation's path, but a socket is not a call it can make — an upgrade is the
 * browser's `WebSocket`, not `fetch` — so the one path the app still spells is spelled here, once.
 *
 * THE SCHEME COMES FROM THE DOCUMENT, NEVER FROM A CONSTANT. A page served over `https:` must open
 * `wss:` and a page served over `http:` must open `ws:`; a hard-coded scheme works in exactly one of
 * the two and fails in the other as a blocked mixed-content upgrade with no useful message. Taking
 * it from where the document was served is also what keeps the session cookie same-site, which is
 * what the room authenticates the upgrade with.
 */

/** The socket that carries a meeting's signaling, as an absolute `ws:`/`wss:` address. */
export function meetingSocketUrl(meetingId: string, documentUrl: string = location.href): string {
  return socketUrl(`/api/v1/meetings/${encodeURIComponent(meetingId)}/socket`, documentUrl);
}

/** A relative contract path, resolved against the document and switched to the socket scheme. */
function socketUrl(path: string, documentUrl: string): string {
  const url = new URL(path, documentUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
