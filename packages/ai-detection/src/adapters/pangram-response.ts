// Pangram's `predict` response, validated at the trust boundary before any mapping. Hand-rolled (no
// schema library) so the pure package stays dependency-free. A shape violation returns null — the
// adapter maps that to a validation problem, never a throw and never a silently-dropped field.

export interface PangramWindow {
  readonly start_index: number;
  readonly end_index: number;
  readonly ai_assistance_score: number;
  readonly confidence?: number;
}

export interface PangramPrediction {
  readonly fraction_ai: number;
  readonly fraction_ai_assisted?: number;
  readonly version?: string;
  readonly stage?: string;
  readonly windows?: readonly PangramWindow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

// A probability field must be a finite number in [0, 1]; a NaN, an infinity, or an out-of-range value
// (e.g. a buggy vendor emitting fraction_ai: 5) is a malformed body, not a signal to trust — reject it
// at the boundary rather than let it drive a band.
function isUnitProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function optionalUnitProbability(value: unknown): value is number | undefined {
  return value === undefined || isUnitProbability(value);
}

function parseWindow(value: unknown): PangramWindow | null {
  if (!isRecord(value)) return null;
  if (typeof value.start_index !== "number") return null;
  if (typeof value.end_index !== "number") return null;
  if (!isUnitProbability(value.ai_assistance_score)) return null;
  if (!optionalUnitProbability(value.confidence)) return null;
  return {
    start_index: value.start_index,
    end_index: value.end_index,
    ai_assistance_score: value.ai_assistance_score,
    ...(value.confidence !== undefined ? { confidence: value.confidence } : {}),
  };
}

export function parsePangramResponse(json: unknown): PangramPrediction | null {
  if (!isRecord(json)) return null;
  if (!isUnitProbability(json.fraction_ai)) return null;
  if (!optionalUnitProbability(json.fraction_ai_assisted)) return null;
  if (!optionalString(json.version)) return null;
  if (!optionalString(json.stage)) return null;

  let windows: PangramWindow[] | undefined;
  if (json.windows !== undefined) {
    if (!Array.isArray(json.windows)) return null;
    windows = [];
    for (const raw of json.windows) {
      const parsed = parseWindow(raw);
      if (parsed === null) return null;
      windows.push(parsed);
    }
  }

  return {
    fraction_ai: json.fraction_ai,
    ...(json.fraction_ai_assisted !== undefined
      ? { fraction_ai_assisted: json.fraction_ai_assisted }
      : {}),
    ...(json.version !== undefined ? { version: json.version } : {}),
    ...(json.stage !== undefined ? { stage: json.stage } : {}),
    ...(windows !== undefined ? { windows } : {}),
  };
}

// The async external-api submit response — a task handle to poll. `task_id` is the only field we need.
export function parsePangramSubmit(json: unknown): { readonly taskId: string } | null {
  if (!isRecord(json)) return null;
  if (typeof json.task_id !== "string") return null;
  if (json.task_id === "") return null;
  return { taskId: json.task_id };
}

// A poll response's meaning, driven by the task lifecycle `stage` field. STAGE_SUCCESS carries the
// terminal prediction (validated the same way as the sync body); STAGE_FAILED is a terminal failure;
// any other/absent stage means the task is still running (keep polling). A non-object — or a claimed
// success whose prediction does not validate — is malformed.
export type PangramTaskStatus =
  | { readonly kind: "success"; readonly prediction: PangramPrediction }
  | { readonly kind: "failed" }
  | { readonly kind: "pending" }
  | { readonly kind: "malformed" };

export function parsePangramTaskStatus(json: unknown): PangramTaskStatus {
  if (!isRecord(json)) return { kind: "malformed" };
  const stage = typeof json.stage === "string" ? json.stage : undefined;
  if (stage === "STAGE_FAILED") return { kind: "failed" };
  if (stage === "STAGE_SUCCESS") {
    const prediction = parsePangramResponse(json);
    return prediction === null ? { kind: "malformed" } : { kind: "success", prediction };
  }
  return { kind: "pending" };
}
