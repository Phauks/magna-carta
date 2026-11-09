# Per-firm R2 bucket isolation — review of the options brief

**Status:** Review · **Date:** 2026-09-01 · **Reviewer:** Claude (branch `claude/r2-bucket-isolation-review-pckokv`)
**Reviews:** `docs/specs/2026-09-01-per-firm-r2-bucket-isolation-options.md` (commit `6c31bdd`, branch `claude/firm-usage-ui-surface-2zpcw6`)
**White-paper home:** _Tenancy and data isolation_ · **ADRs:** builds on ADR-0003

Every claim in the brief was checked against the code on `main`. This review records what
holds, what the inventory miscounts, one category of caller the inventory has no column for,
one hard case missing from §6, and code-backed answers to two of the three open questions.

**Verdict: the diagnosis is correct and Option A is the right recommendation.** The brief
understates the blast radius, and its module-level inventory hides a call-site-level failure
mode inside a module it counts as safe. Neither changes the recommendation; both change the
first task.

---

## 1. What holds

- **The seam and the throw.** `apps/api-worker/src/files/firm-bucket.ts` is a single
  chokepoint returning the name/handle pair, gated on `realR2Credentials(env)`. Accurate.
- **The one hard constraint.** No runtime binding API. Accurate, and the seam's own comment
  already states it.
- **Provisioning.** `firm-resource-provider.ts` mints `firmResourceName(firmId)` and
  registers object-create notifications on `files/` and `bulk/`. Accurate.
- **The ingest side is genuinely ready.** `files/ingest-consumer.ts` resolves firm from
  `message.bucket` against `firm.bucket_name`, then resolves the handle through the seam
  (lines 93-100). This path needs no change under Option A.
- **Option A's premise.** `files/presign.ts` signs `createMultipartUpload`,
  `completeMultipartUpload`, and `abortMultipartUpload` to an arbitrary bucket string via
  `aws4fetch`, and `presigner-wiring.ts` already provides the injectable-port pattern with a
  development fake. The transport and the injection precedent are both in the bundle.
- **Seam caller count.** 27 modules import `resolveFirmBucket`, matching §5 exactly.
- **The method-mix table.** Direct `env.R2` counts verified call-by-call: `put` 8, `get` 10,
  `delete` 6, `list` 2, `head` 9, `createMultipartUpload` 0. Every cell matches.
- **Lifecycle rules.** Confirmed absent — `firm-resource-provider.ts` configures
  notifications and nothing else. Note this is worse than §6 states: firm buckets get
  **neither** `conversions/` nor `bundles/`. The `bundles/` 7-day rule is live on the shared
  bucket only, so it is not "live today" for any firm bucket.

## 2. Corrections

### 2.1 Blast radius: not "at least one firm" — structurally, every firm

`firm-provisioner.ts:181` is the only production write to `firm.bucket_name`
(`routes/developer/dev-seed.ts` is the other, and is development-only), and it always writes
`firmResourceName(firmId)`. That value can never equal the bound platform bucket name. So
wherever the real R2 S3 credential set is configured, **every firm that completed
provisioning fails the guard**, not one. The log shows one firm because one firm was using
it.

This sharpens open question 1 rather than answering it: the bridge decision is about the
whole tenant base, not a single account.

### 2.2 The direct-`env.R2` count is 21 modules, and the partition is not 27 + 20

- 21 modules reference `env.R2`.
- Of those, 18 **never** touch the seam.
- 3 use **both**: `files/firm-bucket.ts` (the seam itself, correctly), plus
  `routes/developer/dev-r2-upload.ts` and `routes/files/downloads.ts`.

So "a further 20 modules reach the binding directly" is really 18 exclusively-direct modules
plus 2 mixed ones. The 2 mixed modules are the dangerous ones and the module-level framing
files them under "goes through the seam".

### 2.3 The failure mode is per call site, and `routes/files/downloads.ts` already has it

`routes/files/downloads.ts` is in the brief's list of 27. It is also broken in the exact way
`firm-bucket.ts` exists to prevent:

| line | what it does                                           | which bucket    |
| ---- | ------------------------------------------------------ | --------------- |
| 171  | `resolveFirmBucket(c.env, firm.bucketName).bucketName` | firm bucket     |
| 406  | `c.env.R2.head(outputKeyPrefix)`                       | platform bucket |
| 459  | `c.env.R2.head(artifactKey)`                           | platform bucket |
| 487  | `zipEntriesFromR2(c.env.R2, resolved.entries)`         | platform bucket |

Line 171 resolves the pair and **discards the handle**, keeping only the name — in a local
variable named `bucket` that holds a string. The route then checks for a cached artifact in
the _platform_ bucket and, on a hit, presigns a GET against the _firm_ bucket name
(lines 400-410, 455-465).

Today the guard's throw masks this. The moment Option A lands and the throw is deleted, this
route serves a 200 with a presigned URL pointing at an object that is not there. That is a
silent failure introduced _by_ the fix, in a module the inventory marks safe.

The same discard-the-handle pattern appears at `editing/checkout-routes.ts` (×2),
`routes/files/files.ts` (×2), `routes/files/bundle-status.ts` (×2), and `routes/files/uploads.ts` (×4). Those
are all presign-only modules and therefore correct — but only a call-site read distinguishes
them from `routes/files/downloads.ts`. **The audit unit is the call site, not the module.**

