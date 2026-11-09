import type { NumberSegment } from "./segments.ts";

// Render-time refusal: a segment references a context value the record does not carry (e.g. a
// location-scoped scheme on a matter with no Location and no firm default). Callers branch on `code`.
export type NumberingRenderCode = "scheme-segment-value-missing";

export class NumberingRenderError extends Error {
  constructor(
    readonly code: NumberingRenderCode,
    message: string,
  ) {
    super(message);
    this.name = "NumberingRenderError";
  }
}

// Plain strings the handler assembles from the record being numbered — a matter, its Location, type
// and client; a conflicts check or a custody packet supplies only the date. The renderer takes no
// database binding and reads no clock: every date segment is derived from openedDate, the civil date
// the record was numbered on (the day a matter opened, a check was opened, a packet was logged).
export interface RenderContext {
  readonly openedDate: string; // ISO civil date YYYY-MM-DD
  /**
   * The number of the matter the record belongs to, for a sequence that counts within one — a time
   * entry is read against its matter, so it carries that matter's number. Absent for a record that
   * belongs to no matter.
   */
  readonly matterNumber?: string;
  /**
   * The office, practice area, client and attorney a MATTER carries. On the invoice run the
   * location code is the letterhead scope the bill was finalized under, which is what a
   * multi-letterhead firm means by its office.
   */
  readonly locationCode?: string;
  readonly matterTypeCode?: string;
  readonly clientCode?: string;
  readonly staffInitials?: string;
  readonly clientName?: string;
}

// Fold to URL-safe: decompose accented forms and drop the combining marks (é -> e), expand the few
// common ligatures the decomposition misses, drop whitespace, then strip anything still outside the
// unreserved set. Guarantees the rendered number stays URL-safe regardless of the source value.
function sanitizeUrlSafe(value: string): string {
  return value
    .replace(/Æ/g, "Ae")
    .replace(/æ/g, "ae")
    .replace(/Œ/g, "Oe")
    .replace(/œ/g, "oe")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9._~-]/g, "");
}

// A name's words, each folded to URL-safe on its own and joined by the part's separator. A word that
// folds to nothing ("&" in "Smith & Jones") is dropped rather than leaving two separators side by
// side. With no separator this is exactly the old whole-string fold, which also dropped whitespace.
function joinWords(value: string | undefined, separator: string): string | undefined {
  if (value === undefined) return undefined;
  return value
    .split(/\s+/)
    .map(sanitizeUrlSafe)
    .filter((word) => word.length > 0)
    .join(separator);
}

// Resolve a non-counter segment to its rendered string, or throw when a referenced value is absent
// or sanitizes to nothing — an empty segment would yield a malformed, ambiguous number.
function renderValueSegment(segment: NumberSegment, context: RenderContext): string {
  const required = (value: string | undefined, label: string): string => {
    const rendered = value === undefined ? "" : sanitizeUrlSafe(value);
    if (rendered.length === 0) {
      throw new NumberingRenderError(
        "scheme-segment-value-missing",
        `the ${label} segment has no value for this record`,
      );
    }
    return rendered;
  };
  switch (segment.kind) {
    case "literal":
      return segment.text;
    case "year":
      return segment.digits === 2 ? context.openedDate.slice(2, 4) : context.openedDate.slice(0, 4);
    case "month":
      return context.openedDate.slice(5, 7);
    case "day":
      return context.openedDate.slice(8, 10);
    case "date_opened":
      return context.openedDate.split("-").join(segment.separator ?? "");
    case "matter_number":
      return required(context.matterNumber, "matter_number");
    case "location_code":
      return required(context.locationCode, "location_code");
    case "matter_type_code":
      return required(context.matterTypeCode, "matter_type_code");
    case "client_code":
      return required(context.clientCode, "client_code");
    case "staff_initials":
      return required(context.staffInitials, "staff_initials");
    case "client_name":
      return required(joinWords(context.clientName, segment.separator ?? ""), "client_name");
    case "counter":
      throw new Error("renderValueSegment received a counter segment"); // unreachable — handled in render
  }
}

// The scope key is the joined rendered values of the scoping-marked segments, in template order,
// ':'-separated (rendered values are URL-safe, so ':' cannot appear in them). Empty string = the
// firm-wide scope. Counter and literal segments are never scoping.
export function deriveScopeKey(segments: readonly NumberSegment[], context: RenderContext): string {
  return segments
    .filter((segment) => "scoping" in segment && segment.scoping === true)
    .map((segment) => renderValueSegment(segment, context))
    .join(":");
}

// Render the full number for a drawn counter value. Counter is zero-padded to padWidth and never
// truncated (a wider value renders in full — the padding is a floor on the width, not a ceiling on
// the run, so no sequence ever "runs out"); every other segment resolves through renderValueSegment.
export function renderNumber(
  segments: readonly NumberSegment[],
  context: RenderContext,
  counterValue: number,
): string {
  return renderParts(segments, context, counterValue).join("");
}

// The same render, part by part rather than joined. The settings editor states what each part of a
// scheme will put into the number, and it has to be THIS renderer that says so: a second answer
// composed on the screen is a second renderer, and the one that draws real numbers is this one.
export function renderParts(
  segments: readonly NumberSegment[],
  context: RenderContext,
  counterValue: number,
): string[] {
  return segments.map((segment) =>
    segment.kind === "counter"
      ? String(counterValue).padStart(segment.padWidth, "0")
      : renderValueSegment(segment, context),
  );
}
