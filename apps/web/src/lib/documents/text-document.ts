/*
 * A plain-text document's two moves — reading its current version into the editor, and writing the
 * edited text back as the next version — out of the component so both are testable against a
 * scripted fetch.
 *
 * Reading is the shared byte read (document-bytes.ts) plus a decode. The decoded text is never
 * handed to anything that would interpret it: it lands in a text field, which is the one place
 * untrusted content is inert by construction.
 *
 * Writing IS the upload ceremony (create-document.ts) with the document's own id: reserve the next
 * version, put the bytes to storage, complete, wait for the gate. Nothing here is a second save
 * path — a version cut by typing and one cut by uploading are the same act on the server, so they
 * are the same act here.
 */
import { readDocumentBytes, type DocumentReadFailure } from "./document-bytes.ts";
import { uploadDocument, type CeremonyOptions, type CreationOutcome } from "./create-document.ts";
import { TEXT_EDITOR_MAX_BYTES, textContentTypeOf } from "./editable-documents.ts";

/** The two ways a read fails, carrying the failure record every failure surface renders from. */
export type TextReadFailure = DocumentReadFailure;

/** What reading a document's text settles to. */
export type TextReadOutcome =
  | { readonly kind: "ok"; readonly text: string }
  /** The document is bigger than the editor is prepared to hold. It stays downloadable. */
  | { readonly kind: "too-large"; readonly sizeBytes: number }
  /**
   * The bytes are not UTF-8 text, so this editor will not open them. It stays downloadable.
   *
   * This is a REFUSAL, not a fallback, and the reason is what a save would do. A lossy decode
   * turns every byte it cannot read into a replacement character, and the save path re-encodes
   * the field as UTF-8 — so opening a document written in a legacy single-byte encoding, which is
   * ordinary for older files carrying curly quotes, dashes or accented names, and then saving it
   * would cut a new current version with every one of those characters destroyed. The prior
   * versions would survive, and the document a colleague opens next would not.
   */
  | { readonly kind: "not-text" }
  | TextReadFailure;

/**
 * Read the document's current text. The bytes come through the shared read; what is added here is
 * the decode, which is where a text document differs from any other.
 */
export async function readTextDocument(
  fetchImpl: typeof fetch,
  fileId: string,
  sizeBytes: number | null,
  maxBytes: number = TEXT_EDITOR_MAX_BYTES,
): Promise<TextReadOutcome> {
  const outcome = await readDocumentBytes(fetchImpl, fileId, sizeBytes, maxBytes);
  if (outcome.kind !== "ok") return outcome;
  // `fatal` is the whole guard: it makes the decoder THROW on a byte sequence that is not UTF-8
  // rather than substituting U+FFFD and handing back text that looks almost right.
  try {
    return { kind: "ok", text: new TextDecoder("utf-8", { fatal: true }).decode(outcome.bytes) };
  } catch {
    return { kind: "not-text" };
  }
}

/**
 * Write the edited text back as the document's next version. The file carries the document's own
 * name and the content type its name calls for, so the version reads as what it is; the ceremony
 * reports its stages and settles to the same outcomes any upload does.
 */
export function saveTextDocument(
  options: CeremonyOptions & {
    readonly matterId: string;
    readonly fileId: string;
    readonly fileName: string;
    readonly text: string;
  },
): Promise<CreationOutcome> {
  const { matterId, fileId, fileName, text, ...ceremony } = options;
  const file = new File([text], fileName, { type: textContentTypeOf(fileName) });
  return uploadDocument({ ...ceremony, matterId, fileId, file });
}
