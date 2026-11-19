import type { FormatId } from "./format.ts";
import type { ConversionOptions } from "./options.ts";

export interface ConversionInput {
  readonly bytes: Uint8Array;
  readonly from: FormatId;
  readonly to: FormatId;
  readonly recipeRef: string;
  /**
   * The member's choices for this hop (./options.ts). Only the final hop of a path carries them,
   * and only the options its engine accepts; an engine that reads none never receives any.
   */
  readonly options?: ConversionOptions;
}

// A typed outcome, never a thrown error (the integrations Dispatch pattern). `engine-not-implemented`
// is a first-class state because most engines' bodies are deferred to the execution substrate.
export type ConversionResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly mediaType: string }
  | {
      readonly ok: false;
      readonly reason: "engine-not-implemented" | "unsupported-edge" | "adapter-error";
      readonly detail?: string;
    };

export interface ConversionPort {
  convert(input: ConversionInput): Promise<ConversionResult>;
}

export function converted(bytes: Uint8Array, mediaType: string): ConversionResult {
  return { ok: true, bytes, mediaType };
}

export function engineNotImplemented(): ConversionResult {
  return { ok: false, reason: "engine-not-implemented" };
}

export function unsupportedEdge(detail?: string): ConversionResult {
  return detail !== undefined
    ? { ok: false, reason: "unsupported-edge", detail }
    : { ok: false, reason: "unsupported-edge" };
}

export function adapterError(detail: string): ConversionResult {
  return { ok: false, reason: "adapter-error", detail };
}
