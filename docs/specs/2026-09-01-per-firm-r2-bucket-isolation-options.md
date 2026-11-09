# Per-firm R2 bucket isolation — options brief

**Status:** Options brief (handoff) · **Date:** 2026-09-01 · **Owner:** Trevor Goldsmith
**White-paper home:** _Tenancy and data isolation_ (the per-firm R2 bucket) · _Matters and File Manager_
**ADRs:** builds on ADR-0003 (tenancy and data isolation). A new ADR is owed by whoever lands the chosen option.

**Owner ruling, 2026-09-01: per-bucket isolation is load-bearing.** It is not a
performance choice or a tidiness preference — it is the storage half of the tenancy
boundary that ADR-0003 draws, the same boundary the per-firm database draws for rows.
That ruling closes off the cheap stopgap (re-point every firm's `bucket_name` at the one
shared bucket) as a **destination**. It may still be a bridge; it is not the answer.

This brief is a handoff. It states what is true today, the one hard constraint, the three
options with their real costs, and the inventory a fresh worker needs before writing code.
It does not choose the implementation shape beyond a recommendation.

---

## 1. What is true today

**The design.** The white paper commits to a **per-firm R2 bucket** — that firm's files,
documents, originals, and email archives, versioned — as a peer of the per-firm database.

**Provisioning already builds it.** `apps/api-worker/src/firm-resource-provider.ts` mints
`magna-carta-production-firm-<sha256(firmId) truncated to 16 hex>` per firm
(`firmResourceName()`), creates the bucket through the Cloudflare API, and stores the name
on the control-plane firm row (`control-plane-schema.ts`, `bucket_name`, unique — the
column exists so an R2 event can be resolved back to a firm).

**The Worker binds exactly one bucket.** `apps/api-worker/wrangler.jsonc`:

```
"r2_buckets": [{ "binding": "R2", "bucket_name": "magna-carta-production-platform-files" }]
"R2_BUCKET_NAME": "magna-carta-production-platform-files"
```

**So the two halves disagree, and the seam knows it.**
`apps/api-worker/src/files/firm-bucket.ts` is the one home for "which bucket holds this
firm's bytes". It returns a **pair** — `bucketName` (what a presigned URL addresses and
what an R2 event reports) and `bucket` (the bound handle the Worker reads and writes
through) — and its comment states the constraint plainly: a Worker can only get/put/list
through a **bound** namespace, so today every firm resolves to `env.R2`. When real R2
S3 credentials are present and the names diverge, it **throws rather than write into a
hole**.

**That throw is live in production right now.** From the log the owner uploaded
(2026-09-01):

```
firm bucket magna-carta-production-firm-a569d4867cd8e3979ee353ce2085d547 is not the
R2 bucket bound to this Worker (magna-carta-production-platform-files)
```

three times on `POST /api/v1/downloads/snapshots` and once on `POST /api/v1/uploads`. The
guard is doing its job — this is a loud refusal, not corruption — but for any firm
provisioned with its own bucket, **uploads and the download shelf are down** until one of
the options below lands.

---

## 2. The one hard constraint

