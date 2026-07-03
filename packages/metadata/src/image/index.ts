import type { MetadataEngine } from "../engine.ts";
import { reportOf } from "../model.ts";
import { inspectJpegFindings, scrubJpeg } from "./jpeg.ts";
import { inspectPngFindings, scrubPng } from "./png.ts";

export { inspectJpegFindings, scrubJpeg } from "./jpeg.ts";
export { inspectPngFindings, scrubPng } from "./png.ts";

export function imageEngine(format: "jpeg" | "png"): MetadataEngine {
  const findingsOf = format === "jpeg" ? inspectJpegFindings : inspectPngFindings;
  const strip = format === "jpeg" ? scrubJpeg : scrubPng;
  return {
    inspect: (bytes) => Promise.resolve(reportOf(format, findingsOf(bytes))),
    scrub: (bytes, options) => Promise.resolve(options.imageMetadata ? strip(bytes) : bytes),
  };
}
