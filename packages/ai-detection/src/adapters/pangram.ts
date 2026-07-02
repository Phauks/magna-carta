import { adapterError, ok, type Dispatch } from "@magna-carta/integrations/dispatch";
import type { HttpClient } from "@magna-carta/integrations/http";
import { integrationProblem } from "@magna-carta/integrations/problem";
import type { AiTextDetectionPort, DetectionInput, RawDetection, RawSegment } from "../port.ts";
import type { DetectionReport } from "../report.ts";
import { normalize } from "../normalize.ts";
import { parsePangramResponse, type PangramPrediction } from "./pangram-response.ts";

// The platform-managed Pangram adapter. It calls Pangram over the injected HttpClient (the pure
// package never touches the network itself), validates the response at the boundary, maps it to the
// vendor-neutral RawDetection, and hands that to normalize() — the framing (band/reliability/caveats)
// is ours. The API key is injected at construction (a platform secret, not a per-firm credential), so
// the adapter declares no connection. Errors surface as an adapter-error dispatch whose detail never
// echoes the analyzed text or any raw upstream response body.
export interface PangramAdapterConfig {
  readonly http: HttpClient;
  readonly apiKey: string;
  readonly baseUrl: string; // e.g. https://text.api.pangram.com — a binding, not a code constant
  readonly now: () => string; // ISO-8601 instant; the pure core never calls Date.now()
}

const ADAPTER_ID = "pangram";
const EGRESSED_TO = "pangram";

function toSegments(prediction: PangramPrediction): readonly RawSegment[] | undefined {
  if (prediction.windows === undefined) return undefined;
  return prediction.windows.map((window) => ({
    startCharacter: window.start_index,
    endCharacter: window.end_index,
    score: window.ai_assistance_score,
  }));
}

// The lowest per-window confidence is the adapter's vendorConfidence: one weak window undercuts the
// whole result, which is the conservative reading the caveat layer wants.
function minWindowConfidence(prediction: PangramPrediction): number | undefined {
  const confidences = (prediction.windows ?? [])
    .map((window) => window.confidence)
    .filter((value): value is number => value !== undefined);
  return confidences.length > 0 ? Math.min(...confidences) : undefined;
}

function toRawDetection(prediction: PangramPrediction): RawDetection {
  const vendorConfidence = minWindowConfidence(prediction);
  const segments = toSegments(prediction);
  const paraphraseSuspected =
    prediction.fraction_ai_assisted !== undefined && prediction.fraction_ai_assisted > 0;
  return {
    score: prediction.fraction_ai,
    ...(vendorConfidence !== undefined ? { vendorConfidence } : {}),
    ...(prediction.version !== undefined ? { vendorModel: prediction.version } : {}),
    ...(prediction.stage !== undefined ? { vendorVersion: prediction.stage } : {}),
    ...(segments !== undefined ? { segments } : {}),
    ...(paraphraseSuspected ? { signals: { paraphraseSuspected: true } } : {}),
  };
}

export function createPangramAdapter(config: PangramAdapterConfig): AiTextDetectionPort {
  return {
    async detect(input: DetectionInput): Promise<Dispatch<DetectionReport>> {
      let status: number;
      let body: unknown;
      try {
        const response = await config.http.request({
          method: "POST",
          url: `${config.baseUrl}/predict`,
          headers: {
            "content-type": "application/json",
            "x-api-key": config.apiKey,
          },
          body: JSON.stringify({ text: input.text, public_dashboard_link: false }),
        });
        status = response.status;
        body = await response.json();
      } catch {
        // A transport failure carries nothing caller-safe from the request; never include the text.
        return adapterError(
          integrationProblem("network", 502, "Detection provider unreachable", {
            detail: "The detection provider could not be reached.",
          }),
        );
      }
      if (status < 200 || status >= 300) {
        return adapterError(
          integrationProblem("upstream", 502, "Detection provider error", {
            detail: `The detection provider returned status ${status}.`,
          }),
        );
      }
      const prediction = parsePangramResponse(body);
      if (prediction === null) {
        return adapterError(
          integrationProblem("upstream", 502, "Unexpected detection response", {
            detail: "The detection provider returned an unexpected response shape.",
          }),
        );
      }
      return ok(
        normalize(input, toRawDetection(prediction), {
          adapterId: ADAPTER_ID,
          detectedAt: config.now(),
          egressedTo: EGRESSED_TO,
        }),
      );
    },
  };
}
