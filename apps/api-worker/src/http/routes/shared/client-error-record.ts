// What a crash in the browser sends to be kept, and the one insert that keeps it: shared by the
// member's route (../platform/client-errors.ts) and the meeting guest's
// (../communications/meetings-guest-crash.ts), so the two cannot disagree about what a crash may
// carry.
//
// What arrives is a shape, never content: the handle, the SvelteKit route id (a template such as
// "/(app)/meetings/[meetingId]", not the concrete path), the error's kind, the first stack frame as
// file, line and column, and the build. A message is kept only for the kinds whose message the
// JavaScript engine writes itself, and it is scrubbed here as well as in the browser; anything else is
// dropped, because a message our code or a library wrote can carry what the code had in hand.
import { z } from "@hono/zod-openapi";
import { insertErrorRecordStatement } from "@magna-carta/data-access/error-record-statements";
import { scrubText } from "@magna-carta/telemetry/scrub";
import type { Bindings } from "../../../bindings.ts";
import { publicCause } from "../../contracts/problem.ts";

/** The shape apps/web/src/lib/diagnostics/client-error-id.ts mints: Crockford base32, eight long. */
export const CLIENT_ERROR_ID_PATTERN = /^client_[0-9A-HJKMNP-TV-Z]{8}$/;

export const RecordClientErrorRequest = z
  .object({
    errorId: z.string().regex(CLIENT_ERROR_ID_PATTERN),
    // The SvelteKit route id the crash happened under, or the path where there is none.
    route: z.string().max(200),
    errorName: z.string().max(60),
    // Present only for an engine-written message; the server keeps it only for those kinds too.
    message: z.string().max(200).optional(),
    // The first stack frame, "file.svelte:212:18".
    location: z.string().max(160).optional(),
    build: z.string().max(60),
  })
  .openapi("RecordClientErrorRequest");

export const RecordClientErrorResponse = z
  .object({ errorId: z.string(), recorded: z.boolean() })
  .openapi("RecordClientErrorResponse");

/** The message the record may keep: an engine kind's message, scrubbed, or nothing. */
export function keptClientMessage(errorName: string, message: string | undefined): string | null {
  if (message === undefined || message === "") return null;
  const scrubbed = scrubText(message).text;
  const cause = publicCause(errorName, scrubbed);
  // publicCause returns the bare kind when the kind is not one the engine writes.
  return cause === (errorName === "" ? "Error" : errorName) ? null : scrubbed;
}

/**
 * Keep one browser crash. `route` is what the record files it under: the request's own route
 * template for a member, and a fixed template for a guest, whose address is their link. A second
 * send of one ID is a no-op (the statement ends in ON CONFLICT DO NOTHING).
 */
export async function keepClientError(
  env: Bindings,
  request: z.infer<typeof RecordClientErrorRequest>,
  who: {
    readonly firmId: string;
    readonly userId: string | null;
    readonly correlationId: string | null;
    readonly route: string;
  },
): Promise<void> {
  await insertErrorRecordStatement(env.DB_CONTROL, {
    errorId: request.errorId,
    recordedAt: new Date().toISOString(),
    source: "browser",
    service: "web",
    operation: who.route,
    status: null,
    problemType: null,
    title: null,
    errorName: request.errorName,
    messageHead: keptClientMessage(request.errorName, request.message),
    location: request.location ?? null,
    build: request.build,
    firmId: who.firmId,
    userId: who.userId,
    correlationId: who.correlationId,
  }).run();
}
