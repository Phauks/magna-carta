import { z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import type { MagnusConversationId, UserId } from "@magna-carta/identifiers/types";
import {
  ARTIFACT_RESTORE_GUARD,
  listArtifacts,
  readArtifact,
  readArtifactVersionContent,
  restoreArtifactVersion,
  type ListedArtifact,
} from "@magna-carta/magnus/artifact";
import {
  ArtifactSummary,
  ArtifactVersionText,
  ConversationArtifacts,
  RestoreArtifactVersionRequest,
} from "@magna-carta/magnus/contract";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import { resolveMagnusConsent } from "../../../magnus/consent.ts";
import {
  commonErrors,
  consentRefusal,
  mutationMeta,
  notFound,
  readMeta,
  requireOwnConversation,
  requireReadableConversation,
  type MagnusApp,
} from "./route-shared.ts";

// The documents Magnus wrote in a conversation, and their versions. Whoever can read the
// conversation reads its documents: the author, or a holder of the supervisory permission, whose
// read of the conversation itself is what is audited. Only the author restores a version, because
// only the author works in the conversation.

const conversationParams = z.object({
  conversationId: identifierPathParam("magnusConversation", "conversationId"),
});
const artifactParams = z.object({
  conversationId: identifierPathParam("magnusConversation", "conversationId"),
  artifactId: identifierPathParam("magnusArtifact", "artifactId"),
});
const versionParams = z.object({
  conversationId: identifierPathParam("magnusConversation", "conversationId"),
  artifactId: identifierPathParam("magnusArtifact", "artifactId"),
  versionNumber: z.coerce
    .number()
    .int()
    .min(1)
    .openapi({ param: { name: "versionNumber", in: "path" } }),
});

const listArtifactsRoute = defineOpenAPIRoute(readMeta("listArtifacts"), {
  method: "get",
  path: "/api/v1/magnus/conversations/{conversationId}/artifacts",
  description:
    "The documents Magnus wrote in a conversation, oldest first, each with its versions but not " +
    "their text.",
  request: { params: conversationParams },
  responses: {
    200: {
      description: "The conversation's documents",
      content: { "application/json": { schema: ConversationArtifacts } },
    },
    ...commonErrors,
  },
});

const readVersionRoute = defineOpenAPIRoute(readMeta("readArtifactVersion"), {
  method: "get",
  path: "/api/v1/magnus/conversations/{conversationId}/artifacts/{artifactId}/versions/{versionNumber}",
  description: "The text of one version of a document Magnus wrote.",
  request: { params: versionParams },
  responses: {
    200: {
      description: "The version's text",
      content: { "application/json": { schema: ArtifactVersionText } },
    },
    ...commonErrors,
  },
});

const restoreVersionRoute = defineOpenAPIRoute(
  {
    ...mutationMeta("restoreArtifactVersion", true),
    reversal: {
      kind: "none",
      reason:
        "Restoring adds a version and removes none, so the versions before it are still there to restore in turn.",
    },
  },
  {
    method: "post",
    path: "/api/v1/magnus/conversations/{conversationId}/artifacts/{artifactId}/restore",
    description:
      "Puts an earlier version of a document back as its newest version. Nothing is overwritten: " +
      "the new version names the one it came from, and every version stays.",
    request: {
      params: artifactParams,
      headers: idempotencyKeyHeader,
      body: {
        content: { "application/json": { schema: RestoreArtifactVersionRequest } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The document with its new version",
        content: { "application/json": { schema: ArtifactSummary } },
      },
      ...commonErrors,
    },
  },
);

function artifactBody(artifact: ListedArtifact) {
  return {
    id: artifact.id,
    title: artifact.title,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    versions: artifact.versions.map((version) => ({
      versionNumber: version.versionNumber,
      note: version.note,
      writtenByTurnId: version.writtenByTurnId,
      memberUserId: version.memberUserId,
      restoredFromVersion: version.restoredFromVersion,
      createdAt: version.createdAt,
      bytes: version.bytes,
    })),
  };
}

function documentNotFound(c: Parameters<typeof notFound>[0]) {
  return problemJson(c, { type: "not-found", status: 404, title: "Document not found" });
}

export function registerMagnusArtifactRoutes(app: MagnusApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...listArtifactsRoute, middleware: chokepointMiddleware(chokepoint, listArtifactsRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const refusal = consentRefusal(c, await resolveMagnusConsent(firm.firmDatabase, userId));
      if (refusal !== null) return refusal;
      const { conversationId } = c.req.valid("param");
      if ((await requireReadableConversation(c, conversationId, userId)) === null) {
        return notFound(c);
      }
      const artifacts = await listArtifacts(firm.firmDatabase, conversationId);
      return c.json({ artifacts: artifacts.map(artifactBody) }, 200);
    },
  );

  app.openapi(
    { ...readVersionRoute, middleware: chokepointMiddleware(chokepoint, readVersionRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const refusal = consentRefusal(c, await resolveMagnusConsent(firm.firmDatabase, userId));
      if (refusal !== null) return refusal;
      const { conversationId, artifactId, versionNumber } = c.req.valid("param");
      if ((await requireReadableConversation(c, conversationId, userId)) === null) {
        return notFound(c);
      }
      const artifact = await readArtifact(firm.firmDatabase, artifactId);
      if (artifact === undefined || artifact.conversationId !== conversationId) {
        return documentNotFound(c);
      }
      const content = await readArtifactVersionContent(
        firm.firmDatabase,
        artifactId,
        versionNumber,
      );
      if (content === undefined) return documentNotFound(c);
      return c.json({ artifactId, versionNumber, content }, 200);
    },
  );

  app.openapi(
    { ...restoreVersionRoute, middleware: chokepointMiddleware(chokepoint, restoreVersionRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const refusal = consentRefusal(c, await resolveMagnusConsent(firm.firmDatabase, userId));
      if (refusal !== null) return refusal;
      const { conversationId, artifactId } = c.req.valid("param");
      const { versionNumber } = c.req.valid("json");
      if ((await requireOwnConversation(c, conversationId, userId)) === null) return notFound(c);
      const artifact = await readArtifact(firm.firmDatabase, artifactId);
      if (artifact === undefined || artifact.conversationId !== conversationId) {
        return documentNotFound(c);
      }
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
            write: restoreArtifactVersion(
              firm.firmDatabase,
              { clock: { now: () => nowIso }, actorUserId: userId },
              {
                conversationId: conversationId as MagnusConversationId,
                artifactId,
                versionNumber,
                memberUserId: userId as UserId,
              },
            ),
            responseCode: 200,
            responseBody: canonicalJsonStringify({ artifactId }),
          }),
        });
      } catch (caught) {
        // The version asked for does not exist.
        if (caught instanceof GuardedWriteRefusedError && caught.guard === ARTIFACT_RESTORE_GUARD) {
          return documentNotFound(c);
        }
        throw caught;
      }
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
        return problemResponseForIdempotencyConflict(c, result);
      }
      // The document as it is now, read after the commit, so a replayed request answers with the
      // same document a member sees.
      const artifacts = await listArtifacts(firm.firmDatabase, conversationId);
      const restored = artifacts.find((candidate) => candidate.id === artifactId);
      if (restored === undefined) return documentNotFound(c);
      return c.json(artifactBody(restored), 200);
    },
  );
}
