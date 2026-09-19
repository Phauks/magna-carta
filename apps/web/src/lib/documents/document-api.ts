import {
  problemOutcome,
  requestJson,
  transportOutcome,
  type ApiOutcome,
  type Problem,
} from "$lib/api/request.ts";

export { requestJson, type ApiOutcome, type Problem };

/*
 * The Documents surface's response shapes — every call this screen makes into the API, in one place,
 * out of the components so the branching is unit-testable without a DOM.
 *
 * These are same-origin `fetch` calls against the relative `/api/v1` paths, matching the WHOIS tool
 * (apps/web/src/lib/tools/whois/whois-lookup.ts) and the speed test: `apps/web` does not depend on
 * @magna-carta/api-client, so the response shapes below are hand-written mirrors of the contract in
 * apps/api-worker/openapi/openapi.json. Keep them in step with it — a field added there is a field added
 * here, and nowhere else in this app.
 *
 * Every call resolves rather than throws. A caller has three outcomes to render — the value, a
 * server that answered with a problem document, and nothing answering at all — and collapsing the
 * last two into one `catch` loses the only distinction that changes what a person should do about it.
 */

/** How a document's latest version came out of the ingest gate. */
export type DocumentStatus = "clean" | "pending" | "quarantined";

export interface DocumentSummary {
  id: string;
  matterId: string;
  folderId: string | null;
  name: string;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  versionNumber: number;
  sizeBytes: number | null;
  sniffedContentType: string | null;
  status: DocumentStatus;
  quarantineReason: string | null;
}

export interface DocumentVersion {
  id: string;
  versionNumber: number;
  sizeBytes: number | null;
  sniffedContentType: string | null;
  contentSha256: string | null;
  committedAt: string | null;
}

export interface TemplateSummary {
  templateId: string;
  name: string;
  description: string | null;
  status: string;
  currentVersionId: string | null;
}

/** The single-shot leg of the upload ceremony. The multipart leg is a separate, larger surface. */
export interface InitiatedUpload {
  mode: "put" | "multipart";
  uploadId: string;
  fileId: string;
  versionId: string;
  key: string;
  /** Present on the single-shot PUT only. */
  url?: string;
  /**
   * The headers the bytes MUST be sent with. They carry the object's dimensions, which the host
   * signed — a PUT that drops one writes an object nothing can place, so they are passed through
   * exactly as received and never edited or filtered here.
   */
  headers?: Record<string, string>;
}

export interface UploadStatus {
  sessionStatus: "open" | "completed" | "aborted" | "expired";
  versionStatus: "pending" | "clean" | "quarantined" | "abandoned";
  quarantineReason: string | null;
}

export interface SubmittedAssembly {
  assemblyId: string;
  status: "queued";
}

/**
 * What an assembly files. The merge always produces a word-processing document; "pdf" asks the host
 * to convert it before filing, in the same job. The platform seal takes a PDF and nothing else, so a
 * document meant to be signed is built as one rather than converted afterwards.
 */
export type AssemblyOutputFormat = "docx" | "pdf";

export interface AssemblyStatus {
  assemblyId: string;
  status: "queued" | "running" | "done" | "failed";
  outcome: string | null;
  /** What the job set out to produce — answerable before the document lands, and after one failed. */
  outputFormat: AssemblyOutputFormat;
  fileId: string | null;
  fileVersionId: string | null;
  /** Merge-field KEYS the matter could not supply — never a value a client's record held. */
  absentFieldKeys: readonly string[];
  /** Word merge fields the template still carries, which print stale cached text. Names only. */
  frozenMergeFieldNames: readonly string[];
  reason: string | null;
}

export interface EditSessionLaunch {
  editorUrl: string;
  editorOrigin: string;
  accessToken: string;
  accessTokenTtl: number;
  capability: "edit" | "view";
  /**
   * Whether the firm's policy has this document record its changes. When it does, the screen
   * framing the editor turns the showing of the marks off once the document is up.
   */
  recordsChanges: boolean;
}

