/*
 * The one write a page makes on its way out of the browser, sent so it survives the page going away.
 *
 * IT LIVES IN THE SEAM FOR THE REASON `socket-url.ts` DOES: this is the one directory in `apps/web`
 * that knows a URL, and this write cannot be made through the generated client. The client builds
 * its request across a promise chain, and a tab being closed does not stay alive for one — the call
 * is abandoned half-built. `fetch` with `keepalive` is the transport that outlives the document, and
 * it is dispatched here in the same turn as the event that asked for it.
 *
 * NOT `navigator.sendBeacon`, WHICH IS THE OBVIOUS REACH. A beacon cannot set a header, and every
 * write on this contract requires an `Idempotency-Key` — so a beacon is refused before it reaches the
 * route. The key is minted per departure for the reason every other write mints one: the same
 * departure retried is the same departure, and two of them must not close two stays.
 *
 * BEST EFFORT, AND THE SERVER IS WHAT MAKES IT RELIABLE. Nothing here can be awaited or reported: a
 * failure has nowhere to render because the page is gone. The stay is closed by this write where it
 * lands, and by the server's own sweep where it does not.
 */

/** The headers a bodyless write on this contract carries. The client adds no others without a body. */
function departureHeaders(): Record<string, string> {
  return { "idempotency-key": crypto.randomUUID() };
}

/**
 * Close this member's stay in a meeting, from a page that is going away.
 *
 * `send` is the seam a test drives; the app passes nothing and the browser's own `fetch` is used.
 * The promise is deliberately not returned: a caller in a `pagehide` handler has nothing to do with
 * one, and awaiting it is what a page being torn down cannot do.
 */
export function leaveMeetingOnDeparture(meetingId: string, send: typeof fetch = fetch): void {
  const path = `/api/v1/meetings/${encodeURIComponent(meetingId)}/leave`;
  void send(path, {
    method: "POST",
    headers: departureHeaders(),
    keepalive: true,
    // The session cookie is what the route authenticates with, and the app is served from its own
    // API's origin — stated rather than left to the default, because the default is the only thing
    // making this work and it is invisible.
    credentials: "same-origin",
  }).catch(() => {
    // A departure that did not land is the sweep's to notice. There is no surface left to tell.
  });
}

/**
 * The header a guest's credential rides on an ordinary request. The socket upgrade is the one place
 * it travels any other way (`socket-url.ts` says why), and every guest call names it from here.
 */
export const MEETING_GUEST_HEADER = "x-meeting-guest";

/**
 * Close a GUEST's stay in a meeting, from a page that is going away.
 *
 * The guest's twin of the member departure above, on the same transport for the same reason, with
 * two differences that are the whole of what a guest is. The credential is the grant their arrival
 * was answered with, carried in its header, because a guest holds no session. And no cookie is sent
 * at all: the guest page is served from the firm's own origin, and a browser that also happens to
 * hold a member's session must not have it ride along on a request that is about somebody else.
 */
export function leaveMeetingAsGuestOnDeparture(grant: string, send: typeof fetch = fetch): void {
  void send("/api/v1/guest/departures", {
    method: "POST",
    headers: { ...departureHeaders(), [MEETING_GUEST_HEADER]: grant },
    keepalive: true,
    credentials: "omit",
  }).catch(() => {
    // As above: a departure that did not land is the sweep's to notice.
  });
}
