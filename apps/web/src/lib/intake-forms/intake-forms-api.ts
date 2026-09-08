/*
 * The public intake form's response shapes and calls. Mirrors the `intakeForms.*` operations in
 * apps/api-worker/openapi/openapi.json; the transport envelope lives in $lib/api/request.ts.
 *
 * TWO SURFACES, AND ONLY ONE OF THEM CARRIES A SESSION. The firm's calls go through `requestJson`
 * like every other authenticated screen. The two public calls do not: they are reached by a stranger
 * with no cookie, on a page served outside the app shell, so they use `fetch` directly and read the
 * problem body themselves. Nothing here may quietly send a credential to them.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** What a question collects. A closed platform vocabulary; this list mirrors the server's. */
export const INTAKE_FORM_FIELD_KINDS = [
  "person-name",
  "organization-name",
  "email",
  "telephone",
  "postal-address",
  "matter-description",
  "choice",
  "question",
] as const;
export type IntakeFormFieldKind = (typeof INTAKE_FORM_FIELD_KINDS)[number];

export type IntakeFormStatus = "draft" | "published" | "closed";
export type TriageState = "new" | "accepted" | "declined" | "spam";

export const MANAGE_INTAKE_FORMS_PERMISSION = "intakeForms:manage";
export const READ_INTAKE_SUBMISSIONS_PERMISSION = "intakeForms:readSubmissions";

export interface IntakeFormField {
  id: string;
  kind: IntakeFormFieldKind;
  label: string;
  helpText: string | null;
  required: boolean;
  options: string[] | null;
  position: number;
}

export interface IntakeFormSummary {
  id: string;
  name: string;
  title: string;
  status: IntakeFormStatus;
  publicToken: string;
  publishedVersionId: string | null;
  submissionBudgetPerDay: number | null;
  hasUnpublishedChanges: boolean;
  waitingSubmissions: number;
  createdAt: string;
  updatedAt: string;
}

export interface IntakeFormDetail extends IntakeFormSummary {
  introduction: string | null;
  confirmationMessage: string | null;
  fields: IntakeFormField[];
}

export interface IntakeFormInput {
  name: string;
  title: string;
  introduction?: string | null;
  confirmationMessage?: string | null;
  submissionBudgetPerDay?: number | null;
}

export interface IntakeFormFieldInput {
  kind: IntakeFormFieldKind;
  label: string;
  helpText?: string | null;
  required?: boolean;
  options?: string[] | null;
}

export interface SubmissionSummary {
  id: string;
  submittedAt: string;
  triageState: TriageState;
  triagedAt: string | null;
  triagedBy: string | null;
  triageNote: string | null;
}

export interface SubmissionAnswer {
  fieldId: string;
  label: string;
  kind: IntakeFormFieldKind;
  /** Null where the visitor left an optional question blank. */
  value: string | null;
}

export interface SubmissionDetail extends SubmissionSummary {
  /** The answers BESIDE the questions as they were asked, from the submission's own version. */
  answers: SubmissionAnswer[];
}

// ---- the firm's calls ----

export function listIntakeForms(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: IntakeFormSummary[] }>> {
  return requestJson(fetchImpl, "/api/v1/intake-forms");
}

export function readIntakeForm(
  fetchImpl: typeof fetch,
  formId: string,
): Promise<ApiOutcome<IntakeFormDetail>> {
  return requestJson(fetchImpl, `/api/v1/intake-forms/${encodeURIComponent(formId)}`);
}

export function createIntakeForm(
  fetchImpl: typeof fetch,
  form: IntakeFormInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/intake-forms", {
    method: "POST",
    body: form,
    idempotencyKey,
  });
}

export function editIntakeForm(
  fetchImpl: typeof fetch,
  formId: string,
  form: IntakeFormInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ acknowledged: true }>> {
  return requestJson(fetchImpl, `/api/v1/intake-forms/${encodeURIComponent(formId)}`, {
    method: "PATCH",
    body: form,
    idempotencyKey,
  });
}

export function addIntakeFormField(
  fetchImpl: typeof fetch,
  formId: string,
  field: IntakeFormFieldInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ acknowledged: true }>> {
  return requestJson(fetchImpl, `/api/v1/intake-forms/${encodeURIComponent(formId)}/fields`, {
    method: "POST",
    body: field,
    idempotencyKey,
  });
}

