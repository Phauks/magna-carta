# Upload readiness, and a deployment that knows what mode it is in — design

**Date:** 2026-09-10 · **Status:** Designed, awaiting owner review · **Builds on:** the per-firm bucket (`docs/specs/2026-06-23-per-firm-database-durable-object-design.md` for the tenancy shape; ADR-0140), the firm-resource manifest (`apps/api-worker/src/firm-resources.ts`), the browser-upload CORS artifact (`apps/api-worker/src/files/browser-upload-cors.ts`) · **White paper:** _Tenancy & data isolation_, _Observability & diagnostics_.

## Problem

A firm has been unable to upload a file for a week. In that week the fault was diagnosed three times, twice wrongly, and the third diagnosis is still a hypothesis. That is not a run of bad luck; it is the shape of the system. Five distinct faults produce one identical symptom — the browser's presigned PUT fails, nothing the platform runs ever sees it, and the file manager can say only that storage did not answer:

| fault                                     | where it lives                                                                                | who can see it today                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| The firm's bucket was never created       | provisioning ran the dev adapter in production                                                | nobody — the dev adapter records a bucket name and creates nothing |
| The bucket carries no CORS policy         | a firm active before the CORS step landed (2026-09-03)                                        | an operator reading the policy by hand                             |
| The policy names the wrong origins        | a new serving origin since the policy was applied                                             | an operator comparing the policy to the code                       |
| The S3 key cannot sign for that bucket    | the token was scoped to one bucket per the 2026-06-22 runbook; the code assumes account scope | nobody — the assumption is in a comment                            |
| The presigned URL outlived its credential | any future scoped credential                                                                  | nobody                                                             |

Each has a different fix. None is observable from the platform's side, because the hop that fails is the one hop that bypasses every Worker (and must — the request-body cap makes proxying uploads impossible; see `docs/conventions/operations.md` §15). So the diagnosis has been archaeology: read the code, guess a cause, ask the owner to check a dashboard.

Underneath all five is one structural fact. **Production behaviour is selected by which optional secrets happen to be set** — the provisioner (REST or dev), the presigner (real or dev), the scan engine, human verification, feature flags, and now the scoped object-plane credential — and nothing in the system computes, reports, or refuses the resulting combination. The individual selections are each principled ("absent the secret, the safe development adapter runs"). Their product is a deployment that can be running a development adapter against real firms with no signal that it is.

The owner's instruction is to make this the best, not to fix it the fastest. The best fix is one that does not depend on the current diagnosis being right.

## Principles

1. **The system verifies its own preconditions.** Every assumption the upload path makes — the bucket exists, it carries the policy the code expects, the key can sign for it — is a fact the platform can check from the server side, where a failure produces a status code and a log line. So it checks them, and the check is the diagnosis.
2. **A mode is a fact, not an inference.** Which adapter is serving each port is computed in one place, reported on the status surface, and refused at startup where it is wrong for the deployment tier.
3. **Verification is repair where repair is idempotent.** The three bucket settings are whole-set `PUT`s. A check that finds them wrong re-applies them; only the faults it cannot repair (a missing bucket under the dev adapter, a mis-scoped key) are reported for a person.
4. **The reader is told before they try.** A firm that is not upload-ready is told so by the file manager, with the precondition that failed, before a byte is chosen — never by a transport error seven seconds after pressing Upload.
5. **Nothing here widens the trust model.** Verification uses the credentials the path already uses. A probe that needs a broader key than the path itself would be measuring the wrong thing.

## Design

### 1. Deployment mode — one computation, three consumers

`apps/api-worker/src/deployment-mode.ts` exports one pure function over `Bindings`:

```ts
interface DeploymentMode {
  readonly tier: "production" | "development";
  readonly provisioner: "cloudflare-rest" | "development";
  readonly presigner: "r2-sigv4" | "development";
  readonly objectPlaneCredential: "scoped-per-bucket" | "account-parent" | "development";
  readonly scanEngine: "container" | "none";
  readonly humanVerification: "turnstile" | "unconfigured";
  readonly featureFlags: "live" | "default-off";
}
```

Each field is computed by the same test the wiring already uses — `resourceProviderForEnv`, `realR2Credentials`, `resolveScanPort` and so on are refactored to read their selection from this one place rather than each re-deriving it, so the report cannot disagree with the behaviour.

**The tier is explicit.** A new public var, `DEPLOYMENT_TIER`, is set to `production` in `wrangler.jsonc` `vars` and absent everywhere else. Presence-of-`APP_BASE_URL` is not a tier signal; it is a URL.

Three consumers:

- **Startup refusal.** `resolveApp()` computes the mode on first request and, at tier `production`, throws if `provisioner`, `presigner` or `objectPlaneCredential` is `development`. The Worker answers every request 503 with a body naming the port and the secret. A deployment that would provision fake resources for real firms does not start.
- **The status surface.** `derived-snapshot.ts` records the mode beside its probes; the status page shows it. "Which adapter is production running?" becomes a line on a page rather than a reading of `wrangler secret list` against six `if` statements.
- **Telemetry.** One `deployment.mode` event per isolate start, so a mode change is a visible edge in the timeline.

