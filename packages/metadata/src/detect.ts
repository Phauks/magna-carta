import { unzipSync } from "fflate";

export type SupportedFormat = "docx" | "jpeg" | "png";

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
export function detect(bytes: Uint8Array): SupportedFormat | "unsupported" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, ZIP_SIGNATURE)) {
    try {
      const entries = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
      if (entries["word/document.xml"] !== undefined) return "docx";
    } catch {
      return "unsupported";
    }
  }
  return "unsupported";
}
