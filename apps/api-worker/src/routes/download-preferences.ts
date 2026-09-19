import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  resolveScopedSetting,
  writeScopedSettingStatement,
  type ScopedSettingDefinition,
} from "@magna-carta/data-access/scoped-setting-statements";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

/*
 * Whether an export also SAVES a file at the moment it is taken.
 *
 * The default is false, which is the behavior the owner asked for: exporting generates the item onto
 * the member's shelf so several can be taken together later, rather than dropping a file into the
 * browser's download folder every time. A member who preferred the old way turns this on and gets
 * both at once — the file now, and the item on the shelf as well.
 *
 * A MEMBER setting, at the user tier, so it follows the person between machines rather than being a
 * fact about one browser. Deliberately not offered at the firm tier: how somebody likes to take
 * their own files is not a thing a firm decides for them, and the scoped-setting resolver would
 * otherwise let a firm-tier row become a default nobody could see the origin of.
 */
export const DOWNLOAD_SAVE_IMMEDIATELY: ScopedSettingDefinition<boolean> = {
  key: "downloads.saveImmediately",
  schema: z.boolean(),
  defaultValue: false,
};

const DownloadPreferences = z
  .object({ saveImmediately: z.boolean() })
  .openapi("DownloadPreferences");

export const downloadPreferencesGetMeta: RouteMeta = {
  operationId: "downloadPreferences.get",
  surface: "app",
  authenticated: true,
  permission: "downloads:shelf",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const downloadPreferencesUpdateMeta: RouteMeta = {
  operationId: "downloadPreferences.update",
  surface: "app",
  authenticated: true,
  permission: "downloads:shelf",
  resource: "firm",
  // Audited, on the notificationPreferences.update precedent: this is a member's own preference, but
  // it changes whether firm data leaves in a file at the moment of export, and the platform records
  // every write to a stored setting rather than only the loud ones.
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const downloadPreferencesGetRoute = defineOpenAPIRoute(downloadPreferencesGetMeta, {
  method: "get",
  path: "/api/v1/downloads/preferences",
  description:
    "The session member's own download preferences: whether an export also saves a file at the moment it is taken, or only generates the item onto their shelf.",
  responses: {
    200: {
      description: "The member's preferences",
      content: { "application/json": { schema: DownloadPreferences } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks downloads:shelf",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const downloadPreferencesUpdateRoute = defineOpenAPIRoute(downloadPreferencesUpdateMeta, {
  method: "put",
  path: "/api/v1/downloads/preferences",
  description:
    "Set whether the session member's exports also save a file immediately. Writes the member's own tier and nothing else.",
  request: {
    body: { content: { "application/json": { schema: DownloadPreferences } }, required: true },
  },
  responses: {
    200: {
      description: "The preferences as they now stand",
      content: { "application/json": { schema: DownloadPreferences } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks downloads:shelf",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerDownloadPreferenceRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...downloadPreferencesGetRoute,
      middleware: chokepointMiddleware(chokepoint, downloadPreferencesGetRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const saveImmediately = await resolveScopedSetting(
        firm.firmDatabase,
        DOWNLOAD_SAVE_IMMEDIATELY,
        { userId },
      );
      return c.json({ saveImmediately }, 200);
    },
  );

  app.openapi(
    {
      ...downloadPreferencesUpdateRoute,
      middleware: chokepointMiddleware(chokepoint, downloadPreferencesUpdateRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { saveImmediately } = c.req.valid("json");
      const now = new Date().toISOString();
      // The member's OWN tier and nothing else: a person changing how they take their files must
      // never be silently changing it for the firm.
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            writeScopedSettingStatement(
              firm.firmDatabase,
              DOWNLOAD_SAVE_IMMEDIATELY,
              "user",
              userId,
              saveImmediately,
              now,
            ),
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "downloads.preferencesUpdated",
              actorUserId: userId,
              subjectId: userId,
              metadata: { saveImmediately },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );
      return c.json({ saveImmediately }, 200);
    },
  );
}
