import { CIVIL_DATE_PATTERN } from "@magna-carta/civil-time/civil-date";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { BatchDatabase, EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { identifierField } from "@magna-carta/identifiers/field";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  DirectoryPersonId,
  FileId,
  FileVersionId,
  FolderId,
  ShareId,
  UserId,
} from "@magna-carta/identifiers/types";
import { shareReadContext } from "@magna-carta/sharing/share-access";
import { listMatterShares } from "@magna-carta/sharing/share-reads";
import {
  changeShare,
  revokeShare,
  shareItems,
  ShareValidationError,
  MAXIMUM_SHARES_PER_WRITE,
} from "@magna-carta/sharing/share-service";
import { SHARE_ROLES, SHARE_SIGN_INS, type ShareTarget } from "@magna-carta/sharing/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// Sharing a matter's files and folders with people outside the firm, over @magna-carta/sharing.
//
// The File Manager reads ONE list per matter (every live share, with the person's name) and draws the
// shared mark, the Shared With column, the Sharing tab and the Sharing view from it. Writes share a
// selection with one or more people, change one share, or stop one. A stopped share is kept, revoked,
// so who could see what stays answerable; the person is refused on their next request.

const FILES_SHARE = "files:share" as const;

const ShareTargetBody = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("matter") }),
  z.object({ scope: z.literal("folder"), folderId: identifierField("folder") }),
  z.object({
    scope: z.literal("file"),
    fileId: identifierField("file"),
    // Hold this version still, so the person keeps seeing the copy that was sent.
    fileVersionId: identifierField("fileVersion").nullable().optional(),
  }),
]);

const ShareRequest = z
  .object({
    items: z.array(ShareTargetBody).min(1).max(MAXIMUM_SHARES_PER_WRITE),
    people: z
      .array(z.object({ entityId: identifierField("directoryPerson"), role: z.enum(SHARE_ROLES) }))
      .min(1)
      .max(50),
    allowDownload: z.boolean().optional(),
    signIn: z.enum(SHARE_SIGN_INS).optional(),
    endsOn: z.string().regex(CIVIL_DATE_PATTERN).nullable().optional(),
  })
  .openapi("ShareFilesRequest");

const ChangeShareRequest = z
  .object({
    role: z.enum(SHARE_ROLES).optional(),
    allowDownload: z.boolean().optional(),
    signIn: z.enum(SHARE_SIGN_INS).optional(),
    endsOn: z.string().regex(CIVIL_DATE_PATTERN).nullable().optional(),
  })
  .openapi("ChangeShareRequest");

const ShareSummary = z
  .object({
    id: z.string(),
    matterId: z.string(),
    scope: z.enum(["matter", "folder", "file"]),
    folderId: z.string().nullable(),
    fileId: z.string().nullable(),
    fileVersionId: z.string().nullable(),
    recipientEntityId: z.string(),
    recipientName: z.string().nullable(),
    role: z.enum(SHARE_ROLES),
    allowDownload: z.boolean(),
    signIn: z.enum(SHARE_SIGN_INS),
    endsOn: z.string().nullable(),
    sharedByUserId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    // Present when the share is still recorded but no longer opens: "ended" past its end date,
    // "needsNewSharer" when the member who made it can no longer share. Changing it takes it over.
    dormant: z.enum(["ended", "needsNewSharer"]).nullable(),
  })
  .openapi("ShareSummary");

const ShareListResponse = z.object({ data: z.array(ShareSummary) }).openapi("ShareListResponse");
const SharedResponse = z.object({ shareIds: z.array(z.string()) }).openapi("SharedFilesResponse");
const ShareAcknowledged = z.object({ ok: z.literal(true) }).openapi("ShareAcknowledged");

