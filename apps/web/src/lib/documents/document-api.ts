/*
 * The Documents surface's transport seam — every call this screen makes into the API, in one place,
 * out of the components so the branching is unit-testable without a DOM.
 *
 * These are same-origin `fetch` calls against the relative `/api/v1` paths, matching the WHOIS tool
 * (apps/web/src/lib/tools/whois/whois-lookup.ts) and the speed test: `apps/web` does not depend on
 * @magna-carta/api-client, so the response shapes below are hand-written mirrors of the contract in
 * apps/worker/openapi/openapi.json. Keep them in step with it — a field added there is a field added
 * here, and nowhere else in this app.
 *
 * Every call resolves rather than throws. A caller has three outcomes to render — the value, a
 * server that answered with a problem document, and nothing answering at all — and collapsing the
 * last two into one `catch` loses the only distinction that changes what a person should do about it.
 */

/** A failed call surfaced to the user. `errorId` is the correlation handle every problem carries. */
export interface ApiProblem {
  status: number;
  /** The problem document's machine-readable type, when it sent one. */
  type?: string;
  /** The human-readable detail, when it sent one. Server-authored — never a raw exception. */
  detail?: string;
  errorId?: string;
}

export type ApiOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "problem"; problem: ApiProblem }
  | { kind: "transport" };

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
}

// Read the correlation handle and the server's own words off a problem document. Defensive: a body
// that is not JSON still yields a usable problem carrying the HTTP status.
async function readProblem(response: Response): Promise<ApiProblem> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    return {
      status: response.status,
      type: typeof body.type === "string" ? body.type : undefined,
      detail: typeof body.detail === "string" ? body.detail : undefined,
      errorId: typeof body.errorId === "string" ? body.errorId : undefined,
    };
  } catch {
    return { status: response.status };
  }
}

interface JsonRequest {
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
  /**
   * The idempotency key for a write the contract requires one on. A retried submit must not file a
   * second document, and the server rejects the call outright when the header is absent.
   */
  readonly idempotencyKey?: string;
}

/** The one place a `/api/v1` call is made. Never throws; a dead transport is its own outcome. */
export async function requestJson<T>(
  fetchImpl: typeof fetch,
  path: string,
  request: JsonRequest = {},
): Promise<ApiOutcome<T>> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (request.body !== undefined) headers["content-type"] = "application/json";
  if (request.idempotencyKey !== undefined) headers["idempotency-key"] = request.idempotencyKey;

  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: request.method ?? "GET",
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
  } catch {
    return { kind: "transport" };
  }

  if (!response.ok) return { kind: "problem", problem: await readProblem(response) };

  try {
    return { kind: "ok", value: (await response.json()) as T };
  } catch {
    return { kind: "transport" };
  }
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

export function completeUpload(
  fetchImpl: typeof fetch,
  uploadId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ key: string; location: string }>> {
  return requestJson(fetchImpl, `/api/v1/uploads/${encodeURIComponent(uploadId)}/complete`, {
    method: "POST",
    body: {},
    idempotencyKey,
  });
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

/**
 * PUT the bytes at the URL the host signed. This leg does NOT go through `requestJson`: it is an
 * object-storage write, not an API call — no session cookie belongs on it, the body is the raw file,
 * and the only thing the caller needs back is whether the bytes landed.
 */
export async function putUploadBytes(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: Blob,
): Promise<ApiOutcome<null>> {
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "PUT", headers, body });
  } catch {
    return { kind: "transport" };
  }
  if (!response.ok) return { kind: "problem", problem: { status: response.status } };
  return { kind: "ok", value: null };
}
