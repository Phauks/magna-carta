import type { EngineResolver } from "@magna-carta/conversion/execute";
import type { EngineId } from "@magna-carta/conversion/format";
import {
  type ConversionPort,
  type ConversionResult,
  adapterError,
  converted,
  engineNotImplemented,
} from "@magna-carta/conversion/port";
import type { Bindings } from "../bindings.ts";

// The engine ids the convert worker can execute today. Both raster-served paths (raster
// interconversion and image-to-PDF) run in its RasterEngineContainer; the office edges run in its
// LibreOfficeEngineContainer. email joins this set when its Container lands in the convert worker.
// OCR is not here — it is its own already-live service, resolved below.
//
// "transcode" is deliberately absent although its Container is in the convert worker: this port
// reads the whole source into memory and the whole result back, which a video of any size would
// exhaust. The playable-copy path reaches that engine by streaming instead, and a video edge stays
// engine-not-implemented here until this port streams too.
//
// Adding an id here is what actually turns an engine on, so it is the LAST step of that engine's
// deploy rather than the first: the convert worker must already carry the Container class, or an id
// it does not recognise comes back 501 and the job fails cleanly as adapter-error.
const CONVERT_WORKER_ENGINE_IDS: ReadonlySet<EngineId> = new Set([
  "libvips",
  "image-pdf",
  "libreoffice",
]);

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

// The OCR engine ConversionPort: POST the PDF bytes to the OCR service's searchable endpoint and read
// back the searchable PDF. Unlike the convert-worker engines, OCR is its own already-live service, so
// this routes to the OCR service binding rather than magna-carta-convert; the request is just the
// bytes (the endpoint carries no recipe). Never throws — any non-2xx (a document the engine rejected,
// or a transient fault) becomes adapter-error, the same terminal signal the consumer marks failed on.
function ocrSearchablePort(ocr: Pick<Fetcher, "fetch">): ConversionPort {
  return {
    async convert(input): Promise<ConversionResult> {
      try {
        const response = await ocr.fetch(
          new Request("https://ocr/ocr/searchable", { method: "POST", body: input.bytes }),
        );
        if (!response.ok) return adapterError(`ocr service ${response.status}`);
        const mediaType = response.headers.get("content-type") ?? "application/pdf";
        return converted(new Uint8Array(await response.arrayBuffer()), mediaType);
      } catch (error) {
        return adapterError(error instanceof Error ? error.message : "ocr service error");
      }
    },
  };
}

// The port for an engine with no reachable Container or service binding (every test environment, and
// prod until that service is deployed + bound): every conversion is engine-not-implemented. Tests
// inject their own resolver at the consumer's seam.
const deferredPort: ConversionPort = {
  convert: () => Promise.resolve(engineNotImplemented()),
};

// Resolve each hop's engine by id to the service that runs it. The OCR engine is its own service
// (OCR_SERVICE); the engines the convert worker can execute get its service-binding port, which
// stamps the engine id so that worker dispatches to the right Container. An engine whose Container is
// not built yet, or whose service is unbound, resolves to the deferred port, so a job needing it fails
// with engine-not-implemented rather than a crash. Per-engineId (not a single shared port) so a
// multi-hop path can cross services.
export function resolveEnginePort(env: Bindings): EngineResolver {
  return (engineId) => {
    if (engineId === "ocr") {
      return env.OCR_SERVICE === undefined ? deferredPort : ocrSearchablePort(env.OCR_SERVICE);
    }
    return env.CONVERT !== undefined && CONVERT_WORKER_ENGINE_IDS.has(engineId)
      ? serviceBindingPort(env.CONVERT, engineId)
      : deferredPort;
  };
}
