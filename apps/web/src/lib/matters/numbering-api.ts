/*
 * The numbering surface, as this app calls it: the firm's active scheme for each of its two
 * sequences, replacing one, previewing a candidate against a sample matter, and setting one
 * matter's number by hand. Shapes are spelled here rather than imported from the generated client,
 * the same way every other module in this directory keeps its own reading of the contract.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";
import type {
  NumberingPurpose,
  NumberingSampleContext,
  NumberSegment,
} from "./numbering-scheme.ts";

export interface NumberingSchemeRecord {
  /** The active template, or null where the firm has configured nothing and no default applies. */
  segments: NumberSegment[] | null;
  purpose: NumberingPurpose;
  /** True where the segments are the built-in consultation sequence rendering until the firm sets its own. */
  usingDefault: boolean;
}

export function readNumberingScheme(
  fetchImpl: typeof fetch,
  purpose: NumberingPurpose,
): Promise<ApiOutcome<NumberingSchemeRecord>> {
  return requestJson(fetchImpl, `/api/v1/numbering-scheme?purpose=${purpose}`);
}

/**
 * Replace the firm's scheme for one purpose. Numbers already drawn are frozen; the new template
 * reaches only the matters numbered after it. Audited server-side, so the change is on the record.
 */
export function setNumberingScheme(
  fetchImpl: typeof fetch,
  purpose: NumberingPurpose,
  segments: readonly NumberSegment[],
  idempotencyKey: string,
): Promise<ApiOutcome<{ segments: NumberSegment[]; purpose?: NumberingPurpose }>> {
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

/** Render a candidate against the sample matter. Pure on the server: nothing is drawn or written. */
export function previewNumberingScheme(
  fetchImpl: typeof fetch,
  segments: readonly NumberSegment[],
  context: NumberingSampleContext,
  counterValue = 1,
): Promise<ApiOutcome<NumberingPreview>> {
  return requestJson(fetchImpl, "/api/v1/numbering-scheme/preview", {
    method: "POST",
    body: { segments, counterValue, context },
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
