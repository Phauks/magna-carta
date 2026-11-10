import type { FileId, MatterId } from "@magna-carta/identifiers/types";
import {
  encodeExtractedText,
  extractedTextObjectDimensions,
  extractedTextObjectKey,
  readExtractedPassage,
  type ExtractedPassageOutcome,
} from "@magna-carta/search/extracted-text";
import type { Passage } from "@magna-carta/search/port";

// The firm's bucket as the place a file version's extracted text is kept. The format, the key and
// the reasons are in @magna-carta/search/extracted-text; this is the two bucket operations.

export interface ExtractedTextWrite {
  readonly matterId: MatterId;
  readonly fileId: FileId;
  readonly version: number;
  // The extraction the index job already made for this same version. Never a second one.
  readonly passages: readonly Passage[];
}

// Writes the text of one version, over whatever an earlier attempt at the same version wrote: the
// key is derived from the file and the version, so a retry lands on its own object.
export async function writeExtractedText(
  bucket: R2Bucket,
  input: ExtractedTextWrite,
): Promise<void> {
  const dimensions = extractedTextObjectDimensions(input.matterId);
  await bucket.put(
    extractedTextObjectKey(input.fileId, input.version),
    encodeExtractedText(input.passages),
    {
      customMetadata: dimensions,
      httpMetadata: { contentType: "application/octet-stream" },
    },
  );
}

// Reads one passage of one version's text, by range: one read for most documents, two for a long
// one, three for one of several thousand pages. Never the whole object.
export function readExtractedPassageFromBucket(
  bucket: R2Bucket,
  fileId: FileId,
  version: number,
  chunkId: string,
): Promise<ExtractedPassageOutcome> {
  const key = extractedTextObjectKey(fileId, version);
  return readExtractedPassage(async (offset, length) => {
    const object = await bucket.get(key, { range: { offset, length } });
    return object === null ? null : new Uint8Array(await object.arrayBuffer());
  }, chunkId);
}