The handoff has the same split: `routes/files/downloads.ts` passes `bucketName: bucket` (the firm
bucket) to `BundleBuildCoordinator`, which at `bundle-coordinator.ts:101,105` heads
`this.env.R2`, and `bundle-consumer.ts:115` reads inputs and writes the artifact through
`env.R2`. One job, firm name on the routing key, platform bucket for every byte.

### 2.4 A third category the inventory has no column for

Some modules never mention `env.R2` or `resolveFirmBucket`; they take `bucket: R2Bucket` as a
parameter — `files/object-stamping.ts`, `downloads/download-register.ts`,
`editing/wopi-routes.ts`, `search/natural-language-feed-writer.ts`, `routes/matters/locations.ts`,
and helper functions inside `files/ingest-consumer.ts` and `discovery/load-artifacts.ts`.

Architecturally this is the _right_ pattern — the caller decides, so these inherit
correctness. But it means the proposed fitness function proves less than it appears to: a
rule forbidding the `env.R2` token outside an allow-list says nothing about whether the
handle a module _receives_ came from the correct side of the sort. The rule is still worth
having; it is a guard against regression, not evidence that the sort is complete. Only the
call-site read is that.

One piece of the sort is pre-annotated: `bundle-consumer.ts:86-90` already carries a comment
stating that its `env.R2` use is provisional and that `message.bucketName` is the
forward-looking routing key. Worth grepping for similar admissions before sorting by hand.

## 3. Missing from §6: Durable Objects

The brief's hard cases cover multipart, ranged reads, lifecycle, tests, backfill, and region.
It does not mention Durable Objects, which are a distinct injection problem.

There are 11 `DurableObject<Bindings>` classes; at least `downloads/bundle-coordinator.ts`
and `editing/document-session.ts` reach `this.env.R2` directly. A Durable Object receives its
own `env` at construction and lives across requests, so the request-scoped
`presignerForEnv(c.env)` pattern the brief names as the precedent does not transfer
unchanged: a Durable Object must either be handed the firm bucket name in its constructor
arguments or its persisted state, or build the adapter itself from `this.env`. Whichever is
chosen, it is a design decision that belongs in step 2, not a detail discovered in step 3.

`BundleBuildCoordinator` already has `attachment.bucketName` in state, so the data is
present; only the handle construction is missing.

## 4. Answers to the open questions

**Question 2 — does any provisioned firm hold objects in the shared bucket?** Not answerable
from code; it needs a bucket listing. But the guard's history bounds it: while real
credentials have been configured, every firm write has been _refused_, not misdirected. So
any objects in the shared bucket predate the credentials or were written by a path that
bypasses the seam. Check the direct-`env.R2` writers (`put` = 8 call sites) first — they are
the only paths that could have written firm bytes to the platform bucket without tripping the
guard.

**Question 3 — does the S3 endpoint need to vary with region?** **Yes, and it already does
not.** `files/presign.ts:80` hardcodes:

```
const endpoint = `https://${options.accountId}.r2.cloudflarestorage.com`;
```

`packages/database/src/data-region.ts` defines `DataRegion = "us" | "eu"`, and
`jurisdictionForRegion` returns `"eu"` for EU firms — a hard jurisdiction, which
`firm-resource-provider.ts:173` passes to `createBucket`. A jurisdiction-bound bucket is
reachable only at `https://<account>.eu.r2.cloudflarestorage.com`. An EU firm's presigned
URLs therefore address an endpoint its bucket does not exist at.

This is **latent, not live**: `control-plane-schema.ts:86` defaults `data_region` to `"us"`,
so it bites on the first EU firm. It is a defect in the _existing_ presign path, independent
of bucket isolation, and Option A's adapter would inherit it. The endpoint should be derived
from the firm's region at the same seam that resolves the bucket — which argues for
`resolveFirmBucket` returning the region (or an endpoint) alongside the pair.

## 5. One piece of good news for Option A

The brief flags multipart as a shape mismatch, which it is. But the hardest version of that
problem — SigV4 header-signing a stream of unknown length — does not arise.
`bundle-consumer.ts:34-81` (`putStreamMultipart`) already materializes uniform 5 MiB
`Uint8Array` parts before each `uploadPart` call, so every part has a known length and a
computable payload hash. The adapter needs a stateful wrapper around upload id and part
ETags, and must map `customMetadata` to `x-amz-meta-*` headers, but it does not need
streaming-signature machinery.

Two edges to pin with tests: S3 rejects non-final parts under 5 MiB (the code satisfies this,
but the adapter must not re-chunk), and the single-empty-part case at line 66 must be
confirmed against R2's `CompleteMultipartUpload`.

## 6. Revised order

The brief's five steps are right. Two amendments:

1. **Step 1 becomes a call-site audit, not a module sort.** Sorting 18 modules into two piles
   leaves `routes/files/downloads.ts` and its coordinator/consumer chain misclassified, because they
   are mixed within a single module. Fix that chain as part of step 1 — it is a live
   correctness bug that outlives whichever option lands, and it is the endpoint in the
   production log.
2. **Fold the region/endpoint defect into step 2.** The adapter has to choose an endpoint
   anyway; choosing it correctly costs nothing now and is a migration later. Decide there
   whether `resolveFirmBucket` returns the region.

The fitness function should ship with step 1 as proposed, with its limits (§2.4) written into
its own comment so a later reader does not mistake a green lint for a complete sort.

Whoever lands the chosen option still owes the ADR (golden rule 8) and an
`docs/active-work/` note (golden rule: make your stream visible).
