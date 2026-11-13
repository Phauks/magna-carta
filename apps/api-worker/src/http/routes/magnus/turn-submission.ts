import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { MagnusConversationId, MagnusTurnId, UserId } from "@magna-carta/identifiers/types";
import { primaryReasoningModelDefinition } from "@magna-carta/inference/settings";
import { MAGNUS_DISCLOSURE_VERSION } from "@magna-carta/magnus/disclosure";
import { MEMBER_TURN_MAX_BYTES, exceedsMemberTurnCap } from "@magna-carta/magnus/limits";
import { magnusDailyTurnCeilingDefinition } from "@magna-carta/magnus/settings";
import { countMemberTurnsSince, readNextSequence } from "@magna-carta/magnus/statements";
import { submitTurn } from "@magna-carta/magnus/turn";
import type { Context } from "hono";
import type { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import { requireChokepointIdempotency } from "../../chokepoint/context-accessors.ts";
import { problemJson } from "../../contracts/problem.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { modelChoiceRefusal, resolveModelChoice } from "../../../magnus/model-choice.ts";

// Putting a question to Magnus: the checks every question passes and the one atomic batch that
// records it, shared by asking (the submit route) and asking again (an edit, which re-asks from the
// message it rewrites). An edit spends the firm's allowance and reaches a model exactly as a new
// question does, so it passes exactly the same gates in exactly the same order.

export function utcDayStart(nowIso: string): string {
  return `${civilDateOf(nowIso)}T00:00:00.000Z`;
}

export interface TurnToAccept {
  readonly firm: ReturnType<typeof requireChokepointFirmContext>;
  readonly userId: UserId;
  readonly conversationId: MagnusConversationId;
  readonly content: string;
  readonly modelId?: string | undefined;
  readonly effort?: string | undefined;
  // The member turn an edit rewrites, and where it sits.
  readonly replaces?: { readonly turnId: MagnusTurnId; readonly sequence: number };
}

function tooLarge(c: Context) {
  return problemJson(c, {
    type: "magnus-turn-too-large",
    title: "Message too long",
    status: 422,
    detail: `A message is limited to ${MEMBER_TURN_MAX_BYTES} bytes.`,
  });
}

// The caller has already passed the consent gates and established that the member owns the
// conversation. Answers 202 with the pending pair, or the refusal that names what stopped it.
export async function acceptTurn(c: Context, input: TurnToAccept) {
  const { firm, conversationId, content } = input;

  // The member's choice of model and effort is checked against the same roster the firm chooses
  // from, and refused by name when it is not on it (apps/api-worker/src/magnus/model-choice.ts).
  const chosen =
    input.modelId === undefined && input.effort === undefined
      ? null
      : resolveModelChoice(
          await readFirmSetting(firm.firmDatabase, primaryReasoningModelDefinition),
          { modelId: input.modelId, effort: input.effort },
        );
  if (chosen !== null && chosen.kind !== "ok") return problemJson(c, modelChoiceRefusal(chosen));

  // The cap is checked here as well as at the write path: a member gets a refusal naming the limit
  // rather than a request that succeeds and quietly ships a deposition to a provider.
  if (exceedsMemberTurnCap(content)) return tooLarge(c);

  // The firm's daily allowance, checked BEFORE anything is enqueued. This is the limit that matters:
  // the assistant is the first surface where one member can generate unbounded provider spend just by
  // typing, so the firm is told it reached its own ceiling by name.
  const ceiling = await readFirmSetting(firm.firmDatabase, magnusDailyTurnCeilingDefinition);
  const spent = await countMemberTurnsSince(
    firm.firmDatabase,
    utcDayStart(new Date().toISOString()),
  );
  if (spent >= ceiling) {
    return problemJson(c, {
      type: "magnus-daily-ceiling-reached",
      title: "The firm's daily allowance is spent",
      status: 429,
      detail: `This firm's daily limit of ${ceiling} messages has been reached. It resets at 00:00 UTC.`,
    });
  }

  const nextSequence = await readNextSequence(firm.firmDatabase, conversationId);
  const idempotency = requireChokepointIdempotency(c);
  const now = () => new Date().toISOString();
  const result = await runIdempotentEffect({
    database: firm.firmDatabase,
    key: idempotency.key,
    fingerprint: idempotency.fingerprint,
    now,
    effect: async () => {
      const submission = submitTurn(
        firm.firmDatabase,
        { clock: { now }, actorUserId: input.userId, randomSource: cryptoRandomSource },
        {
          conversationId,
          content,
          nextSequence,
          disclosureVersion: MAGNUS_DISCLOSURE_VERSION,
          ...(chosen !== null && { choice: chosen.choice }),
          ...(input.replaces !== undefined && { replaces: input.replaces }),
        },
      );
      if (!submission.ok) {
        // Unreachable given the check above; kept because the domain is the authority on its own cap
        // and a route that silently disagreed with it would be the bug.
        return {
          write: { statements: [], outboxMessages: [] },
          responseCode: 422,
          responseBody: null,
        };
      }
      return {
        write: submission.effect,
        responseCode: 202,
        responseBody: canonicalJsonStringify({
          conversationId,
          memberTurnId: submission.memberTurnId,
          magnusTurnId: submission.magnusTurnId,
          status: "pending",
        }),
      };
    },
  });
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return problemResponseForIdempotencyConflict(c, result);
  }
  if (result.responseBody === null) return tooLarge(c);
  return c.json(
    JSON.parse(result.responseBody) as {
      conversationId: string;
      memberTurnId: string;
      magnusTurnId: string;
      status: "pending";
    },
    202,
  );
}
