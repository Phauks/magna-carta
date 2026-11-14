import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, TransferPassId } from "@magna-carta/identifiers/types";
import { runRequestedPass } from "@magna-carta/record-transfer/requested-pass";
import type { TransferPassRequestedPayload } from "@magna-carta/record-transfer/transfer-requests";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import type { Bindings } from "../../bindings.ts";
import { resolveFirmBucketForFirmId } from "../../files/firm-bucket.ts";
import type { ProxyBatchDatabase } from "../../firm-database/firm-database-proxy.ts";
import { firmKeyProviderForEnv } from "../../firm-key-provider-wiring.ts";
import { sourceFileText } from "../../record-transfer/source-file-text.ts";

// The queue's side of a record transfer pass: the message names a pass, and this hands the pass to
// the package with the firm's database, the firm's bucket and a clock.
//
// WHAT RETRIES AND WHAT DOES NOT. A pass is taken by its first delivery, so a second delivery of
// the same message does nothing. A pass that ends in a failure the package names (the file's bytes
// are not held, the file cannot be read as rows) has recorded that on its own row and the message
// is done. A fault nobody expected is recorded on the row the same way and then reported through
// the error pipeline here, and the message is still done: delivering it again would find the pass
// already taken. The way on after any failure is a new pass, which a person asks for.
//
// The Directory's write context is built with no permissions. A pass seals what it writes and
// never opens a sealed field, and an empty set is a refusal for any read that tried.
export async function consumeTransferPassRequest(
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  message: { readonly firmId: string; readonly payload: string },
  logger: Logger,
): Promise<void> {
  const payload = JSON.parse(message.payload) as Partial<TransferPassRequestedPayload>;
  if (typeof payload.transferPassId !== "string") return;
  const { bucket } = await resolveFirmBucketForFirmId(env, message.firmId);
  const clock = { now: () => new Date().toISOString() };
  const outcome = await runRequestedPass(
    {
      database: firmDatabase,
      clock,
      randomSource: cryptoRandomSource,
      directoryContext: (actorUserId) => ({
        firmId: message.firmId as FirmId,
        firmKeyVersion: 1,
        firmKeyProvider: firmKeyProviderForEnv(env),
        database: firmDatabase,
        effectivePermissions: new Set(),
        actorUserId,
        clock,
        randomSource: cryptoRandomSource,
      }),
      readSourceFile: (objectKey) => sourceFileText(bucket, objectKey),
      writeReport: async (objectKey, json) => {
        await bucket.put(objectKey, json, { httpMetadata: { contentType: "application/json" } });
      },
    },
    payload.transferPassId as TransferPassId,
  );
  if (outcome.outcome === "failed" && outcome.error !== undefined) {
    logOperationFailed(
      logger,
      `queue:record-transfer-pass:${payload.transferPassId}`,
      outcome.error,
      newCorrelationId(),
    );
  }
}
