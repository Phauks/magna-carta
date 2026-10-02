# Interactive browsing — design

**Decisions:** `docs/decisions/pending/interactive-browsing-on-a-per-member-session.md` (the held session, takes up the seam ADR-0119 deferred) and `docs/decisions/pending/live-browsing-streams-the-remote-browser.md` (the owner's 2026-09-24 ruling that Live streams, superseding the screenshot-per-step shape). **Measured on:** the session probe's answer of 2026-09-20 — session reuse and CDP both available, 200 concurrent sessions, 10 acquisitions in the rate budget, 8.2 s for a full acquire/navigate/reconnect/navigate round trip.

## 1. What this is

One remote browser, held open for a member and streamed to their screen, that they drive with their own pointer and keyboard. They can click through a consent wall, scroll to what a page hides below the fold, open a menu, type into a search box — in a browser that remembers each step, so a link built to reveal itself only in stages can be followed through them.

What reaches the member's browser is pictures and text: JPEG frames of the remote screen, the address it is on, and the inspector's facts about each page. Nothing the suspect page sends is parsed as markup or run as script on the member's side.

## 2. What this is not

- **Not a proxy.** The page is never fetched on the member's behalf and re-served; it runs on the remote machine and nowhere else.
- **Not persistent.** Nothing about a session is stored beyond its own lifetime. There is no browsing history and no record of it in the firm's database.
- **Not a credential-safe surface.** The stream cannot tell a phishing page's password field from a search box, so it cannot stop a member typing a real password into one. The screen says so, standing, beside the stream.
- **Not a second renderer for the static capture.** Static still uses quick actions; Live is Browser Sessions over CDP.

## 3. Shape

```
apps/web  ──GET /api/v1/safe-browse/live/stream (Upgrade: websocket)──▶  chokepoint
   │                                                                      same-origin check
   │                                                                          │
   │  ◀──────── ready · frame (JPEG) · location · details · ended ────────  SafeBrowseSession DO (firmId:userId)
   │  ──────── navigate · pointer · wheel · key · text · frameAck ───────▶    holds: socket + CDP connection
   │                                                                          record: sessionId, openedAt
   │                                                                          │
   │                                                    puppeteer.connect(sessionId) or launch()
   │                                                    Fetch.enable(Document) → assertPublicTarget every document
   │                                                    Page.startScreencast / Input.dispatch*
```

**The wire protocol has one home**, `packages/safe-browse/src/live-stream-protocol.ts`, imported by both the Worker and the web app. The Worker's parse treats every client frame as hostile: unknown types dropped, numbers bounded and finite, strings capped (an address at 2,048 characters, pasted text at 10,000, a key name at 32).

**The Durable Object holds the stream while it is open and the session id between streams.** An open stream keeps the object in memory — it holds the member's socket and a CDP connection to the browser — so the socket is accepted with the ordinary API, not hibernation, which would drop the browser connection. Between streams the object holds a few dozen bytes: the browser's session id and when the session began.

**Keyed `${firmId}:${userId}`.** Firm-namespaced on the same reasoning as the live timer: a session addressed by user id alone could be reached across firms by a caller who knew the id. The firm comes from the session at the chokepoint, never from the request.

**The stream's decisions are separate from its machinery.** `apps/api-worker/src/safe-browse/live-stream.ts` decides what input reaches the browser, how frames are paced, and when a stream ends; `puppeteer-live-browser.ts` carries it out over CDP. The split exists because the test pool has no browser: every decision is tested against a fake.

## 4. The guard, which is the point

`assertPublicTarget` runs on **every document the browser requests for the whole session**, not only the address the member types. A member clicking around hands a hostile page a whole session of navigations to send the browser somewhere it should not go — a private address, a link-local metadata endpoint, an internal host.

**Built on CDP's Fetch domain, scoped to documents.** `Fetch.enable` with a Document resource-type pattern pauses every main-frame and sub-frame navigation, and each redirect hop of one, until the guard has passed its address:

- a typed address is guarded before the browser sees it, and refused with a `refused` frame that never echoes it;
- a refused **main-frame** document is reported to the member the same way;
- a refused **sub-frame** is blocked alone — an iframe pointing inward does not make the page unviewable;
- **sub-resources** (images, scripts, fetches) are not paused. A page makes hundreds, and pausing each on a round trip to the Worker would make every page slow. That is the same line the static capture's renderer draws, and the browser fetching them runs in the rendering service's network, not this platform's.

**What else is shut:** new tabs are folded into the visible one — `window.open` and `target` attributes are neutralised by a script added to every document, and a tab that opens anyway is closed and its address followed in the visible tab, through the guard; downloads are denied; the file chooser is intercepted; dialogs are dismissed (a leave-this-page prompt accepted) and reported, so a page cannot freeze the stream.

Interception is switched off before the object disconnects from a browser it is leaving alive; left on, the page's next navigation would pause waiting for a handler that no longer exists.

## 5. Frames and input

**Frames are JPEG at quality 70, one in flight.** The object forwards a frame and holds the next until the page acknowledges drawing the first; a newer frame supersedes a held one. A slow connection sees a lower frame rate, never a backlog, and the browser is never more than one frame ahead.

**The remote viewport follows the member's screen.** The page sends the size of the space the stream fills (on connect, and again once a resize has settled), clamped to 320×240–1920×1600. The remote page lays itself out for that space rather than being shrunk from someone else's.

**Input:** pointer moves are coalesced to one per animation frame; presses carry a click count the page counts itself (pointer events report none); the wheel is normalised to pixels; keys go through puppeteer's keyboard layout, with characters outside it typed as characters. The canvas takes every key while focused — Tab moves between the remote page's fields — so **Escape twice in quick succession leaves it**; the paste chord is left to the member's browser, whose paste event carries their clipboard text across as a `text` frame.

## 6. Lifecycle

| Event                  | What happens                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| First address entered  | The page opens the stream; the object launches a browser, records its id, sends `ready`; the held address is then sent        |
| Stream reopened        | Record held → `puppeteer.connect(id)`; on failure, a fresh launch rather than an error, and `ready` says the cookies are gone |
| Second tab opens Live  | The first stream is sent `ended: replaced` and releases the browser; the second reconnects to it                              |
| Three minutes no input | The alarm ends the stream (`idle`) and closes the browser                                                                     |
| Fifteen minutes open   | The alarm ends the stream (`ceiling`) and closes the browser, however busy the member is                                      |
| Socket drops           | The browser is released, not closed; the alarm closes it after the idle window unless a stream reconnects                     |
| Member switches/leaves | The page closes the socket and posts `/live/close` (a beacon on `pagehide`), which ends the stream and closes the browser     |

## 7. What the screen does

In Live the viewport **is** the remote browser: a canvas the frames are drawn into, scaled to fit and centred, taking the member's pointer, wheel, keys and pastes. The address bar follows the remote browser's location; back, forward and refresh drive its own history; the Links and Redirects tabs navigate it. The inspector's tabs fill from a `details` frame after each page load — the capture's view shape, without a screenshot, since the member is looking at the page itself. **Download Screenshot and Details** asks the browser for a full capture of the page as it stands, screenshot included, and saves the same archive the static capture does.

The stream opens on the first address, never on the mode switch alone: a held browser is billed from the moment it is acquired. **A fault is retried visibly before it is reported:** a browser that could not be acquired, or a connection that dropped, is reopened up to three attempts in all, each shown as it happens with the address and elapsed seconds; a dropped connection reopens onto the same browser with its cookies. Only then does the screen show the failure, with the Error ID the Worker recorded it under and a Retry. An intentional end (idle, ceiling, another tab, closed) is stated with its limit read from `@magna-carta/safe-browse/live-session`, never typed into the copy, and the last frame is hidden so a stopped screen never looks live. Notices sit over the top of the screen rather than above it, so one appearing never resizes the remote browser; a dismissed dialog's text is set apart as the page's own words. The note band beside the address bar carries the credential warning and the way out of the canvas; when a later stream had to start a fresh browser, it says the cookies from earlier pages are gone.

## 8. Testing

- **Pure, no network:** the protocol's parse (every refusal case), viewport clamps, pointer mapping through a letterboxed canvas, modifiers, wheel normalisation, which keys the member keeps.
- **Worker, fake browser:** the stream's guard on typed addresses, input ordering, one-frame flow control, details on load, capture, idle and ceiling, close vs release; the object's takeover between tabs and the record it keeps; the route's refusals (no upgrade, cross-origin, no session).
- **Page, fake socket:** the client opens nothing until an address is entered, holds it until `ready`, drops early input, acknowledges each drawn frame, and says why a stream stopped.
- **Not automatable here:** the real binding. Miniflare has no browser, so the CDP adapter is exercised against the deployed service.
