import { registerEngine } from "../../engines.ts";
import {
  type ConversionInput,
  type ConversionPort,
  type ConversionResult,
  adapterError,
  converted,
  unsupportedEdge,
} from "../../port.ts";
import { getFormat } from "../../registry.ts";

// Target FormatId -> libvips write suffix + media type. The libvips recipeRef IS the target id, so the
// adapter handles exactly the raster targets it knows; anything else is an unsupported edge.
const RASTER_OUTPUT: Record<string, { suffix: string; mediaType: string }> = {
  png: { suffix: ".png", mediaType: "image/png" },
  jpeg: { suffix: ".jpg", mediaType: "image/jpeg" },
  webp: { suffix: ".webp", mediaType: "image/webp" },
  tiff: { suffix: ".tif", mediaType: "image/tiff" },
  gif: { suffix: ".gif", mediaType: "image/gif" },
};

// wasm-vips initializes once (the WASM module is heavy); memoize it. Runtime-agnostic: the same module
// runs in Node now and could target a Worker (small images) or be swapped for native libvips in a
// Container later.
let vipsPromise: Promise<Awaited<ReturnType<typeof loadVips>>> | undefined;
async function loadVips() {
  const Vips = (await import("wasm-vips")).default;
  return Vips();
}
function vips() {
  vipsPromise ??= loadVips();
  return vipsPromise;
}

export const libvipsAdapter: ConversionPort = {
  async convert(input: ConversionInput): Promise<ConversionResult> {
    const output = RASTER_OUTPUT[input.to];
    if (output === undefined || getFormat(input.to) === undefined) {
      return unsupportedEdge(`libvips cannot target ${input.to}`);
    }
    try {
      const v = await vips();
      // newFromBuffer auto-detects the loader; libvips' loaders are the hardened, in-tenant path for
      // untrusted bytes — a malformed buffer raises here and is mapped to adapter-error below.
      const image = v.Image.newFromBuffer(input.bytes);
      const out = image.writeToBuffer(output.suffix);
      return converted(new Uint8Array(out), output.mediaType);
    } catch (error) {
      return adapterError(error instanceof Error ? error.message : "libvips conversion failed");
    }
  },
};

registerEngine("libvips", libvipsAdapter);
