/*
 * A plain-text document's two moves — reading its current version into the editor, and writing the
 * edited text back as the next version — out of the component so both are testable against a
 * scripted fetch.
 *
 * Reading goes through the audited download route, which answers with a redirect to a short-lived
 * signed URL on the storage; `fetch` follows it, and the bucket's browser policy admits the read
 * from the application's origin. The bytes are decoded as UTF-8 text and never handed to anything
 * that would interpret them: they land in a text field, which is the one place untrusted content
 * is inert by construction.
 *
 * Writing IS the upload ceremony (create-document.ts) with the document's own id: reserve the next
 * version, put the bytes to storage, complete, wait for the gate. Nothing here is a second save
 * path — a version cut by typing and one cut by uploading are the same act on the server, so they
 * are the same act here.
 */
import { problemOutcome, transportOutcome, type ApiOutcome } from "$lib/api/request.ts";
import { fileDownloadUrl } from "$lib/file-manager/matter-file-api.ts";
import { uploadDocument, type CeremonyOptions, type CreationOutcome } from "./create-document.ts";
import { TEXT_EDITOR_MAX_BYTES, textContentTypeOf } from "./editable-documents.ts";

/** The two ways a read fails, carrying the failure record every failure surface renders from. */
export type TextReadFailure = Exclude<ApiOutcome<never>, { kind: "ok" }>;

/** What reading a document's text settles to. */
export type TextReadOutcome =
  | { readonly kind: "ok"; readonly text: string }
  /** The document is bigger than the editor is prepared to hold. It stays downloadable. */
  | { readonly kind: "too-large"; readonly sizeBytes: number }
  | TextReadFailure;

/** The failing branch of an outcome that was built to fail. Narrows without a cast. */
function failure(outcome: ApiOutcome<never>): TextReadFailure {
  if (outcome.kind === "ok") throw new Error("A failure outcome cannot be ok.");
  return outcome;
}

/**
 * Read the document's current text. `sizeBytes` is the record's own size, asked before a byte
 * moves so a document the editor will refuse is refused without fetching it; a record that holds
 * no size is read and measured on arrival.
 */
export async function readTextDocument(
  fetchImpl: typeof fetch,
  fileId: string,
  sizeBytes: number | null,
  maxBytes: number = TEXT_EDITOR_MAX_BYTES,
): Promise<TextReadOutcome> {
  if (sizeBytes !== null && sizeBytes > maxBytes) return { kind: "too-large", sizeBytes };
  const path = fileDownloadUrl(fileId);
  const line = `GET ${path}`;
  let response: Response;
  try {
    response = await fetchImpl(path);
  } catch {
    return failure(transportOutcome<never>(line));
  }
  if (!response.ok) return failure(problemOutcome<never>({ status: response.status }, line));
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    return failure(transportOutcome<never>(line));
  }
  if (bytes.byteLength > maxBytes) return { kind: "too-large", sizeBytes: bytes.byteLength };
  return { kind: "ok", text: new TextDecoder("utf-8").decode(bytes) };
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
