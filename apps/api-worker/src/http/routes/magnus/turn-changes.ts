import { z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type { MagnusConversationId, MagnusTurnId } from "@magna-carta/identifiers/types";
import { RemovedTurn, SubmitTurnRequest, SubmittedTurn } from "@magna-carta/magnus/contract";
import { hasPendingTurn, readTurn, readTurnAtSequence } from "@magna-carta/magnus/statements";
import {
  TURN_REMOVE_GUARD,
  removeTurn,
  turnChangeRefusal,
  type TurnChangeRefusal,
} from "@magna-carta/magnus/turn";
import type { TurnRow } from "@magna-carta/magnus/types";
import type { Context } from "hono";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { resolveMagnusConsent } from "../../../magnus/consent.ts";
import {
  commonErrors,
  consentRefusal,
  mutationMeta,
  notFound,
  requireOwnConversation,
  type MagnusApp,
} from "./route-shared.ts";
import { acceptTurn } from "./turn-submission.ts";

// Changing one's own message: editing it, which asks again from that point, and removing it, which
// takes it and its answer out of the conversation behind a marker.
//
// Neither erases anything. A transcript is the firm's work product and is erased only with its whole
// conversation, so an edit SETS ASIDE the message and every turn after it, and a removal HIDES the
// pair: both stay on the record, neither is read by the model again, and the reader sees a marker
// where they were. Only the conversation's author changes its messages (only its author asks in it),
// and nothing changes while an answer is being written.

const turnParams = z.object({
  conversationId: identifierPathParam("magnusConversation", "conversationId"),
  turnId: identifierPathParam("magnusTurn", "turnId"),
});

const unchangeable = {
  description:
    "The message cannot be changed now: it is an answer rather than a member's message, it was " +
    "already removed or replaced, or an answer is still being written in the conversation",
  content: { "application/problem+json": { schema: Problem } },
};

const editTurnRoute = defineOpenAPIRoute(mutationMeta("editTurn", true), {
  method: "patch",
  path: "/api/v1/magnus/conversations/{conversationId}/turns/{turnId}",
  description:
    "Edits one of the caller's messages and asks again from that point. The message and every " +
    "turn after it are set aside, kept on the record but no longer sent to the model, and the edit " +
    "is recorded as a new message naming the one it replaces, with a pending answer. It passes the " +
    "same checks as a new message: the size cap, the model choice and the firm's daily allowance.",
  request: {
    params: turnParams,
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: SubmitTurnRequest } }, required: true },
  },
  responses: {
    202: {
      description: "The edit was recorded and an answer is pending",
      content: { "application/json": { schema: SubmittedTurn } },
    },
    ...commonErrors,
    409: unchangeable,
    422: {
      description:
        "The message exceeds the per-turn size limit, or names a model or effort it cannot",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "The firm's daily allowance is spent",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const removeTurnRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("removeTurn", true),
    reversal: {
      kind: "none",
      reason:
        "The message and its answer stay on the record, but nothing puts them back into the conversation or in front of the model; asking the question again is a new message.",
    },
  },
  {
    method: "delete",
    path: "/api/v1/magnus/conversations/{conversationId}/turns/{turnId}",
    description:
      "Removes one of the caller's messages and the answer to it from the conversation. Both are " +
      "kept on the record and shown behind a marker, never sent to the model again, and erased " +
      "only when the whole conversation is deleted.",
    request: { params: turnParams, headers: idempotencyKeyHeader },
    responses: {
      200: {
        description: "The message and its answer were removed",
        content: { "application/json": { schema: RemovedTurn } },
      },
      ...commonErrors,
      409: unchangeable,
    },
  },
);

const REFUSAL_DETAIL: Record<TurnChangeRefusal, string> = {
  "not-yours":
    "Only a member's own message can be changed. An answer is removed with its question.",
  "already-gone": "This message was already removed, or replaced by an edit.",
  "answer-pending":
    "An answer is still being written in this conversation. Try again once it settles.",
};