const matterIdParam = z.object({ matterId: identifierPathParam("matter", "matterId") });
const shareIdParam = z.object({ shareId: identifierPathParam("share", "shareId") });

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});
const errors = {
  400: problem("Missing Idempotency-Key (this operation requires one)"),
  401: problem("No valid session"),
  403: problem("The session member lacks the required permission"),
  404: problem("The firm is unreachable, the member is deactivated, or the matter or share is unknown"),
  409: problem("A request with this Idempotency-Key is still in progress"),
  422: problem("The request names something that cannot be shared"),
  429: problem("Rate limited"),
} as const;

const listMeta: RouteMeta = {
  operationId: "shares.list",
  surface: "app",
  authenticated: true,
  // Who can see a matter's files outside the firm is a fact every member working the matter needs
  // to see, on the same footing as the folder tree itself.
  permission: null,
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

function writeMeta(action: string): RouteMeta {
  return {
    operationId: `shares.${action}`,
    surface: "app",
    authenticated: true,
    permission: FILES_SHARE,
    resource: "matter",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const listSharesRoute = defineOpenAPIRoute(listMeta, {
  method: "get",
  path: "/api/v1/matters/{matterId}/shares",
  description:
    "Every live share on the matter, with the person's name: who outside the firm can see which " +
    "file, folder or the matter's top level, and what each can do. Shares that no longer open are " +
    "included and marked, so they can be ended or taken over.",
  request: { params: matterIdParam },
  responses: {
    200: { description: "The matter's shares", content: { "application/json": { schema: ShareListResponse } } },
    401: errors[401],
    403: errors[403],
    404: errors[404],
    429: errors[429],
  },
});

const shareRoute = defineOpenAPIRoute(writeMeta("share"), {
  method: "post",
  path: "/api/v1/matters/{matterId}/shares",
  description:
    "Shares files, folders or the matter's top level with people in the Directory. A folder share " +
    "covers the files inside it, including files added later, and not the folders inside it. " +
    "Where a person already has an item, their share is changed rather than doubled.",
  request: {
    headers: idempotencyKeyHeader,
    params: matterIdParam,
    body: { content: { "application/json": { schema: ShareRequest } }, required: true },
  },
  responses: {
    201: { description: "Shared", content: { "application/json": { schema: SharedResponse } } },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const changeShareRoute = defineOpenAPIRoute(
  { ...writeMeta("change"), reversal: { kind: "inverse", by: "shares.change" } },
  {
    method: "patch",
    path: "/api/v1/shares/{shareId}",
    description:
      "Changes what the person can do with a share: the role, download, sign-in, or end date. The " +
      "member who changes it becomes the one it answers to.",
    request: {
      headers: idempotencyKeyHeader,
      params: shareIdParam,
      body: { content: { "application/json": { schema: ChangeShareRequest } }, required: true },
    },
    responses: {
      200: { description: "Changed", content: { "application/json": { schema: ShareAcknowledged } } },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
      422: errors[422],
      429: errors[429],
    },
  },
);

const stopShareRoute = defineOpenAPIRoute(
  { ...writeMeta("stop"), reversal: { kind: "inverse", by: "shares.share" } },
  {
    method: "delete",
    path: "/api/v1/shares/{shareId}",
    description:
      "Stops a share. The person is refused on their next request. The record is kept, so who " +
      "could see what and until when stays answerable; sharing the item again makes a new share.",
    request: { headers: idempotencyKeyHeader, params: shareIdParam },
    responses: {
      200: { description: "Stopped", content: { "application/json": { schema: ShareAcknowledged } } },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
      422: errors[422],
      429: errors[429],
    },
  },
);

function serviceOptions(userId: string) {
  return {
    clock: { now: () => new Date().toISOString() },
    actorUserId: userId as UserId,
    randomSource: cryptoRandomSource,
    visibility: visibleMatterPredicate(),
  };
}

function shareErrorResponse(
  c: Context,
  caught: ShareValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  if (caught.code === "matter-unknown" || caught.code === "share-unknown") {
    return problemJson(c, { type: "not-found", title: "Not found", status: 404, detail: caught.message });
  }
  return problemJson(c, { type: "validation", title: "Share request invalid", status: 422, detail: caught.message });
}

type Outcome =
  | { ok: true; body: unknown; replayed: boolean }
  | { ok: false; problem: ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> };

async function commitShareEffect(
  c: Context,
  database: BatchDatabase,
  idempotency: { key: string | undefined; fingerprint: string },
  responseCode: number,
  call: () => Promise<{ body: unknown; effect: EffectWrite }>,
): Promise<Outcome> {
  let result;
  try {
    result = await runIdempotentEffect({
      database,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const { body, effect } = await call();
        return { write: effect, responseCode, responseBody: canonicalJsonStringify(body) };
      },
    });
  } catch (caught) {
    if (caught instanceof ShareValidationError) return { ok: false, problem: shareErrorResponse(c, caught) };
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return { ok: false, problem: problemResponseForIdempotencyConflict(c, result) };
  }
  return { ok: true, body: JSON.parse(result.responseBody ?? "{}"), replayed: result.kind === "replayed" };
}

function toTarget(item: z.infer<typeof ShareTargetBody>): ShareTarget {
  if (item.scope === "matter") return { scope: "matter" };
  if (item.scope === "folder") return { scope: "folder", folderId: item.folderId as FolderId };
  return {
    scope: "file",
    fileId: item.fileId as FileId,
    fileVersionId: (item.fileVersionId ?? null) as FileVersionId | null,
  };
}

export function registerSharesRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // GET /api/v1/matters/{matterId}/shares
  app.openapi(
    { ...listSharesRoute, middleware: chokepointMiddleware(chokepoint, listSharesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { matterId } = c.req.valid("param");
      const data = await listMatterShares(firm.firmDatabase, matterId, shareReadContext(Date.now()));
      return c.json({ data }, 200);
    },
  );

  // POST /api/v1/matters/{matterId}/shares
  app.openapi({ ...shareRoute, middleware: chokepointMiddleware(chokepoint, shareRoute) }, async (c) => {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const idempotency = requireChokepointIdempotency(c);
    const { matterId } = c.req.valid("param");
    const request = c.req.valid("json");
    const outcome = await commitShareEffect(c, firm.firmDatabase, idempotency, 201, async () => {
      const { shareIds, effect } = await shareItems(
        firm.firmDatabase,
        {
          matterId,
          items: request.items.map(toTarget),
          people: request.people.map((person) => ({
            entityId: person.entityId as DirectoryPersonId,
            role: person.role,
          })),
          allowDownload: request.allowDownload,
          signIn: request.signIn,
          endsOn: request.endsOn,
        },
        serviceOptions(userId),
      );
      return { body: { shareIds }, effect };
    });
    if (!outcome.ok) return outcome.problem;
    if (outcome.replayed) c.header("Idempotency-Replayed", "true");
    return c.json(outcome.body as z.infer<typeof SharedResponse>, 201);
  });

  // PATCH /api/v1/shares/{shareId}
  app.openapi(
    { ...changeShareRoute, middleware: chokepointMiddleware(chokepoint, changeShareRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { shareId } = c.req.valid("param");
      const request = c.req.valid("json");
      const outcome = await commitShareEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await changeShare(firm.firmDatabase, shareId as ShareId, request, serviceOptions(userId));
        return { body: { ok: true }, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );

  // DELETE /api/v1/shares/{shareId}
  app.openapi(
    { ...stopShareRoute, middleware: chokepointMiddleware(chokepoint, stopShareRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { shareId } = c.req.valid("param");
      const outcome = await commitShareEffect(c, firm.firmDatabase, idempotency, 200, async () => {
        const { effect } = await revokeShare(firm.firmDatabase, shareId as ShareId, serviceOptions(userId));
        return { body: { ok: true }, effect };
      });
      if (!outcome.ok) return outcome.problem;
      if (outcome.replayed) c.header("Idempotency-Replayed", "true");
      return c.json({ ok: true } as const, 200);
    },
  );
}
