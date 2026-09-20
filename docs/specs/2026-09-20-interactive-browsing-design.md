# Interactive browsing — design

**Decision:** `docs/decisions/pending/interactive-browsing-on-a-per-member-session.md` (takes up the seam ADR-0119 deferred). **Measured on:** the session probe's answer of 2026-09-20 — session reuse and CDP both available, 200 concurrent sessions, 10 acquisitions in the rate budget, 8.2 s for a full acquire/navigate/reconnect/navigate round trip.

## 1. What this is

One remote browser, held open for a member, that they can walk from page to page. Each step answers with the same inert artefacts the static capture answers with — a screenshot and structured text — so nothing new reaches the member's device to execute. The difference from the capture is not what comes back; it is that the browser remembers.

That memory is the whole feature. A shortener into a consent wall into a credential form only reaches step three if steps one and two set cookies, and a fresh browser per capture arrives at step one every time.

## 2. What this is not

- **Not pixel streaming.** No screencast, no input forwarding, no canvas. The probe established that CDP is available; the reasons not to stream are about credential entry, cost shape and the input attack surface, and none of them were answered by the probe. The Live toggle in the viewer's shell turns on THIS, not that.
- **Not persistent.** Nothing about a session is stored beyond its own lifetime. There is no browsing history here to keep and no record of it in the firm's database.
- **Not a second renderer.** The screenshot comes from the same Browser Rendering binding as the static capture.

## 3. Shape

```
apps/web  ──POST /api/v1/safe-browse/live/navigate {url}──▶  chokepoint
                                                                 │
                                          SafeBrowseSession DO ◀─┘   (firmId:userId)
                                          holds: sessionId, location, openedAt
                                                                 │
                                          puppeteer.connect(BROWSER, sessionId)
                                          or launch() when there is none
                                                                 │
                                          assertPublicTarget EVERY hop
                                                                 │
                                          ◀── SafeWebsiteView (screenshot, text, links)
```

**The Durable Object holds the session id, not the browser.** A browser handle cannot survive an object's eviction; a session id can, and reconnecting to it is what the probe measured. So the object is a small, durable record of "which remote browser belongs to this member, and where it is", and the Worker reconnects per request.

**Keyed `${firmId}:${userId}`.** Firm-namespaced on the same reasoning as the live timer: a session addressed by user id alone could be reached across firms by a caller who knew the id. The firm comes from the session at the chokepoint, never from the request.

## 4. The guard, which is the point

`assertPublicTarget` runs on **every** navigation, not only the address the member typed. A held session differs from a one-shot capture precisely in that a hostile page has a whole session to redirect the browser somewhere it should not go — at a private address, a link-local metadata endpoint, an internal host. The guard belongs inside the navigate path so that no caller can forget it, and the redirect-following probe the static capture already uses re-guards each hop for the same reason.

The route's failure answers are the ones the capture already has, unchanged: a refused target is the generic 400 that never echoes the address back; a page that will not render is `page-render-failed`; a service that cannot serve is the transient 502.

## 5. Lifecycle

| Event          | What happens                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| First navigate | No session recorded → `puppeteer.launch` with `keep_alive`; store the id                                                                  |
| Later navigate | Session recorded → `puppeteer.connect(id)`; on failure, fall back to a fresh launch rather than erroring (the service may have reaped it) |
| Idle alarm     | Close the remote browser, clear the record                                                                                                |
| Explicit close | Same, on the member leaving the page                                                                                                      |

**A reconnect that fails is not an error.** The remote service reaps idle sessions on its own schedule, so a stored id can be stale through nobody's fault. Falling back to a launch costs the member their cookies and tells them so; erroring would tell them the tool is broken when it is merely cold.

## 6. What the screen does

The shell already has everything: an address bar, back/forward over capture history, the inspector tabs, and a Static | Live segmented control rendered as a Soon affordance. Live mode switches which endpoint the address bar calls and nothing else — the view shape is identical, so the screenshot pane and every tab render unchanged. Back/forward in Live mode navigates the session rather than replaying stored captures.

## 7. Testing

- **Unit, no network:** the session record's lifecycle decisions (launch vs connect vs relaunch-on-stale) as a pure function over `{storedId, connectResult}`.
- **Integration, Miniflare:** the route's contract and permission gating with a fake browser binding; a navigation whose target is private answers the redacted 400; a stale stored id relaunches rather than failing.
- **Not automatable here:** the real binding. Miniflare has no browser, so the live path is exercised by the probe route against the deployed service, exactly as the capture is.

## 8. Build order

1. The session record and its lifecycle decision (pure, tested).
2. `SafeBrowseSession` Durable Object + wrangler binding and migration tag.
3. `POST /api/v1/safe-browse/live/navigate` and `.../live/close` behind the chokepoint on `tools:safeBrowse`.
4. The shell's Live toggle, replacing the Soon affordance.
5. `docs/user/` guide for the viewer, which it still does not have.
