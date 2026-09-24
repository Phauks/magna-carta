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

/**
 * The socket a GUEST's signaling rides. The address carries no credential: the grant travels in the
 * upgrade's subprotocol list (`guestMeetingSocketProtocols`), never in the query string.
 *
 * NOT THE ADDRESS, BECAUSE AN ADDRESS IS WHAT GETS LOGGED. A browser cannot set a header on a
 * WebSocket upgrade and a guest holds no session cookie, so the credential needs some other part of
 * the upgrade to ride in — and a query string is the part every access log, every proxy and every
 * platform request record writes down whole. `Sec-WebSocket-Protocol` is a header the browser sets
 * from the list the page hands its constructor, which no request log records as part of the
 * address, and which the server accepts on this one route alone.
 *
 * THE MEETING IS NOT IN THE PATH. It is a fact of the grant rather than of the request line, so a
 * guest has no identifier to change and cannot address a meeting the link was not minted for.
 */
export function guestMeetingSocketUrl(documentUrl: string = location.href): string {
  return socketUrl("/api/v1/guest/meeting/socket", documentUrl);
}

/**
 * The subprotocol a guest's socket names first, ahead of the grant. The server answers the upgrade
 * by echoing it, which is what a browser requires of a server it offered subprotocols to: an upgrade
 * answered without one of the offered names is failed by the browser before any frame arrives.
 */
export const MEETING_GUEST_SOCKET_PROTOCOL = "meeting-guest";

/**
 * What a guest's socket offers as its subprotocols: the name above, then the grant itself.
 *
 * Two entries rather than one joined string, so the grant is a whole entry the server reads without
 * parsing it back out of a name. A grant is base64url segments joined by a dot, every character of
 * which is legal in a subprotocol token, so the browser takes it as it is.
 */
export function guestMeetingSocketProtocols(grant: string): readonly [string, string] {
  return [MEETING_GUEST_SOCKET_PROTOCOL, grant];
}

/** Open a guest's signaling socket in this browser, offering the grant as its subprotocol. */
export function openGuestMeetingSocket(url: string, protocols: readonly string[]): WebSocket {
  return new WebSocket(url, [...protocols]);
}

/** A relative contract path, resolved against the document and switched to the socket scheme. */
function socketUrl(path: string, documentUrl: string): string {
  const url = new URL(path, documentUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
