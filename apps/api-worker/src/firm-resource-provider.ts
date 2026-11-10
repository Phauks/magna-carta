import type { FirmId } from "@magna-carta/identifiers/types";
import {
  jurisdictionForRegion,
  locationHintForRegion,
  type DataRegion,
} from "@magna-carta/database/data-region";
import { MEETING_RECORDING_STAGING_PREFIX } from "@magna-carta/meetings/recording-types";
import { browserUploadCorsRules } from "./files/browser-upload-cors.ts";

// The provisioning port: how the firm provisioner obtains a firm's physical resources. The
// per-firm database needs none — it is the firmId-addressed FirmDatabase Durable Object, which
// self-migrates on first access — so the port covers only the firm's R2 bucket. Two adapters
// below — the dev adapter (Miniflare cannot create R2 at runtime) and the Cloudflare REST adapter
// (real resource creation, deploy-time credentials).
export interface FirmResourceProvider {
  // Which adapter this is. A reader of the upload-readiness report (files/upload-readiness.ts)
  // needs the fact stated, not inferred from what the calls did: the development adapter answers
  // every configure call with success while configuring nothing, so "all steps succeeded" under it
  // says nothing about the bucket.
  readonly kind: "cloudflare-rest" | "development";
  createBucket(firmId: FirmId, region: DataRegion): Promise<{ bucketName: string }>;
  // Whether the firm's bucket exists in the account, under the firm's jurisdiction — the probe
  // createBucket runs before creating, exposed on its own so a diagnostic can ask without creating.
  // A firm provisioned under the development adapter records a bucket name and creates no bucket;
  // this is the call that tells that firm apart from one whose bucket is real.
  bucketExists(firmId: FirmId, region: DataRegion): Promise<boolean>;
  // Configure the firm bucket's object-create event notification to feed the files-ingest queue
  // (prefix files/). Re-runnable: provisioning calls it on every run that reaches the bucket step,
  // so a run that created the bucket but crashed before this still configures on retry — and the
  // REST adapter reads back a rule R2 refuses as already present, because the API's PUT adds rules
  // rather than replacing them (see the adapter).
  // The region must match what createBucket used — the notification PUTs target the SAME bucket.
  configureBucketNotifications(firmId: FirmId, region: DataRegion): Promise<void>;
  // Apply the firm bucket's lifecycle rules. The transient prefixes are regenerable caches, and
  // nothing else expires them: `bundles/` is rebuilt on demand from its manifest, `conversions/` is
  // re-derivable from the source document. Without these rules every artifact a firm has ever
  // downloaded or converted accumulates in its bucket forever, metered and paid for. Staged meeting
  // audio expires a day after the recording sweep's own retention as its backstop, and `files/` is
  // never expired — only an upload abandoned there has its parts reclaimed. Idempotent (a PUT of the
  // whole rule set), and re-runnable for the same reason notifications are.
  configureBucketLifecycle(firmId: FirmId, region: DataRegion): Promise<void>;
  // Apply the firm bucket's CORS policy. The file-manager upload PUTs bytes from the browser straight
  // to a presigned URL on the bucket — a cross-origin request — and a bucket with no policy refuses
  // the preflight before a byte moves, leaving the app able to say only that nothing answered. The
  // rules are files/browser-upload-cors.ts plus the origins the deployment names.
  // Idempotent (a PUT of the whole rule set) and re-runnable, like the two above.
  configureBucketCors(firmId: FirmId, region: DataRegion): Promise<void>;
}

// ---------------------------------------------------------------------------
// Dev adapter
// ---------------------------------------------------------------------------

