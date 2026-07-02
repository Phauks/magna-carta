import { runConversion } from "@magna-carta/conversion/execute";
import type { ConversionPort } from "@magna-carta/conversion/port";
import type { Bindings } from "../app.ts";
import { resolveEnginePort } from "./conversion-engine.ts";
import type { ConversionMessage } from "./conversion-types.ts";

function coordinatorFor(env: Bindings, message: ConversionMessage) {
  return env.CONVERSION_JOB.get(
    env.CONVERSION_JOB.idFromName(`${message.firmId}:${message.jobId}`),
  );
}

async function convertOne(
  env: Bindings,
  message: ConversionMessage,
  resolvePort: (env: Bindings) => ConversionPort,
): Promise<void> {
  const coordinator = coordinatorFor(env, message);
  await coordinator.markRunning();
  const source = await env.R2.get(message.sourceKey);
  if (source === null) {
    await coordinator.markFailed("source expired");
    return; // terminal — do not retry a reaped source
  }
  const bytes = new Uint8Array(await source.arrayBuffer());
  // resolvePort resolves every hop to the single libvips engine — correct while libvips is the
  // only implemented engine. When LibreOffice/FFmpeg engines activate, a multi-hop path will
  // need a per-engineId resolver instead of a single-instance resolver.
  const result = await runConversion(message.from, message.to, bytes, () => resolvePort(env));
  if (!result.ok) {
    await coordinator.markFailed(result.reason); // typed, terminal
    return;
  }
  await env.R2.put(message.resultKey, result.bytes, {
    httpMetadata: { contentType: result.mediaType },
  });
  await coordinator.markDone(message.resultKey, result.mediaType);
}

export async function conversionQueue(
  batch: MessageBatch<ConversionMessage>,
  env: Bindings,
  resolvePort: (env: Bindings) => ConversionPort = resolveEnginePort,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await convertOne(env, message.body, resolvePort);
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
