import { type EngineResolver, runConversion } from "@magna-carta/conversion/execute";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { Bindings } from "../../bindings.ts";
import { resolveFirmBucket } from "../../files/firm-bucket.ts";
import { resolveEnginePort } from "../../conversions/conversion-engine.ts";
import type { ConversionMessage } from "../../conversions/conversion-types.ts";

// PER-FIRM BUCKET SEAM: the source object is read and the result written through resolveFirmBucket
// (files/firm-bucket.ts) — the same resolver the conversion routes presign the upload and the result
// download against — so a job's bytes can never be read from, or written to, a different bucket than
// the one the client uploaded into. Today that resolves to the single bound binding for every firm;
// binding a firm's own bucket is a config-commit + deploy step the resolver absorbs without changing
// this consumer. The firm's recorded bucket rides on the message (conversion-types.ts).

function coordinatorFor(env: Bindings, message: ConversionMessage) {
  return env.CONVERSION_JOB.get(
    env.CONVERSION_JOB.idFromName(`${message.firmId}:${message.jobId}`),
  );
}

async function convertOne(
  env: Bindings,
  message: ConversionMessage,
  resolveEngines: (env: Bindings) => EngineResolver,
): Promise<void> {
  const coordinator = coordinatorFor(env, message);
  await coordinator.markRunning();
  const { bucket } = resolveFirmBucket(env, message.bucketName);
  const source = await bucket.get(message.sourceKey);
  if (source === null) {
    await coordinator.markFailed("source expired");
    return; // terminal — do not retry a reaped source
  }
  const bytes = new Uint8Array(await source.arrayBuffer());
  // resolveEngines(env) is a per-engineId resolver, so each hop of a multi-hop path reaches the
  // service that runs its engine (the convert worker, or the OCR service for the searchable-PDF hop);
  // a hop whose engine is not wired yet fails typed (engine-not-implemented) and stops the chain.
  const result = await runConversion(message.from, message.to, bytes, resolveEngines(env));
  if (!result.ok) {
    await coordinator.markFailed(result.reason); // typed, terminal
    return;
  }
  // A conversion runs from the firm-level converter tool, not from a matter's file: neither the source
  // nor the result is filed anywhere, and both expire. Firm-level, and stamped as such so the absence
  // of a matter is a recorded answer rather than a gap.
  await bucket.put(message.resultKey, result.bytes, {
    httpMetadata: { contentType: result.mediaType },
    customMetadata: firmScopedObjectDimensions("conversion-artifact"),
  });
  await coordinator.markDone(message.resultKey, result.mediaType);
}

export async function conversionQueue(
  batch: MessageBatch<ConversionMessage>,
  env: Bindings,
  resolveEngines: (env: Bindings) => EngineResolver = resolveEnginePort,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await convertOne(env, message.body, resolveEngines);
      message.ack();
    } catch (error) {
      // Transport/unexpected failure: mark failed (the DO guards against clobbering a done) and retry.
      await coordinatorFor(env, message.body).markFailed(
        error instanceof Error ? error.message : "conversion error",
      );
      message.retry();
    }
  }
}
