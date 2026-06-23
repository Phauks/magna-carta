import { detect, type SupportedFormat } from "./detect.ts";
import type { MetadataEngine } from "./engine.ts";
import { BombError, oversize } from "./guards.ts";
import { imageEngine } from "./image/index.ts";
import { documentEngine } from "./ooxml/index.ts";
import type { MetadataFailure, MetadataInput, MetadataPort, ScrubOutcome } from "./port.ts";
import type { ScrubOptions } from "./options.ts";

const MEDIA_TYPE: Record<SupportedFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  png: "image/png",
};

function engineFor(format: SupportedFormat): MetadataEngine {
  return format === "docx" ? documentEngine() : imageEngine(format);
}

// Map an unexpected throw from an engine to a typed failure. A bomb is its own reason; anything else
// is treated as a corrupt/unparseable file. The error is NEVER surfaced verbatim (redaction).
function failureFromThrow(error: unknown): MetadataFailure {
  return error instanceof BombError ? "decompression-bomb" : "corrupt";
}

export function createMetadataPort(): MetadataPort {
  return {
    async inspect(input: MetadataInput) {
      if (oversize(input.bytes)) return { ok: false, reason: "too-large" };
      const format = detect(input.bytes);
      if (format === "unsupported") return { ok: false, reason: "unsupported-format" };
      try {
        const report = await engineFor(format).inspect(input.bytes);
        return { ok: true, report };
      } catch (error) {
        return { ok: false, reason: failureFromThrow(error) };
      }
    },

    async scrub(input: MetadataInput, options: ScrubOptions): Promise<ScrubOutcome> {
      if (oversize(input.bytes)) return { ok: false, reason: "too-large" };
      const format = detect(input.bytes);
      if (format === "unsupported") return { ok: false, reason: "unsupported-format" };
      try {
        const engine = engineFor(format);
        const bytes = await engine.scrub(input.bytes, options);
        const report = await engine.inspect(bytes); // re-inspect the OUTPUT so callers can confirm clean
        return { ok: true, bytes, mediaType: MEDIA_TYPE[format], report };
      } catch (error) {
        return { ok: false, reason: failureFromThrow(error) };
      }
    },
  };
}
