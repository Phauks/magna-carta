# Network resilience on constrained connections — design

**Status:** Approved (design); implementation pending.
**Date:** 2026-06-29.
**Outputs:** a new convention (`docs/conventions/network-resilience.md`), an ADR
(`docs/decisions/pending/network-resilience-constrained-networks.md`), one behaviour-neutral
backend extraction, and a tracked migration backlog.

## Why

Prompted by [_Engineering for Slow Internet_](https://brr.fyi/posts/engineering-for-slow-internet) —
field notes from Antarctic research stations on 750 ms round-trips, sub-2 Mbps shared links, packet
loss, and connectivity that arrives only in scheduled windows. Its lessons are not exotic. Magna
Carta is a document-heavy SPA with an external client portal, used by lawyers from courthouses, rural
county offices, hotels, and the road — often against a hard filing deadline. The article's signature
failure (a download that aborts and cache-busts, forcing a restart) is, in our domain, a missed
filing. That raises the stakes past ordinary SaaS: behaving well on a bad link is a correctness
concern, not a nicety.

The article's recommendations, distilled: do not bake in connectivity assumptions. No hardcoded
timeouts that abort a transfer still making progress; chunk large payloads so a drop resumes instead
of restarting; expose a direct link so the browser's own download manager can pause and resume; keep
core function working when optional assets have not loaded; render last-known values rather than
failing; and budget what must download before an app becomes usable (the article's worst case: 20 MB
of JavaScript to send a six-byte message).

## What we are deciding

Four commitments, ratified in the ADR; the rules they imply live in the convention.

1. **Resumable transfer is a required seam now.** Any feature that moves file bytes uses the
   established R2 transfer seam — multipart-resumable upload, presigned-GET download, or HTTP Range
   serving — never a monolithic, non-resumable in-app fetch. This is the expensive-to-retrofit
   foundation; the backend already realises it (see audit below).
2. **A slow-network / transfer-weight profile is added to the load-profile harness.** The measurement
   rule is anchored in `docs/conventions/performance.md` (one home for "how we measure"); the
   constrained-network behaviour rules live in the new convention.
3. **A shared client transport seam is required.** All client network calls route through one
   utility that owns timeout, backoff, retry, and stale-cache exposure — so "no hardcoded timeout"
   and "render last-known value" are implemented once, not hand-rolled per call site.
4. **Per-route transfer budget is a fitness function.** The mechanism is decided now; the numeric
   gate goes enforcing once commitment 2 lands and the SPA's per-route baseline is measured. This
   honours `performance.md`'s "gates land with the code to measure," but replaces an open-ended
   "later" with a named trigger.

Everything else — graceful-degradation patterns, honest transfer-status UI, the direct-link
fallback, highest-hostility-surface-first — is a rule in the convention, not an ADR decision.

## Approach: forward-binding standard, no big-bang retrofit

The standard binds all new work immediately. Existing surfaces are not reworked en masse; they are
audited once (below), and real retrofits are scheduled from findings — deadline-critical paths first,
otherwise when an area is next opened. This matches how `performance.md` and `security.md` phased in,
and honours "verify before asserting a cause": we conform what is genuinely hostile, not what we
assume to be.

## Conformance audit — every transfer path

The backend was built streaming- and resume-aware; the genuine forward work is the (currently
skeleton) client. The single existing retrofit is bounded.

### Backend (`apps/worker`) — conformant; becomes the reference

- **Upload** (`routes/files/uploads.ts`) — direct-to-R2: single-shot presigned PUT at or below the firm's
  threshold, **multipart-resumable session above it** (sign-part / complete / abort), idempotency-
  keyed, bytes bypass the Worker. This _is_ the mandated seam. No change.
- **Per-file and over-threshold bulk download** (`routes/files/downloads.ts`, `files/presign.ts`) — a
  single resolved file and an over-threshold bundle deliver via a 302 to a presigned GET, so the
  browser's download manager drives pause / resume. No change.
- **Inline preview / media** (`files/preview-serve.ts`) — HTTP Range with If-Range conditional resume
  and ETag (206 partial content). No change.
- **Async bundle build** (`downloads/bundle-consumer.ts`, coordinator) — streams R2 bodies through a
  multipart write, delivers via presigned GET; a notifications-push status seam is already named.
  No change.

### Backend — one bounded retrofit (backlogged)

- **Inline bulk ZIP** (`routes/files/downloads.ts`, multi-file under the live threshold) — a single
  non-resumable streamed `application/zip`; a mid-stream drop restarts the whole archive. Bounded by
  the firm's live-download thresholds. **Backlog:** on a constrained-network signal, lower the inline
  threshold or route to the async build + presigned GET (already resumable). Tuning, not a rebuild.

### Backend — one DRY extraction (folded into this change)

- The R2-entries-to-zip-inputs generator is duplicated almost verbatim: `zipInputs()` in
  `routes/files/downloads.ts` and `inputs()` in `downloads/bundle-consumer.ts` (both: for each entry,
  `R2.get`, skip null, yield `{ name, input: object.body }`). Extract one shared
  `zipEntriesFromR2(bucket, entries)` and have both call it. Behaviour-neutral; tests stay green.

### Backend — deferred extraction (backlogged)

- `parseSingleByteRange` and the 200/206/416 response construction in `files/preview-serve.ts` are
  the canonical Range-serving implementation. Today there is exactly one path where the Worker itself
  serves bytes, so extracting a helper now is premature. Extract when a second byte-serving consumer
  appears.

### Client (`apps/web`) — greenfield; forward seams, not retrofits

The SPA is a skeleton (one layout, one page, one lib file); only `health.ts` touches `fetch`.

- **Per-route bundle weight** — not yet measured. The priority forward seam: set the budget and
  measurement before the SPA grows feature areas into one bundle.
- **Shared client transport seam** — does not exist. Build before call sites proliferate.
- **Upload UX (pause / resume / progress)** — the server multipart seam exists; the client UX to
  surface it is future work.
- **Download UX** — relies on the browser via the 302 (a good default). Rule: never trap a large
  download behind a non-resumable in-app fetcher.

### Future surfaces (flagged)

- **Tool result artifacts** (metadata, hash, file-type, decryption, repair, conversion) operate on
  R2 objects via the paths above and inherit conformance — provided any tool-specific artifact
  download reuses the presigned-GET seam.
- **Client portal** (unbuilt) is the highest-hostility surface: external users, unknown connections.
  The convention flags it for lite-mode and resumable delivery when built.

## Operational plan

**Now (this change):** write the convention and ADR; add a changelog fragment; add the slow-network
measurement _rule_ to `performance.md`; fold in the `zipEntriesFromR2` extraction with green tests;
record the backlog below; add the conventions README row; add the active-work note.

The shared client transport seam (commitment 3) and the harness transfer-weight measurement
(commitment 2) are **decided here as required seams** but **built when the first real consumer
exists**. The SPA is a one-page skeleton whose only `fetch` is a liveness ping; there is no
data-fetch consumer to route through a transport seam and no multi-route bundle to baseline, so
building either now would be speculative machinery (golden rule 10; `performance.md`'s "gates land
with the code to measure"). Deciding them now is what makes them cheap to honour when the area opens.

**Forward (designed-in, built when the area opens):** the shared client transport seam lands with the
first data-fetch consumer; the harness transfer-weight profile lands with the first real SPA routes;
the per-route budget gate goes enforcing once that baseline is measured; upload/download client UX
surfaces progress, pause, and resume; client-portal lite-mode; inline-ZIP constrained-network tuning;
Range-serve helper extraction at the second byte-serving consumer.

## Migration backlog (tracked)

1. Shared client transport seam (timeout / backoff / retry / stale-cache): build with the first
   data-fetch consumer; route call sites through it.
2. Harness transfer-weight profile: add to the load-profile harness with the first real SPA routes.
3. Per-route transfer budget: set initial budgets from that baseline → enforce the fitness-function
   gate.
4. Inline-ZIP (`routes/files/downloads.ts`): constrained-network threshold / async-route tuning.
5. Range-serve helper: extract from `files/preview-serve.ts` at the second byte-serving consumer.
6. Upload/download client UX: surface progress, pause, resume, ETA.
7. Client portal: lite-mode bundle + resumable delivery at build time.

## Scope guard

This change is docs + the shared transport seam + the harness profile + one behaviour-neutral
extraction. It does **not** rework shipped transfer paths, does not lower any threshold, and does not
add the numeric CI gate (mechanism only). Those are backlog items with named triggers.
