import {
  type ConversionPort,
  type ConversionResult,
  adapterError,
  converted,
  engineNotImplemented,
} from "@magna-carta/conversion/port";
import type { Bindings } from "../app.ts";

// The Container-backed ConversionPort: POST {recipe + bytes} to the libvips Container, read back the
// converted bytes + media type. Never throws — a Container/transport failure maps to adapter-error
// (the integrations Dispatch discipline).
function containerPort(namespace: DurableObjectNamespace): ConversionPort {
  return {
    async convert(input): Promise<ConversionResult> {
      try {
        const container = namespace.get(namespace.idFromName("libvips"));
        const response = await container.fetch("https://libvips/convert", {
          method: "POST",
          headers: { "x-target-format": input.to, "x-recipe": input.recipeRef },
          body: input.bytes,
        });
        if (!response.ok) return adapterError(`libvips container ${response.status}`);
        const mediaType = response.headers.get("content-type") ?? "application/octet-stream";
        return converted(new Uint8Array(await response.arrayBuffer()), mediaType);
      } catch (error) {
        return adapterError(error instanceof Error ? error.message : "libvips container error");
      }
    },
  };
}

// The deferred port for environments without the Container binding (the local test pool, and prod until
// the image is deployed): every conversion is engine-not-implemented. Tests inject their own fake port.
const deferredPort: ConversionPort = {
  convert: () => Promise.resolve(engineNotImplemented()),
};

export function resolveEnginePort(env: Bindings): ConversionPort {
  return env.LIBVIPS_CONTAINER === undefined ? deferredPort : containerPort(env.LIBVIPS_CONTAINER);
}
