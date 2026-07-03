import { adapterError, ok, type Dispatch } from "@magna-carta/integrations/dispatch";
import type { HttpClient, HttpResponse } from "@magna-carta/integrations/http";
import { integrationProblem } from "@magna-carta/integrations/problem";
import type { AiTextDetectionPort, DetectionInput, RawDetection, RawSegment } from "../port.ts";
import type { DetectionReport } from "../report.ts";
import { normalize } from "../normalize.ts";
import {
  parsePangramResponse,
  parsePangramSubmit,
  parsePangramTaskStatus,
  type PangramPrediction,
} from "./pangram-response.ts";

// The platform-managed Pangram adapter. It calls Pangram over the injected HttpClient (the pure
// package never touches the network itself), validates the response at the boundary, maps it to the
// vendor-neutral RawDetection, and hands that to normalize() — the framing (band/reliability/caveats)
// is ours. The API key is injected at construction (a platform secret, not a per-firm credential).
// Pangram exposes two surfaces with the SAME request/response fields: an async external-api that
// returns a task to poll, and a synchronous endpoint. `mode` selects which; the poll delay is an
// injected `sleep` so the pure package stays timer-free. Errors surface as an adapter-error dispatch
// whose detail never echoes the analyzed text or any raw upstream response body.
export type PangramMode = "async-task" | "sync";

export interface PangramAdapterConfig {
  readonly http: HttpClient;
  readonly apiKey: string;
  readonly baseUrl: string; // async: the external-api host; sync: the full endpoint (a binding, not a code constant)
  readonly mode: PangramMode;
  readonly now: () => string; // ISO-8601 instant; the pure core never calls Date.now()
  readonly sleep: (milliseconds: number) => Promise<void>; // the pure core never calls setTimeout
  readonly pollIntervalMs?: number;
  readonly maxPollAttempts?: number;
}

const ADAPTER_ID = "pangram";
const EGRESSED_TO = "pangram";
const DEFAULT_POLL_INTERVAL_MS = 750;
const DEFAULT_MAX_POLL_ATTEMPTS = 16;

function jsonHeaders(apiKey: string): Readonly<Record<string, string>> {
  return { "content-type": "application/json", "x-api-key": apiKey };
}

function requestBody(text: string): string {
  return JSON.stringify({ text, public_dashboard_link: false });
}

// The three generic failure problems, built once. Detail is always generic — never the text or an
// upstream body.
function networkProblem() {
  return integrationProblem("network", 502, "Detection provider unreachable", {
    detail: "The detection provider could not be reached.",
  });
}
function upstreamStatusProblem(status: number) {
  return integrationProblem("upstream", 502, "Detection provider error", {
    detail: `The detection provider returned status ${status}.`,
  });
}
function unexpectedResponseProblem() {
  return integrationProblem("upstream", 502, "Unexpected detection response", {
    detail: "The detection provider returned an unexpected response shape.",
  });
}

// A single HTTP round-trip that returns either the decoded JSON body or a typed failure. Centralizes
// the transport-throw / non-2xx / undecodable-body handling shared by submit, poll, and sync.
type FetchResult =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly dispatch: Dispatch<never> };

async function fetchJson(
  http: HttpClient,
  request: { method: "GET" | "POST"; url: string; headers: Readonly<Record<string, string>>; body?: string },
): Promise<FetchResult> {
  let response: HttpResponse;
  try {
    response = await http.request(request);
  } catch {
    return { ok: false, dispatch: adapterError(networkProblem()) };
  }
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, dispatch: adapterError(upstreamStatusProblem(response.status)) };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, dispatch: adapterError(unexpectedResponseProblem()) };
  }
}

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
    // `version` is the vendor model version (e.g. "3.3"). `stage` is the task lifecycle state, NOT a
    // model version, so it never enters provenance.
    ...(prediction.version !== undefined ? { vendorVersion: prediction.version } : {}),
    ...(segments !== undefined ? { segments } : {}),
    ...(paraphraseSuspected ? { signals: { paraphraseSuspected: true } } : {}),
  };
}

function mapPrediction(input: DetectionInput, prediction: PangramPrediction, now: () => string) {
  return ok(
    normalize(input, toRawDetection(prediction), {
      adapterId: ADAPTER_ID,
      detectedAt: now(),
      egressedTo: EGRESSED_TO,
    }),
  );
}

// Sync: one POST returns the terminal prediction body directly.
async function detectSync(
  config: PangramAdapterConfig,
  input: DetectionInput,
): Promise<Dispatch<DetectionReport>> {
  const result = await fetchJson(config.http, {
    method: "POST",
    url: config.baseUrl,
    headers: jsonHeaders(config.apiKey),
    body: requestBody(input.text),
  });
  if (!result.ok) return result.dispatch;
  const prediction = parsePangramResponse(result.body);
  if (prediction === null) return adapterError(unexpectedResponseProblem());
  return mapPrediction(input, prediction, config.now);
}

// Async: POST /task returns a task_id; poll GET /task/{id} until the stage is terminal (or attempts
// run out). A pending status waits `sleep(pollIntervalMs)` and retries; failed/malformed/exhausted
// all surface as adapter-error with no text leak.
async function detectAsync(
  config: PangramAdapterConfig,
  input: DetectionInput,
): Promise<Dispatch<DetectionReport>> {
  const submitResult = await fetchJson(config.http, {
    method: "POST",
    url: `${config.baseUrl}/task`,
    headers: jsonHeaders(config.apiKey),
    body: requestBody(input.text),
  });
  if (!submitResult.ok) return submitResult.dispatch;
  const submitted = parsePangramSubmit(submitResult.body);
  if (submitted === null) return adapterError(unexpectedResponseProblem());

  const interval = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxAttempts = config.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  const pollUrl = `${config.baseUrl}/task/${submitted.taskId}`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pollResult = await fetchJson(config.http, {
      method: "GET",
      url: pollUrl,
      headers: jsonHeaders(config.apiKey),
    });
    if (!pollResult.ok) return pollResult.dispatch;
    const status = parsePangramTaskStatus(pollResult.body);
    if (status.kind === "success") return mapPrediction(input, status.prediction, config.now);
    if (status.kind === "failed" || status.kind === "malformed") {
      return adapterError(unexpectedResponseProblem());
    }
    // pending — wait and poll again, unless this was the last attempt.
    if (attempt < maxAttempts - 1) await config.sleep(interval);
  }
  return adapterError(
    integrationProblem("upstream", 502, "Detection timed out", {
      detail: "The detection provider did not return a result in time.",
    }),
  );
}

export function createPangramAdapter(config: PangramAdapterConfig): AiTextDetectionPort {
  return {
    async detect(input: DetectionInput): Promise<Dispatch<DetectionReport>> {
      return config.mode === "sync" ? detectSync(config, input) : detectAsync(config, input);
    },
  };
}
