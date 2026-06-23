import type { MetadataEngine } from "../engine.ts";
import { inspectDocx } from "./inspect.ts";
import { scrubDocx } from "./scrub.ts";

export function documentEngine(): MetadataEngine {
  return {
    inspect: (bytes) => Promise.resolve(inspectDocx(bytes)),
    scrub: (bytes, options) => Promise.resolve(scrubDocx(bytes, options)),
  };
}
