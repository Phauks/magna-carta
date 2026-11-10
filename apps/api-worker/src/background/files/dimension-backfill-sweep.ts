import { BULK_PREFIX, FILES_PREFIX } from "@magna-carta/file-manager/file-statements";
import { listMatterIdsByFileIds } from "@magna-carta/file-manager/queries";
import type { FileId, MatterId } from "@magna-carta/identifiers/types";
import {
  matterScopedObjectDimensions,
  objectIsStamped,
  type MatterScopedObjectClass,
} from "@magna-carta/object-dimensions/dimensions";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../../bindings.ts";
import { listReachableActiveFirms } from "../scheduled.ts";
import { resolveFirmBucket } from "../../files/firm-bucket.ts";

// The repair pass for objects written before their scope travelled with them, and the standing detector
// for a write path that forgets to stamp one.
//
// WHY A SWEEP AND NOT A MIGRATION. There is nothing to migrate: the fact is not in a table, it is on
// each object, and the only way to put it there is to rewrite that object's metadata. A one-shot script
// would have to be re-run by hand after every failure and would go stale the moment a new write path
// appeared; a sweep that runs every day converges on its own and keeps converging.
//
// WHY THE BUCKET IS THE CANDIDATE QUERY. Asking the database "which objects are unstamped" is a question
// it cannot answer — it never knew. Asking the bucket is exact, needs no new column and no new state,
// and is self-limiting in the way that matters: a stamped object stops being a candidate, so the work
// left shrinks by construction rather than by bookkeeping.
//
// WHY IT CONVERGES OVER FAILURES. Each pass restamps up to a fixed budget of candidates and stops
// walking once the budget is spent, so one pass is bounded no matter how large the backlog. An object
// that is stamped is never a candidate again; an object whose rewrite failed is left exactly as it was
// and is a candidate again tomorrow. So every pass strictly reduces the unstamped set by the smaller of
// the budget and what remains, and a firm whose backlog is larger than one budget drains over several
// days rather than flooding one night. Nothing is deleted and no byte changes: the rewrite carries the
// same bytes, the same content type, and the same storage class, so re-running it costs a rewrite and
// can never cost content.
//
// WHAT IT COSTS ONCE THERE IS NOTHING TO DO. A listing walk per firm per day, and no writes. That is
// the price of the second thing this pass buys: a firm whose count of unstamped objects stops being
// zero is a write path that forgot, surfaced the day it ships rather than the day something tries to
// read the dimension.

// One pass's per-firm rewrite budget. Sized well below the re-extraction sweep's enqueue cap because a
// rewrite moves bytes where an enqueue moves a message: this is the same class of work as the tiering
// sweep, and it is bounded for the same reason.
const BACKFILL_PER_FIRM_REWRITE_BUDGET = 200;

// The two prefixes holding objects that belong to a matter and are keyed `<prefix>/{fileId}/{...}`.
// Every other prefix in a firm's bucket holds firm-level artifacts, whose class is stamped by the path
// that writes them and which have no matter to recover.
const MATTER_KEYED_PREFIXES = [`${FILES_PREFIX}/`, `${BULK_PREFIX}/`];

export interface DimensionBackfillReport {
  readonly firmsProcessed: number;
  // Objects rewritten with their scope this pass.
  readonly stamped: number;
  // Objects found unstamped whose file no longer exists in this firm's records. Left alone and counted
  // rather than guessed at, and deliberately NOT charged against the rewrite budget — an orphan that
  // can never be resolved must not be able to consume the budget every night and starve the objects
  // that can.
  readonly unresolvable: number;
}

export interface DimensionBackfillOptions {
  readonly perFirmRewriteBudget?: number;
}

// The class an object at this key must carry. The mutable working copy of a document is not a version
// of it, and stamping one as the other would be the single most misleading thing this pass could do.
function objectClassForKey(key: string): MatterScopedObjectClass {
  return key.endsWith("/current") ? "working-copy" : "working-document";
}

