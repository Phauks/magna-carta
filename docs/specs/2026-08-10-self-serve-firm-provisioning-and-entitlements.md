# Self-serve firm provisioning, the free evaluation tier, and entitlements — design

**Date:** 2026-08-10
**Status:** Design proposed. The owner flags in section 9 are open; every one of them is a **number or a
policy choice**, not a structural question — the shape below is buildable without them, and the numbers
are configuration the catalog reads. **No product code, no migrations, and no schema edits in this
cycle.**
**Scope:** How an anonymous stranger creates a firm and what that costs; what a free evaluation tier
withholds and why; where entitlements live, how they are read on the hot path, and how they compose with
the permission model without becoming a second authorization system; what happens to an abandoned free
tenant; the abuse surface an anonymous creation endpoint opens; the upgrade seam a future payments
integration fills; and whether a paid tier should require proving the firm is a real practice.
**Excludes:** payments themselves (Phase 6/7, parked — this design defines the seam and builds nothing);
the registration and free-tier user interface (a parallel stream; this design supplies the configuration
its panels render from); pricing; the terms of service; per-subject erasure, which remains its own
undecided track.
**White-paper home:** _Tenancy and data isolation_, with _Authentication, access control & encryption_,
_Settings & configuration_, _Delivery model_, and _Observability & diagnostics_ as surrounding context.
**Governing decisions:** ADR-0003 (tenancy and the firm-scoped data-access layer), ADR-0067 (route
metadata and the one enforcement chokepoint), ADR-0068 (trusted-insider access control — the 403/404
split), ADR-0039 (nothing heavy on the hot path), ADR-0049 (deleted-file lifecycle: destruction is
policy-driven, hold-blocked, audited, and defaults to indefinite retention), ADR-0084 (per-firm
crypto-shred), ADR-0078 (build the cheap-to-add seams while in the area; the exact per-firm storage
rollup), ADR-0168 (`firm.data_region`), ADR-0190 (firm-level erasure is the only erasure that exists).
**Decision inputs, all read in this cycle:** `packages/database/src/control-plane-schema.ts` (the firm
registry), `apps/worker/src/firm-provisioner.ts` and `apps/worker/src/firm-resource-provider.ts` (what
provisioning actually does), `apps/worker/src/routes/platform/firms.ts` (the secret-gated creation route),
`apps/worker/src/chokepoint/chokepoint.ts` and `apps/worker/src/contracts/route-meta.ts` (the one
enforcement point and its reserved seams), `packages/access-control/src/registry.ts` (the permission
registry), `apps/worker/src/usage/consent.ts` (the isolate-local cache idiom this design reuses),
`apps/worker/src/scheduled.ts` (the fleet-wide cron enumeration), `apps/worker/src/firm-key-shred.ts`,
`apps/worker/src/routes/firm/firm-usage.ts` (the storage measurement already built),
`docs/specs/2026-08-04-custodian-design.md` (the retention and destruction posture this design follows
rather than reinvents), `docs/specs/2026-08-06-ai-search-integration-design.md` (the 5,000-instance
account cap), `docs/conventions/settings.md` and `packages/notifications/src/settings.ts` (the
declarative settings idiom), `docs/conventions/operations.md` (Turnstile's real status).

---

## 1. What changes, in one paragraph

Today a firm is created by a platform administrator through `POST /v1/firms`, guarded by a Worker-secret
header, on a fleet of about one. Three things in the shipped code say so out loud: the firm row's `name`
column carries the comment "platform-admin-controlled input on a fleet of ~1; revisit if self-serve
signup ever exists", the provisioner repeats it, and the registration path has no bot control because it
never faced the open internet. The owner's direction opens that door. This design keeps every piece of
the existing provisioning machinery — it is already resumable, already idempotent, already correct — and
changes four things around it: **who may call it** (anyone, behind a verification gate), **when it runs**
(a queue job, not a request handler), **what identifies a run** (the firm id, not the firm's name), and
**what a firm is allowed to do once it exists** (an entitlement tier, enforced as a mask over the
permission registry rather than as a second gate).

---

## 2. Provisioning on demand

### 2.1 What a firm actually is, and therefore what one costs

The costs are smaller than the phrase "per-firm D1 plus per-firm R2" suggests, because the first half of
that phrase is no longer true. Provisioning a firm today does exactly this:

| Step                       | Cost                                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-firm database          | **Nothing at provisioning time.** It is the firmId-addressed `FirmDatabase` Durable Object, which exists for every firm id and self-migrates the per-firm lineage on first access. |
| Per-firm R2 bucket         | One real account resource. A `GET` probe, then a `POST` create against the Cloudflare REST API.                                                                                    |
| Bucket event notifications | One `PUT` for the interactive ingest lane, a second when the bulk lane is configured. Idempotent, re-run on every resume.                                                          |
| Firm data key              | 32 random bytes, AES-KW-wrapped under the root key-encryption key; only the wrapped form is stored.                                                                                |
| Control-plane rows         | The `firm` row, the owner `user` row, a `firm.provisioned` audit row, one `member.provision` outbox row, one idempotency record. Five rows.                                        |
| First access to the firm   | The whole per-firm migration lineage applied inside the Durable Object. This is the single largest unit of work and it happens lazily, on first use, not at provisioning.          |
| Forever after              | Enrolment in every fleet-wide sweep. See 2.3 — this is the cost that matters.                                                                                                      |

So the per-tenant footprint is: one R2 bucket, one Durable Object, five control-plane rows, three to four
Cloudflare REST calls.

### 2.2 Do Cloudflare's account limits bound the idea?

**No.** Checked against the published limits rather than assumed:

- **R2 buckets: 1,000,000 per account** by default, raisable on request. One bucket per firm means the
  account holds a million tenants before the limit is even a conversation. It does not bind.
- **R2 bucket management operations: 50 per second.** Signup rates do not approach this.
- **R2 REST API: 1,200 requests per five minutes, account-wide.** This is the one real number. At three
  to four calls per provisioning it permits roughly 300–400 provisionings per five minutes, and the
  budget is _shared_ with every other REST consumer — lifecycle rules, bucket locks, notification
  reconfiguration. It bounds **burst throughput, not population**, and it is the concrete reason
  provisioning must be a rate-limited queue consumer rather than a request handler.
- **D1: the 50,000-databases-per-account limit does not apply**, because only the control plane is D1.
  Had the per-firm database still been D1, this limit would have been the interesting constraint and the
  answer to this section might have been different. It is not.
- **Durable Objects: unlimited objects per namespace**, 10 GB of SQLite per object on Workers Paid,
  500 classes per account. None of these bind; the 10 GB per-object ceiling is a per-firm data-volume
  question for very large firms, entirely unrelated to tenant count.
- **AI Search instances: 5,000 per account**, one per firm, created on opt-in. This one **does** bind —
  see 5.5. It is a reason to withhold a specific feature from the free tier, not a reason the tier
  cannot exist.

### 2.3 The constraint that does bind, and it is ours

`apps/worker/src/scheduled.ts` runs a **serial loop over every active firm** on the `*/5` cron:
`listReachableActiveFirms` selects every row with `status = 'active'`, and for each one the pass does an
outbox sweep, an idempotency purge, a stale-upload sweep, and a stranded-version re-drive — several
Durable Object round trips per firm, per five minutes. The daily pass adds storage reconciliation (a full
R2 `LIST` per firm) and the notification-retention sweep on the same enumeration.

That design is entirely correct for a curated fleet. Self-serve replaces the curated fleet with an
unbounded population of strangers, most of whom will sign in twice and never return, and the sweep cost
is paid on every one of them forever. **This — not any Cloudflare limit — is what actually bounds
self-serve tenancy**, and it is the reason dormancy in section 3 is defined as a _sweep-eligibility_
state and not merely as a step on the road to deletion. A firm that goes dormant leaves the hot
enumeration, and the platform recovers the recurring cost long before anything is destroyed.

Two consequences worth building in-area rather than retrofitting (ADR-0078): the enumeration should
select on an index over `status`, and the per-firm loop should become batched and resumable across passes
rather than serial-over-everything. Neither is in scope here; both are named so the build stream does not
discover them at the fleet size where they hurt.

### 2.4 Registration as two stages, and why the split is the primary anti-abuse control

**Stage one — registration. One control-plane write, no resources.**
`POST /api/v1/registrations` (public surface, Turnstile-gated, IP-rate-limited, idempotency-keyed) mints
a firm id, inserts a `firm` row in status **`pending_verification`** and an unverified owner `user` row,
and sends a verification email. It creates **no bucket, no key, no Durable Object touch, and no
notification configuration.** A spam run against this endpoint costs the platform two rows per attempt.

**Stage two — provisioning. A queue job.**
The owner's verification click flips `email_verified`, moves the firm to `provisioning`, and commits a
`firm.provision` outbox row in the same batch. The relay hands it to the platform-jobs queue, whose
consumer calls the existing `provisionFirm` orchestration **unchanged**. This is the reuse that makes the
whole design cheap: `provisionFirm` is already step-guarded and resumable by construction, which is
exactly the contract an at-least-once queue consumer needs. The consumer adds one thing — a token bucket
against the R2 REST budget from 2.2 — and nothing else.

Splitting the stages is not only tidiness. It is the control that makes the endpoint economically
uninteresting to abuse (section 6), and it is what keeps `status = 'active'` meaning "a firm somebody
actually confirmed", which is what the cron enumeration filters on.

### 2.5 The resume identity must stop being the firm's name

`provisionFirm` resumes a crashed run by looking the firm up by its **`UNIQUE` name**, byte-exact, with
the route canonicalizing whitespace and Unicode form so a retry finds its own partial row. The module
documents why (firm ids are minted per attempt, so a client-supplied name was the only stable handle) and
documents its own expiry condition: "Platform-admin-controlled input on a fleet of ~1; revisit if
self-serve signup ever exists."

Self-serve breaks it three ways. Firm names are not unique in the world — there are a great many firms
called _Smith Law_, and the second one to register would be told its name is taken. A globally unique
name column is a **tenant-enumeration oracle**: a stranger can probe for the existence of any firm by
attempting to register its name, which is precisely the kind of existence leak ADR-0068 spends the 403/404
split preventing everywhere else. And it is a squatting surface — registering _Cravath_ costs one email
address.

**Recommendation.** The firm id becomes the resume identity, minted once at registration and carried in
the queue message; the provisioner's find-first becomes `WHERE id = ?`. The human-facing name moves to a
new nullable `display_name` column (null means "use `name`", so every existing row is correct with no
backfill), and `name` is written by registration as a platform-generated unique handle. This is purely
additive — the `UNIQUE` constraint stays satisfied and is never dropped, which matters because SQLite
cannot drop one without a destructive table rebuild and the additive-only rule forbids that against a
table holding data.

The consequences are all improvements: no name collisions between unrelated firms, no enumeration oracle,
no squatting, and the `name-conflict` outcome branch simply stops occurring for self-serve registrations.
The secret-gated `POST /v1/firms` route is kept exactly as it is, name-keyed, for platform-administrative
creation.

### 2.6 Firm status becomes a lifecycle

`firm.status` is already a free-text column defaulting to `'active'`, so extending the vocabulary is
additive and needs no migration of existing rows:

`pending_verification` → `provisioning` → `active` → `dormant` → `suspended` → `closing` → `closed`,
plus `suspended_billing` off `active` (section 7).

Only `active` is enumerated by the cron. Only `active` and `suspended_billing` accept a session at all;
`suspended` accepts one for export alone. A firm that never verifies never leaves `pending_verification`
and never costs anything but two rows.

---

## 3. Reaping an abandoned tenant

### 3.1 The posture is already set; this design follows it

An abandoned free workspace belonging to a lawyer may hold privileged material. The platform has already
decided how it treats data it might destroy, twice, and both decisions bind here:

- **ADR-0049** made deletion a soft-delete with a trash window, a cold tier, and a hard-delete that is
  policy-driven, **blocked by any legal, discovery, or Custodian hold**, audited like any irreversible
  act — and it shipped the destruction machinery with retention **defaulting to indefinite**.
- **The custodian design** went further and refused to ship retention _periods_ at all: the destruction
  request/approval workflow exists, `retention_until` is a nullable column a firm sets, and there is
  deliberately **no automatic destruction sweep**, on the reasoning that "we have a scan" is exactly the
  reasoning that destroys an original will. Its formulation — _the seams exist and the numbers do not_ —
  is the precedent this section follows rather than a new invention.

So: nothing here destroys anything on a timer alone, every step is warned, every step is recorded, and
the numbers below are proposals the owner sets (flag F2).

### 3.2 Dormancy is measured in human activity, not in data

Dormancy must not be inferred from an empty workspace. A firm with two matters that somebody opens every
Tuesday is alive; a firm with four hundred documents that nobody has opened since March is not.

The signal is the later of **the last authenticated session for any member of the firm** (control-plane
`session` and `auth_audit`, both already written) and **the last write to the firm's per-firm
`audit_log`** (already written on every mutation). Recommend materializing it as `firm.last_activity_at`,
updated cheaply and approximately — a write at most once per firm per day, off the request path — so the
reaping sweep is a single indexed control-plane scan rather than a fleet-wide fan-out into every firm's
Durable Object. Reaping must not itself become the thing that costs money.

Two populations, and the distinction carries the whole design:

- **Never-activated.** Provisioned, but no member has ever signed in beyond the owner's activation, no
  byte has ever been ingested, and the per-firm audit log is empty. There is provably no client data,
  because there was never a session in which any could be created.
- **Used-then-abandoned.** Anything else. There may be privileged material, and the platform cannot know.

### 3.3 The ladder

Free tier only. A firm that has ever paid is never on this ladder (section 7).

| Day (from last activity) | State           | What happens                                                                                                                                                              |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 60                       | `active`        | First notice, in-app and by email. No state change, nothing withheld.                                                                                                     |
| 90                       | `active`        | Second notice, naming the exact dates ahead and the export path.                                                                                                          |
| 120                      | **`dormant`**   | Drops out of the fleet-wide cron enumeration. **Signing in restores `active` immediately and is the only action required.** Nothing is withheld and nothing is destroyed. |
| 150                      | `dormant`       | Final notice to the owner **and every member**, 30 days ahead of suspension.                                                                                              |
| 180                      | **`suspended`** | Sign-in permits export only. Still nothing destroyed; self-restore remains one click for 30 more days.                                                                    |
| 210                      | **`closing`**   | An export bundle is built into the firm's own bucket and a time-limited link mailed to the owner. The link lives 30 days.                                                 |
| 240                      | **destruction** | Only via the recorded act in 3.4.                                                                                                                                         |

The recurring cost is recovered at day 120, six months before anything is destroyed. That ordering is
deliberate: it means the platform is never under cost pressure to shorten the destruction clock.

### 3.4 What "destroyed" means, and who is allowed to say so

Destruction is exactly three acts, in order, each recorded in the control-plane `auth_audit`:

1. **`shredFirmKey`** — the mechanism already built (ADR-0084). Nulling the wrapped firm key makes every
   protected column permanently unreadable and writes the `firm.key_shredded` row that also stops the
   provisioner ever re-minting a key for this firm.
2. **Delete the R2 bucket and its objects.**
3. **Delete the `FirmDatabase` Durable Object's storage.**

**Control-plane rows are retained, not deleted.** The `firm` row flips to `closed` and the audit chain —
registered, each warning delivered, dormant, suspended, closing, key shredded, destroyed — stays forever.
A destruction with no record of why is precisely the artifact a lawyer cannot be handed, and the rows are
bytes.

**Who may execute it.** Following the custodian precedent, the sweep **proposes** and does not execute.
Splitting by population is what keeps that affordable:

- **Never-activated tenants: fully automatic**, on a shortened 30-day clock from provisioning, because
  the absence of client data is a structural fact rather than a judgement. This is the volume case.
- **Everything else: the sweep writes a destruction request** — the custodian's
  `custody_destruction_request` shape, adapted: requester (the sweep), basis, approver, approved-at,
  executed-at, outcome — and a named `platform_operator` approves it. Volume is bounded because most
  abandoned trials are never used.

**Hard refusals, never auto-proposed at all.** A firm with any trust ledger row carrying a non-zero
balance; any Custodian hold; any legal or discovery hold; any custody packet in `held` or `out`. These
escalate to a human contact track and stay there. Non-zero client money in a workspace about to be
destroyed is a catastrophe, and refusing to reap it costs nothing given that trust is withheld from the
free tier in the first place (5.1) — which is a large part of why withholding it is the right call.

**A warning nobody received is not a warning.** The notifications delivery subsystem records delivery. If
the final notice bounces, the clock **stops** and the firm goes to the manual queue. Proceeding to
destruction on the strength of an email that was never delivered is not defensible.

### 3.5 What this deliberately does not do

No silent purge. No shortening of the clock for cost reasons — the cost is already recovered at day 120.
No destruction of a firm that has ever paid. No per-subject erasure, which remains undecided elsewhere
and is not smuggled in here.

---

## 4. The entitlement model

### 4.1 Where entitlements live

The control plane, and the argument for the shape is that entitlement is a **platform fact about a firm**,
not a firm's own configuration. That rules out the per-firm `setting` table immediately — it lives in the
firm's own database, is written through the firm-scoped data-access layer by the firm's own admins, and a
firm setting its own tier is the whole problem.

Recommended shape, in two parts:

**The catalog is code.** A new module beside the permission registry —
`packages/access-control/src/entitlements.ts` — declaring each tier: which permission keys it withholds,
which quota dimensions it caps and at what number, and a human label and description per entry. Code
because it is versioned, reviewable in a pull request, diffable, exhaustively testable, and because the
platform already treats its most load-bearing vocabularies this way (the permission registry, the feature
flag catalog, the notification registry). Its cost is that changing a limit is a deploy, which for a
handful of tiers is the right trade.

**The per-firm assignment is data.** Two columns on `firm` and one small table:

- `firm.entitlement_tier` — text, not null, **default `'full'`**. The default matters more than it looks:
  a migration that defaulted the existing fleet to `'free'` would silently downgrade every real firm. The
  free tier is the exception a registration writes, never the default a schema implies.
- `firm.verification_status` — text, not null, default `'unverified'` for new rows and asserted `'verified'`
  for the existing fleet. Section 8 argues why this is a second axis rather than part of the tier.
- `firm_entitlement_override(firm_id, key, value, expires_at, granted_by, note)` — per-firm exceptions.
  This exists so "give this firm 5 GB while we sort their invoice" is a row rather than a deploy, and so
  a future payments integration has somewhere to write a grant that is not a whole tier.

Resolution is catalog, then override, most-specific-wins — the same precedence idiom
`docs/conventions/settings.md` already sets out, applied to a different storage tier.

### 4.2 Reading it on the hot path

Three layers, none of them new machinery:

1. The catalog is a compile-time constant. Zero reads, ever.
2. The per-firm resolution (tier, verification status, overrides) is read from the control plane and
   cached **isolate-locally under a short TTL**, exactly as `apps/worker/src/usage/consent.ts` already
   caches usage-analytics consent: a `Map` keyed by firm id, a 60-second entry lifetime, first request
   warms it and every subsequent request in that isolate reads memory. Reuse that resolver's shape rather
   than inventing a second caching idiom.
3. The chokepoint already performs a control-plane firm lookup per request in `resolveFirmContext`.
   Entitlement resolution rides that same step, so after warmup it adds **no round trip at all** and in
   the cold case it adds nothing that was not already being read.

A tier change therefore takes effect within one TTL. For an upgrade that means a paying firm waits up to
a minute, which is acceptable and can be shortened to zero for the specific case by invalidating the
entry on the write — the same `invalidate(firmId)` move `firm-key-shred.ts` already makes against the key
cache.

### 4.3 The composition — one gate, one vocabulary, two denial reasons

**An entitlement is a mask over the existing permission registry. It is not a second vocabulary and it is
not a second gate.**

Concretely:

- **The catalog names registry keys and nothing else.** A tier is, on the capability axis, a set of
  `Permission` strings it withholds: `trust:manage`, `discovery:load`, `esign:seal` — the same strings
  routes already declare in their `RouteMeta`. There is no parallel vocabulary of feature names, because
  a parallel vocabulary is the thing that drifts.
- **The withholding happens inside the chokepoint's existing step 3b.** `ChokepointPorts.loadPermissions`
  returns the principal's effective set today; tomorrow it returns that set **intersected with what the
  firm's tier permits**. Nothing about the chokepoint's ordered contract changes: no new step, no new
  ordering question, no new port, no route metadata, no handler discipline.
- **Denial keeps one decision point and gains one branch.** The single `permissions.has(required)` check
  stays exactly where it is. The port additionally reports which keys it withheld, so the chokepoint
  renders **402 `upgrade-required`** (carrying `upgradeRequired: true`, the sibling of the existing
  `requestAccess: true`) when the missing key is a withheld one, and the existing **403
  `permission-denied`** otherwise. This branch is not cosmetic: answering a firm Owner "your role does not
  grant this action" when they hold every role in the firm is a support ticket every single time, and it
  is also a lie.
- **Exhaustiveness is enforced the way registry coverage is already enforced.** A fitness test asserts
  every key in `PERMISSIONS` is classified in every tier — available or withheld, explicitly. A new
  subsystem key that nobody classified fails CI rather than defaulting silently in either direction. This
  is the mechanism that stops the catalog drifting behind the registry, which is the failure mode this
  whole section exists to avoid.

**Why this is not a second authorization system, stated plainly:** it has no vocabulary of its own, no
enforcement point of its own, and no route-level declaration of its own. It is an intersection applied to
the _input_ of the one check the platform already makes. There remains exactly one place in the codebase
that decides whether a request proceeds. The only thing new on the wire is which problem document a
denial renders.

**The alternative, and why it is refused.** `RouteMeta` reserves an unpopulated `planTier` field for
exactly this feature. It is the wrong seam to fill. Populating it would put a tier declaration on each of
several hundred routes, in a second vocabulary, maintained by per-route discipline — and two routes that
reach the same capability could classify it differently, which is the drift disaster in its purest form.
**Recommendation: leave `planTier` permanently unpopulated and retire it**, with a comment pointing at
the entitlement catalog. This contradicts a deliberately reserved seam and is flagged as such (F7).

### 4.4 Quotas are a second axis, and must not be forced into the mask

`storageBytes`, `memberCount`, `matterCount`, `fileCount` are numbers, not capability keys, and pretending
otherwise would corrupt the clean thing in 4.3. They are enforced **at the point of consumption**, not at
the chokepoint:

- The measurement already exists and must not be rebuilt: ADR-0078's exact incremental per-firm rollup by
  storage class and prefix, surfaced by `readStorageUsage` and `GET /api/v1/firm-usage`.
- Storage is checked **twice**: at presign, so the refusal is early and friendly, and at version commit,
  which is the authority. Checking only at presign lets a client that ignores the refusal still commit;
  checking only at commit wastes the upload.
- Entity ceilings are checked in the create path of the subsystem that owns them.
- Refusal is the same 402 `upgrade-required` problem, carrying the dimension and the limit, so one client
  handler covers both axes.

An over-quota firm is **never** deleted down to fit. It is refused new writes and keeps everything it has
— the same principle as 7.3.

### 4.5 What the registration screen renders from

One public, unauthenticated `GET /api/v1/tiers` renders the catalog: tier names, the human labels of what
each withholds, and the quota numbers. The registration screen, the in-app upgrade panel, the 402 problem
body, and the enforcement itself all read the same catalog. **A limit therefore cannot be right in one
place and stale in another**, which is the platform's rule that limits render from configuration and never
from hard-coded copy. This endpoint is what the parallel sign-in mockup's placeholder limits become.

---

## 5. What the free tier withholds

Two reasons to withhold, and they are not interchangeable — they unlock differently:

- **Withheld for integrity.** An _unverified_ firm should not do this. Unlocking requires **verification**,
  not payment (section 8).
- **Withheld for cost.** It spends real money or a scarce account resource per use. Unlocking requires
  **payment**, and a paying firm gets it at once.

### 5.1 Trust accounting — withheld for integrity. Yes, this is the right call

`trust:read`, `trust:manage`, `trust:authorize`.

The obvious argument — client money, unverified stranger — is correct but not the strongest one. Three
better ones:

- **The subsystem already fails closed on exactly this class of uncertainty.** The jurisdiction corpus
  refuses to act on rules pending attorney review. Handing an unverified stranger a ledger that purports
  to track client money under rules the platform has not certified manufactures a record the firm may
  later have to defend to its bar, and the platform would have invited it.
- **It is what makes the reaping refusal in 3.4 cheap.** "Never reap a firm holding client money" is a
  simple, absolute rule precisely because a free tenant cannot hold any. Allow trust on the free tier and
  the rule either becomes unenforceable or makes free tenants unreapable — an abandoned workspace with a
  trust ledger is one the platform can neither destroy nor charge for.
- **A trust ledger is not a demo.** It has no value to an evaluator who is not going to run real client
  money through it, so withholding it costs the showcase almost nothing.

**And it should unlock on verification, not on payment.** A credit card is not evidence that a real
practice is holding real client funds.

### 5.2 Billing — partially withheld, for integrity

Withhold `billing:finalize`, `billing:apply`, `billing:credit`. Keep `billing:read` and `billing:draft`.

A finalized invoice is an evidentiary record with a drawn number that the firm hands to a client. An
unverified workspace minting one, and then being reaped, produces exactly the artifact nobody can later
explain. Drafting demonstrates the entire product surface — arrangement, rate cards, work-in-progress
capture, the draft itself — without producing a record that leaves the building.

### 5.3 E-signature seal — withheld for integrity, at any price below verification

`esign:seal`. The seal is applied with the **platform's** signing key, in the dedicated worker that alone
holds it. A sealed document asserts something about us, not merely about the firm. This one does not
unlock for money.

### 5.4 Discovery — the loading act withheld, for cost

Withhold `discovery:load`. Keep `discovery:read` and `discovery:manageReviewSets`.

The permission registry already makes the argument: loading "is the act that brings another party's
untrusted material into the firm's own corpus, consumes the review set's document ceiling, and is the one
discovery operation whose cost is set from outside the firm." Container processing, extraction, OCR and
index build, all per byte of somebody else's production, all unbounded by anything on our side. Withhold
the act that spends; leave the surface visible so the evaluation shows what the product does.

### 5.5 Magnus and AI Search — withheld for cost _and_ for a hard account limit

`magnus:converse`, `magnus:readAllConversations`, and the AI Search firm opt-in.

Inference cost is the obvious reason. The structural one is better: the AI Search design allocates **one
instance per firm**, created on opt-in, against an account cap of **5,000 instances**. A few thousand
evaluators opting in would consume the platform's entire AI Search capacity and lock out paying firms.
That is a capacity reservation, not a cost preference, and it should be recorded as such so nobody later
"generously" enables it.

### 5.6 Container-backed tools — withheld for cost, ideally metered rather than locked

`tools:ocr`, `tools:fileConverter`, `tools:fileRepair`, `tools:decryption`. Each is CPU-bound Container
time per invocation.

The better answer here is a **small metered allowance** rather than a hard lock — a handful of runs
demonstrates the tool, and a locked button demonstrates nothing. Metering is a third enforcement shape
(a counter with a period), which is real work; if it is not built, lock them and say so plainly in the
tier catalog. Flagged as F6.

### 5.7 Outbound and third-party surfaces — withheld for integrity

`emails:manageCaptureAddresses` (minting a platform-branded `@in.magnacarta.esq` inbound address for an
anonymous stranger is handing out platform mail capacity), `shipping:manage` (postage is a payment
instrument), and the client portal (it exposes an unverified workspace to _third parties_ — the firm's
own clients — under our domain).

### 5.8 Quotas

Storage bytes, member count, matter count. Numbers are configuration and are flagged (F1), but two
recommendations on shape rather than value: the **member ceiling is the single most effective anti-abuse
limit on a free tier**, because it caps the value of a farmed tenant, and it should be small. And the
storage ceiling should be small enough that a free tenant's abandoned bytes are never individually worth
worrying about, which is what lets the reaping ladder in 3.3 be patient.

### 5.9 What is deliberately not withheld

Matters, the directory, conflicts, time tracking, costs, documents and editing, document automation,
custodian, the calendar, notifications, file upload within quota, keyword search, and every read-only
tool. The free tier has to be a genuine practice-management workspace or it showcases nothing. **The lock
list is short on purpose**, and every entry on it earns its place by one of the two reasons above rather
than by being expensive-looking.

---

## 6. Abuse

### 6.1 Warranted

- **Turnstile in managed mode on the registration endpoint.** Stated honestly: in this tree Turnstile is
  an unchecked item in `docs/conventions/operations.md` with a named build seam, not shipped code. This
  design **depends on standing it up** and does not assume it exists.
- **Email verification before any resource is created.** The single highest-value control, because it
  moves the entire provisioning cost behind a click on an address somebody controls. The machinery exists
  (Better Auth's `verification` table and `user.email_verified`).
- **The two-stage split itself (2.4).** This is the primary defence and deserves to be named as one: an
  unverified registration costs two control-plane rows. Nothing about a spam run touches R2, the REST
  budget, a Durable Object, or the cron enumeration.
- **Rate limiting on the registration endpoint,** keyed by IP through the chokepoint's existing
  `clientRateLimitKey` — already implemented for the public surface, using Cloudflare's edge-set
  `cf-connecting-ip`, which a client cannot spoof and cannot rotate. Reuse; build nothing.
- **A token bucket in the provisioning consumer** against the R2 REST budget. Availability protection
  rather than abuse protection, but it is what stops a burst taking out the account's R2 API for every
  other consumer.
- **One free workspace per verified email address, and a soft daily cap per IP.** Cheap, and it is what
  makes farming tedious.
- **Anomaly alerting on the registration rate,** through the telemetry pipeline that already exists.

### 6.2 Theatre

- **Blocking disposable email domains.** An arms race against a list that is always stale, and its false
  positives are real lawyers at small domains. Require a _verified_ address instead and count workspaces
  per address.
- **Phone or SMS verification.** Real cost, real friction, trivially defeated, and it excludes legitimate
  international users.
- **Blocking VPN, Tor, and proxy ranges.** Lawyers use VPNs, and privacy-conscious ones use them more.
- **A CAPTCHA in addition to Turnstile.** No additional signal.
- **Bar-number entry at registration.** Nothing is checked at the door, so it is a text box that filters
  nobody while implying a verification that did not happen. It belongs at upgrade (section 8).
- **Requiring a credit card to open a free workspace.** This would work — and it would also end the
  showcase the owner asked for. It is a product decision, not a security one, and is not recommended
  here.

---

## 7. The upgrade seam

Build nothing. Define the seam precisely enough that the payments work is a wiring job.

### 7.1 One writer

Tier is a control-plane fact with exactly one writer: an internal function,
`setFirmEntitlementTier(firmId, tier, reason, actor)`, which writes the column, records an `auth_audit`
row, and invalidates the isolate cache entry. **The seam is the function, not a route.** Today it is
reachable from a platform-operator-guarded endpoint — `apps/worker/src/routes/platform/platform-release-channel.ts`
is the working template for exactly this shape: secret-guarded, no firm session, audited to the
control-plane `auth_audit`. Tomorrow the payments integration calls the same function. Nothing else in
the codebase ever writes the column.

### 7.2 What a future payments integration must supply

1. **A subscription identity** on the firm row — `billing_customer_reference` and
   `billing_subscription_reference`, opaque provider-owned strings. Nothing else about the provider
   enters our schema.
2. **An authoritative entitlement decision, not a payment event.** The integration must answer _"what
   tier is this firm entitled to, as of now"_. Our side stores that answer; it never derives entitlement
   by replaying an event stream, because an event stream with one lost message produces a wrong answer
   that persists.
3. **A paid-through instant** (`entitlement_paid_through`), so a webhook we never receive degrades safely
   in a chosen direction rather than leaving a firm entitled forever or cut off instantly.
4. **Idempotent, replayable delivery with a stable event id.** The platform's idempotency machinery
   already covers the rest.
5. **A reconciliation read** — a scheduled pull that re-asserts the provider's truth over our stored
   answer, on the existing daily cron pass. Webhooks are lost; reconciliation is not optional.
6. **No card data, ever, in our database.** The compliance posture already says so.

### 7.3 On upgrade, nothing moves

The firm id, the R2 bucket, the Durable Object, every row and every byte stay exactly where they are. The
only write is one column, and within one cache TTL the withheld keys come back. There is no migration, no
re-provisioning, no export-and-import, and no downtime.

This is worth recording explicitly rather than leaving implicit, because it is the property that a future
"free tenants live in a shared workspace" idea would destroy — and somebody will propose that. The free
tier is a **mask over a fully-formed firm**, not a lesser kind of tenant.

### 7.4 When a paid firm lapses — the interesting case

**A lapsed paid firm is not a free firm, and is never reaped.** The ladder in section 3 is scoped to firms
that have only ever been free. A firm that has paid has almost certainly put real client matters in, and a
payment failure is far more often a dead card than an abandonment.

The lapse sequence:

- **`paid_through` passes → grace, 30 days, full function**, with escalating notices. A failed card must
  not lock a lawyer out of a hearing-date calendar. This is not generosity; it is the difference between
  a billing problem and a malpractice exposure we caused.
- **Then `suspended_billing`: read-only, indefinitely.** Every write-shaped permission is withheld by the
  **same mask** from 4.3 — no second mechanism — while reads and export stay open. There is no further
  step. No destruction ever follows a payment lapse without an explicit owner-approved act going through
  the same recorded destruction-request workflow as everything else.
- **Trust and billing on a lapsed firm: reads stay, writes stop.** A firm must never be locked out of
  _seeing_ its own client-money records, whatever it owes us. That is a line worth writing down.

**Downgrading a lapsed firm to the free tier is refused, and this is the part most designs get wrong.**
Applying free-tier quotas to a firm holding forty gigabytes and a trust ledger means either destroying
data to fit the quota or leaving the firm permanently over-quota and confused about why. Read-only with
export is the honest state. **An over-quota lapsed firm keeps everything it has**; over-quota is tolerated
indefinitely and never triggers deletion.

Restoring payment writes one column and the firm is whole. That symmetry with 7.3 is the point.

---

## 8. Verification

**Recommendation: yes for capability, no for payment — and they must be two independent axes.**

Requiring a manual check before anyone can pay is how you lose a customer who was ready to buy, and
payment is itself a meaningful signal about who is on the other end. But the integrity-withheld
capabilities in section 5 — trust, invoice finalization, the platform seal, the client portal — are
withheld for a reason that a payment does not address. A card proves somebody will pay; it does not prove
a real practice exists.

Hence `firm.verification_status` beside `firm.entitlement_tier`, and the mask is the **intersection of
both**. One extra column, no extra enforcement point, and the two states that must be expressible both
are: _paid but unverified_ (a real customer with the cost-withheld features unlocked and the
integrity-withheld ones still closed) and _free but verified_ (a real firm that proved itself before
paying, which is exactly the firm we want evaluating the product).

**What verification should check, in the honest first version.** Two things, cheap and high-signal:
control of a **domain** matching the firm (a DNS TXT record, or an email at the domain), and a **claimed
bar number and jurisdiction for at least one attorney**, recorded and displayed. Note carefully: the
platform's existing attorney-license capability is a set of _lookup links_, not an API. There is no
national bar registry to call, and per-state scraping is a maintenance liability nobody should sign up
for. So the first version is **attested and recorded, spot-checked by a human, revocable by a platform
operator — and it must never be described in any user-facing string as though it were automatically
verified.** Claiming a check the platform did not perform is worse than performing no check.

---

## 9. Owner flags

Only genuinely open decisions. Everywhere the platform's existing posture already answers a question, it
is cited above and not re-opened.

- **F1 — The free-tier numbers.** Storage ceiling, member ceiling, matter ceiling. Configuration, and per
  the custodian precedent this design proposes the seams and declines to invent the numbers.
  **This is the flag the parallel sign-in mockup's placeholders are waiting on.**
- **F2 — The reaping clock.** The 60 / 90 / 120 / 150 / 180 / 210 / 240-day ladder in 3.3, and the 30-day
  never-activated clock. Proposed, not settled.
- **F3 — Does trust unlock on verification (recommended) or for any paying firm?** 5.1 argues
  verification. It is a policy call with a real revenue edge.
- **F4 — Verification at launch: manual review, or attestation plus spot-check?** Section 8 recommends
  attestation plus spot-check, with operator revocation. Manual review is stronger and becomes a
  bottleneck at exactly the volume self-serve is for.
- **F5 — Must the free tier's terms state "not for real client data"?** Recommended, as a checkbox at
  registration rather than buried. This is a legal-perimeter call, not an engineering one, and it changes
  how defensible the reaping ladder is.
- **F6 — Metered allowances for the Container-backed tools (5.6), or a hard lock for the first version?**
  Metering is a third enforcement shape and real work; the lock is free and demonstrates less.
- **F7 — Retiring `RouteMeta.planTier`.** 4.3 recommends leaving a deliberately reserved seam permanently
  unpopulated and removing it. That contradicts a prior reservation and wants a nod rather than a silent
  decision.
