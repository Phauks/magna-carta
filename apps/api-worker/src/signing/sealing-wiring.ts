import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { FirmId, SigningRequestId } from "@magna-carta/identifiers/types";
import type { Logger } from "@magna-carta/telemetry/logger";
import { emailAdapterForEnv } from "../auth-instance.ts";
import type { Bindings } from "../bindings.ts";
import type { SendEmail } from "../email-port.ts";
import { resolveSealPort } from "../documents/seal-port-binding.ts";
import { resolveFirmBucketForFirmId } from "../files/firm-bucket.ts";
import { enqueueDevIngestEvent } from "../files/presign.ts";
import { sealCompletedRequest, type SealOutcome } from "./seal-completed.ts";
import { mailSignedCopies } from "./signer-delivery.ts";
import { readMemberName, readRequest, readSigners } from "./statements.ts";

// The deployment's side of sealing a completed request: the sealing service over its binding, the
// firm's own bucket, the ingest the filed copies go through, and the firm's name for the
// certificate's contact line. Both the queue handler and the hourly pass reach sealing through here,
// so they cannot be wired differently.
//
// Once a request is sealed, each outside signer is mailed a link to the signed copy. The mail goes
// only on the call that sealed, so a retried message or the hourly pass finding it sealed mails no
// one twice. A deployment with no public address has nowhere for the link to point, and mails nothing.

export async function sealRequestForFirm(
  env: Bindings,
  firmId: string,
  database: BatchDatabase,
  requestId: SigningRequestId,
  logger: Logger,
  options: { readonly send?: SendEmail } = {},
): Promise<SealOutcome> {
  const { bucket, bucketName } = await resolveFirmBucketForFirmId(env, firmId);
  const firmName = await readFirmName(env, firmId);
  const outcome = await sealCompletedRequest(database, requestId, {
    sealPort: resolveSealPort(env.SIGN_SERVICE),
    bucket,
    bucketName,
    ingest: (name, key, size) => enqueueDevIngestEvent(env, name, key, size),
    firmName,
    now: () => new Date().toISOString(),
  });
  // Counted by kind, never with the request, the document or a name.
  if (outcome.kind !== "skipped") logger.count("signing.seal_outcome", { outcome: outcome.kind });
  if (outcome.kind === "sealed" && env.APP_BASE_URL !== undefined) {
    const request = await readRequest(database, requestId);
    if (request?.sealedAt != null) {
      const { failed } = await mailSignedCopies(
        {
          send: options.send ?? emailAdapterForEnv(env),
          key: env.AUTH_SECRET,
          firmId: firmId as FirmId,
          firmName,
          senderName: await readMemberName(database, request.createdByUserId),
          origin: new URL(env.APP_BASE_URL).origin,
          logger,
        },
        { ...request, sealedAt: request.sealedAt },
        await readSigners(database, requestId),
      );
      if (failed > 0) logger.count("signing.signed_copies_undelivered", {}, failed);
    }
  }
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
