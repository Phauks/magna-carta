import type { Context } from "hono";
import { problemJson, type ProblemResponse } from "../contracts/problem.ts";
import {
  DecryptionEngineFaultError,
  DecryptionEngineUnavailableError,
  HashExtractionRefusedError,
  UnlockRefusedError,
} from "./decryption-engine-port.ts";

/**
 * Turn an engine failure into the reply it deserves, so the routes that call the engine cannot
 * answer the same fact two different ways.
 *
 * Four errors reach here and only two of them are verdicts:
 *
 * - `HashExtractionRefusedError` — the engine read the file and there is no hash in it. A **400**
 *   carrying the stable code, and no echo of any file content.
 * - `UnlockRefusedError` — the engine ran the decrypt and got no plaintext, including the
 *   wrong-password case. Also a **400** carrying the stable code, and — the part that matters —
 *   carrying nothing of the password that failed.
 * - `DecryptionEngineUnavailableError` — no engine is wired into this deployment. A **503**.
 * - `DecryptionEngineFaultError` — a wired engine could not answer. A **503**, retryable.
 *
 * Neither 503 mints an Error ID's worth of blame on the member: they asked about their own file and
 * the answer is about our engine, not their bytes. Anything else returns null so the caller
 * rethrows it and the standard error path handles it as the genuine fault it is.
 *
 * `toolName` names the surface in the refusal detail ("the decryption tool", "the recovery tool"),
 * which is the only part of the wording the routes have ever differed on.
 */
export function decryptionEngineProblem(
  c: Context,
  error: unknown,
  toolName: string,
): ProblemResponse<400> | ProblemResponse<503> | null {
  if (error instanceof HashExtractionRefusedError) {
    const title =
      error.code === "notEncrypted"
        ? "The file is not encrypted"
        : error.code === "unsupported"
          ? "Encrypted file format not supported"
          : "The file could not be read";
    return problemJson(c, {
      type: "validation",
      status: 400,
      title,
      // Stable code surfaces without echoing any file content.
      detail: `${toolName} could not extract a recovery hash (${error.code}).`,
    });
  }
  if (error instanceof UnlockRefusedError) {
    if (error.code === "wrongPassword") {
      // Generic detail only — do NOT reveal whether the file or format was otherwise valid, and
      // never echo the password or any file content.
      return problemJson(c, {
        type: "wrong-password",
        status: 400,
        title: "Wrong password",
        detail: "The supplied password did not decrypt the file.",
      });
    }
    const title =
      error.code === "notEncrypted"
        ? "The file is not encrypted"
        : error.code === "unsupported"
          ? "Encrypted file format not supported"
          : "The file could not be read";
    return problemJson(c, {
      type: "validation",
      status: 400,
      title,
      // Stable code surfaces without echoing any file content.
      detail: `${toolName} could not decrypt the file (${error.code}).`,
    });
  }
  if (error instanceof DecryptionEngineUnavailableError) {
    return problemJson(c, {
      type: "service-unavailable",
      status: 503,
      title: "The decryption engine is not available",
      detail:
        "No decryption engine is wired into this deployment, so the file could not be examined. Nothing was stored.",
    });
  }
  if (error instanceof DecryptionEngineFaultError) {
    return problemJson(c, {
      type: "service-unavailable",
      status: 503,
      title: "The decryption engine is unreachable",
      detail:
        "The decryption engine did not answer, so the file could not be examined. Nothing was stored. Try again shortly.",
    });
  }
  return null;
}
