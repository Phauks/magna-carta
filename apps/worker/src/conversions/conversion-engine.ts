import type { EngineResolver } from "@magna-carta/conversion/execute";
import {
  type ConversionPort,
  type ConversionResult,
  adapterError,
  converted,
  engineNotImplemented,
} from "@magna-carta/conversion/port";
import type { Bindings } from "../app.ts";

// The engine ConversionPort: POST the source bytes + target-format/recipe headers to the dedicated
// conversion worker (magna-carta-convert) over its service binding, and read back the converted bytes
// + media type. Never throws — a transport/engine failure maps to adapter-error (the integrations
// Dispatch discipline, matching the consumer's !result.ok -> markFailed -> ack contract). The heavy
// engines run in that worker's Container(s); a small-raster wasm-vips in-process fast-path may be
// added here later as a parity backend.
function serviceBindingPort(convert: Pick<Fetcher, "fetch">): ConversionPort {
  return {
    async convert(input): Promise<ConversionResult> {
      try {
        const response = await convert.fetch(
          new Request("https://convert/convert", {
            method: "POST",
            headers: {
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

// The deferred port for an engine whose service binding is absent (every test environment, and prod
// until that service is deployed + bound): every conversion is engine-not-implemented. Tests inject
// their own resolver at the consumer's seam.
const deferredPort: ConversionPort = {
  convert: () => Promise.resolve(engineNotImplemented()),
};

// Resolve each hop's engine to the service that runs it. Most engines run in the dedicated conversion
// worker (CONVERT); the OCR engine is its own service (OCR_SERVICE). A hop whose service is unbound
// resolves to the deferred port, so a job needing it fails with engine-not-implemented rather than a
// crash. Per-engineId (not a single shared port) so a multi-hop path can cross services.
export function resolveEnginePort(env: Bindings): EngineResolver {
  return (engineId) => {
    if (engineId === "ocr") {
      return env.OCR_SERVICE === undefined ? deferredPort : ocrSearchablePort(env.OCR_SERVICE);
    }
    return env.CONVERT === undefined ? deferredPort : serviceBindingPort(env.CONVERT);
  };
}
