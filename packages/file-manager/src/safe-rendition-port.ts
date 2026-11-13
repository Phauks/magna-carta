import type { FileVersionId } from "@magna-carta/identifiers/types";

// The safe-rendition seam. The structural rule is that active formats get a derived safe rendition
// (a rasterized image or a transcoded video) produced in a Container, never the active original.
// The video half is built: a copy every browser plays is made on request and recorded on the version
// it came from (playable-copy.ts). The rasterized-image half has no engine yet, so this port keeps
// its engine-less launch adapter: lookup() finds nothing and request() refuses.
export interface SafeRenditionRequest {
  readonly versionId: FileVersionId;
  readonly r2Key: string;
  readonly sniffedContentType: string;
  readonly target: "rasterized-image" | "transcoded-mp4";
}

export interface SafeRendition {
  readonly renditionVersionId: FileVersionId;
  readonly r2Key: string;
  readonly contentType: string;
}

export interface SafeRenditionPort {
  lookup(request: SafeRenditionRequest): Promise<SafeRendition | null>;
  request(request: SafeRenditionRequest): Promise<SafeRendition>;
}

export class SafeRenditionNotAvailableError extends Error {
  constructor(message = "No safe rendition engine is available.") {
    super(message);
    this.name = "SafeRenditionNotAvailableError";
  }
}

// Launch adapter: no engine yet. lookup() finds no derived rendition; request() refuses rather than
// silently returning the active original.
export const nullSafeRenditionAdapter: SafeRenditionPort = {
  async lookup() {
    return null;
  },
  async request() {
    throw new SafeRenditionNotAvailableError();
  },
};