// The dev adapter takes no options: the per-firm database is the firmId-addressed FirmDatabase
// Durable Object (no pool to claim), and Miniflare cannot create R2 at runtime, so bucket
// "creation" only computes the deterministic name the provisioner records.
export function createDevFirmResourceProvider(): FirmResourceProvider {
  return {
    kind: "development",

    // The bound bucket is the only bucket there is locally, and every firm's bytes go through it,
    // so the firm's bucket "exists" in the only sense the local runtime has. The readiness report
    // does not take this at face value: it reads `kind` and says the check did not apply.
    bucketExists(_firmId: FirmId, _region: DataRegion): Promise<boolean> {
      return Promise.resolve(true);
    },

    // Miniflare cannot create R2 buckets at runtime; every locally-provisioned firm shares
    // the single pre-declared R2 binding (resolved by binding key in code, never by this stored
    // name). The stored name is per-firm UNIQUE — the SAME deterministic shape production uses — so
    // the ingest consumer's `WHERE bucket_name = ?` event→firm resolution stays unambiguous with
    // more than one dev firm; locally it only marks the provisioning step complete.
    async createBucket(firmId: FirmId, _region: DataRegion): Promise<{ bucketName: string }> {
      return { bucketName: await firmResourceName(firmId) };
    },

    // Miniflare delivers no R2 event notifications, so there is nothing to configure locally — the
    // ingest consumer is driven by synthetic events in dev/tests. A no-op marks the step complete.
    configureBucketNotifications(_firmId: FirmId, _region: DataRegion): Promise<void> {
      return Promise.resolve();
    },

    // Miniflare has no lifecycle engine either, and every local firm shares the bound bucket whose
    // rules are not this provider's to set. A no-op marks the step complete.
    configureBucketLifecycle(_firmId: FirmId, _region: DataRegion): Promise<void> {
      return Promise.resolve();
    },

    // Local uploads go same-origin through the development R2 route, so no browser ever preflights
    // against the bound bucket and there is nothing to configure. A no-op marks the step complete.
    configureBucketCors(_firmId: FirmId, _region: DataRegion): Promise<void> {
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// Cloudflare REST adapter
// ---------------------------------------------------------------------------

export interface CloudflareRestFirmResourceProviderOptions {
  readonly accountId: string;
  // A deploy-time Worker secret (wrangler secret put CLOUDFLARE_API_TOKEN_FIRM_PROVISIONER) — never needed
  // locally, where the dev adapter runs instead.
  readonly apiToken: string;
  // The files-ingest queue's Cloudflare UUID — the target of every firm bucket's object-create
  // notification. A deploy-time fact (the queue is created once for the fleet); absent → the dev
  // adapter runs instead, so reaching configureBucketNotifications without it is a misconfiguration.
  readonly eventNotificationQueueId?: string;
  // The bulk-ingest queue's Cloudflare UUID — when present, a second notification rule is registered
  // for the bulk/ prefix. The lane benefit is queue topology and max_concurrency settings; bulk
  // objects still meter under the files/ dimension. Absent → only the interactive lane is configured.
  readonly bulkEventNotificationQueueId?: string;
  // Origins a browser uploads from beyond the ones files/browser-upload-cors.ts names — the deployment's own
  // APP_BASE_URL, so a deployment serving at an address the artifact does not list still takes
  // uploads. Duplicates of the artifact's origins are folded away.
  readonly browserOrigins?: readonly string[];
  readonly fetchImplementation?: typeof fetch;
}

// The R2 key prefix uploaded objects live under (mirrors @magna-carta/file-manager's FILES_PREFIX);
// the notification rule scopes to it so only ingestable objects trigger the queue.
const FILES_NOTIFICATION_PREFIX = "files/";
// The R2 key prefix for bulk-uploaded objects — the notification rule targets the bulk-ingest queue.
const BULK_NOTIFICATION_PREFIX = "bulk/";

const DAY_SECONDS = 24 * 60 * 60;

// One prefix's lifecycle: when an object under it is deleted, if ever, and when an upload begun under
// it and never completed is aborted. R2's lifecycle PUT replaces the bucket's whole rule set, so a rule
// that is not in this list is removed from every bucket on its next provisioning run — a rule added by
// hand does not survive, and a firm provisioned later never has it. Every rule a firm bucket needs
// therefore lives here.
interface BucketLifecycleRule {
  readonly id: string;
  readonly prefix: string;
  // Absent means objects under the prefix are NEVER deleted by age — the firm's own documents.
  readonly expireObjectsAfterSeconds?: number;
  // A multipart upload nobody completed keeps its parts, and its parts are metered. Nothing else
  // reclaims an upload whose record is gone, so every prefix written by multipart carries one.
  readonly abortIncompleteUploadsAfterSeconds: number;
}

// A staged meeting-recording track. The recording sweep (meetings/recording-sweep.ts) keeps a failed
// or abandoned recording's staged tracks for seven days after the recording SETTLED, because they are
// the only copy of what was captured, and deletes a filed recording's leftovers a day after filing.
// Lifecycle age counts from when the object was CREATED, which can precede the settling by as much as
// the twelve-hour maximum recording plus its compose attempts — so the rule waits one day past the
// sweep's seven, and can only ever take what the sweep has already let go of or never reached (a pass
// that failed for that firm, a row that no longer names its object). The same horizon applies to an
// open staged upload: a track's upload stays open for as long as the recording runs in case its
// speaker returns, and until it is completed it IS the captured audio, so the abort must never be what
// decides that copy is lost before the retention does.
const MEETING_RECORDING_STAGING_LIFETIME_SECONDS = 8 * DAY_SECONDS;

// An upload under `files/` nobody completed. The longest-lived legitimate one is a member's resumable
// browser upload, whose session lives a day (routes/uploads.ts) before the daily stale-pending sweep
// aborts it, and a meeting recording's composite, written as one multipart upload across a queue
// invocation per window of audio — a twelve-hour recording is seventy-two of them, and the recording
// sweep fails a compose after three thirty-minute stalls, so even a backlogged compose finishes or
// fails within hours. Seven days is many times either, so a live upload is never cut off; what the
// rule reclaims is only what no record will ever complete or abort (a compose that failed holding its
// upload, a session whose row was lost), at the cost of a week's storage for those parts.
const FILES_ABANDONED_UPLOAD_LIFETIME_SECONDS = 7 * DAY_SECONDS;

const LIFECYCLE_RULES: readonly BucketLifecycleRule[] = [
  // A download bundle: the shelf hands out short-TTL signed URLs against it, so a week outlives every
  // link ever minted for it. Regenerable — rebuilt from its manifest hash on the next request.
  {
    id: "expire-download-bundles",
    prefix: "bundles/",
    expireObjectsAfterSeconds: 7 * DAY_SECONDS,
    abortIncompleteUploadsAfterSeconds: DAY_SECONDS,
  },
  // A conversion result: handed back as one presigned GET and never referenced again. Regenerable —
  // re-derived from the source document.
  {
    id: "expire-conversion-results",
    prefix: "conversions/",
    expireObjectsAfterSeconds: DAY_SECONDS,
    abortIncompleteUploadsAfterSeconds: DAY_SECONDS,
  },
  {
    id: "expire-meeting-recording-staging",
    prefix: `${MEETING_RECORDING_STAGING_PREFIX}/`,
    expireObjectsAfterSeconds: MEETING_RECORDING_STAGING_LIFETIME_SECONDS,
    abortIncompleteUploadsAfterSeconds: MEETING_RECORDING_STAGING_LIFETIME_SECONDS,
  },
  // The firm's documents: never expired, only an abandoned upload's parts reclaimed.
  {
    id: "abort-abandoned-file-uploads",
    prefix: FILES_NOTIFICATION_PREFIX,
    abortIncompleteUploadsAfterSeconds: FILES_ABANDONED_UPLOAD_LIFETIME_SECONDS,
  },
];

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

// Resource naming: magna-carta-<environment>-<scope>[-<purpose-or-slug>]. The slug must be
// deterministic per firm (idempotent resume re-creates the SAME resource and hits already-exists)
// and valid in both the D1 and R2 name alphabets, which exclude the identifier alphabet's
// uppercase and underscore characters — so the firm id is folded through SHA-256 and the first
// 128 bits are spent as lowercase hex.
const FIRM_RESOURCE_NAME_PREFIX = "magna-carta-production-firm";

export async function firmResourceName(firmId: FirmId): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(firmId));
  const slug = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${FIRM_RESOURCE_NAME_PREFIX}-${slug}`;
}

interface CloudflareApiEnvelope<Result> {
  readonly success: boolean;
  readonly result?: Result;
  readonly errors?: readonly { readonly code?: number; readonly message?: string }[];
}

// RACE-WINDOW FALLBACK ONLY — deliberately demoted from the resume linchpin it once was.
// Idempotent resume now travels find-first: each create PROBES for the
// resource by its deterministic name and only creates when absent, so a crashed provisioning's
// retry never depends on this detection. It remains solely for the narrow race where a concurrent
// create lands between the probe and the POST. Detection is by message ("already exists" /
// "already own") plus R2's documented 10004 code — the Cloudflare error catalog carries no stable
// cross-product duplicate code, which is exactly why a vendor copy-edit must never be able to
// wedge a resume (it can only widen this benign race window).
function isAlreadyExists(envelope: CloudflareApiEnvelope<unknown>): boolean {
  return (envelope.errors ?? []).some(
    (error) => error.code === 10004 || /already (exists|own)/i.test(error.message ?? ""),
  );
}

// R2's refusal of a notification rule that overlaps one already configured — error 11020. The
// code is documented; the message match is the fallback for a vendor copy-edit of the code.
function isRuleOverlap(envelope: CloudflareApiEnvelope<unknown>): boolean {
  return (envelope.errors ?? []).some(
    (error) => error.code === 11020 || /invalid overlap/i.test(error.message ?? ""),
  );
}

// What `GET …/event_notifications/r2/{bucket}/configuration` answers: each queue the bucket
// notifies, with the rules that send to it. Only the fields the overlap check reads are typed.
// Both casings are read, because the documented shape is camelCase and the account API has
// answered other resources in snake_case; a mismatch here would turn a rule that is in place into
// a reported fault, which is the mistake this read exists to stop.
interface NotificationRule {
  readonly prefix?: string;
  readonly actions?: readonly string[];
}
interface NotificationQueue {
  readonly queueId?: string;
  readonly queue_id?: string;
  readonly queueName?: string;
  readonly rules?: readonly NotificationRule[];
}
interface NotificationConfiguration {
  readonly queues?: readonly NotificationQueue[];
}

function queueIdOf(queue: NotificationQueue): string {
  return queue.queueId ?? queue.queue_id ?? "";
}

// A queue id is a UUID, and the API takes it on a path with or without its hyphens while always
// answering with them — so the id a deployment names and the id the bucket reports are the same
// queue under two spellings. The first real run of the readiness check reported exactly that
// pair as a mismatch. Compared without hyphens, case-folded.
function sameQueue(left: string, right: string): boolean {
  const canonical = (id: string) => id.replaceAll("-", "").toLowerCase();
  return canonical(left) === canonical(right);
}

// Whether the bucket already sends objects under `prefix` to `queueId` — the state a refused
// overlap is allowed to mean. An overlap with a rule to some other queue is not this, and fails.
function hasNotificationRule(
  configuration: NotificationConfiguration | undefined,
  queueId: string,
  prefix: string,
): boolean {
  return (configuration?.queues ?? []).some(
    (queue) =>
      sameQueue(queueIdOf(queue), queueId) &&
      (queue.rules ?? []).some((rule) => (rule.prefix ?? "") === prefix),
  );
}

// The configuration in one line, for the failure that has to name it: each queue and the prefixes
// it is sent. Deployment facts only — queue ids and key prefixes, never anything a firm wrote.
function describeNotificationConfiguration(
  configuration: NotificationConfiguration | undefined,
): string {
  const queues = configuration?.queues ?? [];
  if (queues.length === 0) return "no notification rules at all";
  return queues
    .map((queue) => {
      const prefixes = (queue.rules ?? []).map((rule) =>
        rule.prefix === undefined || rule.prefix === "" ? "(every key)" : rule.prefix,
      );
      return `queue ${queueIdOf(queue) || "(unnamed)"} ← ${prefixes.join(", ") || "(no rules)"}`;
    })
    .join("; ");
}

function describeFailure(
  operation: string,
  status: number,
  envelope: CloudflareApiEnvelope<unknown>,
): Error {
  const messages = (envelope.errors ?? [])
    .map((error) => `${String(error.code ?? "?")}: ${error.message ?? "(no message)"}`)
    .join("; ");
  return new Error(
    `${operation} failed: HTTP ${String(status)} — ${messages || "(no error detail)"}`,
  );
}

// Real resource creation through the Cloudflare REST API. This adapter only guarantees the firm's
// R2 bucket exists and is recorded on the firm row; the per-firm database is the firmId-addressed
// FirmDatabase Durable Object and needs no provisioning here.
export function createCloudflareRestFirmResourceProvider(
  options: CloudflareRestFirmResourceProviderOptions,
): FirmResourceProvider {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const accountBase = `${CLOUDFLARE_API_BASE}/accounts/${options.accountId}`;
  const headers = {
    authorization: `Bearer ${options.apiToken}`,
    "content-type": "application/json",
  };

  async function callApi<Result>(
    operation: string,
    method: "GET" | "POST" | "PUT",
    url: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<{ status: number; envelope: CloudflareApiEnvelope<Result> }> {
    const response = await fetchImplementation(url, {
      method,
      headers: { ...headers, ...extraHeaders },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Text first, parse second: an HTML edge error page (502/520) must surface as a described
    // failure carrying the operation and HTTP status — never an opaque JSON SyntaxError that
    // loses both.
    const text = await response.text();
    try {
      return {
        status: response.status,
        envelope: JSON.parse(text) as CloudflareApiEnvelope<Result>,
      };
    } catch {
      throw new Error(
        `${operation} failed: HTTP ${String(response.status)} — non-JSON response body (an edge error page?)`,
      );
    }
  }

  // The bucket probe (its name IS its identifier). The eu jurisdiction header must ride it — the
  // bucket lives under that jurisdiction's namespace, so a probe without it queries the wrong
  // jurisdiction and always misses. A miss is a 404 with a non-success envelope; anything else
  // that is not success (a refused token, an edge error) is a failure to ask, not an absence, and
  // is thrown so a diagnostic never reports "no bucket" for a token that could not look.
  async function probeBucket(operation: string, name: string, region: DataRegion) {
    const jurisdiction = jurisdictionForRegion(region);
    const extraHeaders = jurisdiction ? { "cf-r2-jurisdiction": jurisdiction } : undefined;
    const probed = await callApi<unknown>(
      operation,
      "GET",
      `${accountBase}/r2/buckets/${name}`,
      undefined,
      extraHeaders,
    );
    if (probed.envelope.success) return { exists: true as const, extraHeaders };
    if (probed.status === 404) return { exists: false as const, extraHeaders };
    throw describeFailure(operation, probed.status, probed.envelope);
  }

  return {
    kind: "cloudflare-rest",

    async bucketExists(firmId: FirmId, region: DataRegion): Promise<boolean> {
      const name = await firmResourceName(firmId);
      return (await probeBucket("bucketExists", name, region)).exists;
    },

    // Find-first, same shape: probe the bucket, create only when the probe misses; already-exists
    // on the create is the same benign probe-create race. The jurisdiction header rides the create
    // as it rode the probe.
    async createBucket(firmId: FirmId, region: DataRegion): Promise<{ bucketName: string }> {
      const name = await firmResourceName(firmId);
      const { exists, extraHeaders } = await probeBucket("createBucket", name, region);
      if (exists) return { bucketName: name };

      const locationHint = locationHintForRegion(region);
      const created = await callApi<unknown>(
        "createBucket",
        "POST",
        `${accountBase}/r2/buckets`,
        locationHint ? { name, locationHint } : { name },
        extraHeaders,
      );
      if (created.envelope.success || isAlreadyExists(created.envelope)) {
        return { bucketName: name };
      }
      throw describeFailure("createBucket", created.status, created.envelope);
    },

    // PUT the object-create notification rule onto the firm's bucket, targeting the files-ingest
    // queue. The bucket name is its deterministic resource name (createBucket's identifier).
    //
    // NOT IDEMPOTENT ON THE API'S SIDE, whatever the verb says. This PUT ADDS rules to the queue's
    // configuration, and R2 refuses a rule that overlaps one already there (error 11020, "rules have
    // invalid overlap") — so the second run against a configured bucket fails, which is exactly the
    // run a resumed provisioning and the upload readiness check both make. The first firm checked
    // after the check shipped reported that refusal as a fault on a bucket whose rule was in place.
    // A refused overlap is therefore READ rather than believed: the bucket's configuration is
    // fetched and the step succeeds when the rule it meant to add is already there for this queue,
    // and fails, with the API's words, when the overlap is with something else.
    async configureBucketNotifications(firmId: FirmId, region: DataRegion): Promise<void> {
      if (
        options.eventNotificationQueueId === undefined ||
        options.eventNotificationQueueId === ""
      ) {
        throw new Error(
          "configureBucketNotifications requires eventNotificationQueueId (the files-ingest queue " +
            "UUID) — set FILES_INGEST_QUEUE_ID for the REST provider, or run the dev adapter",
        );
      }
      const bucketName = await firmResourceName(firmId);
      // The jurisdiction header must ride every bucket-scoped operation against a jurisdiction-
      // restricted bucket (same requirement as createBucket's probe/create) — an unheadered PUT
      // resolves against the default jurisdiction and misses the bucket entirely.
      const jurisdiction = jurisdictionForRegion(region);
      const extraHeaders = jurisdiction ? { "cf-r2-jurisdiction": jurisdiction } : undefined;
      const putRule = async (queueId: string, prefix: string): Promise<void> => {
        const configured = await callApi<unknown>(
          "configureBucketNotifications",
          "PUT",
          `${accountBase}/event_notifications/r2/${bucketName}/configuration/queues/${queueId}`,
          { rules: [{ actions: ["PutObject", "CompleteMultipartUpload"], prefix }] },
          extraHeaders,
        );
        if (configured.envelope.success) return;
        if (!isRuleOverlap(configured.envelope)) {
          throw describeFailure(
            "configureBucketNotifications",
            configured.status,
            configured.envelope,
          );
        }
        // Refused as an overlap: read what the bucket holds, and either recognise the rule as
        // already there or say exactly what IS there — a reader of the readiness report has to be
        // able to tell "the rule is on the bucket under a queue this deployment no longer names"
        // from "the API is refusing something else", and the refusal's own sentence says neither.
        let existing: {
          status: number;
          envelope: CloudflareApiEnvelope<NotificationConfiguration>;
        };
        try {
          existing = await callApi<NotificationConfiguration>(
            "configureBucketNotifications",
            "GET",
            `${accountBase}/event_notifications/r2/${bucketName}/configuration`,
            undefined,
            extraHeaders,
          );
        } catch (caught) {
          throw new Error(
            `configureBucketNotifications: R2 refused the ${prefix} rule as overlapping a rule ` +
              `already on ${bucketName}, and the bucket's configuration could not be read to ` +
              `confirm it: ${caught instanceof Error ? caught.message : String(caught)}`,
            { cause: caught },
          );
        }
        if (!existing.envelope.success) {
          throw new Error(
            `configureBucketNotifications: R2 refused the ${prefix} rule as overlapping a rule ` +
              `already on ${bucketName}, and reading the bucket's configuration failed: ` +
              describeFailure("readBucketNotifications", existing.status, existing.envelope)
                .message,
          );
        }
        if (hasNotificationRule(existing.envelope.result, queueId, prefix)) return;
        throw new Error(
          `configureBucketNotifications: R2 refused the ${prefix} rule as overlapping a rule ` +
            `already on ${bucketName}, and the bucket does not send ${prefix} to queue ${queueId}. ` +
            `It holds: ${describeNotificationConfiguration(existing.envelope.result)}. Either the ` +
            "queue id this deployment names (FILES_INGEST_QUEUE_ID) is not the queue the bucket was " +
            "configured for, or an older rule covers the same prefix — remove it in the dashboard " +
            "(R2 → the bucket → Settings → Event notifications) and run the check again.",
        );
      };
      await putRule(options.eventNotificationQueueId, FILES_NOTIFICATION_PREFIX);
      if (
        options.bulkEventNotificationQueueId !== undefined &&
        options.bulkEventNotificationQueueId !== ""
      ) {
        await putRule(options.bulkEventNotificationQueueId, BULK_NOTIFICATION_PREFIX);
      }
    },

    // PUT the whole rule set onto the firm's bucket. The API replaces what is there, so this is
    // idempotent and a resumed provisioning re-applies the same rules rather than accumulating them.
    // The jurisdiction header rides this call for the same reason it rides the others.
    async configureBucketLifecycle(firmId: FirmId, region: DataRegion): Promise<void> {
      const bucketName = await firmResourceName(firmId);
      const jurisdiction = jurisdictionForRegion(region);
      const extraHeaders = jurisdiction ? { "cf-r2-jurisdiction": jurisdiction } : undefined;
      const configured = await callApi<unknown>(
        "configureBucketLifecycle",
        "PUT",
        `${accountBase}/r2/buckets/${bucketName}/lifecycle`,
        {
          rules: LIFECYCLE_RULES.map((rule) =>
            Object.assign(
              {
                id: rule.id,
                enabled: true,
                conditions: { prefix: rule.prefix },
              },
              rule.expireObjectsAfterSeconds === undefined
                ? {}
                : {
                    deleteObjectsTransition: {
                      condition: {
                        type: "Age",
                        maxAge: rule.expireObjectsAfterSeconds,
                      },
                    },
                  },
              {
                abortMultipartUploadsTransition: {
                  condition: {
                    type: "Age",
                    maxAge: rule.abortIncompleteUploadsAfterSeconds,
                  },
                },
              },
            ),
          ),
        },
        extraHeaders,
      );
      if (!configured.envelope.success) {
        throw describeFailure("configureBucketLifecycle", configured.status, configured.envelope);
      }
    },

    // PUT the whole CORS rule set onto the firm's bucket — the same rules the runbook has the owner
    // paste onto the shared bucket, in the API's shape. The API replaces what is there, so a resume
    // re-applies rather than accumulates, and the jurisdiction header rides for the same reason it
    // rides the others.
    async configureBucketCors(firmId: FirmId, region: DataRegion): Promise<void> {
      const bucketName = await firmResourceName(firmId);
      const jurisdiction = jurisdictionForRegion(region);
      const extraHeaders = jurisdiction ? { "cf-r2-jurisdiction": jurisdiction } : undefined;
      const configured = await callApi<unknown>(
        "configureBucketCors",
        "PUT",
        `${accountBase}/r2/buckets/${bucketName}/cors`,
        { rules: browserUploadCorsRules(options.browserOrigins ?? []) },
        extraHeaders,
      );
      if (!configured.envelope.success) {
        throw describeFailure("configureBucketCors", configured.status, configured.envelope);
      }
    },
  };
}
