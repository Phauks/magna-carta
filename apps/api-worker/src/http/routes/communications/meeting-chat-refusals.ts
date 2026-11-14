import type { MeetingChatValidationError } from "@magna-carta/meetings/chat-validation";
import type { Context } from "hono";
import { problemJson, type ProblemResponse } from "../../contracts/problem.ts";

// What each refusal of the chat service is answered as. Its own module so the routes beside it stay
// glue: one function, the codes in `@magna-carta/meetings/chat-validation`, and why each answers
// the way it does.

export function chatErrorResponse(
  c: Context,
  caught: MeetingChatValidationError,
): ProblemResponse<403> | ProblemResponse<404> | ProblemResponse<422> {
  switch (caught.code) {
    // A handle naming nothing and a message in another meeting, kept indistinguishable for the
    // reason an unreachable room is.
    case "meeting-message-not-found":
      return problemJson(c, {
        type: "meeting-message-not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    case "meeting-message-too-long":
      return problemJson(c, {
        type: "meeting-message-too-long",
        title: "That message is too long",
        status: 422,
        detail: caught.message,
      });
    // Empty is an ordinary shape refusal — there is nothing specific for a surface to do about it
    // beyond what a validation problem already says.
    case "meeting-message-empty":
      return problemJson(c, {
        type: "validation",
        title: "That message is empty",
        status: 422,
        detail: caught.message,
      });
    // A file the room cannot share. Absent rather than forbidden, so a guess at a handle learns
    // nothing about whether it names a file elsewhere.
    case "meeting-message-file-unavailable":
      return problemJson(c, {
        type: "meeting-message-file-unavailable",
        title: "That file cannot be shared here",
        status: 404,
        detail: caught.message,
      });
    // Somebody else's words, and the caller is not hosting. A permission answer rather than an
    // absence, because the message is one they can see in the transcript — pretending it is not
    // there would be a worse answer than saying it is not theirs to remove.
    case "meeting-message-not-redactable":
      return problemJson(c, {
        type: "permission-denied",
        title: "Permission denied",
        status: 403,
        detail: caught.message,
        requestAccess: false,
      });
  }
}
