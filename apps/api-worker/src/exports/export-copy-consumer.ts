import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { readVersionForExportCopy } from "@magna-carta/file-manager/export-copy";
import type { FileId, FileVersionId } from "@magna-carta/identifiers/types";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { Bindings } from "../app.ts";
import type { PerFirmQueueMessage } from "../costs/recoverable-charge-consumer.ts";
import { resolveFirmBucketForFirmId } from "../files/firm-bucket.ts";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { produceExportCopy } from "./export-copy.ts";

// Where a version's export copy gets made: on the shared per-firm queue, off the request path.
//
// TWO WAYS ONTO THE QUEUE, ONE HANDLER. The save that cuts a version sends this topic straight to
// the queue (requestExportCopy below) so the copy is usually ready within seconds of the save — a
// member who saves and downloads is the common case. The outbox relay also publishes every
// `file.version_committed`, on its own cadence, and that reaches the same handler as a backstop:
// a direct send that failed, or a deploy in between, still gets its copy on the next relay pass.
// The handler is idempotent (a copy already recorded is returned, not remade), so meeting the
// same version twice costs one row read.

export const EXPORT_COPY_REQUESTED_TOPIC = "file.export_copy_requested";

export interface ExportCopyRequestPayload {
  readonly fileId: FileId;
  readonly versionId: FileVersionId;
}

function versionIdOf(payload: string): FileVersionId | undefined {
  try {
    const parsed = JSON.parse(payload) as { versionId?: unknown };
    return typeof parsed.versionId === "string" ? (parsed.versionId as FileVersionId) : undefined;
  } catch {
    return undefined;
  }
}

export async function handleExportCopyRequested(
  env: Bindings,
  firmDatabase: ProxyBatchDatabase,
  message: PerFirmQueueMessage,
  logger: Logger,
): Promise<void> {
  const versionId = versionIdOf(message.payload);
  if (versionId === undefined) {
    // Retrying cannot make the payload name a version; it would only march to the dead-letter queue.
    logger.count("exports.copy.malformed_payload", { topic: message.topic }, 1);
    return;
  }
  const version = await readVersionForExportCopy(firmDatabase, versionId);
  // Not clean, or gone: nothing is served from it, so nothing is owed. Most `file.version_committed`
  // messages land here too — an upload's version needs no copy — and that is one row read each.
  if (version === undefined || version.exportCopyState === null) return;
  const { bucket } = await resolveFirmBucketForFirmId(env, message.firmId);
  const outcome = await produceExportCopy(firmDatabase, bucket, version, () =>
    new Date().toISOString(),
  );
  logger.count(
    "exports.copy.produced",
    { outcome: outcome.kind, reason: outcome.kind === "unavailable" ? outcome.reason : "" },
    1,
  );
}

/**
 * Asks for a version's copy now, straight onto the queue. Best-effort by design: the version is
 * committed and marked pending already, the relay's backstop will reach it, and the download
 * path makes a pending copy on the spot — so a send that fails must never fail the save.
 */
export async function requestExportCopy(
  env: Bindings,
  firmId: string,
  payload: ExportCopyRequestPayload,
): Promise<void> {
  const message: PerFirmQueueMessage = {
    id: crypto.randomUUID(),
    firmId,
    topic: EXPORT_COPY_REQUESTED_TOPIC,
    payload: canonicalJsonStringify(payload),
    aggregateKey: null,
    seq: null,
  };
  await env.QUEUE.send(message);
}
