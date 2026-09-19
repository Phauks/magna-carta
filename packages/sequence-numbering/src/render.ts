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
    case "date_opened":
      return context.openedDate.replace(/-/g, "");
    case "location_code":
      return required(context.locationCode, "location_code");
    case "matter_type_code":
      return required(context.matterTypeCode, "matter_type_code");
    case "client_code":
      return required(context.clientCode, "client_code");
    case "staff_initials":
      return required(context.staffInitials, "staff_initials");
    case "client_name":
      return required(context.clientName, "client_name");
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
  return segments
    .map((segment) =>
      segment.kind === "counter"
        ? String(counterValue).padStart(segment.padWidth, "0")
        : renderValueSegment(segment, context),
    )
    .join("");
}
