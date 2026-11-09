import { type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import {
  SETTING_TABLE,
  readFirmSetting,
  writeFirmSettingStatement,
} from "@magna-carta/data-access/setting-statements";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  CATALOG_EFFECTIVE_DATE,
  CATALOG_VERSION,
  catalogEntryFor,
  reasoningEntries,
  reasoningModelIds,
  type CatalogEntry,
} from "@magna-carta/inference/catalog";
import {
  reconcileProviderRoster,
  type ProviderRosterReconciliation,
  type ProviderRosterSnapshot,
} from "@magna-carta/inference/provider-roster";
import {
  aiProcessingEligibilityDefinition,
  primaryReasoningModelDefinition,
} from "@magna-carta/inference/settings";
import {
  magnusDailyTurnCeilingDefinition,
  magnusEnabledDefinition,
} from "@magna-carta/magnus/settings";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";
import {
  AiModelChoice,
  AiModelFacts,
  FirmAiSettingsResponse,
  PatchFirmAiSettingsRequest,
} from "@magna-carta/inference/contract";
import { readProviderRoster } from "../../../inference/provider-roster-source.ts";

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
// THE MODEL IS A CHOICE THE FIRM MAKES, AND CAN SEE. `inference.primaryReasoningModel` is reported
// here with its facts and written here from the roster. The roster is the platform's curated
// catalog and nothing else: every entry on it carries a human's recorded finding that the model is
// zero-data-retention eligible and not trained on, and neither the Workers AI binding nor the AI
// Gateway offers a way to list models at runtime — and a list that did could not carry that finding.
// So the roster is as current as the catalog, and the page states the catalog's version and
// effective date beside it, because that is the honest answer to "how fresh is this list".
//
// WHAT THE PROVIDER PUBLISHES IS STATED BESIDE IT, AND DECIDES NOTHING. Where the platform holds a
// read-only Anthropic key, the route also reads the provider's own model list (cached; see
// apps/api-worker/src/inference/provider-roster-source.ts) and reports two things the catalog cannot
// know about itself between verification passes: whether each roster entry is still published, and
// which published models the roster does not yet carry. The second list is shown, never offered —
// a model joins the roster only through the verification pass, because only that pass can record
// whether the provider keeps what it is sent.
//
// TWO POSTURES, ONE SETTING. A firm that has never chosen FOLLOWS THE PLATFORM: its model is the
// catalog's occupant of the platform's reasoning tier, which moves forward as better models are
// verified. A firm that has chosen is PINNED to that model until it chooses again, because a
// selection about its own confidential content is not something the platform re-decides on its
// behalf (packages/inference/src/settings.ts says why the asymmetry is deliberate). The control on
// the settings page offers both — "the platform's current model" and each roster entry — and the
// route tells the two apart by whether a row exists, so touching the dropdown never silently converts
// "follow" into "pinned": choosing the platform's option DELETES the row, and choosing a model writes
// one.

const PERMISSION = "firm:manageAiSettings" as const;

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
    "changes nothing and records nothing. `model.modelId` pins the firm to one of the roster's " +
    "verified models; `model.modelId: null` returns the firm to following the platform's current " +
    "model. A model not on the roster is refused. Returns the settings after the write.",
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

// Whether the firm has chosen a model at all. The setting read is total and answers the platform's
// default for a missing row, which is right for every consumer of the value and wrong for the one
// question this route also has to answer: does the firm FOLLOW the platform, or has it pinned? Only
// the row's existence says, so it is read as a row.
async function firmHasChosenModel(database: FirmDatabase): Promise<boolean> {
  const { results } = await database
    .prepare(`SELECT key FROM ${SETTING_TABLE} WHERE key = ?1`)
    .bind(primaryReasoningModelDefinition.key)
    .all<{ key: string }>();
  return results.length > 0;
}

// Returning the firm to the platform's choice is the ABSENCE of a row, not a row naming today's
// default: a row would pin the firm to today's model, which is exactly the conversion this route
// exists not to make silently.
function clearFirmModelStatement(database: FirmDatabase): SqlStatement {
  return database
    .prepare(`DELETE FROM ${SETTING_TABLE} WHERE key = ?1`)
    .bind(primaryReasoningModelDefinition.key);
}

function choiceBody(
  entry: CatalogEntry,
  reconciliation: ProviderRosterReconciliation,
): z.infer<typeof AiModelChoice> {
  return {
    modelId: entry.modelId,
    displayName: entry.displayName,
    snapshotId: entry.snapshotId,
    zeroDataRetention: entry.zdrEligible,
    noTraining: entry.noTrainingEligible,
    verifiedOn: entry.verifiedOn,
    availabilityVerifiedOn: entry.availabilityVerifiedOn,
    retirementNotBefore: entry.retirementNotBefore ?? null,
    tier: entry.tier ?? null,
    effortLevels: [...(entry.effortLevels ?? [])],
    defaultEffort: entry.defaultEffort ?? null,
    platformDefault: entry.modelId === primaryReasoningModelDefinition.defaultValue,
    published: reconciliation.published.get(entry.modelId) ?? null,
  };
}