// `files/{fileId}/{versionId}` and `bulk/{fileId}/{versionId}` — the file id is the second segment, and
// the key shape is a compatibility contract with the objects already in the bucket rather than a
// convention this pass may reinterpret.
function fileIdOfKey(key: string): FileId | null {
  const segments = key.split("/");
  const candidate = segments[1];
  return segments.length >= 3 && candidate !== undefined && candidate !== ""
    ? (candidate as FileId)
    : null;
}

interface Candidate {
  readonly key: string;
  readonly fileId: FileId;
}

// The rewrite. R2's Workers binding has no metadata-only update, so the object is restreamed through
// this pass — the same mechanism, and the same zero-copy upgrade path, as the storage-tiering sweep
// beside it (editing/tiering-sweep.ts). Everything except the metadata is carried across unchanged, so
// a tiered object stays tiered and a typed object keeps its type.
async function restampObject(
  bucket: R2Bucket,
  candidate: Candidate,
  matterId: MatterId,
): Promise<boolean> {
  const object = await bucket.get(candidate.key);
  if (object === null) return false; // deleted between the listing and now; nothing to repair
  const storageClass = (object as { storageClass?: string }).storageClass;
  await bucket.put(candidate.key, object.body, {
    httpMetadata: object.httpMetadata,
    customMetadata: matterScopedObjectDimensions({
      objectClass: objectClassForKey(candidate.key),
      matterId,
    }),
    ...(storageClass !== undefined && storageClass !== "" ? { storageClass } : {}),
  });
  return true;
}

export async function runDimensionBackfillSweep(
  env: Bindings,
  options: DimensionBackfillOptions = {},
): Promise<DimensionBackfillReport> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const budget = options.perFirmRewriteBudget ?? BACKFILL_PER_FIRM_REWRITE_BUDGET;

  const firms = await listReachableActiveFirms(env);
  let firmsProcessed = 0;
  let stamped = 0;
  let unresolvable = 0;

  for (const firm of firms) {
    try {
      const { bucket } = resolveFirmBucket(env, firm.bucketName);
      let remaining = budget;

      for (const prefix of MATTER_KEYED_PREFIXES) {
        let cursor: string | undefined;
        while (remaining > 0) {
          // The listing carries each object's metadata, so the candidate test costs no extra request.
          // The first page is requested without a cursor key at all — an explicit undefined makes the
          // local object store return an empty page.
          const page = await bucket.list(
            cursor === undefined
              ? { prefix, include: ["customMetadata"] }
              : { prefix, cursor, include: ["customMetadata"] },
          );
          const candidates: Candidate[] = [];
          for (const object of page.objects) {
            if (objectIsStamped(object.customMetadata)) continue;
            const fileId = fileIdOfKey(object.key);
            if (fileId === null) continue;
            candidates.push({ key: object.key, fileId });
          }
          // One resolution per page rather than one per object: the whole page's files in a single
          // read, so a page of a thousand candidates costs one query and not a thousand.
          const matters = await listMatterIdsByFileIds(
            firm.database,
            candidates.map((candidate) => candidate.fileId),
          );
          for (const candidate of candidates) {
            if (remaining === 0) break;
            const matterId = matters.get(candidate.fileId);
            if (matterId === undefined) {
              unresolvable++;
              continue;
            }
            if (await restampObject(bucket, candidate, matterId)) {
              stamped++;
              remaining--;
            }
          }
          if (!page.truncated) break;
          cursor = page.cursor;
        }
      }
      firmsProcessed++;
    } catch (caught) {
      // One firm's failure must not starve the rest; logged through the one pipeline, next pass retries.
      logOperationFailed(logger, `cron:dimension-backfill:${firm.firmId}`, caught, correlationId);
    }
  }

  if (stamped > 0) {
    // A count, never a key: which objects needed repair is operational detail, and the number is what
    // an operator watches — it should fall to zero and stay there.
    logger.count("storage.dimension.stamped", {}, stamped);
  }
  return { firmsProcessed, stamped, unresolvable };
}
