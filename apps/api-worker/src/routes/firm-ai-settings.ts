import { type OpenAPIHono, z } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  readFirmSetting,
  writeFirmSettingStatement,
} from "@magna-carta/data-access/setting-statements";
import { catalogEntryFor } from "@magna-carta/inference/catalog";
import {
  aiProcessingEligibilityDefinition,
  primaryReasoningModelDefinition,
} from "@magna-carta/inference/settings";
import {
  magnusDailyTurnCeilingDefinition,
  magnusEnabledDefinition,
} from "@magna-carta/magnus/settings";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../contracts/common.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";

// THE FIRM'S AI SETTINGS — the one place a firm says whether its content may reach a model, and
// whether the assistant is one of the things that may send it.
//
// Both settings existed and had no reader but the settings write path, which is why every firm's
// assistant rendered its closed state with no way to open it. They are read and written together
// here because they are ONE DECISION taken in two parts: `inference.aiProcessingEligibility` asks
// whether privileged content may leave for a third-party provider at all, and `magnus.enabled` asks
// whether the free-form assistant is one of the features that may do it. A firm that enabled
// inference for drafting has not thereby consented to an assistant, and a firm that switches the
// assistant off has not thereby withdrawn consent for everything else — so neither setting subsumes
// the other and neither may be inferred from the other. `apps/api-worker/src/magnus/consent.ts` is
// the sole reader of the pair on the enforcement side; this route is the sole writer.
//
// THE MODEL IS STATED, NOT SELECTED. `inference.primaryReasoningModel` is reported here and cannot
// be written through this route. Consenting to third-party processing without being told which model
// receives the content, what it retains, and whether it trains on it, is consent to nothing legible,
// so the facts travel with the gate. Selection is a different question with a real design cost: an
// unconfigured firm follows the platform's reasoning tier and moves forward with it, while a firm
// that has chosen a model id keeps that choice forever, so a control that wrote a model id on the
// firm's behalf would silently convert "follow the platform" into "pinned", which is not what
// touching a dropdown should mean. That control lands with a setting that can express the tier.

const PERMISSION = "firm:manageAiSettings" as const;

// The four facts a firm needs about the model its content reaches: which one, the exact snapshot
// that produced any given answer, and the two confidentiality guarantees the gateway pins per
// request. `snapshotId` may equal `modelId` without a prefix — the catalog records why (a provider
// that publishes no dated form makes the undated id itself the pin).
const AiModelFacts = z
  .object({
    modelId: z.string(),
    snapshotId: z.string(),
    zeroDataRetention: z.boolean(),
    noTraining: z.boolean(),
  })
  .openapi("AiModelFacts");

const FirmAiSettingsResponse = z
  .object({
    aiProcessing: z.object({ eligible: z.boolean() }),
    // Null when the firm's stored model id is not in the curated catalog at all. The setting read is
    // total (an unrecognized stored value yields the platform default), so this is unreachable
    // today; it stays nullable rather than asserted because a catalog entry can be retired while a
    // firm's row still names it, and a screen that says nothing is honest where one that names a
    // model the platform no longer carries is not.
    model: AiModelFacts.nullable(),
    magnus: z.object({
      enabled: z.boolean(),
      dailyTurnCeiling: z.number().int(),
    }),
  })
  .openapi("FirmAiSettingsResponse");

const PatchFirmAiSettingsRequest = z
  .object({
    // Sparse: a field absent is unchanged, and an empty patch writes nothing and audits nothing.
    aiProcessing: z.object({ eligible: z.boolean().optional() }).optional(),
    magnus: z
      .object({
        enabled: z.boolean().optional(),
        // The same bounds the setting definition enforces at the write path, declared here so a bad
        // value is a 422 against the contract rather than a throw inside the effect.
        dailyTurnCeiling: z.number().int().min(0).max(100000).optional(),
      })
      .optional(),
  })
  .openapi("PatchFirmAiSettingsRequest");

