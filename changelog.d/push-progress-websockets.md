---
category: Added
---

**Push-based job progress for bulk downloads and file conversions.** A client can now subscribe to a
job over a WebSocket and be told the moment it changes — `building`/`queued`, `running`, and the
settled state with its freshly signed download URL — instead of polling until the answer moves. Built
on the Durable Objects hibernation WebSocket API on the existing coordinator objects, so a subscriber
waiting on a long build costs nothing while it waits and its keepalives never wake the object. The
existing polling endpoints are unchanged and remain a complete fallback: both transports resolve a job
through the same function, so they cannot report it differently. Subscribing traverses the same
chokepoint as every other route, with the same session-derived firm scoping — `GET
/api/v1/downloads/bundles/{manifestHash}/events` and `GET /api/v1/conversions/{jobId}/events`.
