# Upload readiness, and a deployment that cannot run the development adapter — design

**Date:** 2026-09-10 · **Status:** Built (this branch) · **Builds on:** the per-firm bucket (`docs/specs/2026-06-23-per-firm-database-durable-object-design.md` for the tenancy shape; ADR-0140), the firm-resource manifest (`apps/api-worker/src/firm-resources.ts`), the browser-upload CORS artifact (`apps/api-worker/src/files/browser-upload-cors.ts`) · **White paper:** _Tenancy & data isolation_, _Observability & diagnostics_.

## Problem

A firm has been unable to upload a file for a week. In that week the fault was diagnosed three times, twice wrongly, and the third diagnosis is still a hypothesis. That is not a run of bad luck; it is the shape of the system. Five distinct faults produce one identical symptom — the browser's presigned PUT fails, nothing the platform runs ever sees it, and the file manager can say only that storage did not answer:

| fault                                  | where it lives                                                                                | who can see it today                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| The firm's bucket was never created    | provisioning ran the development adapter in production                                        | nobody — the dev adapter records a bucket name and creates nothing |
| The bucket carries no CORS policy      | a firm active before the CORS step landed (2026-09-03)                                        | an operator reading the policy by hand                             |
| The policy names the wrong origins     | a new serving origin since the policy was applied                                             | an operator comparing the policy to the code                       |
| The S3 key cannot sign for that bucket | the token was scoped to one bucket per the 2026-06-22 runbook; the code assumes account scope | nobody — the assumption is in a comment                            |
| The deployment names no bound bucket   | `R2_BUCKET_NAME` unset                                                                        | the member, as an Error ID                                         |

Each has a different fix. None is observable from the platform's side, because the hop that fails is the one hop that bypasses every Worker (and must — the request-body cap makes proxying uploads impossible; see `docs/conventions/operations.md` §15). So the diagnosis has been archaeology: read the code, guess a cause, ask the owner to check a dashboard.

Underneath the first fault is one structural fact. **Production behaviour was selected by which optional secrets happened to be set.** Absent the provisioner's token, the development adapter ran — principled on a developer's machine, silently wrong in production — and nothing reported or refused it.

The owner's instruction is to make this the best, where best means **easy to diagnose, not overcomplicated, and working well and fast.** The first draft of this design proposed a deployment-mode object with seven fields, a startup refusal, a status-page line, a telemetry event, a daily repairing sweep over every firm, and a readiness result cached on the firm row. All of that was machinery in service of two facts, and each fact has a one-piece answer. This is the trimmed design; what was cut, and why, is in §4.

## Principles

1. **The system verifies its own preconditions, when asked.** Every assumption the upload path makes is a fact the platform can check from the server side, where a failure produces a status code. The check is the diagnosis, and it runs when a person presses the button — not on a schedule, not on every page load.
2. **A wrong deployment does not deploy.** The credentials that select the real adapters are required by the deploy gate. There is no runtime mode to compute or report because the wrong mode cannot reach production.
3. **Verification is repair where repair is idempotent.** The three bucket settings are whole-set `PUT`s; the check re-applies them rather than diffing. What it cannot repair (a missing bucket, a mis-scoped key) it names, with the fix.
4. **Nothing here widens the trust model.** The signing probe uses the exact credential the browser's URL carries. A probe signed with a wider key would measure the wrong thing.

## Design

### 1. The deploy gate closes the adapter hole

`wrangler.jsonc` `secrets.required` gains `CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER` and `CLOUDFLARE_ACCOUNT_ID`. Wrangler refuses to deploy a Worker whose required secrets are unset, so a production deployment can no longer run the development provisioner or the development presigner. Locally wrangler only warns about the missing names, which is what lets both stay out of `.dev.vars` — their presence there would select the real adapters against a token that does not exist.

The provider interface gains one field, `kind: "cloudflare-rest" | "development"`, so a report can state which adapter ran rather than infer it, and one method, `bucketExists`, the probe `createBucket` already made, exposed so a diagnostic can ask without creating.

### 2. Upload readiness — one function, one route, one button

`apps/api-worker/src/files/upload-readiness.ts` exports `verifyUploadReadiness(dependencies, firm)`: six checks, in the order the preconditions hold, each `ok`, `applied`, `failed` or `not-applicable` with a detail a person acts on.

