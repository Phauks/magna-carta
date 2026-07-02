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

function optionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === "number";
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function parseWindow(value: unknown): PangramWindow | null {
  if (!isRecord(value)) return null;
  if (typeof value.start_index !== "number") return null;
  if (typeof value.end_index !== "number") return null;
  if (typeof value.ai_assistance_score !== "number") return null;
  if (!optionalNumber(value.confidence)) return null;
  return {
    start_index: value.start_index,
    end_index: value.end_index,
    ai_assistance_score: value.ai_assistance_score,
    ...(value.confidence !== undefined ? { confidence: value.confidence } : {}),
  };
}

export function parsePangramResponse(json: unknown): PangramPrediction | null {
  if (!isRecord(json)) return null;
  if (typeof json.fraction_ai !== "number") return null;
  if (!optionalNumber(json.fraction_ai_assisted)) return null;
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