const errorResponses = {
  400: {
    description: "The Idempotency-Key header is missing on a write",
    content: { "application/problem+json": { schema: Problem } },
  },
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks firm:manageAiSettings",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable or the member is deactivated",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description: "A request with this Idempotency-Key is already in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description:
      "The request body is invalid, or the Idempotency-Key was reused with a different body",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const getMeta: RouteMeta = {
  operationId: "firmAiSettings.get",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const patchMeta: RouteMeta = {
  operationId: "firmAiSettings.update",
  surface: "app",
  authenticated: true,
  permission: PERMISSION,
  resource: "firm",
  // Audited, and this is the audit row that matters most in the whole settings surface: it is the
  // record of who decided that the firm's privileged content could leave for a third party, and
  // when. The metadata is the patch itself — two booleans and an integer, nothing a person typed.
  audited: true,
  idempotency: "required",
  idempotencyStore: "firm",
  rateLimit: "default",
};

const getRoute = defineOpenAPIRoute(getMeta, {
  method: "get",
  path: "/api/v1/firm/ai/settings",
  description:
    "Reads the firm's AI settings: whether its content may reach a third-party model at all, " +
    "whether the assistant may send it, the assistant's daily question allowance, and the facts " +
    "about the model in force — which model, the exact snapshot behind an answer, and whether the " +
    "provider retains or trains on what it receives. Both gates are closed until a firm opens them.",
  responses: {
    200: {
      description: "The firm's AI settings",
      content: { "application/json": { schema: FirmAiSettingsResponse } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    429: errorResponses[429],
  },
});

const patchRoute = defineOpenAPIRoute(patchMeta, {
  method: "patch",
  path: "/api/v1/firm/ai/settings",
  description:
    "Updates the firm's AI settings. Sparse: an absent field is left alone, and an empty patch " +
    "changes nothing and records nothing. The model in force is reported, never written. Returns " +
    "the settings after the write.",
  request: {
    headers: idempotencyKeyHeader,
    body: {
      required: true,
      content: { "application/json": { schema: PatchFirmAiSettingsRequest } },
    },
  },
  responses: {
    200: {
      description: "The firm's AI settings after the write",
      content: { "application/json": { schema: FirmAiSettingsResponse } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    422: errorResponses[422],
    429: errorResponses[429],
  },
});

type AiSettingsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
type AiSettingsBody = z.infer<typeof FirmAiSettingsResponse>;
type FirmDatabase = Parameters<typeof readFirmSetting>[0];

async function readAiSettingsBody(database: FirmDatabase): Promise<AiSettingsBody> {
  const [eligible, modelId, enabled, dailyTurnCeiling] = await Promise.all([
    readFirmSetting(database, aiProcessingEligibilityDefinition),
    readFirmSetting(database, primaryReasoningModelDefinition),
    readFirmSetting(database, magnusEnabledDefinition),
    readFirmSetting(database, magnusDailyTurnCeilingDefinition),
  ]);
  const entry = catalogEntryFor(modelId);
  return {
    aiProcessing: { eligible },
    model:
      entry === undefined
        ? null
        : {
            modelId: entry.modelId,
            snapshotId: entry.snapshotId,
            zeroDataRetention: entry.zdrEligible,
            noTraining: entry.noTrainingEligible,
          },
    magnus: { enabled, dailyTurnCeiling },
  };
}

export function registerFirmAiSettingsRoutes(app: AiSettingsApp, chokepoint: Chokepoint): void {
  // GET /api/v1/firm/ai/settings
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      return c.json(await readAiSettingsBody(firm.firmDatabase), 200);
    },
  );

  // PATCH /api/v1/firm/ai/settings
  app.openapi(
    { ...patchRoute, middleware: chokepointMiddleware(chokepoint, patchRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const actorUserId = requireChokepointUserId(c);
      const body = c.req.valid("json");
      const eligible = body.aiProcessing?.eligible;
      const enabled = body.magnus?.enabled;
      const dailyTurnCeiling = body.magnus?.dailyTurnCeiling;
      if (eligible === undefined && enabled === undefined && dailyTurnCeiling === undefined) {
        // An empty patch changes nothing and must not add an audit row: a redelivered no-op would
        // otherwise put a consent decision in the log that nobody made.
        return c.json(await readAiSettingsBody(firm.firmDatabase), 200);
      }

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const stored = await readAiSettingsBody(firm.firmDatabase);
      const merged: AiSettingsBody = {
        aiProcessing: { eligible: eligible ?? stored.aiProcessing.eligible },
        model: stored.model,
        magnus: {
          enabled: enabled ?? stored.magnus.enabled,
          dailyTurnCeiling: dailyTurnCeiling ?? stored.magnus.dailyTurnCeiling,
        },
      };

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => {
          const timestamp = now();
          return {
            write: {
              statements: [
                ...(eligible === undefined
                  ? []
                  : [
                      writeFirmSettingStatement(
                        firm.firmDatabase,
                        aiProcessingEligibilityDefinition,
                        eligible,
                        timestamp,
                      ),
                    ]),
                ...(enabled === undefined
                  ? []
                  : [
                      writeFirmSettingStatement(
                        firm.firmDatabase,
                        magnusEnabledDefinition,
                        enabled,
                        timestamp,
                      ),
                    ]),
                ...(dailyTurnCeiling === undefined
                  ? []
                  : [
                      writeFirmSettingStatement(
                        firm.firmDatabase,
                        magnusDailyTurnCeilingDefinition,
                        dailyTurnCeiling,
                        timestamp,
                      ),
                    ]),
                insertAuditLogStatement(firm.firmDatabase, {
                  id: newIdentifier("auditLog"),
                  event: "firm.ai_settings_updated",
                  actorUserId,
                  subjectId: null,
                  // The patch as submitted: two booleans and an integer, nothing a person typed.
                  metadata: body,
                  now: timestamp,
                }),
              ],
              outboxMessages: [],
            },
            responseCode: 200,
            // Composed from the merged value rather than re-read: a read inside this effect would
            // not yet see its own uncommitted write.
            responseBody: canonicalJsonStringify(merged),
          };
        },
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemResponseForIdempotencyConflict(c, result);
      if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
      return c.json(await readAiSettingsBody(firm.firmDatabase), 200);
    },
  );
}
