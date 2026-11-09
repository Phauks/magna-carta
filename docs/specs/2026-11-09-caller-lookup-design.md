# Caller lookup — who a typed number belongs to, design

**Date:** 2026-11-09 · **Status:** built · **Area:** Communications
**Builds on:** [`2026-09-07-call-and-text-log-design.md`](2026-09-07-call-and-text-log-design.md)
**Decision:** `docs/decisions/pending/caller-id-is-a-paid-lookup-a-member-presses-for.md`

## 1. The problem

The owner's observation (2026-11-09): when somebody records a call, what they usually have is the
phone number and maybe the caller ID. The firm's phones are a cable carrier's business voice service,
which offers no API, no webhook and no live feed of calls, so a ringing call cannot reach the app yet.
What can be done today is to make the number, once typed, say who it belongs to.

## 2. What it answers, cheapest first

| Answer                  | Source                                                 | Cost             | When                                  |
| ----------------------- | ------------------------------------------------------ | ---------------- | ------------------------------------- |
| Directory contacts      | `directory_phone`, matched on (calling code, national) | free             | as soon as the typed number is valid  |
| Area code's region      | libphonenumber's geocoding rows, bundled (Apache 2.0)  | free, offline    | same read                             |
| Caller ID name and line | Telnyx Number Lookup, `caller-name` + `carrier`        | billed per query | only when a member presses the button |

The paid answer is **kept** in the per-firm `caller_identity` table, keyed by the same two parts the
Directory indexes. The next time anybody types that number the free read returns it, and the button is
not offered again. Telnyx's published rates on 2026-11-09 were $0.003 for a caller-name query and
$0.0015 for a carrier query ([pricing](https://telnyx.com/pricing/number-lookup)); the enhanced and
caller-identity types (several times the price) are deliberately not asked for.

A number outside the North American Numbering Plan is `not-covered`: caller-name databases are a
North American institution, so a query for any other number is a billed query that can only come back
empty, and none is made.

## 3. Shape

- **`packages/caller-lookup`** — the port (`CallerLookupPort`, typed outcomes, never a throw), the
  deferred port, the Telnyx adapter with an injected transport, and the area-code table. No `env`.
- **`apps/api-worker/src/caller-lookup/caller-lookup-engine.ts`** — Telnyx when `TELNYX_API_KEY` is
  set, the deferred port otherwise. Absent is the shipped state: the free answers still arrive and no
  button is shown.
- **`packages/directory/src/phone-match.ts`** — `findEntitiesByPhoneNumber`, which also matches a
  number recorded without its country code, or with a leading 1 and no plus, because that is how
  people write domestic numbers into a contact.
- **`packages/communications/src/caller-identity.ts`** — the kept answer's read and upsert, with an
  audit row that records that a lookup was paid for and never the number or the name.
- **Two read-shaped POSTs** under `/api/v1/communications/caller-lookup`, gated on
  `communications:log`. POST rather than GET because invocation logging records full URLs and the
  number is a client's. The paid one requires an idempotency key, so a retried press is replayed
  rather than paid for twice; a refused or dropped query throws inside the idempotent effect, so
  nothing is kept and the next press asks again.
- **`apps/web/src/lib/communications/caller-lookup.ts`** holds the logic and
  **`caller-lookup.svelte`** draws it under the number field. They are separate so the record-window
  redesign can draw the same answer in a side panel.

## 4. What it does not do

- It does not see a call ring. That needs the carrier path (the call-and-text-log design's producer 2) or simultaneous ring to a Telnyx number; this lookup is the piece both of those reuse.
- It does not record or transcribe calls. The owner ruled recording out on 2026-11-09.
- It does not write the caller ID name into the Directory. The network's name is shown beside the
  firm's record, never as it.
