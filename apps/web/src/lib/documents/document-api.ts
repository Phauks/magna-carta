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
  // The signed URL is never the request line: it carries the signature, an expiry and the object
  // key as query parameters, and this line is built to be copied into a report.
  const line = "PUT (presigned object storage)";
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "PUT", headers, body });
  } catch {
    return transportOutcome(line);
  }
  if (!response.ok) return problemOutcome({ status: response.status }, line);
  return { kind: "ok", value: null };
}
