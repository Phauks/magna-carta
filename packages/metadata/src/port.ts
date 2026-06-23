import type { MetadataReport } from "./model.ts";
import type { ScrubOptions } from "./options.ts";

export interface MetadataInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
}

export type MetadataFailure = "unsupported-format" | "too-large" | "corrupt" | "decompression-bomb";

export type InspectOutcome =
  | { readonly ok: true; readonly report: MetadataReport }
  | { readonly ok: false; readonly reason: MetadataFailure; readonly detail?: string };

export type ScrubOutcome =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly mediaType: string;
      readonly report: MetadataReport; // re-inspection of the OUTPUT, so the caller can confirm clean
    }
  | { readonly ok: false; readonly reason: MetadataFailure; readonly detail?: string };

export interface MetadataPort {
  inspect(input: MetadataInput): Promise<InspectOutcome>;
  scrub(input: MetadataInput, options: ScrubOptions): Promise<ScrubOutcome>;
}