export function listMatterDocuments(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<{ data: DocumentSummary[]; nextCursor: string | null }>> {
  // Pending and quarantined rows are asked for deliberately. A document still being scanned, and one
  // the scanner rejected, must both read as themselves where the person put them — a file that
  // silently never appears is the worse failure.
  const query = new URLSearchParams({
    matterId,
    includePendingAndQuarantined: "true",
  });
  return requestJson(fetchImpl, `/api/v1/files?${query.toString()}`);
}

export function listDocumentVersions(
  fetchImpl: typeof fetch,
  fileId: string,
): Promise<ApiOutcome<{ data: DocumentVersion[] }>> {
  return requestJson(fetchImpl, `/api/v1/files/${encodeURIComponent(fileId)}/versions`);
}

export function listTemplates(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: TemplateSummary[]; nextCursor: string | null }>> {
  return requestJson(fetchImpl, "/api/v1/templates");
}

export interface InitiateUploadInput {
  readonly matterId: string;
  readonly name: string;
  readonly declaredSize: number | null;
  readonly declaredContentType: string | null;
  /** Present = a new version on an existing document; absent = a new document. */
  readonly fileId?: string;
}

export function initiateUpload(
  fetchImpl: typeof fetch,
  input: InitiateUploadInput,
  idempotencyKey: string,
): Promise<ApiOutcome<InitiatedUpload>> {
  return requestJson(fetchImpl, "/api/v1/uploads", {
    method: "POST",
    body: input,
    idempotencyKey,
  });
}

/** One part of a multipart upload, as the storage acknowledged it: its number and its ETag. */
export interface UploadedPart {
  readonly partNumber: number;
  readonly etag: string;
}

/**
 * Close the session. A single-shot PUT sends no manifest (its object already exists); a multipart
 * session sends every part's number and ETag, which is what the storage assembles the object from.
 */
export function completeUpload(
  fetchImpl: typeof fetch,
  uploadId: string,
  idempotencyKey: string,
  parts?: readonly UploadedPart[],
): Promise<ApiOutcome<{ key: string; location: string }>> {
  return requestJson(fetchImpl, `/api/v1/uploads/${encodeURIComponent(uploadId)}/complete`, {
    method: "POST",
    body: parts === undefined ? {} : { parts },
    idempotencyKey,
  });
}

/** What the firm already holds of a file's bytes, asked by digest and size before an upload. */
export interface UploadMatches {
  /** Live files on the target matter whose current version is these bytes. */
  readonly onMatter: readonly {
    readonly fileId: string;
    readonly versionId: string;
    readonly folderId: string | null;
    readonly name: string;
  }[];
  /** Live files elsewhere in the firm with these bytes; one can be duplicated with no upload. */
  readonly elsewhere: readonly {
    readonly fileId: string;
    readonly versionId: string;
    readonly matterId: string;
  }[];
}

export function findUploadMatches(
  fetchImpl: typeof fetch,
  input: { matterId: string; sha256: string; sizeBytes: number },
  signal?: AbortSignal,
): Promise<ApiOutcome<UploadMatches>> {
  return requestJson(fetchImpl, "/api/v1/uploads/matches", {
    method: "POST",
    body: input,
    ...(signal === undefined ? {} : { signal }),
  });
}

/** A new file on a matter, made server-side from a committed version the firm already holds. */
export function duplicateHeldVersion(
  fetchImpl: typeof fetch,
  input: {
    sourceVersionId: string;
    matterId: string;
    folderId: string | null;
    name: string;
    documentTypeId?: string | null;
    sourceModifiedAt?: string | null;
    createdAtBasis?: "upload" | "source";
  },
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ApiOutcome<{ fileId: string; versionId: string }>> {
  return requestJson(fetchImpl, "/api/v1/uploads/duplicates", {
    method: "POST",
    body: input,
    idempotencyKey,
    ...(signal === undefined ? {} : { signal }),
  });
}

/** A signed URL for one part of an open multipart session, minted fresh per part. */
export function signUploadPart(
  fetchImpl: typeof fetch,
  uploadId: string,
  partNumber: number,
): Promise<ApiOutcome<{ url: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/uploads/${encodeURIComponent(uploadId)}/parts/${String(partNumber)}`,
  );
}

export function readUploadStatus(
  fetchImpl: typeof fetch,
  uploadId: string,
): Promise<ApiOutcome<UploadStatus>> {
  return requestJson(fetchImpl, `/api/v1/uploads/${encodeURIComponent(uploadId)}`);
}

export function submitAssembly(
  fetchImpl: typeof fetch,
  matterId: string,
  templateVersionId: string,
  outputFormat: AssemblyOutputFormat,
  idempotencyKey: string,
): Promise<ApiOutcome<SubmittedAssembly>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/assemblies`, {
    method: "POST",
    body: { templateVersionId, outputFormat },
    idempotencyKey,
  });
}

export function readAssemblyStatus(
  fetchImpl: typeof fetch,
  matterId: string,
  assemblyId: string,
): Promise<ApiOutcome<AssemblyStatus>> {
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/assemblies/${encodeURIComponent(assemblyId)}`,
  );
}

export function openEditSession(
  fetchImpl: typeof fetch,
  fileId: string,
): Promise<ApiOutcome<EditSessionLaunch>> {
  return requestJson(fetchImpl, `/api/v1/documents/${encodeURIComponent(fileId)}/edit-session`, {
    method: "POST",
  });
}

/** What a storage write answers with: the ETag the storage gave the bytes, when it exposed one. */
export interface PutUploadResult {
  readonly etag: string | null;
}

export interface PutUploadOptions {
  /**
   * Bytes sent so far, and the total, as the browser reports them while the request body goes out.
   * Given, the write runs on XMLHttpRequest — the one browser transport that reports upload
   * progress; `fetch` has no such event — and falls back to `fetch` where XMLHttpRequest is absent
   * (a test in Node). Omitted, the write is a plain fetch.
   */
  readonly onProgress?: (sentBytes: number, totalBytes: number) => void;
  /** Abandons the write. An aborted write resolves as `transport`, like any other that produced no response. */
  readonly signal?: AbortSignal;
  /** The XMLHttpRequest constructor to use. A seam for tests; the browser's own otherwise. */
  readonly xhr?: () => XMLHttpRequestLike;
}

/** The slice of XMLHttpRequest the progress transport uses, narrowed so a test can stand in for it. */
export interface XMLHttpRequestLike {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
  abort(): void;
  getResponseHeader(name: string): string | null;
  readonly status: number;
  upload: {
    onprogress:
      | ((event: { loaded: number; total: number; lengthComputable: boolean }) => void)
      | null;
  };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

// The signed URL is never the request line: it carries the signature, an expiry and the object
// key as query parameters, and this line is built to be copied into a report.
const PUT_LINE = "PUT (presigned object storage)";

/**
 * PUT the bytes at the URL the host signed. This leg does NOT go through `requestJson`: it is an
 * object-storage write, not an API call — no session cookie belongs on it, the body is the raw file,
 * and what the caller needs back is whether the bytes landed and, for a multipart part, the ETag
 * the storage gave them.
 */
export async function putUploadBytes(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: Blob,
  options: PutUploadOptions = {},
): Promise<ApiOutcome<PutUploadResult>> {
  const sent = signedHeaders(headers);
  const xhrAvailable =
    options.xhr !== undefined || typeof globalThis.XMLHttpRequest !== "undefined";
  if (options.onProgress !== undefined && xhrAvailable) {
    return putWithProgress(url, sent, body, options);
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "PUT",
      headers: sent,
      body,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch {
    return transportOutcome(PUT_LINE);
  }
  if (!response.ok) return problemOutcome({ status: response.status }, PUT_LINE);
  return { kind: "ok", value: { etag: response.headers.get("ETag") } };
}

/*
 * The progress-reporting write. XMLHttpRequest sends no cookies to a cross-origin URL unless asked
 * (it is not asked), sets exactly the headers it is given, and fires `upload.onprogress` as the body
 * leaves — which is the whole reason it is here. A Blob body with no type sets no Content-Type of
 * its own, so a part's unsigned PUT goes out with exactly the headers the caller passed.
 */
function putWithProgress(
  url: string,
  headers: Record<string, string>,
  body: Blob,
  options: PutUploadOptions,
): Promise<ApiOutcome<PutUploadResult>> {
  return new Promise((resolve) => {
    const request = options.xhr?.() ?? (new XMLHttpRequest() as unknown as XMLHttpRequestLike);
    const { signal, onProgress } = options;
    if (signal?.aborted === true) {
      resolve(transportOutcome(PUT_LINE));
      return;
    }
    const abort = (): void => request.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const settle = (outcome: ApiOutcome<PutUploadResult>): void => {
      signal?.removeEventListener("abort", abort);
      resolve(outcome);
    };
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
      else onProgress?.(event.loaded, body.size);
    };
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        settle(problemOutcome({ status: request.status }, PUT_LINE));
        return;
      }
      onProgress?.(body.size, body.size);
      settle({ kind: "ok", value: { etag: request.getResponseHeader("ETag") } });
    };
    request.onerror = () => settle(transportOutcome(PUT_LINE));
    request.onabort = () => settle(transportOutcome(PUT_LINE));
    request.send(body);
  });
}

/**
 * The header set as one name per header. HTTP header names are case-insensitive and a record is
 * not, so a record carrying "Content-Type" and "content-type" is two entries that the browser's
 * Headers merges into one doubled value — and a doubled value is not the value the storage
 * signature covers, so the write is refused. The host now answers one spelling; this collapses any
 * that slip through, keeping the later spelling the way Headers would have kept the later value.
 */
export function signedHeaders(headers: Record<string, string>): Record<string, string> {
  const byName: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) byName[name.toLowerCase()] = value;
  return byName;
}

/**
 * Give a reservation back. The version it reserved is abandoned and its session closed, so a file
 * whose bytes never landed does not survive as a row with nothing behind it. Idempotent from the
 * caller's side: a session already closed answers a conflict, and that is not a failure to report.
 */
export function abortUpload(
  fetchImpl: typeof fetch,
  uploadId: string,
): Promise<ApiOutcome<{ status: "aborted" }>> {
  return requestJson(fetchImpl, `/api/v1/uploads/${encodeURIComponent(uploadId)}/abort`, {
    method: "POST",
    body: {},
  });
}

/**
 * Where the caller's current open of a document has got to, as the host saw the editor's own
 * calls back to it. The editor asks the host what the document is (CheckFileInfo) and then for its
 * bytes (GetFile) from inside its container, out of the browser's sight, so the marks here are the
 * only way the screen framing the editor can tell those two stages apart. Every mark is null when no
 * launch of this document is on record for the caller.
 */
export interface EditOpenProgress {
  launchedAt: string | null;
  checkFileInfoAt: string | null;
  getFileAt: string | null;
  /** The editor's most recent call and what it was told, refusals included. */
  lastCallback: {
    operation: string;
    status: number;
    errorId: string | null;
    at: string;
  } | null;
}

export function readEditOpenProgress(
  fetchImpl: typeof fetch,
  fileId: string,
): Promise<ApiOutcome<EditOpenProgress>> {
  return requestJson(
    fetchImpl,
    `/api/v1/documents/${encodeURIComponent(fileId)}/edit-session/progress`,
  );
}