function refuse(c: Context, refusal: TurnChangeRefusal) {
  return problemJson(c, {
    type: "magnus-turn-unchangeable",
    title: "This message cannot be changed now",
    status: 409,
    detail: REFUSAL_DETAIL[refusal],
  });
}

// The member turn being changed, in this conversation, and whether it may be changed now.
async function changeableTurn(
  database: Parameters<typeof readTurn>[0],
  conversationId: MagnusConversationId,
  turnId: MagnusTurnId,
): Promise<
  | { kind: "missing" }
  | { kind: "refused"; refusal: TurnChangeRefusal }
  | { kind: "ok"; turn: TurnRow }
> {
  const turn = await readTurn(database, turnId);
  if (turn === undefined || turn.conversationId !== conversationId) return { kind: "missing" };
  const refusal = turnChangeRefusal(turn, await hasPendingTurn(database, conversationId));
  return refusal === null ? { kind: "ok", turn } : { kind: "refused", refusal };
}

export function registerMagnusTurnChangeRoutes(app: MagnusApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...editTurnRoute, middleware: chokepointMiddleware(chokepoint, editTurnRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const refusal = consentRefusal(c, await resolveMagnusConsent(firm.firmDatabase, userId));
      if (refusal !== null) return refusal;
      const { conversationId, turnId } = c.req.valid("param");
      const { content, modelId, effort } = c.req.valid("json");
      if ((await requireOwnConversation(c, conversationId, userId)) === null) return notFound(c);
      const target = await changeableTurn(firm.firmDatabase, conversationId, turnId);
      if (target.kind === "missing") return notFound(c);
      if (target.kind === "refused") return refuse(c, target.refusal);
      return acceptTurn(c, {
        firm,
        userId,
        conversationId,
        content,
        modelId,
        effort,
        replaces: { turnId, sequence: target.turn.sequence },
      });
    },
  );

  app.openapi(
    { ...removeTurnRoute, middleware: chokepointMiddleware(chokepoint, removeTurnRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const refusal = consentRefusal(c, await resolveMagnusConsent(firm.firmDatabase, userId));
      if (refusal !== null) return refusal;
      const { conversationId, turnId } = c.req.valid("param");
      if ((await requireOwnConversation(c, conversationId, userId)) === null) return notFound(c);
      const target = await changeableTurn(firm.firmDatabase, conversationId, turnId);
      if (target.kind === "missing") return notFound(c);
      if (target.kind === "refused") return refuse(c, target.refusal);

      // The answer is the turn that follows the message, when it is Magnus's and still standing.
      const next = await readTurnAtSequence(
        firm.firmDatabase,
        conversationId,
        target.turn.sequence + 1,
      );
      const answerId =
        next !== undefined && next.speaker === "magnus" && next.supersededAt === null
          ? next.id
          : null;
      const idempotency = requireChokepointIdempotency(c);
      const nowIso = new Date().toISOString();
      let result: Awaited<ReturnType<typeof runIdempotentEffect>>;
      try {
        result = await runIdempotentEffect({
          database: firm.firmDatabase,
          key: idempotency.key,
          fingerprint: idempotency.fingerprint,
          now: () => nowIso,
          effect: async () => ({
            write: removeTurn(
              firm.firmDatabase,
              { clock: { now: () => nowIso }, actorUserId: userId },
              { conversationId, memberTurnId: turnId, magnusTurnId: answerId },
            ),
            responseCode: 200,
            responseBody: canonicalJsonStringify({
              memberTurnId: turnId,
              magnusTurnId: answerId,
              removedAt: nowIso,
            }),
          }),
        });
      } catch (caught) {
        // Removed, or set aside by an edit, between the read above and the commit.
        if (caught instanceof GuardedWriteRefusedError && caught.guard === TURN_REMOVE_GUARD) {
          return refuse(c, "already-gone");
        }
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as {
          memberTurnId: string;
          magnusTurnId: string | null;
          removedAt: string;
        },
        200,
      );
    },
  );
}
