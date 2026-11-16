import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";

// A failing engine must be diagnosable from the metrics, not only from a person's screen. A route
// that answers 503 because the engine it is bound to returned an error records the engine's status
// and the engine's own error code: a fixed word such as "inference-failed", never file content. A
// Container that cannot start (500 or 503 with no code) then reads differently from a file the
// engine could not handle.
export async function recordEngineFailure(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  engine: "ocr" | "file-repair",
  operation: string,
  response: Response,
): Promise<void> {
  const body: unknown = await response.json().catch(() => null);
  const code =
    typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
      ? body.code.slice(0, 64)
      : "none";
  c.get("logger")?.count("files.engine_failure", {
    engine,
    operation,
    status: String(response.status),
    code,
  });
}
