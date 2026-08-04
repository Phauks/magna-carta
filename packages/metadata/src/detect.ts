import { BombError, zipHasEntry } from "./guards.ts";

export type SupportedFormat = "docx" | "jpeg" | "png";

const DOCX_MAIN_PART = "word/document.xml";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

// Classify by content, never by the supplied filename/extension. A zip is classified as docx only
// when it actually contains word/document.xml — so a renamed archive cannot masquerade as a document.
//
// The zip probe goes through the guarded, non-inflating read in guards.ts: detection needs to know
// only that the entry EXISTS, and this runs before any other read, so inflating here would be the
// one unguarded expansion in the whole pipeline. A breached cap throws BombError, which the caller
// maps to its own failure reason; anything else about the archive being unreadable is simply "not a
// document we support".
export function detect(bytes: Uint8Array): SupportedFormat | "unsupported" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, ZIP_SIGNATURE)) {
    try {
      if (zipHasEntry(bytes, DOCX_MAIN_PART)) return "docx";
    } catch (error) {
      if (error instanceof BombError) throw error;
      return "unsupported";
    }
  }
  return "unsupported";
}
