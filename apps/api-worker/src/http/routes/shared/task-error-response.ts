import type { TaskValidationError } from "@magna-carta/tasks/validation";
import type { Context } from "hono";
import { problemJson, type ProblemResponse } from "../../contracts/problem.ts";

// How a refused task act is answered, shared by the two domains that create tasks: the task routes
// themselves, and a meeting summary's action item made into a task. One mapping, so a refusal reads
// the same whichever screen the task was made from.
export function taskErrorResponse(
  c: Context,
  caught: TaskValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  switch (caught.code) {
    case "task-unknown":
    case "task-unknown-file":
    case "task-unknown-predecessor":
    // 404 and not 403: which matter a task or a document belongs to is itself a fact about the
    // firm's work, and a distinguishable refusal would let a caller probe for either.
    case "task-matter-mismatch":
    case "task-file-matter-mismatch":
    case "task-predecessor-matter-mismatch":
    case "task-list-unknown":
    case "task-status-unknown":
    case "task-team-unknown":
    case "task-parent-unknown":
    case "task-checklist-item-unknown":
    case "task-link-unknown":
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    // Where the task stands is not where this move applies. A conflict rather than a validation
    // failure: the request was well-formed and the record moved under it, which is what a second
    // person completing the same task looks like.
    case "task-not-open":
    case "task-not-done":
    case "task-already-archived":
    case "task-not-archived":
    case "task-status-move-not-in-flow":
    case "task-list-name-taken":
    case "task-status-name-taken":
    case "task-team-name-taken":
    case "task-list-is-default":
    case "task-status-in-use":
    case "task-status-last":
      return problemJson(c, {
        type: "conflict",
        title: "That task is not where this change applies",
        status: 409,
        detail: caught.message,
      });
    default:
      return problemJson(c, {
        type: "validation",
        title: "Task request invalid",
        status: 422,
        detail: caught.message,
      });
  }
}