export function editIntakeFormField(
  fetchImpl: typeof fetch,
  formId: string,
  fieldId: string,
  field: IntakeFormFieldInput,
  idempotencyKey: string,
): Promise<ApiOutcome<{ acknowledged: true }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/intake-forms/${encodeURIComponent(formId)}/fields/${encodeURIComponent(fieldId)}`,
    { method: "PATCH", body: field, idempotencyKey },
  );
}

export function removeIntakeFormField(
  fetchImpl: typeof fetch,
  formId: string,
  fieldId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ acknowledged: true }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/intake-forms/${encodeURIComponent(formId)}/fields/${encodeURIComponent(fieldId)}`,
    { method: "DELETE", idempotencyKey },
  );
}

export function reorderIntakeFormFields(
  fetchImpl: typeof fetch,
  formId: string,
  fieldIds: string[],
  idempotencyKey: string,
): Promise<ApiOutcome<{ acknowledged: true }>> {
  return requestJson(fetchImpl, `/api/v1/intake-forms/${encodeURIComponent(formId)}/field-order`, {
    method: "PUT",
    body: { fieldIds },
    idempotencyKey,
  });
}

/** Freeze the working draft and point the public link at it. After this, strangers can answer it. */
export function publishIntakeForm(
  fetchImpl: typeof fetch,
  formId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ acknowledged: true }>> {
  return requestJson(fetchImpl, `/api/v1/intake-forms/${encodeURIComponent(formId)}/publication`, {
    method: "POST",
    idempotencyKey,
  });
}

/** Take the form off the internet, or put it back. Keeps every question and every submission. */
export function setIntakeFormClosed(
  fetchImpl: typeof fetch,
  formId: string,
  closed: boolean,
  idempotencyKey: string,
): Promise<ApiOutcome<{ acknowledged: true }>> {
  return requestJson(fetchImpl, `/api/v1/intake-forms/${encodeURIComponent(formId)}/closed`, {
    method: "PUT",
    body: { closed },
    idempotencyKey,
  });
}

/** Mint a new link. EVERY LINK ALREADY HANDED OUT STOPS WORKING — the screen says so first. */
export function rotateIntakeFormToken(
  fetchImpl: typeof fetch,
  formId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ publicToken: string }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/intake-forms/${encodeURIComponent(formId)}/token-rotations`,
    { method: "POST", idempotencyKey },
  );
}

export function listIntakeSubmissions(
  fetchImpl: typeof fetch,
  formId: string,
  state?: TriageState,
): Promise<ApiOutcome<{ data: SubmissionSummary[] }>> {
  const suffix = state === undefined ? "" : `?state=${encodeURIComponent(state)}`;
  return requestJson(
    fetchImpl,
    `/api/v1/intake-forms/${encodeURIComponent(formId)}/submissions${suffix}`,
  );
}

export function readIntakeSubmission(
  fetchImpl: typeof fetch,
  formId: string,
  submissionId: string,
): Promise<ApiOutcome<SubmissionDetail>> {
  return requestJson(
    fetchImpl,
    `/api/v1/intake-forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(submissionId)}`,
  );
}

/** Record what a member decided. Accepting creates nothing — it records that somebody looked. */
export function triageIntakeSubmission(
  fetchImpl: typeof fetch,
  formId: string,
  submissionId: string,
  decision: { state: Exclude<TriageState, "new">; note?: string | null },
  idempotencyKey: string,
): Promise<ApiOutcome<{ acknowledged: true }>> {
  return requestJson(
    fetchImpl,
    `/api/v1/intake-forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(submissionId)}/triage`,
    { method: "PUT", body: decision, idempotencyKey },
  );
}

// ---- the public link ----

/**
 * Where a firm's published form lives, as the absolute URL a firm pastes into an email or a website.
 *
 * Built here rather than returned by the server so there is one place the shape is decided, and so a
 * firm reading it in the builder sees exactly what a visitor will open.
 *
 * `/enquiry`, NOT `/intake`: the staff-side Intake desk already holds `/intake` inside the
 * application, and one word cannot address both a member's workspace and a stranger's form. It is
 * also the better word for who reads it — somebody arriving here is making an enquiry, and has no
 * reason to know what the firm calls the process at its end.
 */
export function publicFormUrl(origin: string, firmId: string, publicToken: string): string {
  return `${origin}/enquiry/${encodeURIComponent(firmId)}/${encodeURIComponent(publicToken)}`;
}

export function newWriteKey(): string {
  return crypto.randomUUID();
}
