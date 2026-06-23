import type { MetadataReport } from "./model.ts";
import type { ScrubOptions } from "./options.ts";

// Both the OOXML document engine and the image engine implement this. The interface is the seam:
// a heavier implementation can replace either without touching the port, the route, or the UI.
export interface MetadataEngine {
  inspect(bytes: Uint8Array): Promise<MetadataReport>;
  scrub(bytes: Uint8Array, options: ScrubOptions): Promise<Uint8Array>;
}
