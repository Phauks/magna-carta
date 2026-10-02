---
number: 425
slug: a-firms-bucket-is-resolved-at-one-seam-and-an-adapter-not-a-binding
status: Proposed
date: 2026-09-01
area: Tenancy
summary: "Per-firm R2 bucket isolation is completed by growing `src/files/firm-bucket.ts` into an S3-API-backed `R2Bucket` when the resolved bucket is not the bound one, rather than by binding every firm's bucket in Wrangler configuration or by collapsing every firm onto one bucket behind a key prefix. R2 bindings are static configuration and no runtime API turns a bucket name into a handle, so those are the only three shapes available. The adapter wins because the transport already ships: `files/presign.ts` signs server-side S3 calls to arbitrary bucket names with `aws4fetch` under an account-scoped credential that already reaches every firm bucket, so only the object plane is new — and because it keeps firm creation off the release path, which binding-per-firm would put there on a repository where a merge to `main` deploys. The prefix option is refused outright: it turns the tenancy boundary into a string convention enforced by application code. The binding decision is second: the audit unit is the CALL SITE, not the module, because a module can resolve the firm's bucket name for a signed URL and still read bytes through `env.R2` — five such sites existed, three of them inside modules that already called the resolver. Every firm-scoped access therefore resolves through the seam, the four genuinely platform- or development-scoped modules are named in an allow-list with their reasons, and `lint:firm-bucket-seam` holds the line."
---

**A firm's bytes live in that firm's bucket, and the name a URL is signed against is resolved in the
same breath as the handle those bytes are read through — one decision, at one seam, or it is not a
boundary at all.**

**Context:** provisioning has minted `magna-carta-production-firm-<hash>` per firm since the
beginning and stores it on the control-plane firm row; the Worker binds exactly one bucket. The two
halves disagreed, and `src/files/firm-bucket.ts` already knew it: the resolver returns a **pair** —
the `bucketName` a presigned URL addresses and an R2 event reports, and the `bucket` handle this
Worker reads through — and refused with a loud error rather than write a firm's bytes into a bucket
no read path here could reach. That refusal was live in production on uploads and the download shelf.

The refusal was right and the configuration was the gap, but the blast radius was wider than the log
suggested. `firm-provisioner.ts` is the only production write to `bucket_name` and always writes the
per-firm name, so wherever the full R2 S3 credential set is configured, *every* provisioned firm
fails the guard — not the one firm that happened to be using it.

One hard fact bounds the options: **R2 bindings are static Wrangler configuration, and there is no
runtime API that turns a bucket name into an `R2Bucket`.** A binding is added by editing config and
deploying.

**Decision:** grow the existing seam. When the resolved name is not the bound bucket,
`resolveFirmBucket` returns an `R2Bucket`-shaped object backed by SigV4-signed calls to R2's S3
endpoint. The seam stays the only answer to "which bucket holds this firm's bytes", and the pair
invariant is what it keeps: `bucketName` and `bucket` can never name two buckets.

This is smaller than it sounds because the Worker already does the hard half. `files/presign.ts`
imports `AwsClient` from `aws4fetch` and makes server-side, header-signed S3 calls to an arbitrary
bucket name today — `createMultipartUpload`, `completeMultipartUpload`, `abortMultipartUpload` —
under an account-scoped credential that already reaches every firm bucket, gated by one predicate in
`presigner-wiring.ts`. No new transport, no new dependency, no new secret. What is genuinely new is
the object plane: get, ranged get, put, head, delete, list, and a stateful wrapper over multipart.
`bundle-consumer.ts` already cuts uniform 5 MiB parts before each `uploadPart`, so every part has a
known length and a computable payload hash — the adapter needs no streaming-signature machinery.

**The binding order is the substance of this decision, and it is the reverse of the obvious one.**
Sorting every direct `env.R2` use into firm-scoped and platform-scoped comes **before** the adapter,
not after. An adapter only the resolver's callers use would leave every direct reader on the bound
bucket, which is the silent-loss failure the seam exists to prevent — and the sort cannot be done per
module, because a module can resolve the firm's bucket name for a signed URL and read bytes through
the binding in the same handler. `routes/files/downloads.ts` did exactly that: it resolved the pair,
discarded the handle, checked the *platform* bucket for a cached artifact, and presigned the result
against the *firm* bucket name. The guard's throw was the only thing hiding it; resolving the
divergence without fixing it first would have turned a loud refusal into a 200 carrying a URL for an
object confirmed present somewhere else. The bundle and conversion progress resolvers had the same
split, and so did the bundle build consumer.

