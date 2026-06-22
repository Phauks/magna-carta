import type { FileVersionId } from "@magna-carta/identifiers/types";

// The safe-rendition seam. The structural rule is that active formats get a derived safe rendition
// (a rasterized image or a transcoded MP4 produced in a Container, written back to R2 as an
// artifact_role:'derived' version). This slice honors the rule the cheap way — download-only — and
// ships only the PORT plus an engine-less launch adapter. The rasterize/transcode engine wires in
// when the player UI lands; until then lookup() finds nothing and request() refuses.
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
