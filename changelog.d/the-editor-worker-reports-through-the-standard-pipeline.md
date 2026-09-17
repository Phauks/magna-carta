---
category: Changed
audience: internal
---

**The editor worker reports its failures through the standard pipeline, and the scrubber recognises a bearer token.**

`magna-carta-edit` had no error boundary. A throw anywhere on the path between the browser and a document's container reached the runtime unhandled: a bare error page, no Error ID, no structured event, and nothing to correlate but a raw exception line in Workers Logs. A WebSocket the container declined was worse — it was silent, because the browser reports every failed handshake as "closed before the connection is established" whatever the server answered, so a container answering 502 and a worker throwing mid-proxy read identically from outside. That is the defect [#633](https://github.com/Phauks/magna-carta/pull/633) fixed, and it took a round trip of guesswork to name; the boundary added here (`apps/edit-worker/src/diagnostics.ts`) would have named it in one log line.

A thrown fault is now a 500 carrying `X-MC-Error-Id` and one `error.captured`; an upgrade the container did not accept is passed through as answered and recorded as one `operation.failed` naming the status — the only record of that status anywhere. The route logged is always the pathname, never the URL: every request the browser makes to this worker carries the WOPI access token as a query parameter, so a quoted URL is a quoted credential. The worker gains the `TELEMETRY` binding the app worker already carries, against the same dataset.

The scrubbing backstop in `@magna-carta/telemetry` now recognises a bearer token in both shapes it travels in — `access_token=…` as written on the wire, and the bare three-segment base64url token an error message carries once something has unpacked the URL. It covered emails, identifiers, cards and phone numbers, and not the one credential this surface puts in every URL.

**A fleet-wide gap, recorded rather than fixed here.** `createWorkersLogger` is used by the app worker and, now, the editor worker. The other five extracted workers — scan, convert, search, OCR, discovery — carry no boundary of this kind either, so golden rule 4 holds for the request path and the WOPI host and not for the Containers fleet. Each wants the same ~60 lines; none is done in this change, because each fronts a different engine whose declining answers mean different things.