**Considered and rejected:** **Bind every firm bucket and deploy per firm.** Native semantics, no
signing, no network hop, and zero behavioural risk at the call sites — genuinely the lower-risk
option at the point of use. It is refused because it puts tenant creation on the release path: on
this repository `main` **is** production, so provisioning a firm becomes a config commit and a
deploy of the whole Worker, binding counts are capped, and self-serve onboarding is foreclosed. That
is the harder thing to undo later, and it would make storage the one tenancy resource whose
provisioning requires a deploy — the per-firm database is a Durable Object namespace addressed
`idFromName(firmId)` at runtime precisely so it needs none.

**One bucket with a `firms/<firmId>/` key prefix.** It would have unblocked production in a single
control-plane update with no code change. Refused as a destination on the owner's standing ruling:
isolation would become a string convention enforced by application code, where one prefix bug is a
cross-firm read, and it discards per-firm lifecycle rules, per-firm event-notification scoping that
provisioning already registers, and any export or deletion story that hands a firm its bucket.

**A fitness function alone as the guard.** Kept, but it is not the evidence. A rule forbidding the
`env.R2` token says nothing about a module that *receives* an `R2Bucket` from a caller — the
dependency-injection shape several modules correctly use. It guards against regression; only reading
the call sites establishes the sort is complete, and the check's own comment says so.

**Consequences:** every firm-scoped R2 access in the Worker resolves through the seam, including the
paths that reach it from a Durable Object's own `env` and from queue consumers that carry only a firm
id — for which the seam grew `resolveFirmBucketForFirmId`, a control-plane lookup, so a message in
flight across a deploy needs no new field. Four modules keep the binding and are named with their
reasons: the status probe, the development presigner's staging objects, the development upload leg,
and the development seeder. `lint:firm-bucket-seam` fails any new direct use and also fails a stale
allow-list entry, so an exemption cannot outlive the reason for it.

The consumer paths now require the firm's control-plane row to exist before a byte is read, which is
correct — a queue message names a firm, not a bucket — and surfaced as three test fixtures that had
been driving consumers for firms that existed nowhere. `seedFirm` now records a bucket by default,
because a firm without one is a shape production never has.

Provisioning now applies the firm bucket's expiry rules as well, on the same unconditional footing as
its event notifications: `bundles/` at seven days, `conversions/` at twenty-four hours, and an
abandoned-multipart abort at twenty-four hours. Both prefixes hold regenerable artifacts, which is
precisely why they can carry a rule where a firm's own documents cannot. Firm buckets previously got
**neither**, so every bundle and conversion a firm ever produced accumulated in its bucket, metered.
The shared platform bucket predates this code and keeps its dashboard step.

The endpoint is now one home (`files/r2-s3-endpoint.ts`), used by both the adapter and the presigner,
and it is jurisdiction-aware — a bucket created under the `eu` jurisdiction exists at no other host.
What is NOT finished, and is named here rather than implied: the firm's real data region reaches that
helper only on the `resolveFirmBucketForFirmId` path, which reads it from the control-plane row. The
name-taking `resolveFirmBucket` and `presignerForEnv` both default to `us`. That default is correct
for every firm today, because `data_region` defaults to `us` and no firm has been provisioned
otherwise, and it becomes wrong for the first EU firm — at which point the region has to be threaded
from the tenancy chokepoint to both. The defect is older than this decision: `presign.ts` hardcoded
the default endpoint before any of this, so an EU firm's presigned URLs were already addressing a host
its bucket does not exist at.

Also still owed: a backfill for any firm whose bytes are already in the shared bucket. The guard's
history bounds it — while credentials have been configured, every such write was REFUSED rather than
misdirected — so the set is plausibly empty, but it is a bucket listing rather than a code question
and has not been run.
