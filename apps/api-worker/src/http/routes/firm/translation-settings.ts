import type { OpenAPIHono, z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import {
  readFirmSetting,
  writeFirmSettingStatement,
} from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  FirmTranslationSettingsResponse,
  PatchFirmTranslationSettingsRequest,
} from "@magna-carta/translation/contract";
import { translationEnabledDefinition } from "@magna-carta/translation/settings";
import type { Bindings } from "../../../bindings.ts";
import { translationEngineConnected } from "../../../translation/translation-engine.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// THE FIRM'S TRANSLATION SWITCH — the one writer of `translation.enabled`, which the translate route
// reads before any text leaves for Google. Behind firm:manageAiSettings, the permission of the
// firm's other decisions about where its privileged content may go, because this is one of them.
//
// `engineConnected` is a fact about the deployment, not a setting: whether a translation key is set.
// The settings page shows it beside the switch, so a firm that turns translation on in a deployment
// with no key is told why the tool still cannot translate.

type FirmTranslationSettingsBody = z.infer<typeof FirmTranslationSettingsResponse>;

const PERMISSION = "firm:manageAiSettings" as const;

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

const getMeta: RouteMeta = {
  operationId: "firmTranslationSettings.get",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchMeta: RouteMeta = {
  operationId: "firmTranslationSettings.update",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  // The record of who decided that the firm's text could be sent to Google, and when.
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/firm/translation-settings",
  description:
    "Whether the firm's members may translate text with the translation engine (Google Cloud " +
    "Translation), and whether this deployment has an engine set up. Off until the firm turns it on.",
  responses: {
    200: {
      description: "The firm's translation settings",
      content: { "application/json": { schema: FirmTranslationSettingsResponse } },
    },
    401: problem("No valid session"),
    403: problem("The session member lacks firm:manageAiSettings"),
    404: problem("The firm is unreachable or the member is deactivated"),
    429: problem("Rate limit exceeded"),
  },
});

const patchRoute = defineOpenAPIRoute(patchMeta, {
  method: "patch",
  path: "/api/v1/firm/translation-settings",
  description:
    "Turns translation on or off for the firm. An absent field is left alone; the change is audited.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      content: { "application/json": { schema: PatchFirmTranslationSettingsRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The firm's translation settings after the change",
      content: { "application/json": { schema: FirmTranslationSettingsResponse } },
    },
    400: problem("The Idempotency-Key header is missing on a write"),
    401: problem("No valid session"),
    403: problem("The session member lacks firm:manageAiSettings"),
    404: problem("The firm is unreachable or the member is deactivated"),
    409: problem("A request with this Idempotency-Key is already in progress"),
    422: problem(
      "The request body is invalid, or the Idempotency-Key was reused with a different body",
    ),
    429: problem("Rate limit exceeded"),
  },
});

type TranslationSettingsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerFirmTranslationSettingsRoutes(
  app: TranslationSettingsApp,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const body: FirmTranslationSettingsBody = {
        enabled: await readFirmSetting(firm.firmDatabase, translationEnabledDefinition),
        engineConnected: translationEngineConnected(c.env),
      };
      return c.json(body, 200);
    },
  );

  app.openapi(
    { ...patchRoute, middleware: chokepointMiddleware(chokepoint, patchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const body = c.req.valid("json");
      const engineConnected = translationEngineConnected(c.env);
      const enabled = body.enabled;
      if (enabled === undefined) {
        // An empty patch changes nothing and records nothing.
        const unchanged: FirmTranslationSettingsBody = {
          enabled: await readFirmSetting(firm.firmDatabase, translationEnabledDefinition),
          engineConnected,
        };
        return c.json(unchanged, 200);
      }

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const answer: FirmTranslationSettingsBody = { enabled, engineConnected };
      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: () => {
          const timestamp = now();
          return Promise.resolve({
            write: {
              statements: [
                writeFirmSettingStatement(
                  firm.firmDatabase,
                  translationEnabledDefinition,
                  enabled,
                  timestamp,
                ),
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "firm.translation_settings_updated",
                  actorUserId: userId,
                  subjectId: null,
                  // The patch as submitted: one boolean, nothing a person typed.
                  metadata: body,
                  now: timestamp,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            responseBody: canonicalJsonStringify(answer),
          });
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(answer, 200);
    },
  );
}
