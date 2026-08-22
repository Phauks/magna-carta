import type { Context } from "hono";
import { problemJson, type ProblemResponse } from "../contracts/problem.ts";
import {
  EmailEngineFaultError,
  EmailEngineUnavailableError,
  MessageRefusedError,
} from "./email-engine-port.ts";

/**
 * Turn an engine failure into the reply it deserves, so every REQUEST-PATH caller of the email
 * engine answers the same fact the same way.
 *
 * Three states reach here and only one of them is a verdict:
 *
 * - `MessageRefusedError` — the engine read the bytes and they are not a message it can read. A
 *   **413** for `limitExceeded` (the caller can act on it by sending less) and a **422** otherwise,
 *   carrying no echo of the submitted message.
 * - `EmailEngineUnavailableError` — no engine is wired into this deployment. A **503**.
 * - `EmailEngineFaultError` — a wired engine could not answer. A **503**, retryable.
 *
 * Neither 503 mints an Error ID: the member asked about their own file and the answer is about our
 * engine, not their bytes. Anything else returns null so the caller rethrows it and the standard
 * error path handles it as the genuine fault it is.
 *
 * The QUEUE caller does not use this — a queue has no reply to give. The capture consumer branches
 * on the same three errors and turns them into a terminal ack, a retry, or a retry respectively;
 * see emails/capture-consumer.ts.
 */
export function emailEngineProblem(
  c: Context,
  error: unknown,
): ProblemResponse<413> | ProblemResponse<422> | ProblemResponse<503> | null {
  if (error instanceof MessageRefusedError) {
    if (error.code === "limitExceeded") {
      return problemJson(c, {
        type: "upload-not-allowed",
        status: 413,
        title: "Email too large to inspect",
        detail: "The file exceeds the engine's decode limits.",
      });
    }
    if (error.code === "unsupported") {
      return problemJson(c, {
        type: "validation",
        status: 422,
        title: "Unsupported email format",
        detail: "The bytes are not an email format this tool can read.",
      });
    }
    return problemJson(c, {
      type: "validation",
      status: 422,
      title: "Could not parse the email",
      detail: "The bytes could not be read as an email.",
    });
  }
  if (error instanceof EmailEngineUnavailableError) {
    return problemJson(c, {
      type: "service-unavailable",
      status: 503,
      title: "The email engine is not available",
      detail:
        "No email parse engine is wired into this deployment, so the file could not be read. Nothing was stored.",
    });
  }
  if (error instanceof EmailEngineFaultError) {
    return problemJson(c, {
      type: "service-unavailable",
      status: 503,
      title: "The email engine is unreachable",
      detail:
        "The email parse engine did not answer, so the file could not be read. Nothing was stored. Try again shortly.",
    });
  }
  return null;
}
