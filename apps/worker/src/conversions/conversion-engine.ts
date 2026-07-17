import type { EngineResolver } from "@magna-carta/conversion/execute";
import type { EngineId } from "@magna-carta/conversion/format";
import {
  type ConversionPort,
  type ConversionResult,
  adapterError,
  converted,
  engineNotImplemented,
} from "@magna-carta/conversion/port";
import type { Bindings } from "../app.ts";

// The engine ids the convert worker can execute today. Both raster-served paths (raster
// interconversion and image-to-PDF) run in its RasterEngineContainer; LibreOffice/email/FFmpeg
// join this set when their Containers land in the convert worker.
const CONVERT_WORKER_ENGINE_IDS: ReadonlySet<EngineId> = new Set(["libvips", "image-pdf"]);

// An engine ConversionPort: POST the source bytes + engine-id/format/recipe headers to the dedicated
// conversion worker (magna-carta-convert) over its service binding, and read back the converted bytes
// + media type. The x-engine-id header is how that worker picks the Container that executes the hop.
// Never throws — a transport/engine failure maps to adapter-error (the integrations Dispatch
// discipline, matching the consumer's !result.ok -> markFailed -> ack contract).
function serviceBindingPort(convert: Pick<Fetcher, "fetch">, engineId: EngineId): ConversionPort {
  return {
    async convert(input): Promise<ConversionResult> {
      try {
        const response = await convert.fetch(
          new Request("https://convert/convert", {
            method: "POST",
            headers: {
              "x-engine-id": engineId,
              "x-source-format": input.from,
              "x-target-format": input.to,
              "x-recipe": input.recipeRef,
            },
            body: input.bytes,
          }),
        );
        if (!response.ok) return adapterError(`convert worker ${response.status}`);
        const mediaType = response.headers.get("content-type") ?? "application/octet-stream";
        return converted(new Uint8Array(await response.arrayBuffer()), mediaType);
      } catch (error) {
        return adapterError(error instanceof Error ? error.message : "convert worker error");
      }
    },
  };
}

// The port for engines with no reachable Container: every conversion is engine-not-implemented.
const deferredPort: ConversionPort = {
  convert: () => Promise.resolve(engineNotImplemented()),
};

// Resolve each hop's engine by id. An engine backed by the convert worker gets the service-binding
// port; an engine whose Container is not built yet stays deferred, and in an environment without the
// CONVERT binding (every test environment, and prod until the dedicated worker is deployed + bound)
// everything is deferred. Tests inject their own resolver at the consumer's seam.
export function resolveEnginePort(env: Bindings): EngineResolver {
  return (engineId) =>
    env.CONVERT !== undefined && CONVERT_WORKER_ENGINE_IDS.has(engineId)
      ? serviceBindingPort(env.CONVERT, engineId)
      : deferredPort;
}