| check                 | how                                                                                                    | on failure                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `bucket-recorded`     | the firm row names a bucket                                                                            | `failed`; stop — nothing below can be addressed                                                                              |
| `bucket-exists`       | `provider.bucketExists` (a `GET` of the bucket under the firm's jurisdiction)                          | `failed: "No bucket named … exists"`, the development-adapter signature; stop; never creates it                              |
| `event-notifications` | `provider.configureBucketNotifications` — the whole-set `PUT` provisioning makes                       | `failed` with the API's words; the other settings still run                                                                  |
| `lifecycle-rules`     | same                                                                                                   | same                                                                                                                         |
| `cors-policy`         | same — with the deployment's own `APP_BASE_URL` origin folded in, as at provisioning                   | same                                                                                                                         |
| `key-can-sign`        | a signed `HEAD` for `__readiness_probe__` through `resolveFirmBucket`, i.e. the presigner's credential | `404` is ok; `403` names the mis-scoped token and the re-mint; a mint failure or bound-bucket fault carries its own sentence |

Under the development adapter the account checks are `not-applicable`, stated as such — the report never says `ok` for a thing it did not look at — and `key-can-sign` is `not-applicable` where uploads go through the application.

`POST /api/v1/firm/upload-readiness` (`routes/files/upload-readiness.ts`; `firm:manageScanPolicy`; audited with the verdict and the failed ids) runs it for the session's firm. It is a POST because it acts. It runs from the **version chip's Database section** — the platform's build-and-health overlay — with the panel's other reads, for a member holding the permission (owner ruling 2026-09-11: the check belongs with the build information, not inside settings). Its report is the panel's fourth foldable section, _Upload readiness_ — the same heading, rows and fold the Database section uses (owner ruling 2026-09-11: match the panel, consolidate components; a modal and a tab were both a second idiom) — and its verdict stands in for the panel's _File storage_ row while on hand. The panel's one copy control takes the report with everything else. For everyone else the row is fed by a `fileStorage` block on `GET /api/v1/meta/database-health`: the upload path, the provisioning adapter, and the **last readiness check read back from its audit row**. "Not yet checked" is a fact and earns no badge; "Not ready" names the first failed precondition (the cause).

### 3. What was rejected

- **Proxying uploads through the Worker to observe them.** Impossible past the request-body cap.
- **Auto-creating a missing bucket.** A firm without one was provisioned under the wrong adapter; the answer is to say so and re-provision under the right one.

### 4. What the first draft had, and this one does not

- **A `DeploymentMode` object, a startup refusal, a status line and a telemetry event.** All were ways of noticing a production deployment running a development adapter. The deploy gate makes that deployment impossible, which is better than noticing it, and costs a config line.
- **A daily repairing sweep over every active firm.** Its justification was firms provisioned before the CORS step (2026-09-03) and future origin changes. The platform was reset on 2026-09-09, so no such firm exists; an origin change is a press of the button; and a sweep is a cron, a runner and a report nobody reads until something is wrong. The button is the sweep, run by the person who noticed.
- **Readiness cached on the firm row, read before the file manager offers Upload.** A cache, a refresh rule and a second place the answer lives, to move a diagnosis from one screen to another. The failure line points at the screen instead.
- **Readiness as the provisioner's last step before activation.** The provisioner already applies the three settings unconditionally on every run; the gate rules out the adapter that creates no bucket; the remaining precondition, the key's scope, is a deployment fact rather than a per-firm one, and failing every registration over it would turn a mis-scoped token into a 500 for every new owner. It is a button, not a fence.
- **Diffing the bucket settings before repairing them.** Three `GET`s, three parsers and three comparisons, to tell the reader something was wrong before it was fixed. A whole-set `PUT` costs the same and leaves the bucket right; the report says `applied`.

### 5. Deferred

The presigner still signs with the account-wide parent key; joining it to the bucket-scoped credential (`appendSessionToken`) is a separate change and is not diagnosis.

## Verification

`test/upload-readiness.test.ts` drives every check outcome through stub ports — the walk stops where nothing below can be asked, a refused setting does not stop the others, a `403` on the probe names the re-mint, a missing bucket is never created, the development deployment says what it did not look at. `test/upload-readiness-route.test.ts` runs the route through the chokepoint (the development-shaped report; 403 without the permission). `test/firm-resource-provider.test.ts` pins `bucketExists` against found / 404 / refused / eu-jurisdiction. The end-to-end acceptance — a real upload against a real bucket from a real browser — remains the operator's step named in §15 of the runbook, and the button is how they find out why it failed.

## Decision

Recorded as an ADR fragment beside this spec.
