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

// The deferred port for environments without the CONVERT binding (every test environment, and prod
// until the dedicated worker is deployed + bound): every conversion is engine-not-implemented. Tests
// inject their own fake port at the consumer's resolver seam.
const deferredPort: ConversionPort = {
  convert: () => Promise.resolve(engineNotImplemented()),
};

export function resolveEnginePort(env: Bindings): ConversionPort {
  return env.CONVERT === undefined ? deferredPort : serviceBindingPort(env.CONVERT);
}
