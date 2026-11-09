# Network-resilience conventions

**Status:** Active (the resumable-transfer seam and the degradation rules apply now; the client
transport seam and the per-route budget gate land with the client code they measure — see _Forward
seams_).

**Scope (single home for):** how Magna Carta behaves on slow, high-latency, metered, or intermittent
connections — the rules that keep the product usable when the network is hostile. This is a
client-and-delivery concern; server-side compute placement is `performance.md`'s, and the two cross-
reference rather than overlap.

**Authoritative context:** the white paper's _Delivery model_ and _Performance & concurrency model_.
Our users work from courthouses, rural county offices, hotels, and the road, frequently against a
hard filing deadline — so a transfer that aborts and restarts is not a nuisance, it is a missed
filing. Behaving well on a bad link is a correctness concern here, not a nicety.

## The one rule behind the rest

**Bake in no assumption about the connection.** No fixed timeout that abandons a transfer still
making progress; no monolithic payload that must arrive whole or not at all; no feature that needs
the full bundle before it does anything. Every rule below is a corollary.

## Rules

### 1. Resumable transfer is the default — use the established seam

File bytes move through the existing R2 transfer seam, never a monolithic, non-resumable in-app
fetch:

- **Upload** — direct-to-R2 via the presigner: a single-shot presigned PUT at or below the firm's
  threshold, a **multipart-resumable session** above it (sign-part / complete / abort). Reference
  implementation: [`apps/api-worker/src/http/routes/files/uploads.ts`](../../apps/api-worker/src/http/routes/files/uploads.ts) over
  [`apps/api-worker/src/files/presign.ts`](../../apps/api-worker/src/files/presign.ts).
- **Download** — a presigned GET (a 302 to a real URL), so the browser's own download manager owns
  pause, resume, and speed. Reference: the single-file and over-threshold paths in
  [`apps/api-worker/src/http/routes/files/downloads.ts`](../../apps/api-worker/src/http/routes/files/downloads.ts).
- **Inline / seekable serving** — HTTP Range with If-Range conditional resume and ETag. Reference:
  [`apps/api-worker/src/files/preview-serve.ts`](../../apps/api-worker/src/files/preview-serve.ts).

`R2Presigner` is the canonical transfer seam: a new path that moves bytes reaches for it (or the Range
serve path) rather than hand-rolling a buffered transfer.

### 2. A real direct link is always reachable

A large download is always available as a URL the browser's download manager (or a user's own tools)
can drive — never trapped behind an in-app fetcher that lacks pause, resume, and a speed indicator.
The presigned-GET seam (rule 1) satisfies this for free; do not regress it by proxying bytes through
the client to "improve" the UX.

### 3. No hardcoded timeouts; back off, never cache-bust

A transfer that is still moving bytes is allowed to finish. On failure, retry with progressive
backoff and connection reuse — **never** abort-and-refetch-from-scratch, which wastes the bandwidth
already spent (the worst anti-pattern on a metered link). Any retry on a flaky link must be safe to
repeat: idempotency is the partner rule (uploads and provisioning already key on an idempotency key;
extend that to any client retry that could double an effect).

### 4. Core function does not wait on optional assets

The app does useful work before optional components, analytics, and non-essential bundles have
loaded. Defer them; never block a six-byte action on a multi-megabyte download.

### 5. Render last-known values; show honest status

When a live fetch fails, render the cached or previous value with an explicit _stale / reconnecting_
state rather than a blank error. Transfer UI tells the truth — real speed, real ETA, real
pause/resume — never a fake "32 minutes remaining" or an indefinite spinner that cannot distinguish
"still working, slowly" from "broken." On a slow link this distinction is the whole user experience;
correlate genuine failures through the standard error pipeline ([`error-logging.md`](error-logging.md)).

### 6. Budget what must download before the app is usable

Cold-load transfer weight is budgeted per route; split aggressively so a single-matter view or the
client portal never pulls unrelated subsystem code. The budget is enforced as a fitness function once
there is a measured baseline (see _Forward seams_).

### 7. Highest-hostility surfaces get the most care

The client portal serves external users on unknown connections and is the surface we control least —
it gets lite-mode and resumable delivery when built. Tool result artifacts deliver through the same
presigned/resumable seam as any other download.

## Measurement lives in the performance harness

How we _measure_ transfer weight and slow-network behaviour is one fact with one home: the load-
profile harness, documented in [`performance.md`](performance.md) (_Measure-first_). This file owns
how to _behave_; that file owns how to _measure_. The per-route budget (rule 6) is checked against
that harness; do not restate the measurement mechanism here.

## Forward seams (decided, built when the area opens)

These are required, not optional — deciding them now is what makes them cheap to honour later. They
are unbuilt only because the client is a skeleton with nothing yet to route or measure (building the
machinery now would be speculative — golden rule 10):

- **Shared client transport seam** — one utility owning timeout, backoff, retry, and stale-cache
  exposure (rules 3 and 5), built with the first real data-fetch consumer so the policy is
  implemented once, not per call site.
- **Harness transfer-weight profile** — added to the load-profile harness with the first real SPA
  routes; it is the baseline the budget gate (rule 6) enforces against.
- **Per-route budget gate** — the fitness function goes enforcing once that baseline exists.
- **Upload / download client UX** — surfaces progress, pause, resume, and ETA over the server seams
  that already support them.
