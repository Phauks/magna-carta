import type { Bindings } from "../bindings.ts";
import type { MagnusTurnJob } from "./magnus-types.ts";

// The hand-off from the per-firm transactional outbox onto the MAGNUS queue.
//
// A submitted turn's outbox row is written in the SAME atomic batch as the two turn rows and the
// audit row it refers to, so a queued job can never point at rows that did not commit, and a
// committed turn can never fail to be queued. The relay sweeps that row onto the shared per-firm bus
// and this handler forwards it to the assistant's own queue — which is what gives the work its own
// dead-letter queue and its own concurrency, separate from every other per-firm topic.
//
// The payload carries identifiers only. What the member typed stays in the turn row, read back by the
// consumer through the firm-scoped data-access layer.
export interface MagnusTurnSubmittedPayload {
  readonly conversationId: string;
  readonly magnusTurnId: string;
  readonly memberTurnId: string;
}

// Parses the outbox payload defensively: a row that does not carry the two identifiers the job needs
// is not a job, and forwarding a malformed one would put an unanswerable message on the queue.
export function parseMagnusTurnSubmittedPayload(
  payload: string,
): MagnusTurnSubmittedPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const conversationId = record["conversationId"];
  const magnusTurnId = record["magnusTurnId"];
  const memberTurnId = record["memberTurnId"];
  if (
    typeof conversationId !== "string" ||
    typeof magnusTurnId !== "string" ||
    typeof memberTurnId !== "string"
  ) {
    return null;
  }
  return { conversationId, magnusTurnId, memberTurnId };
}

export function magnusTurnJobFrom(
  firmId: string,
  outboxId: string,
  payload: MagnusTurnSubmittedPayload,
): MagnusTurnJob {
  return {
    firmId,
    conversationId: payload.conversationId,
    magnusTurnId: payload.magnusTurnId,
    outboxId,
  };
}

export async function forwardMagnusTurnSubmitted(
  env: Bindings,
  firmId: string,
  outboxId: string,
  payload: string,
): Promise<void> {
  const parsed = parseMagnusTurnSubmittedPayload(payload);
  if (parsed === null) return;
  await env.MAGNUS.send(magnusTurnJobFrom(firmId, outboxId, parsed));
}
