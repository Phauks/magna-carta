/*
 * Reading a stored document's bytes into the browser: one fetch, one size guard, three outcomes.
 *
 * Both surfaces that work on a document's content locally read it this way — the plain-text editor
 * and the PDF viewer — so the guard, the failure shapes and the request line are decided once
 * rather than per screen.
 *
 * The read goes through the AUDITED download route, which answers with a redirect to a short-lived
 * signed URL that `fetch` follows. That is deliberate: reading a document's content is the same act
 * whether a person saves the file or the application draws it, and it is recorded either way.
 */
import { problemOutcome, transportOutcome, type ApiOutcome } from "$lib/api/request.ts";
import { fileDownloadUrl } from "$lib/file-manager/matter-file-api.ts";

/** The two ways a read fails, carrying the failure record every failure surface renders from. */
export type DocumentReadFailure = Exclude<ApiOutcome<never>, { kind: "ok" }>;

/** What reading a document's bytes settles to. */
export type DocumentBytesOutcome =
  | { readonly kind: "ok"; readonly bytes: ArrayBuffer }
  /** The document is bigger than this surface is prepared to hold. It stays downloadable. */
  | { readonly kind: "too-large"; readonly sizeBytes: number }
  | DocumentReadFailure;

/** The failing branch of an outcome that was built to fail. Narrows without a cast. */
function failed(outcome: ApiOutcome<never>): DocumentReadFailure {
  if (outcome.kind === "ok") throw new Error("A failure outcome cannot be ok.");
  return outcome;
}

/**
 * Read the document's current version. `sizeBytes` is the record's own size, asked before a byte
 * moves so a document the surface will refuse costs no transfer; a record that holds no size is
 * read and measured on arrival.
 */
export async function readDocumentBytes(
  fetchImpl: typeof fetch,
  fileId: string,
  sizeBytes: number | null,
  maxBytes: number,
): Promise<DocumentBytesOutcome> {
  if (sizeBytes !== null && sizeBytes > maxBytes) return { kind: "too-large", sizeBytes };
  const path = fileDownloadUrl(fileId);
  const line = `GET ${path}`;
  let response: Response;
  try {
    response = await fetchImpl(path);
  } catch {
    return failed(transportOutcome<never>(line));
  }
  if (!response.ok) return failed(problemOutcome<never>({ status: response.status }, line));
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    return failed(transportOutcome<never>(line));
  }
  if (bytes.byteLength > maxBytes) return { kind: "too-large", sizeBytes: bytes.byteLength };
  return { kind: "ok", bytes };
}
