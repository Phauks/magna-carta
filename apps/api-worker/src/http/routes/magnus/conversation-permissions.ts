import { z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  ConversationPermissionName,
  ConversationPermissionRequest,
  ConversationPermissions,
} from "@magna-carta/magnus/contract";
import {
  listConversationPermissions,
  setConversationPermission,
  type ConversationPermission,
} from "@magna-carta/magnus/permissions";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
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

// What Magnus may read beyond the conversation itself, turned on or off by the conversation's
// author for that one conversation. Every permission starts off. Only the author changes them,
// because only the author asks in the conversation, and each change is audited by name.

const setPermissionRoute = defineOpenAPIRoute(mutationMeta("setConversationPermission", true), {
  method: "put",
  path: "/api/v1/magnus/conversations/{conversationId}/permissions/{permission}",
  description:
    "Turns one of Magnus's read permissions on or off for one of the caller's conversations. " +
    "Turning on a permission already on, or off one already off, changes nothing. Answers with " +
    "every permission now on for the conversation.",
  request: {
    params: z.object({
      conversationId: identifierPathParam("magnusConversation", "conversationId"),
      permission: ConversationPermissionName,
    }),
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: ConversationPermissionRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The permissions now on for the conversation",
      content: { "application/json": { schema: ConversationPermissions } },
    },
    ...commonErrors,
  },
});

export function registerMagnusConversationPermissionRoutes(
  app: MagnusApp,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...setPermissionRoute, middleware: chokepointMiddleware(chokepoint, setPermissionRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const refusal = consentRefusal(c, await resolveMagnusConsent(firm.firmDatabase, userId));
      if (refusal !== null) return refusal;
      const { conversationId, permission } = c.req.valid("param");
      const { granted } = c.req.valid("json");
      if ((await requireOwnConversation(c, conversationId, userId)) === null) return notFound(c);
      const idempotency = requireChokepointIdempotency(c);
      const nowIso = new Date().toISOString();
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now: () => nowIso,
        effect: async () => {
          const current = new Set<ConversationPermission>(
            await listConversationPermissions(firm.firmDatabase, conversationId),
          );
          if (granted) current.add(permission);
          else current.delete(permission);
          return {
            write: setConversationPermission(
              firm.firmDatabase,
              { clock: { now: () => nowIso }, actorUserId: userId },
              { conversationId, permission, granted, memberId: userId },
            ),
            responseCode: 200,
            responseBody: canonicalJsonStringify({ permissions: [...current].sort() }),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      return c.json(
        JSON.parse(result.responseBody ?? "{}") as { permissions: ConversationPermission[] },
        200,
      );
    },
  );
}