// The facts of the platform's own current choice, for the merged response of a write that returned
// the firm to following it.
function platformModelFacts(): z.infer<typeof AiModelFacts> | null {
  const entry = catalogEntryFor(primaryReasoningModelDefinition.defaultValue);
  return entry === undefined
    ? null
    : {
        modelId: entry.modelId,
        snapshotId: entry.snapshotId,
        zeroDataRetention: entry.zdrEligible,
        noTraining: entry.noTrainingEligible,
        selection: "platform",
      };
}

async function readAiSettingsBody(
  database: FirmDatabase,
  providerRoster: Promise<ProviderRosterSnapshot>,
): Promise<AiSettingsBody> {
  const [eligible, modelId, chosen, enabled, dailyTurnCeiling, snapshot] = await Promise.all([
    readFirmSetting(database, aiProcessingEligibilityDefinition),
    readFirmSetting(database, primaryReasoningModelDefinition),
    firmHasChosenModel(database),
    readFirmSetting(database, magnusEnabledDefinition),
    readFirmSetting(database, magnusDailyTurnCeilingDefinition),
    providerRoster,
  ]);
  const entry = catalogEntryFor(modelId);
  const reasoning = reasoningEntries();
  const reconciliation = reconcileProviderRoster(reasoning, snapshot);
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
            selection: chosen ? "chosen" : "platform",
          },
    models: reasoning.map((choice) => choiceBody(choice, reconciliation)),
    catalog: { version: CATALOG_VERSION, effectiveDate: CATALOG_EFFECTIVE_DATE },
    provider: {
      status: snapshot.status,
      checkedAt: snapshot.checkedAt,
      awaitingVerification: reconciliation.awaitingVerification.map((model) => ({
        modelId: model.id,
        displayName: model.displayName,
      })),
    },
    magnus: { enabled, dailyTurnCeiling },
  };
}

// The provider roster for this request: the platform key from the environment, the request's own
// logger and correlation id so a failed read is one more event on the request that caused it.
function providerRosterFor(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
): Promise<ProviderRosterSnapshot> {
  return readProviderRoster({
    apiKey: c.env.ANTHROPIC_MODELS_API_KEY,
    logger: c.get("logger"),
    correlationId: c.get("correlationId"),
  });
}

export function registerFirmAiSettingsRoutes(app: AiSettingsApp, chokepoint: Chokepoint): void {
  // GET /api/v1/firm/ai/settings
  app.openapi(
    { ...getRoute, middleware: chokepointMiddleware(chokepoint, getRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      return c.json(await readAiSettingsBody(firm.firmDatabase, providerRosterFor(c)), 200);
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
      // `model` absent leaves the choice alone; present, it is either a roster entry or null.
      const modelChoice = body.model === undefined ? undefined : body.model.modelId;
      if (
        eligible === undefined &&
        enabled === undefined &&
        dailyTurnCeiling === undefined &&
        modelChoice === undefined
      ) {
        // An empty patch changes nothing and must not add an audit row: a redelivered no-op would
        // otherwise put a consent decision in the log that nobody made.
        return c.json(await readAiSettingsBody(firm.firmDatabase, providerRosterFor(c)), 200);
      }
      // A model off the roster is refused at the contract, with the roster's own vocabulary in the
      // reason. The setting definition's schema would refuse it too, but inside the effect, where it
      // reads as a fault rather than an answer.
      if (
        modelChoice !== undefined &&
        modelChoice !== null &&
        !reasoningModelIds().includes(modelChoice)
      ) {
        return problemJson(c, {
          type: "validation",
          title: "That model is not one the firm can choose",
          status: 422,
          detail:
            "Only a model the platform has verified for zero data retention can be chosen. The " +
            "roster on the settings page is the whole list.",
        });
      }

      const idempotency = requireChokepointIdempotency(c);
      const now = () => new Date().toISOString();
      const stored = await readAiSettingsBody(firm.firmDatabase, providerRosterFor(c));
      const chosenEntry =
        modelChoice === undefined || modelChoice === null
          ? undefined
          : catalogEntryFor(modelChoice);
      const merged: AiSettingsBody = {
        aiProcessing: { eligible: eligible ?? stored.aiProcessing.eligible },
        model:
          modelChoice === undefined
            ? stored.model
            : modelChoice === null
              ? platformModelFacts()
              : chosenEntry === undefined
                ? stored.model
                : {
                    modelId: chosenEntry.modelId,
                    snapshotId: chosenEntry.snapshotId,
                    zeroDataRetention: chosenEntry.zdrEligible,
                    noTraining: chosenEntry.noTrainingEligible,
                    selection: "chosen",
                  },
        models: stored.models,
        catalog: stored.catalog,
        provider: stored.provider,
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
                ...(modelChoice === undefined
                  ? []
                  : modelChoice === null
                    ? [clearFirmModelStatement(firm.firmDatabase)]
                    : [
                        writeFirmSettingStatement(
                          firm.firmDatabase,
                          primaryReasoningModelDefinition,
                          modelChoice,
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
      return c.json(await readAiSettingsBody(firm.firmDatabase, providerRosterFor(c)), 200);
    },
  );
}
