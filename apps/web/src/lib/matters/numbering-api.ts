/*
 * The numbering surface, as this app calls it: every number the firm issues from the one register,
 * the firm's active scheme for one purpose, replacing one, previewing a candidate against the
 * sample record, and setting one matter's number by hand. Shapes are spelled here rather than
 * imported from the generated client, the same way every other module in this directory keeps its
 * own reading of the contract.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";
import type {
  NumberingPurposeRecord,
  NumberingSampleContext,
  NumberSegment,
  SchemeNumberingPurpose,
} from "./numbering-scheme.ts";

export interface NumberingSchemesListing {
  /** Every purpose, in the order the screen lists them. */
  purposes: NumberingPurposeRecord[];
  /** The sample every example was rendered against; the editor previews against the same one. */
  sample: NumberingSampleContext;
}

/** Every number the firm issues, with what is in force for each. */
export function readNumberingSchemes(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<NumberingSchemesListing>> {
  return requestJson(fetchImpl, "/api/v1/numbering-schemes");
}

export interface NumberingSchemeRecord {
  /** The active template, or null where the firm has configured nothing and no default applies. */
  segments: NumberSegment[] | null;
  purpose: SchemeNumberingPurpose;
  /** True where the segments are the built-in sequence rendering until the firm sets its own. */
  usingDefault: boolean;
}

export function readNumberingScheme(
  fetchImpl: typeof fetch,
  purpose: SchemeNumberingPurpose,
): Promise<ApiOutcome<NumberingSchemeRecord>> {
  return requestJson(fetchImpl, `/api/v1/numbering-scheme?purpose=${purpose}`);
}

/**
 * Replace the firm's scheme for one purpose. Numbers already drawn are frozen; the new template
 * reaches only the matters numbered after it. Audited server-side, so the change is on the record.
 */
export function setNumberingScheme(
  fetchImpl: typeof fetch,
  purpose: SchemeNumberingPurpose,
  segments: readonly NumberSegment[],
  idempotencyKey: string,
): Promise<ApiOutcome<{ segments: NumberSegment[]; purpose?: SchemeNumberingPurpose }>> {
  return requestJson(fetchImpl, "/api/v1/numbering-scheme", {
    method: "PUT",
    idempotencyKey,
    body: { segments, purpose },
  });
}

export interface NumberingPreview {
  number: string;
  /** The counter scope the sample falls in: empty for a firm-wide count. */
  scopeKey: string;
}

/**
 * Render a candidate against the sample record. Pure on the server: nothing is drawn or written.
 * Named for its purpose so a part the sequence cannot use is refused here, beside the list.
 */
export function previewNumberingScheme(
  fetchImpl: typeof fetch,
  purpose: SchemeNumberingPurpose,
  segments: readonly NumberSegment[],
  context: NumberingSampleContext,
  counterValue = 1,
): Promise<ApiOutcome<NumberingPreview>> {
  return requestJson(fetchImpl, "/api/v1/numbering-scheme/preview", {
    method: "POST",
    body: { segments, purpose, counterValue, context },
  });
}

/**
 * Set one matter's number by hand: a court's number, a legacy number, a correction. Touches no
 * counter. The server refuses a number another matter already wears (409) and one that cannot
 * stand in a link (422).
 */
export function renumberMatter(
  fetchImpl: typeof fetch,
  matterId: string,
  matterNumber: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ matterId: string }>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/renumber`, {
    method: "POST",
    idempotencyKey,
    body: { matterNumber },
  });
}

/** The permissions the numbering endpoints name. */
export const MANAGE_NUMBERING_PERMISSION = "matters:manageNumbering";
export const RENUMBER_MATTER_PERMISSION = "matters:renumber";