**R2 bindings are static Wrangler configuration. There is no runtime API that turns a
bucket name into an `R2Bucket` handle.** Confirmed against Cloudflare's own guidance; the
community thread on dynamic per-tenant buckets
(<https://community.cloudflare.com/t/accessing-dynamic-r2-buckets-from-cloudflare-workers-without-manual-binding/807076>)
is the short version. A binding is added by editing config and deploying.

Everything below is a way around that single fact.

---

## 3. The options

### Option A — S3 API adapter behind `resolveFirmBucket` (recommended)

Keep `resolveFirmBucket` as the only seam. Grow it so that, when the resolved
`bucketName` is not the bound one, it returns an `R2Bucket`-shaped object backed by
**SigV4-signed calls to R2's S3 endpoint** instead of a binding.

**Why this is the recommendation, and why it is smaller than it sounds: the Worker
already does this.** `apps/api-worker/src/files/presign.ts` imports `AwsClient` from
`aws4fetch` (already a dependency, catalog 1.0.20) and makes **server-side, header-signed
S3 calls to an arbitrary bucket name** today — `createMultipartUpload`,
`completeMultipartUpload`, `abortMultipartUpload` — plus query-signed PUT/GET/part URLs.
The credential set (`CLOUDFLARE_ACCOUNT_ID`, `R2_S3_ACCESS_KEY_ID`,
`R2_S3_SECRET_ACCESS_KEY`) is already provisioned, already gated by one predicate
(`realR2Credentials`, `presigner-wiring.ts`), and is **account-scoped** — it can already
reach every firm bucket. So this option does not introduce a new transport, a new
dependency, or a new secret. It finishes one the codebase already runs in production.

What is genuinely new is the object plane: `get` (including ranged), `put`, `head`,
`delete`, `list`, and multipart against a named bucket, returning the shapes callers
already consume.

- **Pros:** no per-firm deploy; a firm provisioned at 2 a.m. works at 2 a.m.; scales past
  any binding count limit; one seam changes and ~40 call sites do not; the presigned
  upload path (which already addresses the firm bucket by name) becomes _correct_ rather
  than refused.
- **Cons:** the adapter must faithfully reproduce the `R2Bucket` surface the callers use,
  including ranged reads and the `R2Object` metadata fields; S3 XML parsing for `list`;
  every Worker-side byte now crosses the network rather than a binding (latency and,
  outside the same account/region, cost). Errors change shape (HTTP status rather than a
  thrown binding error) and must be normalized.
- **Effort:** the adapter itself is a focused module. The bulk of the work is the
  inventory in §5 and the hard cases in §6.

### Option B — bind every firm bucket, deploy per firm

Add an `r2_buckets` entry per firm and redeploy; `resolveFirmBucket` picks the binding out
of `env` by name.

- **Pros:** native bindings, no signing, no network hop, exact existing semantics — zero
  behavioural risk at the call sites.
- **Cons:** **provisioning a firm now requires a config commit and a production deploy**,
  which is a non-starter for self-serve onboarding and puts tenant creation on the release
  path. Binding counts are capped. `main` is production here, so every new firm becomes a
  deploy of the whole Worker.
- **Verdict:** viable only if firm creation stays a deliberate, low-frequency, owner-run
  act. Worth a sentence of consideration and probably not more.

### Option C — one bucket, per-firm key prefix (the stopgap)

Re-point every firm's `bucket_name` at `magna-carta-production-platform-files` and rely on
a `firms/<firmId>/…` key prefix for separation.

- **Pros:** unblocks production in a single control-plane update; no code change.
- **Cons:** **it is the thing the owner ruled out.** Isolation becomes a string convention
  enforced by application code rather than a platform boundary — one prefix bug is a
  cross-firm read. It also loses per-firm lifecycle rules, per-firm event-notification
  scoping (already provisioned, §4), and any per-firm export/deletion story that says "hand
  the firm its bucket".
- **Verdict:** available as a **bridge** if production cannot wait for Option A, and only
  with an explicit expiry. It is not a destination, and it should not be landed quietly —
  it changes the tenancy story and would need the owner's word.

---

## 4. What is already built (this shrinks the job)

- **Per-firm event notifications are already provisioned.** `firm-resource-provider.ts`
  registers object-create rules on the firm's own bucket against the ingest and bulk
  queues (`FILES_NOTIFICATION_PREFIX = "files/"`, `BULK_NOTIFICATION_PREFIX = "bulk/"`),
  and `R2EventMessage` already carries `bucket`. The ingest side of per-firm buckets is
  built and waiting.
- **`bucket_name` is already on the firm row, unique**, precisely so an event resolves back
  to a firm.
- **The S3 transport is already in the bundle** (`presign.ts`, `aws4fetch`), already
  credentialed, already exercised for multipart.
- **`resolveFirmBucket` is already the single chokepoint** and already returns the
  name/handle pair, which is exactly the shape Option A needs to keep.

---

## 5. Call-site inventory

27 modules resolve through the seam:

```
assemblies/assembly-consumer.ts        discovery/archive-expansion.ts     routes/documents/conversions.ts
assemblies/template-orphan-sweep.ts    discovery/load-artifacts.ts        routes/developer/dev-r2-upload.ts
conversions/conversion-consumer.ts     discovery/process-consumer.ts      routes/discovery/discovery.ts
downloads/shelf-retention-sweep.ts     editing/checkout-routes.ts         routes/files/downloads-register.ts
emails/attachment-extraction.ts        files/dimension-backfill-sweep.ts  routes/files/downloads.ts
files/ingest-consumer.ts               routes/documents/assemblies.ts               routes/files/file-repair.ts
routes/files/bundle-status.ts                routes/files/files.ts                    routes/matters/locations.ts
routes/communications/shipping.ts                     routes/documents/templates.ts                routes/files/uploads.ts
scheduled.ts                           search/split-object-host.ts        files/firm-bucket.ts
```

Method mix across the Worker (`bucket.*` = through the seam; `env.R2.*` = direct):

| method                  | via seam | direct `env.R2` |
| ----------------------- | -------- | --------------- |
| `put`                   | 20       | 8               |
| `get`                   | 16       | 10              |
| `delete`                | 7        | 6               |
| `list`                  | 4        | 2               |
| `head`                  | 2        | 9               |
| `createMultipartUpload` | 2        | —               |

**The `env.R2` column is the trap.** A further 20 modules reach the binding directly,
bypassing the seam entirely — among them `downloads/bundle-consumer.ts`,
`emails/capture-consumer.ts`, `search/index-consumer.ts`, `search/compaction-sweep.ts`,
`editing/document-session.ts`, `editing/wopi-host.ts`, `files/preview-serve.ts`,
`routes/email/emails.ts`, `routes/files/file-integrity.ts`, `routes/discovery/discovery-coding.ts`. Each one is
either (a) genuinely firm-scoped and must be routed through `resolveFirmBucket`, or (b)
genuinely platform-scoped and must be _documented_ as such. **Sorting those 20 into the two
piles is the first real task of this work**, ahead of writing the adapter — an S3 adapter
that only the seam's 27 callers use leaves the other 20 reading the wrong bucket, which is
the silent-data-loss failure `firm-bucket.ts` was written to prevent.

A fitness function that forbids `env.R2` outside an allow-list of platform-scoped modules
is the durable way to hold that line, and belongs in the same commit as the sorting.

---

## 6. Hard cases

- **Multipart** — `discovery/load-artifacts.ts`, `downloads/bundle-consumer.ts`,
  `routes/files/uploads.ts` (plus `files/presign.ts`, which already speaks S3). The binding's
  `createMultipartUpload` returns a stateful `R2MultipartUpload` object; the S3 adapter
  returns an upload id and part ETags. These are not the same shape — the adapter needs a
  small stateful wrapper, or the three call sites move to an id-and-parts interface.
  `presign.ts` already contains a working, tested S3 implementation of all three verbs to
  copy from.
- **Ranged reads** — `files/preview-serve.ts` (`range: { offset, length }`, including
  suffix ranges) and `search/split-object-host.ts` (serves the search container's ranged
  reads). Must map to S3 `Range` headers and back, and must preserve the `R2Object`
  metadata the callers read.
- **Per-bucket lifecycle rules.** Today's rules are configured on the one shared bucket.
  Per-firm buckets need them applied at provisioning time: `bundles/` (7-day expiry, live
  today) and `conversions/` (~24 h, **still missing** and already flagged to the owner as
  an operational gap). `downloads/snapshots/` has a 7-day shelf retention enforced by a
  sweep, not by R2 — decide whether it moves to a lifecycle rule while the code is open.
- **Tests.** The Miniflare pool binds a single R2 from `wrangler.jsonc`; it cannot bind a
  per-firm bucket and it has no S3 endpoint. The adapter must be **injectable** the way the
  other ports are (`presignerForEnv`, `resourceProviderForEnv` are the precedents), with
  the fake resolving to the bound binding — otherwise the integration suite cannot exercise
  the firm-bucket path at all.
- **Backfill.** Any firm whose bytes are already in the shared bucket needs them copied to
  its own before the switch, or a read-through fallback for a transition window. Check
  whether any production firm is in this state before designing for it; if the only affected
  firms have no objects yet, this whole item disappears.
- **Region.** `createBucket(firmId, region)` already takes a `DataRegion`. Confirm the S3
  endpoint the adapter signs against honours it.

---

## 7. Suggested order for the fresh worker

1. **Sort the 20 direct `env.R2` modules** into firm-scoped and platform-scoped. Land that
   sorting plus the fitness function first — it is independently valuable and it is what
   makes the rest safe.
2. **Write the S3-backed `FirmBucket`**, injected like the other ports, with the fake bound
   to `env.R2` for Miniflare. `presign.ts` is the reference for signing.
3. **Grow `resolveFirmBucket`** to return the S3-backed handle when the name is not the
   bound bucket, and delete the throw. Keep the pair invariant — the whole point of the
   seam is that `bucketName` and `bucket` never disagree.
4. **Lifecycle rules at provisioning**, including the missing `conversions/` rule.
5. **Backfill or confirm it is unnecessary**, then verify against the firm in the
   production log.

Record the decision as an ADR in the same commit (golden rule 8), and add the
`docs/active-work/` note before starting (golden rule: make your stream visible).

---

## 8. Open questions for the owner

- **Is the shared-bucket bridge (Option C) acceptable while Option A is built**, given
  uploads and the download shelf are refused for at least one firm today? The ruling says
  it is not a destination; it does not say whether it is an acceptable few-day bridge.
- **Does any provisioned firm already hold objects in the shared bucket?** This decides
  whether §6's backfill exists at all.
- **Region policy** — do firm buckets get placed per `DataRegion` today, and does the S3
  endpoint need to vary with it?
