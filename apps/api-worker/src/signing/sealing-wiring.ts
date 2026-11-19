import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SigningRequestId } from "@magna-carta/identifiers/types";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { Bindings } from "../bindings.ts";
import { resolveSealPort } from "../documents/seal-port-binding.ts";
import { resolveFirmBucketForFirmId } from "../files/firm-bucket.ts";
import { enqueueDevIngestEvent } from "../files/presign.ts";
import { sealCompletedRequest, type SealOutcome } from "./seal-completed.ts";

// The deployment's side of sealing a completed request: the sealing service over its binding, the
// firm's own bucket, the ingest the filed copies go through, and the firm's name for the
// certificate's contact line. Both the queue handler and the hourly pass reach sealing through here,
// so they cannot be wired differently.

export async function sealRequestForFirm(
  env: Bindings,
  firmId: string,
  database: BatchDatabase,
  requestId: SigningRequestId,
  logger: Logger,
): Promise<SealOutcome> {
  const { bucket, bucketName } = await resolveFirmBucketForFirmId(env, firmId);
  const outcome = await sealCompletedRequest(database, requestId, {
    sealPort: resolveSealPort(env.SIGN_SERVICE),
    bucket,
    bucketName,
    ingest: (name, key, size) => enqueueDevIngestEvent(env, name, key, size),
    firmName: await readFirmName(env, firmId),
    now: () => new Date().toISOString(),
  });
  // Counted by kind, never with the request, the document or a name.
  if (outcome.kind !== "skipped") logger.count("signing.seal_outcome", { outcome: outcome.kind });
  return outcome;
}

async function readFirmName(env: Bindings, firmId: string): Promise<string> {
  const row = await env.DB_CONTROL.prepare(
    "SELECT name, display_name FROM firm WHERE id = ? LIMIT 1",
  )
    .bind(firmId)
    .first<{ name: string; display_name: string | null }>();
  return row?.display_name ?? row?.name ?? "";
}
