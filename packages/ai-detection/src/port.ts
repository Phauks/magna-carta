import type { Dispatch } from "@magna-carta/integrations/dispatch";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { DetectionReport } from "./report.ts";

// The port is named in OUR domain vocabulary, never a vendor's request/response shape. firmId is
// carried for tenancy and future per-firm metering (the InferencePort precedent), never on a
// connection object.
export interface DetectionInput {
  readonly text: string;
  readonly languageHint?: string; // BCP-47; informs caveats, never required
  readonly firmId: FirmId;
}

// A vendor adapter's normalized-but-unframed output. The agnostic normalizer turns this into a
// DetectionReport; the framing (band/reliability/caveats) is OURS, not the vendor's.
export interface RawSegment {
  readonly startCharacter: number;
  readonly endCharacter: number;
  readonly score: number; // 0..1
}

export interface RawDetection {
  readonly score: number; // 0..1 probability the text is machine-generated
  readonly vendorConfidence?: number; // 0..1, the vendor's own confidence if it reports one
  readonly vendorModel?: string;
  readonly vendorVersion?: string;
  readonly segments?: readonly RawSegment[];
  readonly signals?: {
    readonly paraphraseSuspected?: boolean;
    readonly mixedAuthorship?: boolean;
  };
}

export interface AiTextDetectionPort {
  detect(input: DetectionInput): Promise<Dispatch<DetectionReport>>;
}