### 2. Upload readiness — the verification, per firm

`apps/api-worker/src/files/upload-readiness.ts` exports `verifyUploadReadiness(env, firm): Promise<UploadReadiness>`, a sequence of server-side checks each answering `ok`, `repaired`, or `failed` with a reason a person can act on:

| check                 | how                                                                                                            | on failure                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bucket-exists`       | `GET /accounts/{id}/r2/buckets/{name}` with the provisioner token, under the firm's jurisdiction               | `failed: "no bucket named … exists in the account"` — the dev-adapter signature; not repairable here                                                            |
| `cors-policy`         | `GET …/cors`; diff against `browserUploadCorsRules(browserOrigins)`                                            | `PUT` the code's rule set → `repaired`; a `PUT` that is refused → `failed`                                                                                      |
| `lifecycle-rules`     | same shape against the expiry rules                                                                            | same                                                                                                                                                            |
| `event-notifications` | same shape against the ingest notification                                                                     | same                                                                                                                                                            |
| `key-can-sign`        | a SigV4-signed `HEAD` for `__readiness_probe__` in the firm's bucket, using **the presigner's own credential** | `404` is success (the key is honoured; the object is absent); `403` is `failed: "the R2 S3 token cannot sign for this bucket — it is scoped to another bucket"` |
| `origin-allowed`      | the deployment's `APP_BASE_URL` origin is in the applied policy's `AllowedOrigins`                             | folded into `cors-policy`'s repair                                                                                                                              |

The report is the manifest's shape (`firm-resources.ts`): one entry per check, in the order they must hold, so a reader sees the first thing that is wrong and not a list of consequences.

`key-can-sign` is the check that discriminates the current fault. It is also the one that must use the exact credential the browser's URL will carry — a probe signed with the provisioner token would pass against a bucket the S3 key cannot reach.

### 3. Where readiness runs

- **At provisioning, as the last step before activation.** A firm is not marked `active` until its own readiness report is all `ok`. This closes the dev-adapter hole from the other side: an adapter that creates nothing cannot produce a bucket that exists, so the firm never activates, and the failure names the cause. (The startup refusal in §1 stops this earlier still; the two are belt and braces, because the startup check reads config and this one reads the world.)
- **On the daily cron, as a sweep over every active firm**, through the existing `runFirmBackfill` runner. This is the bucket-configuration backfill proposed on 2026-09-09, generalised: it repairs the idempotent settings and counts the rest. An origin change becomes self-healing; a firm active before 2026-09-03 is repaired on the next pass without anyone remembering.
- **On demand, as a diagnostic route** — `GET /api/v1/firm/upload-readiness`, on the pattern of `routes/scan-diagnose.ts`, gated on `firm:manageScanPolicy` (Owner/Admin). Its response is the report. This is the route the owner opens instead of a dashboard.
- **Before the file manager offers Upload.** The files section reads the firm's last readiness result (cached on the firm row by the sweep, refreshed by the route) and, where it is not all `ok`, the create control's Upload item carries the refusal — the same `refusal` seam `claimMatterCreate` already has — naming the failed precondition. A member who cannot upload is told why before they choose a file.

### 4. The presigner takes the scoped credential

The deferred half of #590. `createR2Presigner` takes the same `credentials` resolver `createS3FirmBucket` now takes, and signs with `appendSessionToken` so the query-signed URL carries `X-Amz-Security-Token`. The cache's outlives-what-it-signs rule already covers the presigner's TTLs (the hour-long upload URL is the case it was written for). With this, the account-wide parent key appears in exactly one place: the mint request.

### 5. What is deliberately not here

- **Proxying uploads through the Worker to observe them.** Impossible past the plan's request-body cap, and would put every byte through Worker CPU. The hop stays unobservable; the design makes its preconditions observable instead.
- **A second source of truth for what a firm owns.** Readiness reads the manifest; it does not grow its own list.
- **Auto-repair of a missing bucket.** A firm whose bucket does not exist was provisioned under the wrong adapter, and the right answer is to say so and re-provision under the right one — not to have a sweep create buckets the provisioner should have.

## Sequence

1. `deployment-mode.ts`, the `DEPLOYMENT_TIER` var, the startup refusal, the status line. Small, and it turns the current mystery into a reading.
2. `upload-readiness.ts` with the five checks and the diagnostic route. This answers the open question about the current firm directly, from the server, with no dashboard.
3. Readiness as the provisioner's last step, and the daily sweep.
4. The file manager's refusal.
5. The presigner's scoped credential.

Each step ships on its own; 1 and 2 together are what the owner needs this week.

## Verification

Each check is a pure function over a fetch seam, tested against stub responses for every outcome in its row. The startup refusal is tested by constructing the app with a production tier and each development adapter in turn. The route is tested through the chokepoint. The end-to-end acceptance — a real upload against a real bucket from a real browser — remains the operator's step named in §15 of the runbook, and this design does not pretend the local pool can perform it.

## Decision

Recorded as an ADR fragment beside this spec: the deployment tier is explicit and a development adapter refuses to serve production; the upload path's preconditions are verified by the platform and reported to the member.
